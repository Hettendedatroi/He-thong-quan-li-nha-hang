/**
 * Danh mục quyền (RBAC - FR-ADM-02, NFR-03).
 * Mỗi vai trò (Role) lưu một mảng mã quyền; "*" = toàn quyền.
 * Admin có thể tạo vai trò mới / chỉnh quyền qua API /admin/roles.
 */
export const PERMISSIONS = {
  RESERVATION_VIEW: 'reservation.view',
  RESERVATION_MANAGE: 'reservation.manage',
  TABLE_VIEW: 'table.view',
  TABLE_OPERATE: 'table.operate',
  TABLE_CONFIGURE: 'table.configure',
  ORDER_VIEW: 'order.view',
  ORDER_CREATE: 'order.create',
  ORDER_MANAGE: 'order.manage',
  KITCHEN_VIEW: 'kitchen.view',
  KITCHEN_UPDATE: 'kitchen.update',
  MENU_STOCK: 'menu.stock',
  MENU_MANAGE: 'menu.manage',
  PROMOTION_MANAGE: 'promotion.manage',
  SERVICE_REQUEST_HANDLE: 'service_request.handle',
  BILL_MANAGE: 'bill.manage',
  PAYMENT_CONFIRM: 'payment.confirm',
  BILL_VOID: 'bill.void',
  BILL_REFUND: 'bill.refund',
  BILL_DISCOUNT_OVERRIDE: 'bill.discount_override',
  INCIDENT_MANAGE: 'incident.manage',
  SHIFT_MONITOR: 'shift.monitor',
  SHIFT_REPORT_SUBMIT: 'shift_report.submit',
  FEEDBACK_VIEW: 'feedback.view',
  FEEDBACK_RESPOND: 'feedback.respond',
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',
  STAFF_MANAGE: 'staff.manage',
  NOTIFICATION_SEND: 'notification.send',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  AUDIT_VIEW: 'audit.view',
  SETTINGS_MANAGE: 'settings.manage',
  SYSTEM_MONITOR: 'system.monitor',
  SYSTEM_BACKUP: 'system.backup',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  'reservation.view': 'Xem danh sách đặt bàn',
  'reservation.manage': 'Xác nhận / từ chối / check-in đặt bàn',
  'table.view': 'Xem sơ đồ bàn',
  'table.operate': 'Đổi trạng thái bàn, mở bàn, gộp / tách / chuyển bàn',
  'table.configure': 'Cấu hình sơ đồ bàn, khu vực, mã QR',
  'order.view': 'Xem đơn gọi món',
  'order.create': 'Gọi món hộ khách',
  'order.manage': 'Gửi bếp, đổi / hủy món, đánh dấu đã phục vụ',
  'kitchen.view': 'Xem màn hình bếp (KDS)',
  'kitchen.update': 'Cập nhật trạng thái chế biến',
  'menu.stock': 'Đánh dấu món tạm hết / còn hàng',
  'menu.manage': 'Quản lý thực đơn, danh mục, combo, giá theo thời gian',
  'promotion.manage': 'Quản lý khuyến mãi / voucher',
  'service_request.handle': 'Xử lý yêu cầu phục vụ của khách',
  'bill.manage': 'Tạo hóa đơn, tách hóa đơn, áp voucher',
  'payment.confirm': 'Xác nhận thanh toán',
  'bill.void': 'Hủy hóa đơn (quyền nâng cao)',
  'bill.refund': 'Hoàn tiền (quyền nâng cao)',
  'bill.discount_override': 'Giảm giá ngoài chính sách (quyền nâng cao)',
  'incident.manage': 'Ghi nhận / xử lý sự cố, khiếu nại',
  'shift.monitor': 'Giám sát hoạt động ca',
  'shift_report.submit': 'Gửi báo cáo cuối ca',
  'feedback.view': 'Xem đánh giá của khách',
  'feedback.respond': 'Phản hồi / gắn cờ đánh giá',
  'report.view': 'Xem báo cáo thống kê',
  'report.export': 'Xuất báo cáo Excel / PDF, lập lịch gửi báo cáo',
  'staff.manage': 'Quản lý nhân viên, phân ca, chấm công',
  'notification.send': 'Gửi thông báo khuyến mãi',
  'user.manage': 'Quản lý tài khoản nhân viên',
  'role.manage': 'Cấu hình phân quyền (admin)',
  'audit.view': 'Xem nhật ký hoạt động',
  'settings.manage': 'Cấu hình hệ thống, chi nhánh, chính sách',
  'system.monitor': 'Giám sát hệ thống, thiết bị, log lỗi',
  'system.backup': 'Sao lưu / phục hồi dữ liệu',
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];

