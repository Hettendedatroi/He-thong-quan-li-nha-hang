import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderItemStatus, OrderSource, Prisma, TableSession } from '@prisma/client';
import { assertBranchAccess, scopeBranch } from '../common/utils/branch-scope';
import { prefixedCode } from '../common/utils/codes';
import { paged, toSkipTake } from '../common/utils/pagination';
import { parseDateRange } from '../common/utils/time';
import type { AuthUser } from '../common/types/auth-user';
import { AuditService } from '../core/audit.service';
import { SettingsService } from '../core/settings.service';
import { PricingService } from '../menu/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { CreateCustomerOrderDto, ListOrdersQueryDto, OrderItemInputDto, UpdateOrderItemDto } from './dto/orders.dto';
import { CHANGEABLE_STATUSES, refreshOrderStatus } from './order-status.util';

export const ORDER_INCLUDE = {
  table: { select: { id: true, code: true } },
  items: { orderBy: { id: 'asc' } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.OrderInclude;

interface CreateOrderOptions {
  source: OrderSource;
  createdById?: number | null;
  customerId?: number | null;
  note?: string;
  priority?: number;
}

/** FR-10..FR-14, FR-WAT-06, FR-WAT-10, FR-WAT-12 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: TableSessionsService,
    private readonly pricing: PricingService,
    private readonly promotions: PromotionsService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  /** Tạo đơn: chốt giá theo thời điểm gọi (giá theo ngày + happy hour) */
  async createOrder(session: TableSession, inputs: OrderItemInputDto[], opts: CreateOrderOptions) {
    if (!inputs.length) throw new BadRequestException('Đơn hàng chưa có món nào');
    const now = new Date();
    const menuIds = inputs.filter((i) => i.menuItemId).map((i) => i.menuItemId!);
    const comboIds = inputs.filter((i) => i.comboId).map((i) => i.comboId!);
    const [menuItems, combos, holiday, autoPromos, ordering] = await Promise.all([
      this.prisma.menuItem.findMany({ where: { id: { in: menuIds } }, include: { priceRules: true } }),
      this.prisma.combo.findMany({ where: { id: { in: comboIds } }, include: { items: { include: { menuItem: true } } } }),
      this.pricing.isHoliday(now),
      this.promotions.activeAutoPromotions(session.branchId, now),
      this.settings.get('ordering'),
    ]);
    const menuMap = new Map(menuItems.map((m) => [m.id, m]));
    const comboMap = new Map(combos.map((c) => [c.id, c]));

    const lines: Prisma.OrderItemCreateWithoutOrderInput[] = inputs.map((input) => {
      if (!!input.menuItemId === !!input.comboId) throw new BadRequestException('Mỗi dòng cần menuItemId hoặc comboId');
      if (input.menuItemId) {
        const m = menuMap.get(input.menuItemId);
        if (!m || m.isDeleted || !m.isVisible) throw new NotFoundException(`Món #${input.menuItemId} không tồn tại`);
        if (!m.isAvailable) throw new BadRequestException(`Món "${m.name}" đang tạm hết`);
        const unitPrice = this.pricing.effectivePrice(m, now, holiday);
        const best = this.promotions.bestItemDiscount(autoPromos, {
          menuItemId: m.id,
          categoryId: m.categoryId,
          unitPrice,
          quantity: input.quantity,
        });
        return {
          menuItem: { connect: { id: m.id } },
          name: m.name,
          unitPrice,
          quantity: input.quantity,
          note: input.note,
          discountAmount: best.discount,
          ...(best.promotionId ? { promotion: { connect: { id: best.promotionId } } } : {}),
        };
      }
      const c = comboMap.get(input.comboId!);
      if (!c || !c.isActive) throw new NotFoundException(`Combo #${input.comboId} không tồn tại`);
      const missing = c.items.find((ci) => !ci.menuItem.isAvailable || ci.menuItem.isDeleted);
      if (missing) throw new BadRequestException(`Combo "${c.name}" có món "${missing.menuItem.name}" đang tạm hết`);
      const best = this.promotions.bestItemDiscount(autoPromos, { unitPrice: c.price, quantity: input.quantity });
      return {
        combo: { connect: { id: c.id } },
        name: `Combo ${c.name}`,
        unitPrice: c.price,
        quantity: input.quantity,
        note: input.note,
        discountAmount: best.discount,
        ...(best.promotionId ? { promotion: { connect: { id: best.promotionId } } } : {}),
      };
    });

    const needsConfirm = opts.source === 'QR' && ordering.requireStaffConfirmation;
    const order = await this.prisma.order.create({
      data: {
        code: prefixedCode('OD'),
        branchId: session.branchId,
        sessionId: session.id,
        tableId: session.tableId,
        customerId: opts.customerId ?? session.customerId ?? null,
        createdById: opts.createdById ?? null,
        source: opts.source,
        status: needsConfirm ? 'PENDING_CONFIRM' : 'SENT_TO_KITCHEN',
        priority: opts.priority ?? 0,
        note: opts.note,
        sentAt: needsConfirm ? null : now,
        items: { create: lines },
      },
      include: ORDER_INCLUDE,
    });

    // FR-WAT-01: báo phục vụ có đơn mới; FR-KIT-01: đẩy lên KDS
    this.realtime.toBranchStaff(session.branchId, 'order.created', order);
    if (!needsConfirm) this.realtime.toKitchen(session.branchId, 'kitchen.order-received', order);
    this.realtime.toSession(session.token, 'order.created', order);
    if (opts.createdById) {
      await this.audit.log({ userId: opts.createdById, action: 'order.create', entity: 'Order', entityId: order.id });
    }
    return order;
  }

  /** FR-11, FR-12: khách gửi đơn trực tiếp (lần đầu hoặc gọi thêm) */
  async createFromSession(token: string, dto: CreateCustomerOrderDto, user?: AuthUser) {
    const session = await this.sessions.getByToken(token);
    let inputs = dto.items ?? [];
    const fromCart = !inputs.length;
    if (fromCart) {
      const cart = await this.prisma.cartItem.findMany({ where: { sessionId: session.id }, orderBy: { id: 'asc' } });
      if (!cart.length) throw new BadRequestException('Giỏ hàng đang trống');
      inputs = cart.map((c) => ({
        menuItemId: c.menuItemId ?? undefined,
        comboId: c.comboId ?? undefined,
        quantity: c.quantity,
        note: c.note ?? undefined,
      }));
    }
    const order = await this.createOrder(session, inputs, {
      source: 'QR',
      customerId: user?.roleCode === 'CUSTOMER' ? user.id : undefined,
      note: dto.note,
    });
    if (fromCart) {
      await this.prisma.cartItem.deleteMany({ where: { sessionId: session.id } });
      this.realtime.toSession(session.token, 'cart.updated', { items: [] });
    }
    return order;
  }

  /** FR-WAT-06: phục vụ gọi món hộ khách */
  async createByStaff(user: AuthUser, sessionId: number, inputs: OrderItemInputDto[], note?: string, priority?: number) {
    const session = await this.sessions.getOpenById(sessionId);
    assertBranchAccess(user, session.branchId);
    return this.createOrder(session, inputs, { source: 'WAITER', createdById: user.id, note, priority });
  }

  listForSession(token: string) {
    return this.sessions.getByToken(token, false).then((s) =>
      this.prisma.order.findMany({ where: { sessionId: s.id }, include: ORDER_INCLUDE, orderBy: { createdAt: 'asc' } }),
    );
  }

  async list(user: AuthUser, q: ListOrdersQueryDto) {
    const branchId = scopeBranch(user, q.branchId);
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    const where: Prisma.OrderWhereInput = {
      ...(branchId ? { branchId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, ...toSkipTake(q.page, q.limit) }),
      this.prisma.order.count({ where }),
    ]);
    return paged(items, total, q.page, q.limit);
  }

  async get(user: AuthUser, id: number) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Không tìm thấy đơn');
    assertBranchAccess(user, order.branchId);
    return order;
  }

  /** FR-WAT-10: gửi đơn (đang chờ xác nhận) xuống bếp */
  async sendToKitchen(user: AuthUser, id: number) {
    const order = await this.get(user, id);
    if (order.status !== 'PENDING_CONFIRM') throw new BadRequestException('Đơn đã được gửi bếp');
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: 'SENT_TO_KITCHEN', sentAt: new Date(), createdById: order.createdById ?? user.id },
      include: { ...ORDER_INCLUDE, session: { select: { token: true } } },
    });
    const { session, ...payload } = updated;
    this.realtime.toKitchen(order.branchId, 'kitchen.order-received', payload);
    this.realtime.toBranchStaff(order.branchId, 'order.updated', payload);
    this.realtime.toSession(session.token, 'order.updated', payload);
    return payload;
  }

  async setPriority(user: AuthUser, id: number, priority: number) {
    const order = await this.get(user, id);
    const updated = await this.prisma.order.update({ where: { id }, data: { priority }, include: ORDER_INCLUDE });
    this.realtime.toKitchen(order.branchId, 'order.updated', updated);
    return updated;
  }

  /** FR-WAT-12: đổi số lượng / ghi chú khi bếp chưa bắt đầu làm */
  async updateItem(user: AuthUser, itemId: number, dto: UpdateOrderItemDto) {
    const item = await this.getItem(itemId);
    assertBranchAccess(user, item.order.branchId);
    if (!CHANGEABLE_STATUSES.includes(item.status)) {
      throw new BadRequestException('Bếp đã bắt đầu chế biến, không thể thay đổi món');
    }
    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity, note: dto.note },
    });
    await this.audit.log({
      userId: user.id,
      action: 'order_item.update',
      entity: 'OrderItem',
      entityId: itemId,
      data: { before: { quantity: item.quantity, note: item.note }, after: dto },
    });
    this.emitItem(item.order, updated);
    return updated;
  }

  /** FR-WAT-12: hủy món khi bếp chưa bắt đầu làm */
  async cancelItem(user: AuthUser, itemId: number, reason?: string) {
    const item = await this.getItem(itemId);
    assertBranchAccess(user, item.order.branchId);
    return this.doCancel(item, reason ?? 'Phục vụ hủy', user.id);
  }

  /** FR-13: khách tự hủy món khi bếp chưa nhận (nếu cấu hình cho phép) */
  async cancelByCustomer(token: string, itemId: number, reason?: string) {
    const session = await this.sessions.getByToken(token);
    const item = await this.getItem(itemId);
    if (item.order.sessionId !== session.id) throw new ForbiddenException('Món không thuộc bàn của bạn');
    const ordering = await this.settings.get('ordering');
    if (!ordering.allowCustomerCancelPending || item.status !== 'PENDING') {
      throw new BadRequestException('Bếp đã nhận món, vui lòng gửi yêu cầu hủy món cho phục vụ');
    }
    return this.doCancel(item, reason ?? 'Khách hủy', null);
  }

  /** Phục vụ xác nhận đã mang món ra bàn */
  async markServed(user: AuthUser, itemId: number) {
    const item = await this.getItem(itemId);
    assertBranchAccess(user, item.order.branchId);
    if (item.status !== 'READY') throw new BadRequestException('Món chưa hoàn thành');
    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { status: 'SERVED', servedAt: new Date() },
    });
    await refreshOrderStatus(this.prisma, item.orderId);
    this.emitItem(item.order, updated);
    return updated;
  }

  async getItem(itemId: number) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: itemId },
      include: { order: { include: { table: { select: { id: true, code: true } }, session: { select: { token: true } } } } },
    });
    if (!item) throw new NotFoundException('Không tìm thấy món trong đơn');
    return item;
  }

  emitItem(
    order: { id: number; code: string; branchId: number; table: { id: number; code: string }; session: { token: string } },
    item: { id: number; name: string; quantity: number; note: string | null; status: OrderItemStatus; updatedAt: Date },
  ) {
    const payload = {
      id: item.id,
      orderId: order.id,
      orderCode: order.code,
      tableId: order.table.id,
      tableCode: order.table.code,
      name: item.name,
      quantity: item.quantity,
      note: item.note,
      status: item.status,
      updatedAt: item.updatedAt,
    };
    // NFR-01: đồng bộ khách - phục vụ - bếp
    this.realtime.toSession(order.session.token, 'order-item.updated', payload);
    this.realtime.toBranchStaff(order.branchId, 'order-item.updated', payload);
    this.realtime.toKitchen(order.branchId, 'order-item.updated', payload);
    return payload;
  }

  private async doCancel(item: Awaited<ReturnType<OrdersService['getItem']>>, reason: string, actorId: number | null) {
    if (!CHANGEABLE_STATUSES.includes(item.status)) {
      throw new BadRequestException('Bếp đã bắt đầu chế biến, không thể hủy món');
    }
    const billed = await this.prisma.billLine.count({
      where: { orderItemId: item.id, bill: { status: { in: ['OPEN', 'SPLIT', 'PAID'] } } },
    });
    if (billed) throw new BadRequestException('Món đã nằm trong hóa đơn, hãy hủy hóa đơn trước');
    const updated = await this.prisma.orderItem.update({
      where: { id: item.id },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledById: actorId },
    });
    await refreshOrderStatus(this.prisma, item.orderId);
    // NFR-06: ghi nhật ký hủy món
    await this.audit.log({
      userId: actorId,
      action: 'order_item.cancel',
      entity: 'OrderItem',
      entityId: item.id,
      data: { reason, name: item.name, quantity: item.quantity },
    });
    this.emitItem(item.order, updated);
    return updated;
  }
}
