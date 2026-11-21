import { OrderItemStatus, Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/** Món đang chờ / đang làm (chưa xong) */
export const IN_KITCHEN_STATUSES: OrderItemStatus[] = ['PENDING', 'RECEIVED', 'PREPARING'];
/** Còn được đổi / hủy (bếp chưa bắt đầu chế biến) - FR-WAT-12 */
export const CHANGEABLE_STATUSES: OrderItemStatus[] = ['PENDING', 'RECEIVED'];

/**
 * Cập nhật trạng thái tổng của đơn dựa trên trạng thái các món:
 * tất cả đã phục vụ / hủy => COMPLETED (hoặc CANCELLED nếu hủy hết).
 */
export async function refreshOrderStatus(db: Db, orderId: number) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: { select: { status: true } } } });
  if (!order || order.status === 'PENDING_CONFIRM') return order;
  const statuses = order.items.map((i) => i.status);
  let status = order.status;
  if (statuses.length && statuses.every((s) => s === 'CANCELLED')) status = 'CANCELLED';
  else if (statuses.length && statuses.every((s) => s === 'SERVED' || s === 'CANCELLED')) status = 'COMPLETED';
  else status = 'SENT_TO_KITCHEN';
  if (status !== order.status) return db.order.update({ where: { id: orderId }, data: { status } });
  return order;
}
