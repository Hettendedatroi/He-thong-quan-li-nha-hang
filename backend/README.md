# Restaurant Management System - Backend

Backend cho **Hệ thống Quản lý Nhà hàng (Group 4)** theo tài liệu SRS: đặt bàn, gọi món qua QR, điều phối phục vụ - bếp (KDS) theo thời gian thực, hóa đơn & thanh toán, đánh giá của khách, báo cáo thống kê, quản trị hệ thống với phân quyền RBAC.

| Thành phần | Công nghệ |
|---|---|
| Framework | NestJS 11 (TypeScript) |
| Database | PostgreSQL 16+ với Prisma ORM 6 |
| Realtime (NFR-01) | Socket.IO |
| Xác thực | JWT access token + refresh token xoay vòng, quản lý phiên |
| Tài liệu API | Swagger UI tại `/docs` |
| Xuất báo cáo | ExcelJS (xlsx), PDFKit (pdf) |
| Tác vụ định kỳ | `@nestjs/schedule` (nhắc lịch, no-show, gửi báo cáo) |

---

## 1. Cài đặt & chạy

### Yêu cầu
- Node.js 20 trở lên (đã thử với Node 24)
- PostgreSQL: chạy bằng Docker Desktop (khuyên dùng) hoặc cài trực tiếp

> **Lưu ý trên Windows:** nên đặt project ngoài thư mục OneDrive (ví dụ `C:\dev\...`). OneDrive sẽ cố đồng bộ hàng trăm MB `node_modules`, làm chậm máy và dễ khóa file khi `npm install`.

### Chạy nhanh bằng một lệnh (US-15 AC1)

Mở Docker Desktop, rồi:

```bash
cd backend
npm run quickstart
```

Lệnh này tự làm đủ các bước bên dưới: cài thư viện → tạo `.env` từ `.env.example` (nếu chưa có) → bật PostgreSQL và đợi sẵn sàng → chạy migration → nạp dữ liệu mẫu → chạy server ở chế độ dev. Chạy lại nhiều lần không sao: seed không nhân đôi dữ liệu.

### Hoặc làm từng bước

```bash
cd backend

# 1. Cài thư viện
npm install

# 2. Tạo file cấu hình từ mẫu rồi sửa nếu cần
cp .env.example .env            # PowerShell: Copy-Item .env.example .env

# 3. Khởi động PostgreSQL bằng Docker (mở Docker Desktop trước)
npm run db:up

# 4. Tạo bảng + dữ liệu mẫu
npm run prisma:deploy           # áp dụng các migration có sẵn
npm run db:seed                 # tạo tài khoản, chi nhánh, bàn, thực đơn mẫu

# 5. Chạy server ở chế độ dev (tự reload khi sửa code)
npm run start:dev
```

Mở **http://localhost:3000/docs** để xem và gọi thử toàn bộ API.
Health check: `GET http://localhost:3000/api/health`.

Không dùng Docker? Cài PostgreSQL, tạo database `restaurant_db` và sửa `DATABASE_URL` trong `.env`.

### Tài khoản mẫu (mật khẩu chung `Password@123`)

Theo US-15 AC3 của Product Backlog: 1 quản lý, 2 phục vụ, 1 bếp. Nhân viên đăng nhập bằng **tên đăng nhập** (`identifier` trong `POST /api/auth/login`); email / SĐT vẫn dùng được.

| Vai trò | Tên đăng nhập | Email | SĐT |
|---|---|---|---|
| Quản lý nhà hàng (MANAGER) | `manager` | manager@restaurant.local | 0900000002 |
| Phục vụ (WAITER) | `waiter1` | waiter@restaurant.local | 0900000004 |
| Phục vụ (WAITER) | `waiter2` | waiter2@restaurant.local | 0900000006 |
| Bếp (KITCHEN) | `kitchen` | kitchen@restaurant.local | 0900000005 |
| Khách hàng (CUSTOMER) | - | customer@example.com | 0911111111 |

Dữ liệu mẫu còn có: 1 nhà hàng, 3 khu vực (Trong nhà, Ngoài trời, VIP), 8 bàn (2-12 chỗ), 10 món, 1 combo, happy hour đồ uống 17:00-19:00 (thứ 2 - thứ 6), voucher `WELCOME10`, 2 thiết bị (KDS, máy in) và ca làm hôm nay.

