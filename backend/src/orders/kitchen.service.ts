import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderItemStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-user';
import { assertBranchAccess } from '../common/utils/branch-scope';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { refreshOrderStatus } from './order-status.util';
import { OrdersService } from './orders.service';

/** FR-KIT-03, US-13 AC2: chỉ đi tiến từng bước, không lùi / không bỏ bước */
const NEXT: Record<OrderItemStatus, OrderItemStatus[]> = {
  PENDING: ['RECEIVED'],
  RECEIVED: ['PREPARING'],
  PREPARING: ['READY'],
  READY: ['SERVED'],
  SERVED: [],
  CANCELLED: [],
};

const ACTIVE: OrderItemStatus[] = ['PENDING', 'RECEIVED', 'PREPARING', 'READY'];

const STATUS_LABEL: Record<OrderItemStatus, string> = {
  PENDING: 'Đã gửi bếp',
  RECEIVED: 'Đã nhận',
  PREPARING: 'Đang chuẩn bị',
  READY: 'Sẵn sàng',
  SERVED: 'Đã phục vụ',
  CANCELLED: 'Đã hủy',
};

/** Màn hình bếp - Kitchen Display System (FR-KIT-01..FR-KIT-03) */
@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * FR-KIT-01, FR-KIT-02, US-13 AC1: hàng đợi bếp sắp xếp CŨ NHẤT TRƯỚC, kèm bàn, thời gian, món, số lượng, ghi chú;
   * `isNew` = đơn mới chưa được bếp nhận (để làm nổi bật). Đơn đã phục vụ rời danh sách (US-13 AC4).
   */
  async queue(branchId: number) {
    const now = Date.now();
    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'SENT_TO_KITCHEN', items: { some: { status: { in: ACTIVE } } } },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      include: {
        createdBy: { select: { id: true, fullName: true } },
        table: { select: { id: true, code: true } },
        session: { select: { guestCount: true, reservation: { select: { specialRequests: true, note: true } } } },
        items: {
          where: { status: { in: ACTIVE } },
          orderBy: { id: 'asc' },
          include: {
            menuItem: { select: { prepTimeMinutes: true, imageUrl: true } },
            combo: { include: { items: { include: { menuItem: { select: { name: true } } } } } },
          },
        },
      },
    });
    const summary: Record<string, number> = { PENDING: 0, RECEIVED: 0, PREPARING: 0, READY: 0 };
    const result = orders.map((o) => ({
      id: o.id,
      code: o.code,
      table: o.table,
      priority: o.priority,
      source: o.source,
      // US-10 AC4: đơn do phục vụ tạo hiển thị kèm tên phục vụ
      createdByWaiter: o.source === 'WAITER' ? (o.createdBy?.fullName ?? null) : null,
      isNew: o.items.every((i) => i.status === 'PENDING'),
      note: o.note,
      sentAt: o.sentAt,
      waitingMinutes: o.sentAt ? Math.floor((now - o.sentAt.getTime()) / 60_000) : 0,
      guestCount: o.session.guestCount,
      specialRequests: o.session.reservation?.specialRequests ?? [],
      reservationNote: o.session.reservation?.note ?? null,
      items: o.items.map((i) => {
        summary[i.status] = (summary[i.status] ?? 0) + i.quantity;
        return {
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          note: i.note,
          status: i.status,
          prepTimeMinutes: i.menuItem?.prepTimeMinutes ?? null,
          imageUrl: i.menuItem?.imageUrl ?? null,
          comboItems: i.combo?.items.map((ci) => `${ci.quantity} x ${ci.menuItem.name}`) ?? null,
          createdAt: i.createdAt,
          startedAt: i.startedAt,
        };
      }),
    }));
    return { branchId, summary, orders: result };
  }

  /** FR-KIT-03: cập nhật trạng thái một món */
  async updateItemStatus(user: AuthUser, itemId: number, status: OrderItemStatus) {
    const item = await this.orders.getItem(itemId);
    assertBranchAccess(user, item.order.branchId);
    if (item.order.status !== 'SENT_TO_KITCHEN') throw new BadRequestException('Đơn chưa được gửi xuống bếp');
    if (!NEXT[item.status].includes(status)) {
      throw new BadRequestException(
        `Không thể chuyển món từ "${STATUS_LABEL[item.status]}" sang "${STATUS_LABEL[status]}" (không được lùi hoặc bỏ bước)`,
      );
    }
    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: this.statusData(item, status, user.id),
    });
    await refreshOrderStatus(this.prisma, item.orderId);
    // US-13 AC3, DoD B-05: ghi lại người thực hiện & thời gian mỗi lần đổi trạng thái
    await this.audit.log({
      userId: user.id,
      action: 'order_item.status',
      entity: 'OrderItem',
      entityId: itemId,
      data: { orderId: item.orderId, from: item.status, to: status },
    });
    this.orders.emitItem(item.order, updated);
    if (status === 'READY') await this.onReady(item.order, updated.name);
    return updated;
  }

  /** Cập nhật cả đơn một lần (vd: "Nhận tất cả", "Hoàn thành tất cả") */
  async updateOrderStatus(user: AuthUser, orderId: number, status: OrderItemStatus) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, table: { select: { id: true, code: true } }, session: { select: { token: true } } },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn');
    assertBranchAccess(user, order.branchId);
    if (order.status !== 'SENT_TO_KITCHEN') throw new BadRequestException('Đơn chưa được gửi xuống bếp');
    const eligible = order.items.filter((i) => NEXT[i.status].includes(status));
    if (!eligible.length) {
      throw new BadRequestException(
        `Không có món nào chuyển được sang "${STATUS_LABEL[status]}" (không được lùi hoặc bỏ bước)`,
      );
    }
    for (const i of eligible) {
      const updated = await this.prisma.orderItem.update({ where: { id: i.id }, data: this.statusData(i, status, user.id) });
      this.orders.emitItem(order, updated);
    }
    await refreshOrderStatus(this.prisma, orderId);
    await this.audit.log({
      userId: user.id,
      action: 'order.status',
      entity: 'Order',
      entityId: orderId,
      data: { to: status, items: eligible.map((i) => ({ id: i.id, from: i.status })) },
    });
    if (status === 'READY') await this.onReady(order, eligible.map((i) => i.name).join(', '));
    return { updated: eligible.length };
  }

  private statusData(
    item: { receivedAt: Date | null; startedAt: Date | null },
    status: OrderItemStatus,
    userId: number,
  ): Prisma.OrderItemUncheckedUpdateInput {
    const now = new Date();
    switch (status) {
      case 'RECEIVED':
        return { status, receivedAt: now };
      case 'PREPARING':
        return { status, receivedAt: item.receivedAt ?? now, startedAt: now, preparedById: userId };
      case 'READY':
        return { status, readyAt: now, startedAt: item.startedAt ?? now, preparedById: userId };
      case 'SERVED':
        return { status, servedAt: now };
      default:
        return { status };
    }
  }

  /** Món xong: báo phục vụ ra lấy món + thông báo khách (FR-23) */
  private async onReady(
    order: { id: number; branchId: number; customerId: number | null; table: { code: string }; session: { token: string } },
    itemNames: string,
  ) {
    this.realtime.toBranchStaff(order.branchId, 'kitchen.item-ready', {
      orderId: order.id,
      tableCode: order.table.code,
      items: itemNames,
    });
    // US-9 AC2: thông báo lưu lại cho phục vụ
    await this.notifications.notifyBranchStaff(
      order.branchId,
      'STAFF_ORDER_READY',
      { table: order.table.code, items: itemNames },
      { orderId: order.id, event: 'ORDER_READY' },
    );
    if (order.customerId) {
      await this.notifications.notify({
        code: 'ORDER_ITEM_READY',
        userId: order.customerId,
        sessionToken: order.session.token,
        vars: { item: itemNames, table: order.table.code },
        channels: ['IN_APP', 'PUSH'],
      });
    }
  }
}
