import { BadRequestException, ValidationError } from '@nestjs/common';

/** Tên hiển thị của các trường trong DTO (trường chưa khai báo thì dùng tên kỹ thuật) */
const LABELS: Record<string, string> = {
  amount: 'Số tiền',
  capacity: 'Số chỗ ngồi',
  categoryId: 'Danh mục',
  code: 'Mã',
  comboId: 'Combo',
  comment: 'Bình luận',
  customerEmail: 'Email',
  customerName: 'Tên khách hàng',
  customerPhone: 'Số điện thoại',
  email: 'Email',
  fullName: 'Họ tên',
  groups: 'Nhóm món',
  identifier: 'Tên đăng nhập',
  items: 'Danh sách món',
  manualDiscount: 'Số tiền giảm',
  manualDiscountReason: 'Lý do giảm giá',
  menuItemId: 'Món',
  method: 'Phương thức thanh toán',
  mode: 'Cách tách hóa đơn',
  name: 'Tên',
  note: 'Ghi chú',
  parts: 'Số phần',
  partySize: 'Số khách',
  password: 'Mật khẩu',
  phone: 'Số điện thoại',
  price: 'Giá',
  priority: 'Mức ưu tiên',
  quantity: 'Số lượng',
  rating: 'Số sao',
  reason: 'Lý do',
  redeemPoints: 'Số điểm',
  reference: 'Mã giao dịch',
  roleCode: 'Vai trò',
  sessionId: 'Phiên bàn',
  startAt: 'Thời gian',
  status: 'Trạng thái',
  tableId: 'Bàn',
  type: 'Loại',
  username: 'Tên đăng nhập',
  voucherCode: 'Mã voucher',
  zoneId: 'Khu vực',
};

/** Câu mặc định của class-validator có đuôi là con số giới hạn (vd: "... greater than 20") */
const WITH_LIMIT: Record<string, (label: string, limit: string) => string> = {
  min: (l, n) => `${l} phải từ ${n} trở lên`,
  max: (l, n) => `${l} tối đa là ${n}`,
  minLength: (l, n) => `${l} phải có ít nhất ${n} ký tự`,
  maxLength: (l, n) => `${l} tối đa ${n} ký tự`,
  arrayMinSize: (l, n) => `${l} phải có ít nhất ${n} mục`,
  arrayMaxSize: (l, n) => `${l} tối đa ${n} mục`,
};

function messageOf(error: ValidationError): string {
  const label = LABELS[error.property] ?? error.property;
  const constraints = error.constraints ?? {};
  if (error.value === undefined || error.value === null || (error.value === '' && constraints.isNotEmpty)) {
    return `Vui lòng nhập ${label}`;
  }

  // DTO tự khai báo câu tiếng Việt thì giữ nguyên
  const custom = Object.values(constraints).find((m) => /[^\x00-\x7F]/.test(m));
  if (custom) return custom;

  if (constraints.isInt) return `${label} phải là số nguyên`;
  for (const [key, build] of Object.entries(WITH_LIMIT)) {
    const limit = constraints[key]?.match(/(\d+)(?!.*\d)/)?.[1];
    if (limit) return build(label, limit);
  }
  return `${label} không hợp lệ`;
}

function collect(errors: ValidationError[], out: string[] = []): string[] {
  for (const error of errors) {
    if (error.children?.length) collect(error.children, out);
    else out.push(messageOf(error));
  }
  return out;
}

/** DoD A-03, A-04, B-03: lỗi dữ liệu đầu vào báo bằng tiếng Việt, mỗi trường một câu */
export const validationExceptionFactory = (errors: ValidationError[]) =>
  new BadRequestException([...new Set(collect(errors))]);