> Seed chỉ thêm / cập nhật, không xóa. DB đã seed theo bản cũ (2 chi nhánh, 24 bàn, tài khoản admin...) sẽ vẫn giữ dữ liệu cũ; muốn đúng số liệu trên thì chạy `npm run db:reset` (xóa sạch DB dev).

### Các lệnh hay dùng

| Lệnh | Tác dụng |
|---|---|
| `npm run start:dev` | Chạy dev, tự reload |
| `npm run build` / `npm run start:prod` | Build và chạy bản production |
| `npm run typecheck` | Kiểm tra lỗi TypeScript |
| `npm run prisma:migrate -- --name <ten>` | Tạo migration mới sau khi sửa `schema.prisma` |
| `npm run prisma:studio` | Giao diện xem / sửa dữ liệu trên trình duyệt |
| `npm run db:reset` | Xóa sạch DB, chạy lại migration + seed (chỉ dùng khi dev) |

---

## 2. Cấu trúc thư mục

```
backend/
├── prisma/
│   ├── schema.prisma        # Toàn bộ mô hình dữ liệu (có comment FR-xx)
│   ├── migrations/          # Lịch sử thay đổi DB - PHẢI commit
│   └── seed.ts              # Dữ liệu mẫu
└── src/
    ├── main.ts              # Khởi động app, Swagger, CORS, validation
    ├── app.module.ts        # Gắn các module + guard toàn cục
    ├── prisma/              # PrismaService
    ├── common/              # Guard xác thực / RBAC, decorator, filter lỗi, tiện ích
    │   └── constants/permissions.ts   # Danh mục quyền + quyền mặc định của từng vai trò
    ├── core/                # Audit log, cấu hình hệ thống, mã hóa, email, lưu ảnh
    ├── realtime/            # Socket.IO gateway
    ├── notifications/       # Thông báo in-app / push / email / SMS + mẫu thông báo
    ├── auth/                # Đăng ký, đăng nhập (email/SĐT/Google/Facebook), refresh, phiên
    ├── users/               # Admin: tài khoản, vai trò & quyền, audit log
    ├── branches/            # Admin: chi nhánh, khu vực, bàn, QR bàn
    ├── tables/              # Sơ đồ bàn, phiên bàn, gộp / tách / chuyển bàn
    ├── menu/                # Danh mục, món, combo, giá theo thời gian, menu cho khách
    ├── promotions/          # Happy hour, voucher
    ├── reservations/        # Đặt bàn, đặt cọc, check-in, nhắc lịch, no-show
    ├── orders/              # Giỏ hàng, gọi món, KDS bếp
    ├── service-requests/    # Gọi phục vụ, xin hóa đơn, đổi / hủy món
    ├── billing/             # Hóa đơn, tách bill, thanh toán, hoàn tiền, tích điểm
    ├── feedback/            # Đánh giá món / trải nghiệm, phản hồi, gắn cờ
    ├── customers/           # /me: lịch sử, điểm thưởng
    ├── reports/             # Thống kê, xuất Excel/PDF, lịch gửi báo cáo
    ├── staff/               # Nhân viên, ca làm, chấm công, báo cáo cuối ca, sự cố
    ├── system/              # Cấu hình, thiết bị, health, log lỗi, sao lưu / phục hồi
    └── uploads/             # Upload ảnh
```

Mỗi module theo cùng một khuôn: `*.module.ts` (khai báo), `*.controller.ts` (định nghĩa route), `*.service.ts` (nghiệp vụ), `dto/*.ts` (kiểm tra dữ liệu đầu vào bằng `class-validator`).

---

## 3. Quy ước API

- Tiền tố: `/api`. Tiền tệ là **VND dạng số nguyên**. Thời gian trả về dạng ISO 8601 (UTC). Khi gửi lên, dùng ISO có múi giờ, ví dụ `2026-10-20T19:00:00+07:00`.
- **Xác thực:** header `Authorization: Bearer <accessToken>`. Access token sống 15 phút; khi hết hạn gọi `POST /api/auth/refresh` với `refreshToken` để lấy cặp token mới (refresh token cũ hết hiệu lực ngay).
- **Route công khai** (không cần đăng nhập) đều nằm dưới `/api/public/...`.
- **Khách tại bàn** không cần tài khoản: quét QR → `POST /api/public/tables/{qrToken}/session` → nhận `sessionToken`, dùng cho mọi API `/api/public/sessions/{sessionToken}/...` (giỏ hàng, gọi món, yêu cầu phục vụ, hóa đơn, đánh giá).
- **Phân trang:** `?page=1&limit=20`; kết quả dạng `{ items, total, page, limit, totalPages }`.
- **Lỗi:** `{ statusCode, message, path, timestamp }`. Thông báo lỗi bằng tiếng Việt, frontend có thể hiển thị trực tiếp.
- **Phân quyền (RBAC):** mỗi vai trò có danh sách quyền, ví dụ `bill.refund`. Admin xem danh mục quyền tại `GET /api/admin/permissions` và chỉnh vai trò tại `/api/admin/roles`. Nhân viên gắn chi nhánh chỉ thấy dữ liệu của chi nhánh mình.