export const ROLE_CODES = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  SENIOR_WAITER: 'SENIOR_WAITER',
  WAITER: 'WAITER',
  KITCHEN: 'KITCHEN',
  CUSTOMER: 'CUSTOMER',
} as const;

const P = PERMISSIONS;

const WAITER_PERMISSIONS: PermissionCode[] = [
  P.RESERVATION_VIEW,
  P.RESERVATION_MANAGE,
  P.TABLE_VIEW,
  P.TABLE_OPERATE,
  P.ORDER_VIEW,
  P.ORDER_CREATE,
  P.ORDER_MANAGE,
  P.KITCHEN_VIEW,
  P.SERVICE_REQUEST_HANDLE,
  P.BILL_MANAGE,
  P.PAYMENT_CONFIRM,
  P.INCIDENT_MANAGE,
  P.SHIFT_MONITOR,
  P.SHIFT_REPORT_SUBMIT,
  P.FEEDBACK_VIEW,
];

/** Vai trò mặc định được seed. isSystem = true: không xóa được. */
export const DEFAULT_ROLES: { code: string; name: string; description: string; permissions: string[] }[] = [
  {
    code: ROLE_CODES.ADMIN,
    name: 'Quản trị hệ thống',
    description: 'Toàn quyền hệ thống',
    permissions: ['*'],
  },
  {
    code: ROLE_CODES.MANAGER,
    name: 'Quản lý nhà hàng',
    description: 'Báo cáo, thực đơn, bàn & QR, tài khoản nhân viên, thông tin nhà hàng',
    permissions: [
      ...WAITER_PERMISSIONS,
      // US-17, US-18: Quản lý cấu hình bàn / thông tin nhà hàng và tài khoản nhân viên
      P.TABLE_CONFIGURE,
      P.SETTINGS_MANAGE,
      P.USER_MANAGE,
      P.BILL_VOID,
      P.BILL_REFUND,
      P.BILL_DISCOUNT_OVERRIDE,
      P.MENU_STOCK,
      P.MENU_MANAGE,
      P.PROMOTION_MANAGE,
      P.FEEDBACK_RESPOND,
      P.REPORT_VIEW,
      P.REPORT_EXPORT,
      P.STAFF_MANAGE,
      P.NOTIFICATION_SEND,
    ],
  },
  {
    code: ROLE_CODES.SENIOR_WAITER,
    name: 'Phục vụ (trưởng ca)',
    description: 'Phục vụ có quyền nâng cao: hoàn tiền, hủy bill, giảm giá ngoài chính sách',
    permissions: [...WAITER_PERMISSIONS, P.BILL_VOID, P.BILL_REFUND, P.BILL_DISCOUNT_OVERRIDE],
  },
  {
    code: ROLE_CODES.WAITER,
    name: 'Phục vụ',
    description: 'Nhận & điều phối bàn, gọi món',
    permissions: WAITER_PERMISSIONS,
  },
  {
    code: ROLE_CODES.KITCHEN,
    name: 'Nhân viên bếp',
    description: 'Màn hình bếp (KDS)',
    permissions: [P.KITCHEN_VIEW, P.KITCHEN_UPDATE, P.MENU_STOCK, P.ORDER_VIEW],
  },
  {
    code: ROLE_CODES.CUSTOMER,
    name: 'Khách hàng',
    description: 'Khách hàng đã đăng ký',
    permissions: [],
  },
];
