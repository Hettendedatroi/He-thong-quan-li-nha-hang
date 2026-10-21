import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Branch, DiningTable, Prisma, Reservation, ReservationStatus, Zone } from '@prisma/client';
import * as QRCode from 'qrcode';
import { normalizePhone } from '../auth/auth.service';
import { PERMISSIONS } from '../common/constants/permissions';
import type { AuthUser } from '../common/types/auth-user';
import { hasPermission, isStaff } from '../common/types/auth-user';
import { assertBranchAccess, scopeBranch } from '../common/utils/branch-scope';
import { prefixedCode, randomCode } from '../common/utils/codes';
import { paged, toSkipTake } from '../common/utils/pagination';
import { addDays, addMinutes, formatLocalDateTime, localParts, parseDateRange } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { CryptoService } from '../core/crypto.service';
import { ReservationPolicy, SettingsService } from '../core/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import {
  AvailabilityQueryDto,
  CancelReservationDto,
  CreateReservationDto,
  DepositDto,
  ListReservationsQueryDto,
  StaffUpdateReservationDto,
  UpdateReservationDto,
} from './dto/reservations.dto';

/** Các trạng thái đang "giữ" bàn */
const HOLDING: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];

type Db = Prisma.TransactionClient;
type FullReservation = Reservation & { branch: Branch; table: (DiningTable & { zone: Zone }) | null };

interface SlotQuery {
  branchId: number;
  start: Date;
  end: Date;
  partySize: number;
  zoneId?: number;
  locationType?: string;
  excludeReservationId?: number;
}

