/**
 * Mẫu thông báo mặc định (tiếng Việt). Admin có thể ghi đè bằng NotificationTemplate trong DB (FR-ADM-09).
 * Biến dạng {{tenBien}} sẽ được thay khi gửi.
 */
export const DEFAULT_TEMPLATES: Record<string, { title: string; body: string }> = {
  RESERVATION_CREATED: {
    title: 'Đã nhận yêu cầu đặt bàn {{code}}',
    body: 'Xin chào {{name}}, nhà hàng đã nhận yêu cầu đặt bàn cho {{partySize}} người lúc {{time}} tại {{branch}}. Chúng tôi sẽ xác nhận sớm.',
  },
  RESERVATION_CONFIRMED: {
    title: 'Đặt bàn {{code}} đã được xác nhận',
    body: 'Xin chào {{name}}, bàn của bạn cho {{partySize}} người lúc {{time}} tại {{branch}} đã được xác nhận. Vui lòng xuất trình mã {{code}} khi đến.',
  },
  RESERVATION_REJECTED: {
    title: 'Đặt bàn {{code}} bị từ chối',
    body: 'Xin lỗi {{name}}, nhà hàng không thể nhận đặt bàn lúc {{time}}. Lý do: {{reason}}.',
  },
  RESERVATION_UPDATED: {
    title: 'Đặt bàn {{code}} đã thay đổi',
    body: 'Thông tin đặt bàn của bạn đã được cập nhật: {{partySize}} người lúc {{time}} tại {{branch}}.',
  },
  RESERVATION_CANCELLED: {
    title: 'Đặt bàn {{code}} đã hủy',
    body: 'Đặt bàn lúc {{time}} tại {{branch}} đã được hủy.',
  },
  RESERVATION_REMINDER: {
    title: 'Nhắc lịch: bàn {{code}} lúc {{time}}',
    body: 'Xin chào {{name}}, bạn có lịch đặt bàn cho {{partySize}} người lúc {{time}} tại {{branch}}. Hẹn gặp bạn!',
  },
  RESERVATION_NO_SHOW: {
    title: 'Đặt bàn {{code}} đã quá giờ giữ bàn',
    body: 'Bàn đặt lúc {{time}} đã được hủy do quá thời gian giữ bàn.',
  },
  DEPOSIT_PAID: {
    title: 'Đã nhận tiền cọc cho đặt bàn {{code}}',
    body: 'Nhà hàng đã nhận {{amount}}đ tiền cọc cho đặt bàn {{code}}.',
  },
  ORDER_ITEM_READY: {
    title: 'Món {{item}} đã sẵn sàng',
    body: 'Món {{item}} của bàn {{table}} đã xong và đang được mang ra.',
  },
  FEEDBACK_RESPONSE: {
    title: 'Nhà hàng đã phản hồi đánh giá của bạn',
    body: '{{message}}',
  },
  PROMOTION: {
    title: '{{title}}',
    body: '{{body}}',
  },
  SHIFT_REPORT_SUBMITTED: {
    title: 'Báo cáo cuối ca từ {{staff}}',
    body: 'Doanh thu {{revenue}}đ, {{billCount}} hóa đơn, {{incidents}} sự cố.',
  },
};

export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => String(vars[key] ?? ''));
}
