import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { assertBranchAccess } from '../common/utils/branch-scope';
import type { AuthUser } from '../common/types/auth-user';
import { addMinutes } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { SettingsService } from '../core/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MergeTablesDto } from './dto/tables.dto';
import { TableSessionsService } from './table-sessions.service';

/** Trạng thái bàn được phép đổi thủ công (OCCUPIED chỉ đổi qua mở / đóng phiên) */
const ALLOWED_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  AVAILABLE: ['RESERVED', 'CLEANING'],
  READY: ['AVAILABLE', 'RESERVED', 'CLEANING'],
  RESERVED: ['AVAILABLE', 'READY', 'CLEANING'],
  CLEANING: ['READY', 'AVAILABLE'],
  OCCUPIED: [],
};

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: TableSessionsService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * FR-WAT-02: sơ đồ bàn theo khu vực với trạng thái:
   * Trống / Có khách / Đã đặt (kèm giờ & tên khách) / Đang dọn / Sẵn sàng.
   */
  async floorPlan(branchId: number) {
    const policy = await this.settings.get('reservationPolicy');
    const now = new Date();
    const [zones, openSessions, reservations] = await Promise.all([
      this.prisma.zone.findMany({
        where: { branchId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { tables: { where: { isActive: true }, orderBy: { code: 'asc' } } },
      }),
      this.prisma.tableSession.findMany({
        where: { branchId, status: 'OPEN' },
        include: {
          customer: { select: { fullName: true } },
          orders: { select: { items: { select: { status: true, quantity: true } } } },
          serviceRequests: { where: { status: 'OPEN' }, select: { id: true, type: true, priority: true } },
        },
      }),
      this.prisma.reservation.findMany({
        where: {
          branchId,
          tableId: { not: null },
          status: { in: ['CONFIRMED', 'PENDING'] },
          startAt: { gte: addMinutes(now, -policy.maxHoldMinutes), lte: addMinutes(now, 24 * 60) },
        },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const sessionByTable = new Map(openSessions.map((s) => [s.tableId, s]));
    const nextReservation = new Map<number, (typeof reservations)[number]>();
    for (const r of reservations) if (r.tableId && !nextReservation.has(r.tableId)) nextReservation.set(r.tableId, r);
    const leadLimit = addMinutes(now, policy.reservedLeadMinutes);
    const summary: Record<string, number> = { AVAILABLE: 0, OCCUPIED: 0, RESERVED: 0, CLEANING: 0, READY: 0 };

    const result = zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      locationType: zone.locationType,
      tables: zone.tables.map(({ qrToken: _q, ...t }) => {
        const session = sessionByTable.get(t.mergedIntoId ?? t.id);
        const next = nextReservation.get(t.id);
        let displayStatus: TableStatus = t.status;
        if (t.mergedIntoId) displayStatus = 'OCCUPIED';
        else if ((t.status === 'AVAILABLE' || t.status === 'READY') && next && next.startAt <= leadLimit) {
          displayStatus = 'RESERVED';
        }
        summary[displayStatus]++;
        const items = session?.orders.flatMap((o) => o.items) ?? [];
        return {
          ...t,
          displayStatus,
          session: session
            ? {
                id: session.id,
                guestCount: session.guestCount,
                openedAt: session.openedAt,
                customerName: session.customer?.fullName ?? null,
                pendingItems: items.filter((i) => ['PENDING', 'RECEIVED', 'PREPARING'].includes(i.status)).length,
                readyItems: items.filter((i) => i.status === 'READY').length,
                openRequests: session.serviceRequests,
              }
            : null,
          upcomingReservation: next
            ? {
                id: next.id,
                code: next.code,
                customerName: next.customerName,
                partySize: next.partySize,
                startAt: next.startAt,
                status: next.status,
              }
            : null,
        };
      }),
    }));
    return { branchId, generatedAt: now, summary, zones: result };
  }

  /** FR-WAT-11: cập nhật trạng thái bàn (vd: Đang dọn -> Sẵn sàng) */
  async updateStatus(user: AuthUser, tableId: number, status: TableStatus) {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId } });
    if (!table) throw new NotFoundException('Không tìm thấy bàn');
    assertBranchAccess(user, table.branchId);
    if (table.status === status) return table;
    if (status === 'OCCUPIED') throw new BadRequestException('Hãy mở phiên bàn để chuyển sang trạng thái Có khách');
    if (table.status === 'OCCUPIED' || (await this.sessions.findOpenSession(tableId))) {
      throw new ConflictException('Bàn đang có khách, cần thanh toán / đóng phiên trước');
    }
    if (!ALLOWED_TRANSITIONS[table.status].includes(status)) {
      throw new BadRequestException(`Không thể chuyển từ ${table.status} sang ${status}`);
    }
    const updated = await this.prisma.diningTable.update({ where: { id: tableId }, data: { status } });
    await this.sessions.emitTable(tableId);
    return updated;
  }

  /** FR-WAT-07: gộp bàn cho đoàn khách lớn */
  async merge(user: AuthUser, dto: MergeTablesDto) {
    if (dto.tableIds.includes(dto.targetTableId)) throw new BadRequestException('Danh sách gộp chứa bàn chính');
    const tables = await this.prisma.diningTable.findMany({
      where: { id: { in: [dto.targetTableId, ...dto.tableIds] } },
      include: { mergedTables: { select: { id: true } } },
    });
    const target = tables.find((t) => t.id === dto.targetTableId);
    if (!target || tables.length !== dto.tableIds.length + 1) throw new NotFoundException('Có bàn không tồn tại');
    assertBranchAccess(user, target.branchId);
    if (target.mergedIntoId) throw new BadRequestException(`Bàn ${target.code} đang được gộp vào bàn khác`);
    for (const t of tables) {
      if (t.id === target.id) continue;
      if (t.branchId !== target.branchId || !t.isActive) throw new BadRequestException(`Bàn ${t.code} không hợp lệ`);
      if (t.mergedIntoId || t.mergedTables.length) throw new ConflictException(`Bàn ${t.code} đang trong nhóm gộp khác`);
      if (t.status === 'CLEANING') throw new ConflictException(`Bàn ${t.code} đang dọn`);
    }

    const { session: targetSession } = await this.sessions.openForTable(target.id, { openedById: user.id });
    for (const source of tables.filter((t) => t.id !== target.id)) {
      const srcSession = await this.sessions.findOpenSession(source.id);
      if (srcSession) {
        const bills = await this.prisma.bill.count({
          where: { sessionId: srcSession.id, status: { in: ['OPEN', 'SPLIT', 'PAID'] } },
        });
        if (bills) throw new ConflictException(`Bàn ${source.code} đã có hóa đơn, không thể gộp`);
        await this.prisma.$transaction([
          this.prisma.order.updateMany({ where: { sessionId: srcSession.id }, data: { sessionId: targetSession.id } }),
          this.prisma.serviceRequest.updateMany({
            where: { sessionId: srcSession.id },
            data: { sessionId: targetSession.id },
          }),
          this.prisma.cartItem.updateMany({ where: { sessionId: srcSession.id }, data: { sessionId: targetSession.id } }),
          this.prisma.tableSession.update({
            where: { id: targetSession.id },
            data: { guestCount: { increment: srcSession.guestCount } },
          }),
          this.prisma.tableSession.update({
            where: { id: srcSession.id },
            data: { status: 'CLOSED', closedAt: new Date() },
          }),
        ]);
        this.realtime.toSession(srcSession.token, 'session.merged', {
          intoSessionToken: targetSession.token,
          tableCode: target.code,
        });
      }
      await this.prisma.diningTable.update({
        where: { id: source.id },
        data: { mergedIntoId: target.id, status: 'OCCUPIED' },
      });
    }
    await this.audit.log({
      userId: user.id,
      action: 'table.merge',
      entity: 'DiningTable',
      entityId: target.id,
      data: { tableIds: dto.tableIds },
    });
    this.realtime.toBranchStaff(target.branchId, 'floor.updated', { branchId: target.branchId });
    return this.sessions.detail({ id: targetSession.id });
  }

  /** Tách một bàn ra khỏi nhóm gộp */
  async unmerge(user: AuthUser, tableId: number) {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId } });
    if (!table) throw new NotFoundException('Không tìm thấy bàn');
    assertBranchAccess(user, table.branchId);
    if (!table.mergedIntoId) throw new BadRequestException('Bàn này không nằm trong nhóm gộp');
    const updated = await this.prisma.diningTable.update({
      where: { id: tableId },
      data: { mergedIntoId: null, status: 'CLEANING' },
    });
    await this.audit.log({
      userId: user.id,
      action: 'table.unmerge',
      entity: 'DiningTable',
      entityId: tableId,
      data: { from: table.mergedIntoId },
    });
    this.realtime.toBranchStaff(table.branchId, 'floor.updated', { branchId: table.branchId });
    return updated;
  }
}
