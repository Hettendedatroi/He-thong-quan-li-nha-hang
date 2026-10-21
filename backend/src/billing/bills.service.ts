import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Bill, Prisma, User } from '@prisma/client';
import { normalizePhone } from '../auth/auth.service';
import { PERMISSIONS } from '../common/constants/permissions';
import type { AuthUser } from '../common/types/auth-user';
import { hasPermission } from '../common/types/auth-user';
import { assertBranchAccess, scopeBranch } from '../common/utils/branch-scope';
import { prefixedCode } from '../common/utils/codes';
import { paged, toSkipTake } from '../common/utils/pagination';
import { parseDateRange } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { CryptoService } from '../core/crypto.service';
import { SettingsService } from '../core/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { GenerateBillDto, ListBillsQueryDto, PayBillDto, RefundBillDto, SplitBillDto } from './dto/billing.dto';
import { LoyaltyService } from './loyalty.service';

const BILL_INCLUDE = {
  lines: { orderBy: { id: 'asc' } },
  childBills: { include: { lines: true }, orderBy: { id: 'asc' } },
  payments: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, method: true, amount: true, status: true, note: true, createdAt: true, encryptedDetails: true },
  },
  table: { select: { id: true, code: true } },
  customer: { select: { id: true, fullName: true, phone: true, loyaltyPoints: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.BillInclude;

/** Các khoản được chia theo tỷ lệ khi tách bill */
const SPLIT_FIELDS = [
  'subtotal',
  'itemDiscount',
  'voucherDiscount',
  'manualDiscount',
  'pointsDiscount',
  'serviceCharge',
  'vatAmount',
] as const;

/** Chia `total` theo trọng số, phần dư dồn vào phần cuối để tổng luôn khớp */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

interface Line {
  orderItemId: number;
  menuItemId: number | null;
  categoryId: number | null;
  name: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  amount: number;
}

/** FR-WAT-13 (hóa đơn, tách bill, voucher), FR-WAT-14 (thanh toán), FR-WAT-16 (hoàn tiền / hủy / giảm giá đặc biệt) */
@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly promotions: PromotionsService,
    private readonly loyalty: LoyaltyService,
    private readonly sessions: TableSessionsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  /** Tạo (hoặc tạo lại) hóa đơn cuối cho phiên bàn */
  async generate(user: AuthUser, dto: GenerateBillDto) {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        customer: true,
        orders: { include: { items: { include: { menuItem: { select: { categoryId: true } } } } } },
        bills: true,
      },
    });
    if (!session) throw new NotFoundException('Không tìm thấy phiên bàn');
    assertBranchAccess(user, session.branchId);
    if (session.status !== 'OPEN') throw new BadRequestException('Phiên bàn đã đóng');
    if (session.bills.some((b) => b.status === 'PAID' || b.status === 'REFUNDED')) {
      throw new ConflictException('Bàn này đã thanh toán');
    }
    const active = session.bills.filter((b) => b.status === 'OPEN' || b.status === 'SPLIT');
    if (active.some((b) => b.status === 'SPLIT' || b.paidAmount > 0)) {
      throw new ConflictException('Hóa đơn đã được tách hoặc đã thu tiền một phần, không thể tạo lại');
    }
    if (dto.manualDiscount && !hasPermission(user, PERMISSIONS.BILL_DISCOUNT_OVERRIDE)) {
      throw new ForbiddenException('Giảm giá ngoài chính sách cần quyền nâng cao (bill.discount_override)');
    }
    if (dto.manualDiscount && !dto.manualDiscountReason) {
      throw new BadRequestException('Vui lòng nhập lý do giảm giá');
    }

    const lines: Line[] = session.orders
      .filter((o) => o.status !== 'PENDING_CONFIRM')
      .flatMap((o) => o.items)
      .filter((i) => i.status !== 'CANCELLED')
      .map((i) => ({
        orderItemId: i.id,
        menuItemId: i.menuItemId,
        categoryId: i.menuItem?.categoryId ?? null,
        name: i.name,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        discount: i.discountAmount,
        amount: i.unitPrice * i.quantity - i.discountAmount,
      }));
    if (!lines.length) throw new BadRequestException('Bàn chưa có món nào để tính tiền');

    let customer: User | null = session.customer;
    if (dto.customerPhone) {
      customer = await this.prisma.user.findFirst({
        where: { phone: normalizePhone(dto.customerPhone), role: { code: 'CUSTOMER' } },
      });
      if (!customer) throw new NotFoundException('Không tìm thấy khách hàng thành viên với số điện thoại này');
    }

    const totals = await this.compute(lines, {
      branchId: session.branchId,
      voucherCode: dto.voucherCode,
      redeemPoints: dto.redeemPoints,
      manualDiscount: dto.manualDiscount,
      customer,
    });

    const bill = await this.prisma.$transaction(async (tx) => {
      // DoD B-06: khóa theo phiên bàn để 2 lần bấm "Lập hóa đơn" đồng thời không tạo 2 hóa đơn
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(3, ${session.id}::int)::text`;
      const current = await tx.bill.findMany({ where: { sessionId: session.id } });
      if (current.some((b) => b.status === 'PAID' || b.status === 'REFUNDED')) {
        throw new ConflictException('Bàn này đã thanh toán');
      }
      const stillActive = current.filter((b) => b.status === 'OPEN' || b.status === 'SPLIT');
      if (stillActive.some((b) => b.status === 'SPLIT' || b.paidAmount > 0)) {
        throw new ConflictException('Hóa đơn đã được tách hoặc đã thu tiền một phần, không thể tạo lại');
      }
      // Hóa đơn tạm chưa thu tiền => xóa để tạo lại theo dữ liệu mới
      if (stillActive.length) {
        await tx.bill.deleteMany({ where: { parentBillId: { in: stillActive.map((b) => b.id) } } });
        await tx.bill.deleteMany({ where: { id: { in: stillActive.map((b) => b.id) } } });
      }
      if (customer && !session.customerId) {
        await tx.tableSession.update({ where: { id: session.id }, data: { customerId: customer.id } });
      }
      return tx.bill.create({
        data: {
          code: prefixedCode('HD', 8),
          branchId: session.branchId,
          sessionId: session.id,
          tableId: session.tableId,
          customerId: customer?.id ?? null,
          createdById: user.id,
          voucherCode: dto.voucherCode?.toUpperCase() ?? null,
          manualDiscountReason: dto.manualDiscountReason,
          ...totals,
          lines: {
            create: lines.map((l) => ({
              orderItemId: l.orderItemId,
              name: l.name,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
              discount: l.discount,
              amount: l.amount,
            })),
          },
        },
        include: BILL_INCLUDE,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: dto.manualDiscount ? 'bill.generate_with_discount_override' : 'bill.generate',
      entity: 'Bill',
      entityId: bill.id,
      data: { total: bill.total, voucher: dto.voucherCode, manualDiscount: dto.manualDiscount, reason: dto.manualDiscountReason },
    });
    this.emit(bill.branchId, session.token, bill);
    return this.present(bill, user);
  }

  /** Tính tiền: món - giảm món - voucher - giảm tay - điểm + phí phục vụ + VAT */
  private async compute(
    lines: Line[],
    opts: { branchId: number; voucherCode?: string; redeemPoints?: number; manualDiscount?: number; customer: User | null },
  ) {
    const [billing, loyalty] = await Promise.all([this.settings.get('billing'), this.settings.get('loyalty')]);
    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const itemDiscount = lines.reduce((s, l) => s + l.discount, 0);
    let base = subtotal - itemDiscount;

    let voucherDiscount = 0;
    let promotionId: number | null = null;
    if (opts.voucherCode) {
      const v = await this.promotions.validateVoucher(opts.voucherCode, opts.branchId, lines);
      voucherDiscount = Math.min(v.discount, base);
      promotionId = v.promotion.id;
      base -= voucherDiscount;
    }
    const manualDiscount = Math.min(opts.manualDiscount ?? 0, base);
    base -= manualDiscount;

    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (opts.redeemPoints) {
      if (!loyalty.enabled) throw new BadRequestException('Chương trình tích điểm đang tắt');
      if (!opts.customer) throw new BadRequestException('Cần gắn khách hàng thành viên để đổi điểm');
      if (opts.redeemPoints > opts.customer.loyaltyPoints) {
        throw new BadRequestException(`Khách chỉ có ${opts.customer.loyaltyPoints} điểm`);
      }
      const maxValue = Math.floor((base * loyalty.maxRedeemPercent) / 100);
      pointsRedeemed = Math.min(opts.redeemPoints, Math.floor(maxValue / loyalty.pointValue));
      pointsDiscount = pointsRedeemed * loyalty.pointValue;
      base -= pointsDiscount;
    }
    const serviceCharge = Math.round((base * billing.serviceChargePercent) / 100);
    const vatAmount = Math.round(((base + serviceCharge) * billing.vatPercent) / 100);
    return {
      subtotal,
      itemDiscount,
      voucherDiscount,
      promotionId,
      manualDiscount,
      pointsRedeemed,
      pointsDiscount,
      serviceCharge,
      vatAmount,
      total: base + serviceCharge + vatAmount,
    };
  }

  /** FR-WAT-13: tách hóa đơn */
  async split(user: AuthUser, billId: number, dto: SplitBillDto) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId }, include: { lines: true } });
    if (!bill) throw new NotFoundException('Không tìm thấy hóa đơn');
    assertBranchAccess(user, bill.branchId);
    if (bill.parentBillId) throw new BadRequestException('Không thể tách hóa đơn con');
    if (bill.status !== 'OPEN' || bill.paidAmount > 0) throw new BadRequestException('Chỉ tách được hóa đơn chưa thanh toán');

    let weights: number[];
    let groups: (typeof bill.lines)[] = [];
    if (dto.mode === 'EQUAL') {
      if (!dto.parts) throw new BadRequestException('Cần nhập số phần (parts)');
      weights = Array(dto.parts).fill(1);
    } else {
      if (!dto.groups?.length) throw new BadRequestException('Cần nhập các nhóm món (groups)');
      const byId = new Map(bill.lines.map((l) => [l.id, l]));
      const used = new Set<number>();
      for (const g of dto.groups) {
        const lines = g.map((id) => {
          const line = byId.get(id);
          if (!line) throw new BadRequestException(`Dòng #${id} không thuộc hóa đơn`);
          if (used.has(id)) throw new BadRequestException(`Dòng #${id} bị chọn 2 lần`);
          used.add(id);
          return line;
        });
        groups.push(lines);
      }
      const rest = bill.lines.filter((l) => !used.has(l.id));
      if (rest.length) groups.push(rest);
      groups = groups.filter((g) => g.length);
      if (groups.length < 2) throw new BadRequestException('Cần ít nhất 2 phần để tách');
      weights = groups.map((g) => g.reduce((s, l) => s + l.amount, 0));
      if (weights.some((w) => w <= 0)) throw new BadRequestException('Mỗi phần phải có giá trị lớn hơn 0');
    }

    const alloc = Object.fromEntries(SPLIT_FIELDS.map((f) => [f, allocate(bill[f], weights)])) as Record<
      (typeof SPLIT_FIELDS)[number],
      number[]
    >;
    const n = weights.length;
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < n; i++) {
        const v = Object.fromEntries(SPLIT_FIELDS.map((f) => [f, alloc[f][i]])) as Record<(typeof SPLIT_FIELDS)[number], number>;
        const total =
          v.subtotal - v.itemDiscount - v.voucherDiscount - v.manualDiscount - v.pointsDiscount + v.serviceCharge + v.vatAmount;
        await tx.bill.create({
          data: {
            code: `${bill.code}-${i + 1}`,
            branchId: bill.branchId,
            sessionId: bill.sessionId,
            tableId: bill.tableId,
            parentBillId: bill.id,
            customerId: bill.customerId,
            createdById: user.id,
            splitLabel: `${i + 1}/${n}`,
            ...v,
            total,
            ...(dto.mode === 'ITEMS'
              ? {
                  lines: {
                    create: groups[i].map((l) => ({
                      orderItemId: l.orderItemId,
                      name: l.name,
                      unitPrice: l.unitPrice,
                      quantity: l.quantity,
                      discount: l.discount,
                      amount: l.amount,
                    })),
                  },
                }
              : {}),
          },
        });
      }
      await tx.bill.update({ where: { id: bill.id }, data: { status: 'SPLIT' } });
    });
    await this.audit.log({ userId: user.id, action: 'bill.split', entity: 'Bill', entityId: bill.id, data: dto });
    return this.getAndEmit(user, bill.id);
  }

  /** FR-WAT-14: xác nhận thanh toán (tiền mặt, chuyển khoản, ví điện tử, POS) */
  async pay(user: AuthUser, billId: number, dto: PayBillDto) {
    const found = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!found) throw new NotFoundException('Không tìm thấy hóa đơn');
    assertBranchAccess(user, found.branchId);
    const methods = await this.settings.get('paymentMethods');
    if (!methods[dto.method]) throw new BadRequestException('Phương thức thanh toán này chưa được bật');
    const now = new Date();

    // DoD B-06: khóa theo phiên bàn - 2 lần bấm "Xác nhận thanh toán" đồng thời không thu tiền 2 lần
    const { bill, payAmount, change, fullyPaid, rootPaid } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(3, ${found.sessionId}::int)::text`;
      const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
      if (bill.status === 'SPLIT') throw new BadRequestException('Hóa đơn đã tách, hãy thanh toán từng hóa đơn con');
      // US-8 AC3: hóa đơn Đã thanh toán không sửa / thu thêm được
      if (bill.status !== 'OPEN') throw new BadRequestException('Hóa đơn không ở trạng thái chờ thanh toán');

      const remaining = bill.total - bill.paidAmount;
      if (dto.method !== 'CASH' && dto.amount > remaining) {
        throw new BadRequestException(`Số tiền vượt quá số còn phải trả (${remaining})`);
      }
      const payAmount = Math.min(dto.amount, remaining);
      const change = dto.method === 'CASH' ? dto.amount - payAmount : 0;
      const fullyPaid = bill.paidAmount + payAmount >= bill.total;

      await tx.payment.create({
        data: {
          billId,
          method: dto.method,
          amount: payAmount,
          status: 'SUCCESS',
          provider: 'POS',
          encryptedDetails: dto.reference ? this.crypto.encrypt(JSON.stringify({ reference: dto.reference })) : null,
          note: dto.note,
          receivedById: user.id,
          completedAt: now,
        },
      });
      const updated = await tx.bill.update({
        where: { id: billId },
        data: { paidAmount: { increment: payAmount }, ...(fullyPaid ? { status: 'PAID', paidAt: now } : {}) },
      });

      let rootPaid: Bill | null = null;
      if (fullyPaid) {
        if (bill.parentBillId) {
          const siblings = await tx.bill.findMany({ where: { parentBillId: bill.parentBillId } });
          if (siblings.every((s) => s.status === 'PAID')) {
            rootPaid = await tx.bill.update({
              where: { id: bill.parentBillId },
              data: { status: 'PAID', paidAt: now, paidAmount: siblings.reduce((s, b) => s + b.paidAmount, 0) },
            });
          }
        } else {
          rootPaid = updated;
        }
      }
      return { bill, payAmount, change, fullyPaid, rootPaid };
    });
    if (rootPaid) await this.finalize(rootPaid);

    await this.audit.log({
      userId: user.id,
      action: 'payment.confirm',
      entity: 'Bill',
      entityId: billId,
      data: { method: dto.method, amount: payAmount },
    });
    const result = await this.getAndEmit(user, bill.parentBillId ?? billId);
    return { bill: result, paidAmount: payAmount, change, fullyPaid, sessionClosed: !!rootPaid };
  }

  /** FR-WAT-16: hủy hóa đơn (quyền nâng cao) */
  async void(user: AuthUser, billId: number, reason: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId }, include: { childBills: true } });
    if (!bill) throw new NotFoundException('Không tìm thấy hóa đơn');
    assertBranchAccess(user, bill.branchId);
    if (bill.parentBillId) throw new BadRequestException('Hãy hủy hóa đơn gốc');
    if (bill.status !== 'OPEN' && bill.status !== 'SPLIT') throw new BadRequestException('Chỉ hủy được hóa đơn chưa thanh toán');
    if (bill.paidAmount > 0 || bill.childBills.some((c) => c.paidAmount > 0)) {
      throw new BadRequestException('Hóa đơn đã thu tiền, hãy dùng chức năng hoàn tiền');
    }
    await this.prisma.bill.updateMany({
      where: { OR: [{ id: billId }, { parentBillId: billId }] },
      data: { status: 'VOID', voidReason: reason, voidedById: user.id },
    });
    await this.audit.log({ userId: user.id, action: 'bill.void', entity: 'Bill', entityId: billId, data: { reason, total: bill.total } });
    return this.getAndEmit(user, billId);
  }

  /** FR-WAT-16: hoàn tiền (quyền nâng cao) */
  async refund(user: AuthUser, billId: number, dto: RefundBillDto) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) throw new NotFoundException('Không tìm thấy hóa đơn');
    assertBranchAccess(user, bill.branchId);
    if (bill.status !== 'PAID') throw new BadRequestException('Chỉ hoàn tiền cho hóa đơn đã thanh toán');
    const refundable = bill.paidAmount - bill.refundedAmount;
    if (dto.amount > refundable) throw new BadRequestException(`Chỉ có thể hoàn tối đa ${refundable}`);
    const lastPayment = await this.prisma.payment.findFirst({
      where: { billId: { in: [billId] }, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });
    const fully = bill.refundedAmount + dto.amount >= bill.paidAmount;
    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          billId,
          method: dto.method ?? lastPayment?.method ?? 'CASH',
          amount: -dto.amount,
          status: 'REFUNDED',
          note: dto.reason,
          receivedById: user.id,
          completedAt: new Date(),
        },
      }),
      this.prisma.bill.update({
        where: { id: billId },
        data: { refundedAmount: { increment: dto.amount }, ...(fully ? { status: 'REFUNDED' } : {}) },
      }),
    ]);
    await this.audit.log({ userId: user.id, action: 'bill.refund', entity: 'Bill', entityId: billId, data: dto });
    return this.getAndEmit(user, bill.parentBillId ?? billId);
  }

  async get(user: AuthUser, id: number) {
    const bill = await this.prisma.bill.findUnique({ where: { id }, include: BILL_INCLUDE });
    if (!bill) throw new NotFoundException('Không tìm thấy hóa đơn');
    assertBranchAccess(user, bill.branchId);
    return this.present(bill, user);
  }

  async list(user: AuthUser, q: ListBillsQueryDto) {
    const branchId = scopeBranch(user, q.branchId);
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    const where: Prisma.BillWhereInput = {
      parentBillId: null,
      ...(branchId ? { branchId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.bill.findMany({ where, include: BILL_INCLUDE, orderBy: { createdAt: 'desc' }, ...toSkipTake(q.page, q.limit) }),
      this.prisma.bill.count({ where }),
    ]);
    return paged(items.map((b) => this.present(b, user)), total, q.page, q.limit);
  }

  /** FR-15: khách xem hóa đơn của bàn */
  async forSession(token: string) {
    const session = await this.sessions.getByToken(token, false);
    const bills = await this.prisma.bill.findMany({
      where: { sessionId: session.id, parentBillId: null, status: { not: 'VOID' } },
      include: BILL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return bills.map((b) => {
      const { customer: _c, createdBy, payments, ...rest } = this.present(b);
      return {
        ...rest,
        staffName: createdBy?.fullName ?? null,
        payments: payments.map(({ hasReference: _r, ...p }) => p),
      };
    });
  }

  /** Sau khi thanh toán đủ: cộng lượt dùng voucher, tích điểm, đóng phiên bàn */
  private async finalize(root: Bill) {
    if (root.promotionId && root.voucherCode) {
      await this.prisma.promotion.update({ where: { id: root.promotionId }, data: { usedCount: { increment: 1 } } });
    }
    await this.loyalty.settle(root);
    await this.sessions.close(root.sessionId);
  }

  private async getAndEmit(user: AuthUser, billId: number) {
    const bill = await this.prisma.bill.findUniqueOrThrow({
      where: { id: billId },
      include: { ...BILL_INCLUDE, session: { select: { token: true } } },
    });
    const { session, ...rest } = bill;
    this.emit(bill.branchId, session.token, rest);
    return this.present(rest, user);
  }

  private emit(branchId: number, sessionToken: string, bill: { id: number; code: string; status: string; total: number; paidAmount: number }) {
    const payload = { id: bill.id, code: bill.code, status: bill.status, total: bill.total, paidAmount: bill.paidAmount };
    this.realtime.toBranchStaff(branchId, 'bill.updated', payload);
    this.realtime.toSession(sessionToken, 'bill.updated', payload);
  }

  /** Không trả dữ liệu thanh toán đã mã hóa ra ngoài; chỉ người có quyền mới xem mã giao dịch */
  private present<P extends { encryptedDetails: string | null }, T extends { payments: P[] }>(bill: T, user?: AuthUser) {
    const canSee = !!user && hasPermission(user, PERMISSIONS.PAYMENT_CONFIRM);
    const payments = bill.payments.map(({ encryptedDetails, ...p }) => ({
      ...(p as Omit<P, 'encryptedDetails'>),
      hasReference: !!encryptedDetails,
      details: canSee && encryptedDetails ? this.safeDecrypt(encryptedDetails) : undefined,
    }));
    return { ...bill, payments } as Omit<T, 'payments'> & { payments: typeof payments };
  }

  private safeDecrypt(payload: string) {
    try {
      return JSON.parse(this.crypto.decrypt(payload)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