---

## 4. Realtime (Socket.IO) - dành cho team frontend

Kết nối tới cùng host với API:

```js
import { io } from 'socket.io-client';

// Nhân viên / khách đã đăng nhập
const socket = io('http://localhost:3000', { auth: { token: accessToken } });
// Khách tại bàn (không đăng nhập)
const socket = io('http://localhost:3000', { auth: { sessionToken } });
// Thiết bị (KDS, tablet) đã đăng ký ở /api/admin/devices
const socket = io('http://localhost:3000', { auth: { deviceKey } });
```

Server tự cho client vào đúng "phòng" theo vai trò. Quản lý cấp chuỗi (không gắn chi nhánh) gửi `socket.emit('subscribe.branch', { branchId })` để theo dõi một chi nhánh. Khách theo dõi đặt bàn: `socket.emit('subscribe.reservation', { code })`.

| Sự kiện | Ai nhận | Khi nào |
|---|---|---|
| `reservation.created` / `reservation.updated` | Phục vụ, khách theo dõi mã | Có đặt bàn mới / đổi trạng thái (FR-WAT-01, FR-21) |
| `order.created` / `order.updated` | Phục vụ, khách tại bàn | Có đơn mới / gửi bếp |
| `kitchen.order-received` | Bếp | Đơn xuống KDS (FR-KIT-01) |
| `order-item.updated` | Phục vụ, bếp, khách tại bàn | Món đổi trạng thái (FR-14, FR-23) |
| `kitchen.item-ready` | Phục vụ | Món đã xong, cần mang ra |
| `service-request.created` / `.updated` | Phục vụ, khách | Gọi phục vụ / xin hóa đơn (FR-13, FR-WAT-04) |
| `table.updated`, `floor.updated`, `session.opened` | Phục vụ | Sơ đồ bàn thay đổi (FR-WAT-02) |
| `menu.item-updated`, `menu.updated` | Tất cả | Món hết hàng / ẩn / đổi giá (FR-KIT-04, FR-MGR-08) |
| `cart.updated` | Khách tại bàn | Giỏ hàng chung của bàn thay đổi |
| `bill.updated` | Phục vụ, khách tại bàn | Tạo / tách / thanh toán hóa đơn |
| `session.closed`, `session.merged`, `session.moved` | Khách tại bàn | Kết thúc / gộp / chuyển bàn |
| `feedback.created`, `feedback.dish-review` | Phục vụ, quản lý | Có đánh giá mới (FR-WAT-05) |
| `notification` | Người dùng | Thông báo cá nhân (FR-21..24). Phục vụ nhận thêm `STAFF_NEW_ORDER`, `STAFF_SERVICE_REQUEST`, `STAFF_ORDER_READY` (US-9 AC2), đồng thời được lưu lại: `GET /api/me/notifications` (mới nhất trước), `GET /api/me/notifications/unread-count` |
| `incident.created`, `shift-report.submitted` | Phục vụ, quản lý | Sự cố / báo cáo cuối ca |
| `device.status` | Admin | Thiết bị online / offline (FR-ADM-11) |

---

## 5. Luồng nghiệp vụ chính

Trạng thái bàn (US-9): `AVAILABLE` (Trống), `OCCUPIED` (Đang có khách), `RESERVED` (Đã đặt), `CLEANING` (Đang dọn dẹp).