const INCLUDE_FULL = { branch: true, table: { include: { zone: true } } } as const;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly sessions: TableSessionsService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  // =========================================================== KIỂM TRA BÀN TRỐNG

  /** FR-02: kiểm tra bàn trống theo thời gian thực, gợi ý bàn / khung giờ khác nếu hết */
  async checkAvailability(dto: AvailabilityQueryDto) {
    const branch = await this.getBranch(dto.branchId);
    const policy = await this.settings.get('reservationPolicy');
    const start = new Date(dto.startAt);
    this.validateTime(branch, start, policy);
    const end = addMinutes(start, policy.defaultDurationMinutes);
    const query: SlotQuery = { ...dto, start, end };

    const tables = await this.findAvailableTables(this.prisma, query);
    if (tables.length) return { available: true, startAt: start, endAt: end, tables: tables.map(presentTable) };

    const otherZones =
      dto.zoneId || dto.locationType
        ? (await this.findAvailableTables(this.prisma, { ...query, zoneId: undefined, locationType: undefined })).map(
            presentTable,
          )
        : [];
    const timeSlots: { startAt: Date; time: string; availableTables: number }[] = [];
    for (const k of [-2, -1, 1, 2, 3, 4]) {
      const s = addMinutes(start, k * policy.slotMinutes);
      try {
        this.validateTime(branch, s, policy);
      } catch {
        continue;
      }
      const t = await this.findAvailableTables(this.prisma, {
        ...query,
        start: s,
        end: addMinutes(s, policy.defaultDurationMinutes),
      });
      if (t.length) timeSlots.push({ startAt: s, time: localParts(s).hhmm, availableTables: t.length });
    }
    return { available: false, startAt: start, endAt: end, tables: [], alternatives: { otherZones, timeSlots } };
  }

  async findAvailableTables(db: Db, q: SlotQuery) {
    const tables = await db.diningTable.findMany({
      where: {
        branchId: q.branchId,
        isActive: true,
        mergedIntoId: null,
        capacity: { gte: q.partySize },
        ...(q.zoneId ? { zoneId: q.zoneId } : {}),
        zone: { isActive: true, ...(q.locationType ? { locationType: q.locationType } : {}) },
      },
      include: { zone: true },
      orderBy: [{ capacity: 'asc' }, { code: 'asc' }],
    });
    if (!tables.length) return [];
    const busy = await db.reservation.findMany({
      where: {
        tableId: { in: tables.map((t) => t.id) },
        status: { in: HOLDING },
        startAt: { lt: q.end },
        endAt: { gt: q.start },
        ...(q.excludeReservationId ? { id: { not: q.excludeReservationId } } : {}),
      },
      select: { tableId: true },
    });
    const busyIds = new Set(busy.map((b) => b.tableId));
    // Đặt sát giờ hiện tại: bàn đang có khách cũng coi là bận
    const nearTerm = q.start < addMinutes(new Date(), 90);
    return tables.filter((t) => !busyIds.has(t.id) && !(nearTerm && t.status === 'OCCUPIED'));
  }

  // =========================================================== KHÁCH HÀNG

  /** FR-01, FR-03, FR-06: tạo đặt bàn (khách vãng lai hoặc đã đăng nhập; nhân viên đặt hộ) */
  async create(dto: CreateReservationDto, user?: AuthUser) {
    const byStaff = isStaff(user) && hasPermission(user, PERMISSIONS.RESERVATION_MANAGE);
    const branch = await this.getBranch(dto.branchId);
    if (byStaff) assertBranchAccess(user!, branch.id);
    const policy = await this.settings.get('reservationPolicy');
    const start = new Date(dto.startAt);
    this.validateTime(branch, start, policy, byStaff);
    const end = addMinutes(start, policy.defaultDurationMinutes);

    const needsDeposit = !byStaff && policy.depositRequired && dto.partySize >= policy.depositPartySize;
    const needsApproval = !byStaff && this.needsApproval(policy, dto.partySize);

    const reservation = await this.prisma.$transaction(async (tx) => {
      // Khóa theo chi nhánh để tránh 2 khách đặt trùng một bàn cùng lúc
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${1_000_000 + branch.id}::bigint)::text`;
      const tables = await this.findAvailableTables(tx, { ...dto, start, end });
      const table = dto.tableId ? tables.find((t) => t.id === dto.tableId) : tables[0];
      if (!table) {
        throw new ConflictException(
          dto.tableId
            ? 'Bàn đã chọn không còn trống vào giờ này'
            : 'Đã hết bàn phù hợp vào giờ này, vui lòng xem gợi ý khung giờ / khu vực khác',
        );
      }
      return tx.reservation.create({
        data: {
          code: prefixedCode('RS'),
          branchId: branch.id,
          tableId: table.id,
          customerId: user?.roleCode === 'CUSTOMER' ? user.id : null,
          zonePreference: dto.locationType ?? table.zone.locationType,
          partySize: dto.partySize,
          startAt: start,
          endAt: end,
          customerName: dto.customerName.trim(),
          customerPhone: normalizePhone(dto.customerPhone)!,
          customerEmail: dto.customerEmail?.toLowerCase(),
          specialRequests: dto.specialRequests ?? [],
          note: dto.note,
          status: needsDeposit || needsApproval ? 'PENDING' : 'CONFIRMED',
          depositAmount: needsDeposit ? policy.depositAmount : 0,
          depositStatus: needsDeposit ? 'PENDING' : 'NONE',
          confirmedById: byStaff ? user!.id : null,
        },
        include: INCLUDE_FULL,
      });
    });

    await this.notifyCustomer(reservation, reservation.status === 'CONFIRMED' ? 'RESERVATION_CONFIRMED' : 'RESERVATION_CREATED');
    // FR-WAT-01: báo phục vụ ngay khi có đặt bàn mới
    this.realtime.toBranchStaff(branch.id, 'reservation.created', this.present(reservation));
    if (byStaff) {
      await this.audit.log({ userId: user!.id, action: 'reservation.create', entity: 'Reservation', entityId: reservation.id });
    }
    return {
      ...this.present(reservation),
      qrCode: await this.qrDataUrl(reservation.code),
      nextStep: needsDeposit ? 'PAY_DEPOSIT' : needsApproval ? 'WAIT_FOR_APPROVAL' : 'DONE',
    };
  }

  /** FR-05: xem đặt bàn (khách vãng lai cần SĐT; khách đăng nhập là chủ đơn thì không cần) */
  async getForGuest(code: string, phone?: string, user?: AuthUser) {
    const r = await this.findByCode(code);
    this.assertGuestAccess(r, phone, user);
    return { ...this.present(r), qrCode: await this.qrDataUrl(r.code) };
  }

  /** FR-06: mã QR check-in */
  async qrForGuest(code: string, phone?: string, user?: AuthUser) {
    const r = await this.findByCode(code);
    this.assertGuestAccess(r, phone, user);
    return { code: r.code, qrCode: await this.qrDataUrl(r.code) };
  }

  /** FR-05: sửa đặt bàn trong thời hạn cho phép */
  async updateByGuest(code: string, dto: UpdateReservationDto, user?: AuthUser) {
    const r = await this.findByCode(code);
    this.assertGuestAccess(r, dto.phone, user);
    const policy = await this.settings.get('reservationPolicy');
    this.assertModifiable(r, policy);
    return this.applyUpdate(r, dto, policy, user, false);
  }

  /** FR-05: hủy đặt bàn trong thời hạn cho phép */
  async cancelByGuest(code: string, dto: CancelReservationDto, user?: AuthUser) {
    const r = await this.findByCode(code);
    this.assertGuestAccess(r, dto.phone, user);
    const policy = await this.settings.get('reservationPolicy');
    this.assertModifiable(r, policy);
    return this.cancel(r, dto.reason ?? 'Khách hủy', user?.id);
  }

  /** FR-04: khởi tạo thanh toán cọc (cổng thanh toán giả lập - thay bằng VNPay/MoMo khi tích hợp thật) */
  async initDeposit(code: string, dto: DepositDto, user?: AuthUser) {
    const r = await this.findByCode(code);
    this.assertGuestAccess(r, dto.phone, user);
    if (r.status !== 'PENDING' || r.depositStatus !== 'PENDING' || r.depositAmount <= 0) {
      throw new BadRequestException('Đặt bàn này không cần / không còn chờ đặt cọc');
    }
    const enabled = await this.settings.get('paymentMethods');
    if (!enabled[dto.method]) throw new BadRequestException('Phương thức thanh toán đang tạm khóa');
    const payment = await this.prisma.payment.create({
      data: { reservationId: r.id, method: dto.method, amount: r.depositAmount, status: 'PENDING', provider: 'MOCK' },
    });
    const apiUrl = (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return {
      paymentId: payment.id,
      amount: payment.amount,
      provider: 'MOCK',
      paymentUrl: `${apiUrl}/api/public/payments/mock/${payment.id}`,
      hint: 'Môi trường dev: gọi POST /api/public/payments/mock/{paymentId}/confirm với {"success": true} để giả lập thanh toán',
    };
  }

  getMockPayment(paymentId: number) {
    return this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { id: true, amount: true, status: true, method: true, reservation: { select: { code: true, customerName: true } } },
    });
  }

  /** Callback từ cổng thanh toán (giả lập) */
  async confirmMockPayment(paymentId: number, success: boolean) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.reservationId) throw new NotFoundException('Không tìm thấy giao dịch');
    if (payment.status !== 'PENDING') throw new BadRequestException('Giao dịch đã được xử lý');
    if (!success) {
      await this.prisma.payment.update({ where: { id: paymentId }, data: { status: 'FAILED', completedAt: new Date() } });
      return { ok: false, message: 'Thanh toán thất bại' };
    }
    const policy = await this.settings.get('reservationPolicy');
    const r = await this.prisma.reservation.findUniqueOrThrow({ where: { id: payment.reservationId } });
    const autoConfirm = r.status === 'PENDING' && !this.needsApproval(policy, r.partySize);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'SUCCESS',
          completedAt: new Date(),
          // NFR-03: mã giao dịch được mã hóa
          encryptedDetails: this.crypto.encrypt(
            JSON.stringify({ transactionId: `MOCK-${randomCode(10)}`, paidAt: new Date().toISOString() }),
          ),
        },
      }),
      this.prisma.reservation.update({
        where: { id: r.id },
        data: { depositStatus: 'PAID', ...(autoConfirm ? { status: 'CONFIRMED' } : {}) },
        include: INCLUDE_FULL,
      }),
    ]);
    await this.notifyCustomer(updated, 'DEPOSIT_PAID', { amount: payment.amount.toLocaleString('vi-VN') });
    if (autoConfirm) await this.notifyCustomer(updated, 'RESERVATION_CONFIRMED');
    this.emitUpdated(updated);
    return { ok: true, reservation: this.present(updated) };
  }

  // =========================================================== NHÂN VIÊN

  async list(user: AuthUser, q: ListReservationsQueryDto) {
    const branchId = scopeBranch(user, q.branchId);
    let range: { from: Date; to: Date } | null = null;
    if (q.date) range = parseDateRange(q.date, q.date);
    else if (q.from || q.to) range = parseDateRange(q.from, q.to);
    const where: Prisma.ReservationWhereInput = {
      ...(branchId ? { branchId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(range ? { startAt: { gte: range.from, lt: range.to } } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { customerName: { contains: q.search, mode: 'insensitive' } },
              { customerPhone: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        include: INCLUDE_FULL,
        orderBy: { startAt: 'asc' },
        ...toSkipTake(q.page, q.limit),
      }),
      this.prisma.reservation.count({ where }),
    ]);
    return paged(items.map((r) => this.present(r)), total, q.page, q.limit);
  }

  async get(user: AuthUser, id: number) {
    const r = await this.findById(id);
    assertBranchAccess(user, r.branchId);
    return { ...this.present(r), qrCode: await this.qrDataUrl(r.code) };
  }

  async staffUpdate(user: AuthUser, id: number, dto: StaffUpdateReservationDto) {
    const r = await this.findById(id);
    assertBranchAccess(user, r.branchId);
    if (!['PENDING', 'CONFIRMED'].includes(r.status)) throw new BadRequestException('Không thể sửa đặt bàn ở trạng thái này');
    const policy = await this.settings.get('reservationPolicy');
    return this.applyUpdate(r, dto, policy, user, true, dto.tableId);
  }

  /** FR-WAT-08: xác nhận đặt bàn cần duyệt thủ công */
  async confirm(user: AuthUser, id: number, tableId?: number) {
    const r = await this.findById(id);
    assertBranchAccess(user, r.branchId);
    if (r.status !== 'PENDING') throw new BadRequestException('Chỉ xác nhận được đặt bàn đang chờ');
    if (tableId && tableId !== r.tableId) {
      const free = await this.findAvailableTables(this.prisma, {
        branchId: r.branchId,
        start: r.startAt,
        end: r.endAt,
        partySize: r.partySize,
        excludeReservationId: r.id,
      });
      if (!free.some((t) => t.id === tableId)) throw new ConflictException('Bàn được chọn không trống vào giờ này');
    }
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedById: user.id, tableId: tableId ?? r.tableId },
      include: INCLUDE_FULL,
    });
    await this.audit.log({ userId: user.id, action: 'reservation.confirm', entity: 'Reservation', entityId: id });
    await this.notifyCustomer(updated, 'RESERVATION_CONFIRMED');
    this.emitUpdated(updated);
    return this.present(updated);
  }

  /** FR-WAT-08: từ chối */
  async reject(user: AuthUser, id: number, reason: string) {
    const r = await this.findById(id);
    assertBranchAccess(user, r.branchId);
    if (!['PENDING', 'CONFIRMED'].includes(r.status)) throw new BadRequestException('Không thể từ chối đặt bàn này');
    if (r.depositStatus === 'PAID') await this.refundDeposit(r);
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason, confirmedById: user.id },
      include: INCLUDE_FULL,
    });
    await this.audit.log({ userId: user.id, action: 'reservation.reject', entity: 'Reservation', entityId: id, data: { reason } });
    await this.notifyCustomer(updated, 'RESERVATION_REJECTED', { reason });
    this.emitUpdated(updated);
    return this.present(updated);
  }

  async staffCancel(user: AuthUser, id: number, reason?: string) {
    const r = await this.findById(id);
    assertBranchAccess(user, r.branchId);
    return this.cancel(r, reason ?? 'Nhà hàng hủy', user.id);
  }

  /** FR-WAT-09: check-in khi khách đến (quét QR mã đặt bàn hoặc xác nhận thủ công) */
  async checkIn(user: AuthUser, where: { id?: number; code?: string }) {
    const r = where.id ? await this.findById(where.id) : await this.findByCode(where.code!.trim().toUpperCase());
    assertBranchAccess(user, r.branchId);
    if (r.status === 'CHECKED_IN') throw new BadRequestException('Đặt bàn đã check-in rồi');
    if (r.status !== 'CONFIRMED') throw new BadRequestException(`Không thể check-in đặt bàn ở trạng thái ${r.status}`);
    const now = new Date();
    if (now < addMinutes(r.startAt, -120)) throw new BadRequestException('Chưa tới giờ check-in (sớm hơn 2 tiếng)');

    // Nếu bàn đã gán đang có khách khác -> tìm bàn trống khác
    let tableId = r.tableId;
    const occupied = tableId ? await this.sessions.findOpenSession(tableId) : null;
    if (!tableId || occupied) {
      const policy = await this.settings.get('reservationPolicy');
      const free = await this.findAvailableTables(this.prisma, {
        branchId: r.branchId,
        start: now,
        end: addMinutes(now, policy.defaultDurationMinutes),
        partySize: r.partySize,
        excludeReservationId: r.id,
      });
      const candidate = free.find((t) => t.status !== 'CLEANING');
      if (!candidate) throw new ConflictException('Hiện không còn bàn trống phù hợp, vui lòng xếp bàn thủ công');
      tableId = candidate.id;
    }
    const { session } = await this.sessions.openForTable(tableId, {
      guestCount: r.partySize,
      customerId: r.customerId,
      reservationId: r.id,
      openedById: user.id,
    });
    const updated = await this.prisma.reservation.update({
      where: { id: r.id },
      data: { status: 'CHECKED_IN', checkedInAt: now, tableId },
      include: INCLUDE_FULL,
    });
    await this.audit.log({ userId: user.id, action: 'reservation.check_in', entity: 'Reservation', entityId: r.id });
    this.emitUpdated(updated);
    return { reservation: this.present(updated), session: { id: session.id, token: session.token } };
  }

  /** Đánh dấu khách không đến (FR-MGR-05 thống kê no-show) */
  async markNoShow(user: AuthUser | null, id: number) {
    const r = await this.findById(id);
    if (user) assertBranchAccess(user, r.branchId);
    if (r.status !== 'CONFIRMED') throw new BadRequestException('Chỉ đánh dấu no-show cho đặt bàn đã xác nhận');
    if (new Date() < r.startAt) throw new BadRequestException('Chưa tới giờ hẹn');
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'NO_SHOW', ...(r.depositStatus === 'PAID' ? { depositStatus: 'FORFEITED' } : {}) },
      include: INCLUDE_FULL,
    });
    if (user) await this.audit.log({ userId: user.id, action: 'reservation.no_show', entity: 'Reservation', entityId: id });
    await this.notifyCustomer(updated, 'RESERVATION_NO_SHOW');
    this.emitUpdated(updated);
    return this.present(updated);
  }

  // =========================================================== helpers

  needsApproval(policy: ReservationPolicy, partySize: number) {
    return policy.requireManualApproval || partySize >= policy.manualApprovalPartySize;
  }

  async notifyCustomer(r: FullReservation, code: string, extra: Record<string, string | number> = {}) {
    await this.notifications.notify({
      code,
      userId: r.customerId,
      email: r.customerEmail,
      phone: r.customerPhone,
      reservationId: r.id,
      reservationCode: r.code,
      vars: {
        code: r.code,
        name: r.customerName,
        partySize: r.partySize,
        time: formatLocalDateTime(r.startAt),
        branch: r.branch.name,
        ...extra,
      },
      data: { reservationCode: r.code, status: r.status },
    });
  }

  emitUpdated(r: FullReservation) {
    const payload = this.present(r);
    this.realtime.toBranchStaff(r.branchId, 'reservation.updated', payload);
    this.realtime.toReservation(r.code, 'reservation.updated', payload);
    if (r.tableId) void this.sessions.emitTable(r.tableId);
  }

  present(r: FullReservation) {
    return {
      ...r,
      table: r.table ? presentTable(r.table) : null,
      branch: { id: r.branch.id, name: r.branch.name, address: r.branch.address, phone: r.branch.phone },
    };
  }

  private async applyUpdate(
    r: FullReservation,
    dto: UpdateReservationDto,
    policy: ReservationPolicy,
    user: AuthUser | undefined,
    byStaff: boolean,
    tableId?: number,
  ) {
    const changesSlot = dto.startAt || dto.partySize || dto.zoneId || dto.locationType || tableId;
    let data: Prisma.ReservationUncheckedUpdateInput = {
      specialRequests: dto.specialRequests,
      note: dto.note,
    };
    if (changesSlot) {
      const branch = r.branch;
      const start = dto.startAt ? new Date(dto.startAt) : r.startAt;
      this.validateTime(branch, start, policy, byStaff);
      const end = addMinutes(start, policy.defaultDurationMinutes);
      const partySize = dto.partySize ?? r.partySize;
      const newTableId = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${1_000_000 + branch.id}::bigint)::text`;
        const free = await this.findAvailableTables(tx, {
          branchId: branch.id,
          start,
          end,
          partySize,
          zoneId: dto.zoneId,
          locationType: dto.locationType,
          excludeReservationId: r.id,
        });
        const chosen = tableId
          ? free.find((t) => t.id === tableId)
          : (free.find((t) => t.id === r.tableId) ?? free[0]);
        if (!chosen) throw new ConflictException('Không còn bàn phù hợp cho thay đổi này');
        await tx.reservation.update({
          where: { id: r.id },
          data: { startAt: start, endAt: end, partySize, tableId: chosen.id, reminderSentAt: null },
        });
        return chosen.id;
      });
      data = { ...data, tableId: newTableId };
      // Đổi số khách vượt ngưỡng => quay lại chờ duyệt
      if (!byStaff && r.status === 'CONFIRMED' && this.needsApproval(policy, partySize) && partySize > r.partySize) {
        data.status = 'PENDING';
      }
    }
    const updated = await this.prisma.reservation.update({ where: { id: r.id }, data, include: INCLUDE_FULL });
    await this.audit.log({
      userId: user?.id ?? null,
      action: 'reservation.update',
      entity: 'Reservation',
      entityId: r.id,
      data: { before: { startAt: r.startAt, partySize: r.partySize, tableId: r.tableId }, change: dto },
    });
    await this.notifyCustomer(updated, 'RESERVATION_UPDATED');
    this.emitUpdated(updated);
    return this.present(updated);
  }

  private async cancel(r: FullReservation, reason: string, actorId?: number) {
    if (!['PENDING', 'CONFIRMED'].includes(r.status)) throw new BadRequestException('Không thể hủy đặt bàn ở trạng thái này');
    if (r.depositStatus === 'PAID') await this.refundDeposit(r);
    const updated = await this.prisma.reservation.update({
      where: { id: r.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      include: INCLUDE_FULL,
    });
    await this.audit.log({ userId: actorId ?? null, action: 'reservation.cancel', entity: 'Reservation', entityId: r.id, data: { reason } });
    await this.notifyCustomer(updated, 'RESERVATION_CANCELLED');
    this.emitUpdated(updated);
    return this.present(updated);
  }

  private async refundDeposit(r: Reservation) {
    const paid = await this.prisma.payment.findFirst({ where: { reservationId: r.id, status: 'SUCCESS' } });
    await this.prisma.$transaction([
      ...(paid
        ? [
            this.prisma.payment.create({
              data: {
                reservationId: r.id,
                method: paid.method,
                amount: -paid.amount,
                status: 'REFUNDED',
                provider: paid.provider,
                note: 'Hoàn cọc',
                completedAt: new Date(),
              },
            }),
          ]
        : []),
      this.prisma.reservation.update({ where: { id: r.id }, data: { depositStatus: 'REFUNDED' } }),
    ]);
  }

  private assertModifiable(r: Reservation, policy: ReservationPolicy) {
    if (!['PENDING', 'CONFIRMED'].includes(r.status)) {
      throw new BadRequestException('Đặt bàn không còn ở trạng thái có thể thay đổi');
    }
    if (new Date() > addMinutes(r.startAt, -policy.freeCancelHours * 60)) {
      throw new BadRequestException(
        `Chỉ được sửa / hủy trước giờ hẹn ít nhất ${policy.freeCancelHours} giờ. Vui lòng gọi hotline nhà hàng.`,
      );
    }
  }

  private assertGuestAccess(r: Reservation, phone?: string, user?: AuthUser) {
    if (user && r.customerId === user.id) return;
    if (user && isStaff(user) && hasPermission(user, PERMISSIONS.RESERVATION_VIEW)) return;
    if (phone && normalizePhone(phone) === r.customerPhone) return;
    throw new ForbiddenException('Số điện thoại không khớp với đặt bàn');
  }

  private validateTime(branch: Branch, start: Date, policy: ReservationPolicy, byStaff = false) {
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Thời gian không hợp lệ');
    const now = new Date();
    if (!byStaff && start < addMinutes(now, policy.minAdvanceMinutes)) {
      throw new BadRequestException(`Vui lòng đặt trước ít nhất ${policy.minAdvanceMinutes} phút`);
    }
    if (byStaff && start < addMinutes(now, -15)) throw new BadRequestException('Thời gian đã qua');
    if (start > addDays(now, policy.maxAdvanceDays)) {
      throw new BadRequestException(`Chỉ nhận đặt bàn trong vòng ${policy.maxAdvanceDays} ngày tới`);
    }
    const { hhmm } = localParts(start);
    if (hhmm < branch.openTime || hhmm >= branch.closeTime) {
      throw new BadRequestException(`Chi nhánh nhận khách từ ${branch.openTime} đến ${branch.closeTime}`);
    }
  }

  private async getBranch(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch || !branch.isActive) throw new NotFoundException('Không tìm thấy chi nhánh');
    return branch;
  }

  private async findByCode(code: string): Promise<FullReservation> {
    const r = await this.prisma.reservation.findUnique({ where: { code }, include: INCLUDE_FULL });
    if (!r) throw new NotFoundException('Không tìm thấy đặt bàn');
    return r;
  }

  private async findById(id: number): Promise<FullReservation> {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: INCLUDE_FULL });
    if (!r) throw new NotFoundException('Không tìm thấy đặt bàn');
    return r;
  }

  private qrDataUrl(code: string) {
    return QRCode.toDataURL(code, { width: 320 });
  }
}

function presentTable(t: DiningTable & { zone: Zone }) {
  return {
    id: t.id,
    code: t.code,
    capacity: t.capacity,
    zone: { id: t.zone.id, name: t.zone.name, locationType: t.zone.locationType },
  };
}
