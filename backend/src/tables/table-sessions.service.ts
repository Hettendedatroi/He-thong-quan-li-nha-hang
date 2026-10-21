import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderItemStatus, Prisma, TableStatus } from '@prisma/client';
import { assertBranchAccess } from '../common/utils/branch-scope';
import { prefixedCode, randomToken } from '../common/utils/codes';
import type { AuthUser } from '../common/types/auth-user';
import { AuditService } from '../core/audit.service';
import { SettingsService } from '../core/settings.service';
import { normalizePhone } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { refreshOrderStatus } from '../orders/order-status.util';
import { SplitSessionDto, UpdateSessionDto } from './dto/tables.dto';

export interface OpenSessionOptions {
  guestCount?: number;
  customerId?: number | null;
  reservationId?: number | null;
  openedById?: number | null;
}

const SEATABLE: TableStatus[] = ['AVAILABLE', 'READY', 'RESERVED'];

/**
 * Phiên bàn = một lượt khách ngồi tại bàn. Mọi order, yêu cầu phục vụ, hóa đơn đều gắn vào phiên.
 * Khách truy cập phiên qua token bí mật lấy được khi quét QR (FR-07), không cần cài app (NFR-05).
 */
@Injectable()
export class TableSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Bàn đang gộp vào bàn khác => dùng bàn chính */
  async resolvePrimaryTable(tableId: number) {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId }, include: { zone: true } });
    if (!table || !table.isActive) throw new NotFoundException('Không tìm thấy bàn');
    if (table.mergedIntoId) {
      return this.prisma.diningTable.findUniqueOrThrow({ where: { id: table.mergedIntoId }, include: { zone: true } });
    }
    return table;
  }

  findOpenSession(tableId: number) {
    return this.prisma.tableSession.findFirst({ where: { tableId, status: 'OPEN' } });
  }

  async openForTable(tableId: number, opts: OpenSessionOptions = {}) {
    const table = await this.resolvePrimaryTable(tableId);
    const existing = await this.findOpenSession(table.id);
    if (existing) {
      if (opts.customerId && !existing.customerId) {
        const updated = await this.prisma.tableSession.update({
          where: { id: existing.id },
          data: { customerId: opts.customerId },
        });
        return { session: updated, table, created: false };
      }
      return { session: existing, table, created: false };
    }
    if (table.status === 'CLEANING') {
      throw new ConflictException(`Bàn ${table.code} đang được dọn dẹp, vui lòng đợi nhân viên`);
    }
    if (!SEATABLE.includes(table.status) && table.status !== 'OCCUPIED') {
      throw new ConflictException(`Bàn ${table.code} chưa sẵn sàng`);
    }

    // Khóa theo bàn để 2 người quét QR cùng lúc không tạo 2 phiên
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${2_000_000 + table.id}::bigint)::text`;
      const again = await tx.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' } });
      if (again) return again;
      const created = await tx.tableSession.create({
        data: {
          token: randomToken(24),
          branchId: table.branchId,
          tableId: table.id,
          guestCount: opts.guestCount ?? 1,
          customerId: opts.customerId ?? null,
          reservationId: opts.reservationId ?? null,
          openedById: opts.openedById ?? null,
        },
      });
      await tx.diningTable.update({ where: { id: table.id }, data: { status: 'OCCUPIED' } });
      return created;
    });

    this.realtime.toBranchStaff(table.branchId, 'session.opened', {
      sessionId: session.id,
      tableId: table.id,
      tableCode: table.code,
      guestCount: session.guestCount,
    });
    await this.emitTable(table.id);
    return { session, table: { ...table, status: 'OCCUPIED' as TableStatus }, created: true };
  }

  /** FR-07: khách quét QR tại bàn -> nhận token phiên để xem menu & gọi món */
  async openFromQr(qrToken: string, user?: AuthUser) {
    const scanned = await this.prisma.diningTable.findUnique({ where: { qrToken }, include: { branch: true } });
    if (!scanned || !scanned.isActive || !scanned.branch.isActive) throw new NotFoundException('Mã QR không hợp lệ');
    const customerId = user?.roleCode === 'CUSTOMER' ? user.id : undefined;
    const { session, table } = await this.openForTable(scanned.id, { customerId });
    return {
      sessionToken: session.token,
      sessionId: session.id,
      table: { id: table.id, code: table.code, zone: table.zone?.name },
      scannedTableCode: scanned.code,
      branch: { id: scanned.branch.id, name: scanned.branch.name },
    };
  }

  async getByToken(token: string, requireOpen = true) {
    const session = await this.prisma.tableSession.findUnique({
      where: { token },
      include: { table: true, branch: true },
    });
    if (!session) throw new NotFoundException('Phiên bàn không tồn tại');
    if (requireOpen && session.status !== 'OPEN') {
      throw new GoneException('Phiên bàn đã kết thúc, vui lòng quét lại mã QR trên bàn');
    }
    return session;
  }

  async getOpenById(sessionId: number) {
    const session = await this.prisma.tableSession.findUnique({ where: { id: sessionId }, include: { table: true } });
    if (!session) throw new NotFoundException('Không tìm thấy phiên bàn');
    if (session.status !== 'OPEN') throw new BadRequestException('Phiên bàn đã đóng');
    return session;
  }

  /** Chi tiết phiên: các đơn, trạng thái từng món (FR-14), tạm tính (FR-15) */
  async detail(where: Prisma.TableSessionWhereUniqueInput) {
    const session = await this.prisma.tableSession.findUnique({
      where,
      include: {
        table: { include: { zone: true } },
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true, phone: true, loyaltyPoints: true } },
        reservation: { select: { id: true, code: true, specialRequests: true, note: true } },
        orders: {
          orderBy: { createdAt: 'asc' },
          include: {
            items: {
              orderBy: { id: 'asc' },
              include: { menuItem: { select: { imageUrl: true } }, dishReview: { select: { id: true } } },
            },
          },
        },
        serviceRequests: { where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, orderBy: { createdAt: 'desc' } },
        bills: {
          where: { parentBillId: null },
          orderBy: { createdAt: 'desc' },
          include: { childBills: true, feedback: { select: { id: true, rating: true } } },
        },
      },
    });
    if (!session) throw new NotFoundException('Không tìm thấy phiên bàn');
    const estimate = await this.estimate(session.orders.flatMap((o) => o.items));
    return { ...session, estimate };
  }

  /** FR-15: hóa đơn tạm tính trong suốt bữa ăn */
  async estimate(items: { status: OrderItemStatus; unitPrice: number; quantity: number; discountAmount: number }[]) {
    const billing = await this.settings.get('billing');
    const active = items.filter((i) => i.status !== 'CANCELLED');
    const subtotal = active.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const itemDiscount = active.reduce((s, i) => s + i.discountAmount, 0);
    const afterDiscount = subtotal - itemDiscount;
    const serviceCharge = Math.round((afterDiscount * billing.serviceChargePercent) / 100);
    const vatAmount = Math.round(((afterDiscount + serviceCharge) * billing.vatPercent) / 100);
    return {
      itemCount: active.reduce((s, i) => s + i.quantity, 0),
      subtotal,
      itemDiscount,
      serviceCharge,
      vatAmount,
      total: afterDiscount + serviceCharge + vatAmount,
      vatPercent: billing.vatPercent,
      serviceChargePercent: billing.serviceChargePercent,
    };
  }

  list(branchId: number | undefined, status: 'OPEN' | 'CLOSED' = 'OPEN') {
    return this.prisma.tableSession.findMany({
      where: { ...(branchId ? { branchId } : {}), status },
      include: {
        table: { select: { id: true, code: true, zoneId: true } },
        customer: { select: { id: true, fullName: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { openedAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: status === 'OPEN' ? undefined : 100,
    });
  }

  async update(user: AuthUser, sessionId: number, dto: UpdateSessionDto) {
    const session = await this.getOpenById(sessionId);
    assertBranchAccess(user, session.branchId);
    let customerId: number | undefined;
    if (dto.customerPhone) {
      const customer = await this.prisma.user.findFirst({
        where: { phone: normalizePhone(dto.customerPhone), role: { code: 'CUSTOMER' } },
      });
      if (!customer) throw new NotFoundException('Không tìm thấy khách hàng thành viên với số điện thoại này');
      customerId = customer.id;
    }
    const updated = await this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { guestCount: dto.guestCount, customerId },
    });
    await this.emitTable(session.tableId);
    return updated;
  }

  /** FR-WAT-07: chuyển cả bàn sang bàn khác */
  async move(user: AuthUser, sessionId: number, toTableId: number) {
    const session = await this.getOpenById(sessionId);
    assertBranchAccess(user, session.branchId);
    const to = await this.prisma.diningTable.findUnique({ where: { id: toTableId } });
    if (!to || !to.isActive || to.branchId !== session.branchId) throw new BadRequestException('Bàn đích không hợp lệ');
    if (to.id === session.tableId) throw new BadRequestException('Bàn đích trùng bàn hiện tại');
    if (to.mergedIntoId) throw new ConflictException('Bàn đích đang được gộp vào bàn khác');
    if (!SEATABLE.includes(to.status) || (await this.findOpenSession(to.id))) {
      throw new ConflictException(`Bàn ${to.code} đang không trống`);
    }
    const fromTableId = session.tableId;
    await this.prisma.$transaction([
      this.prisma.tableSession.update({ where: { id: sessionId }, data: { tableId: to.id } }),
      this.prisma.serviceRequest.updateMany({
        where: { sessionId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        data: { tableId: to.id },
      }),
      this.prisma.diningTable.update({ where: { id: to.id }, data: { status: 'OCCUPIED' } }),
      this.prisma.diningTable.update({ where: { id: fromTableId }, data: { status: 'CLEANING' } }),
      this.prisma.diningTable.updateMany({
        where: { mergedIntoId: fromTableId },
        data: { mergedIntoId: null, status: 'CLEANING' },
      }),
    ]);
    await this.audit.log({
      userId: user.id,
      action: 'session.move',
      entity: 'TableSession',
      entityId: sessionId,
      data: { fromTableId, toTableId: to.id },
    });
    this.realtime.toBranchStaff(session.branchId, 'floor.updated', { branchId: session.branchId });
    this.realtime.toSession(session.token, 'session.moved', { tableId: to.id, tableCode: to.code });
    return this.detail({ id: sessionId });
  }

  /** FR-WAT-07: tách một phần món / khách sang bàn khác */
  async split(user: AuthUser, sessionId: number, dto: SplitSessionDto) {
    const session = await this.getOpenById(sessionId);
    assertBranchAccess(user, session.branchId);
    const items = await this.prisma.orderItem.findMany({
      where: { id: { in: dto.orderItemIds }, order: { sessionId } },
      select: { id: true, orderId: true },
    });
    if (items.length !== dto.orderItemIds.length) throw new BadRequestException('Có món không thuộc bàn này');
    const billed = await this.prisma.bill.count({ where: { sessionId, status: { in: ['OPEN', 'SPLIT', 'PAID'] } } });
    if (billed) throw new ConflictException('Bàn đã có hóa đơn, hãy hủy hóa đơn trước khi tách bàn');

    const { session: target } = await this.openForTable(dto.toTableId, {
      openedById: user.id,
      guestCount: dto.guestCount ?? 1,
    });
    if (target.id === sessionId) throw new BadRequestException('Bàn đích trùng bàn hiện tại');
    if (target.branchId !== session.branchId) throw new BadRequestException('Bàn đích khác chi nhánh');

    const sourceOrderIds = [...new Set(items.map((i) => i.orderId))];
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          code: prefixedCode('OD'),
          branchId: target.branchId,
          sessionId: target.id,
          tableId: target.tableId,
          createdById: user.id,
          source: 'WAITER',
          status: 'SENT_TO_KITCHEN',
          sentAt: new Date(),
          note: `Tách từ bàn ${session.table.code}`,
        },
      });
      await tx.orderItem.updateMany({ where: { id: { in: dto.orderItemIds } }, data: { orderId: order.id } });
      await refreshOrderStatus(tx, order.id);
      for (const orderId of sourceOrderIds) {
        const left = await tx.orderItem.count({ where: { orderId } });
        if (!left) await tx.order.delete({ where: { id: orderId } });
        else await refreshOrderStatus(tx, orderId);
      }
      if (dto.guestCount) {
        await tx.tableSession.update({
          where: { id: sessionId },
          data: { guestCount: Math.max(1, session.guestCount - dto.guestCount) },
        });
      }
    });
    await this.audit.log({
      userId: user.id,
      action: 'session.split',
      entity: 'TableSession',
      entityId: sessionId,
      data: { toSessionId: target.id, orderItemIds: dto.orderItemIds },
    });
    this.realtime.toBranchStaff(session.branchId, 'floor.updated', { branchId: session.branchId });
    this.realtime.toSession(session.token, 'session.updated', { sessionId });
    return { from: await this.detail({ id: sessionId }), to: await this.detail({ id: target.id }) };
  }

  /** Đóng phiên sau khi thanh toán xong: bàn -> Đang dọn (FR-WAT-11), đặt bàn -> hoàn tất */
  async close(sessionId: number) {
    const session = await this.prisma.tableSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status === 'CLOSED') return;
    await this.prisma.$transaction([
      this.prisma.tableSession.update({ where: { id: sessionId }, data: { status: 'CLOSED', closedAt: new Date() } }),
      this.prisma.diningTable.update({ where: { id: session.tableId }, data: { status: 'CLEANING' } }),
      this.prisma.diningTable.updateMany({
        where: { mergedIntoId: session.tableId },
        data: { mergedIntoId: null, status: 'CLEANING' },
      }),
      this.prisma.cartItem.deleteMany({ where: { sessionId } }),
      ...(session.reservationId
        ? [this.prisma.reservation.update({ where: { id: session.reservationId }, data: { status: 'COMPLETED' } })]
        : []),
    ]);
    this.realtime.toSession(session.token, 'session.closed', { sessionId });
    this.realtime.toBranchStaff(session.branchId, 'floor.updated', { branchId: session.branchId });
  }

  async emitTable(tableId: number) {
    const table = await this.prisma.diningTable.findUnique({
      where: { id: tableId },
      select: { id: true, code: true, status: true, branchId: true, zoneId: true, mergedIntoId: true },
    });
    if (table) this.realtime.toBranchStaff(table.branchId, 'table.updated', table);
  }
}