1. **Đặt bàn:** `GET /public/reservations/availability` → `POST /public/reservations`. Khách nhận mã + QR, đặt bàn ở trạng thái **Chờ xác nhận**. Hết bàn thì API trả 409 kèm `alternatives.timeSlots`.
2. **Phục vụ duyệt:** `GET /reservations?status=PENDING` → `POST /reservations/{id}/confirm` hoặc `/reject` (kèm lý do).
3. **Khách đến:** phục vụ quét mã đặt chỗ → `POST /reservations/check-in` → bàn chuyển **Đang có khách**.
4. **Gọi món:** khách quét QR trên bàn (bàn **vẫn Trống**) → thêm giỏ → `POST /public/sessions/{token}/orders`; hoặc phục vụ gọi hộ `POST /orders` với `tableId`. **Đơn đầu tiên** chuyển bàn sang Đang có khách.
5. **Bếp:** `GET /kitchen/queue` (cũ nhất trước) → `POST /kitchen/orders/{id}/status` (RECEIVED → PREPARING → READY).
6. **Phục vụ mang món:** `POST /orders/{id}/serve` → Đã phục vụ.
7. **Thanh toán:** `POST /bills` → (tùy chọn) `POST /bills/{id}/split` → `POST /bills/{id}/payments`. Thanh toán đủ thì bàn chuyển sang **Đang dọn dẹp**.
8. **Dọn bàn:** `PATCH /tables/{id}/status` với `AVAILABLE` → Trống.
9. **Đánh giá:** `POST /public/sessions/{token}/dish-reviews` và `/feedback` (chỉ sau khi đã thanh toán, mỗi hóa đơn 1 lần).

Bảng ánh xạ đầy đủ từng yêu cầu SRS sang API: xem [docs/FR_TRACEABILITY.md](docs/FR_TRACEABILITY.md).

---

## 6. Các điểm tích hợp còn là bản giả lập

| Hạng mục | Hiện trạng | Muốn dùng thật thì |
|---|---|---|
| Cổng thanh toán đặt cọc (FR-04) | Cổng giả lập: `POST /api/public/payments/mock/{id}/confirm` | Thay trong `ReservationsService.initDeposit` / `confirmMockPayment` bằng VNPay / MoMo |
| Push notification | Ghi log, vẫn gửi qua Socket.IO | Gọi Firebase Cloud Messaging trong `NotificationsService.sendPush` |
| SMS | Ghi log | Gọi nhà cung cấp SMS trong `NotificationsService.notify` |
| Email | Chỉ ghi log khi chưa cấu hình | Điền `SMTP_*` trong `.env` |
| Lưu ảnh | Ổ đĩa `uploads/` | Thay `StorageService` bằng S3 / Cloudinary |

---

## 7. Thêm một tính năng mới

1. Sửa `prisma/schema.prisma` → `npm run prisma:migrate -- --name ten_thay_doi` (commit cả thư mục migration mới).
2. Tạo DTO trong `src/<module>/dto/`, viết logic trong service, thêm route trong controller.
3. Gắn `@RequirePermissions(PERMISSIONS.XXX)` cho route cần quyền. Quyền mới thì khai báo trong `src/common/constants/permissions.ts`.
4. Thao tác quan trọng (đổi giá, hủy, hoàn tiền, đổi quyền) thì gọi `AuditService.log(...)` (NFR-06).
5. Cần báo realtime thì gọi `RealtimeService.toBranchStaff / toKitchen / toSession ...`.
6. Chạy `npm run typecheck` rồi thử trên Swagger trước khi commit.

## 8. Lỗi thường gặp

| Lỗi | Cách xử lý |
|---|---|
| `Can't reach database server` | Docker Desktop chưa chạy hoặc chưa `npm run db:up`; kiểm tra `DATABASE_URL` |
| `Environment variable not found: DATABASE_URL` | Chưa tạo file `.env` |
| `@prisma/client did not initialize yet` | Chạy `npx prisma generate` (bình thường `npm install` đã tự chạy qua script `postinstall`). Sau mỗi lần sửa `schema.prisma` cũng cần generate lại |
| `Cannot find module 'C:/.../src/...dto'` khi khởi động | Plugin Swagger lỗi với đường dẫn có dấu tiếng Việt. Thuộc tính là mảng DTO lồng nhau phải có `@ApiProperty({ type: () => XxxDto, isArray: true })` (xem `CreateComboDto`); hoặc đặt project ở thư mục không dấu |
| PDF xuất ra lỗi dấu tiếng Việt | Đặt `PDF_FONT_PATH` tới một font TTF có tiếng Việt (vd `C:\Windows\Fonts\arial.ttf`) |
| `EPERM` / file bị khóa khi `npm install` | Project đang nằm trong OneDrive, hãy chuyển ra ngoài |
| 401 sau khi admin khóa tài khoản | Đúng thiết kế: khóa tài khoản sẽ thu hồi mọi phiên đăng nhập ngay lập tức |
