# Bảng truy vết yêu cầu (SRS) → API backend

Tất cả đường dẫn có tiền tố `/api`. `{token}` là `sessionToken` của phiên bàn (lấy khi quét QR).
Trong code, các hàm / route liên quan đều có comment `FR-xx` để tra cứu ngược.

## 2. Khách hàng

| ID | Yêu cầu | API |
|---|---|---|
| FR-01 | Chọn chi nhánh, ngày giờ, số khách, vị trí bàn | `GET /public/branches`, `GET /public/branches/{id}` (khu vực), `POST /public/reservations` (`branchId`, `startAt`, `partySize`, `zoneId` / `locationType`) |
| FR-02 | Kiểm tra bàn trống real-time, gợi ý bàn / giờ khác | `GET /public/reservations/availability` → `alternatives.otherZones`, `alternatives.timeSlots` |
| FR-03 | Thông tin liên hệ, ghi chú đặc biệt | `POST /public/reservations` (`customerName`, `customerPhone`, `specialRequests[]`, `note`) |
| FR-04 | Đặt cọc online | `POST /public/reservations/{code}/deposit`, callback `POST /public/payments/mock/{id}/confirm`; chính sách tại `PUT /admin/settings/reservationPolicy` |
| FR-05 | Xem / sửa / hủy trong thời hạn | `GET` / `PATCH /public/reservations/{code}`, `POST /public/reservations/{code}/cancel` (khóa khi quá `freeCancelHours`) |
| FR-06 | Mã đặt bàn / QR check-in | Trả về khi tạo; `GET /public/reservations/{code}/qr` |
| FR-07 | Quét QR bàn để xem menu | `POST /public/tables/{qrToken}/session`; ảnh QR in bàn: `GET /admin/tables/{id}/qr` |
| FR-08 | Menu theo danh mục, ảnh, giá, tình trạng còn hàng | `GET /public/menu?lang=` |
| FR-09 | Món bán chạy, món mới, đánh giá của khách khác | `GET /public/menu/highlights`, `GET /public/menu/items/{id}` |
| FR-10 | Giỏ hàng, số lượng, ghi chú món | `GET/POST/PATCH/DELETE /public/sessions/{token}/cart...` |
| FR-11 | Gửi đơn trực tiếp | `POST /public/sessions/{token}/orders` |
| FR-12 | Gọi thêm món | Gọi lại `POST /public/sessions/{token}/orders` |
| FR-13 | Yêu cầu nhanh: gọi phục vụ, xin hóa đơn, đổi / hủy món | `POST /public/sessions/{token}/requests`; tự hủy món chưa nấu: `POST /public/sessions/{token}/order-items/{id}/cancel` |
| FR-14 | Theo dõi trạng thái đơn | `GET /public/sessions/{token}` + socket `order-item.updated` |
| FR-15 | Hóa đơn tạm tính | `GET /public/sessions/{token}` (trường `estimate`), `GET /public/sessions/{token}/bills` |
| FR-16 | Like / dislike / chấm sao từng món | `POST /public/sessions/{token}/dish-reviews` |
| FR-17 | Đánh giá trải nghiệm theo hóa đơn, khóa sau khi gửi | `POST /public/sessions/{token}/feedback` (`billId` unique → gửi lần 2 trả 409) |
| FR-18 | Nhận xét kèm ảnh | `POST /public/sessions/{token}/uploads` → đưa URL vào `photos[]` |
| FR-19 | Ẩn danh hoặc gắn tài khoản | `isAnonymous` trong 2 API đánh giá |
| FR-20 | Nhận phản hồi từ nhà hàng | Thông báo `FEEDBACK_RESPONSE` (in-app / push / email) |
| FR-21 | Thông báo xác nhận / từ chối / thay đổi đặt bàn | `NotificationsService` + socket `notification`, `reservation.updated` |
| FR-22 | Nhắc lịch trước giờ hẹn | Cron `ReservationsScheduler.sendReminders` (mỗi phút, mặc định trước 60 phút) |
| FR-23 | Thông báo trạng thái đơn real-time | Socket `order-item.updated`; push `ORDER_ITEM_READY` |
| FR-24 | Thông báo khuyến mãi, có thể tắt | `POST /notifications/promotions`; khách tắt bằng `PATCH /auth/me` `{ "promoOptIn": false }` |
| FR-25 | Đăng ký / đăng nhập (SĐT, email, mạng xã hội) hoặc khách vãng lai | `POST /auth/register`, `/auth/login`, `/auth/social`; khách vãng lai dùng API `/public/...` |
| FR-26 | Lịch sử đặt bàn, đơn, đánh giá | `GET /me/history`, `/me/reservations`, `/me/orders`, `/me/reviews` |
| FR-27 | Tích & đổi điểm | `GET /me/loyalty`; đổi điểm qua `redeemPoints` khi `POST /bills` |

## 3. Phục vụ

| ID | Yêu cầu | API |
|---|---|---|
| FR-WAT-01 | Thông báo tức thì khi có đặt bàn / đơn mới | Socket `reservation.created`, `order.created`, `service-request.created`, `table.updated` |
| FR-WAT-02 | Sơ đồ bàn theo khu vực, đủ 5 trạng thái | `GET /tables/floor-plan` (`displayStatus`, `upcomingReservation`, `session`) |
| FR-WAT-03 | Món gọi nhiều theo ca / ngày | `GET /reports/popular-dishes?period=shift|day` |
| FR-WAT-04 | Yêu cầu phục vụ mới nhất theo mức ưu tiên | `GET /service-requests` (`priority`, `isOverdue`), `/acknowledge`, `/resolve` |
| FR-WAT-05 | Đánh giá mới nhất | `GET /feedback/latest` |
| FR-WAT-06 | Gọi món hộ khách | `POST /orders` |
| FR-WAT-07 | Gộp / tách bàn | `POST /tables/merge`, `POST /tables/{id}/unmerge`, `POST /sessions/{id}/split`, `POST /sessions/{id}/move` |
| FR-WAT-08 | Xác nhận / từ chối đặt bàn | `POST /reservations/{id}/confirm`, `/reject` |
| FR-WAT-09 | Check-in bằng mã hoặc thủ công | `POST /reservations/check-in` `{ code }`, `POST /reservations/{id}/check-in` |
| FR-WAT-10 | Gửi đơn xuống bếp, theo dõi KDS | `POST /orders/{id}/send-to-kitchen` (khi bật `ordering.requireStaffConfirmation`), `GET /kitchen/queue` |
| FR-WAT-11 | Đang dọn dẹp → Trống | `PATCH /tables/{id}/status` |
| FR-WAT-12 | Đổi / hủy món trước khi bếp làm | `PATCH /order-items/{id}`, `POST /order-items/{id}/cancel` (chỉ khi `PENDING` / `RECEIVED`) |
| FR-WAT-13 | Hóa đơn cuối, tách bill, voucher | `POST /bills`, `POST /bills/{id}/split` (`EQUAL` / `ITEMS`) |
| FR-WAT-14 | Xác nhận thanh toán (tiền mặt, chuyển khoản, ví, POS) | `POST /bills/{id}/payments` |
| FR-WAT-15 | Giám sát ca | `GET /reports/shift-monitor` |
| FR-WAT-16 | Hoàn tiền, hủy bill, giảm giá ngoài chính sách (quyền nâng cao) | `POST /bills/{id}/refund` (`bill.refund`), `/void` (`bill.void`), `manualDiscount` (`bill.discount_override`) - vai trò `SENIOR_WAITER` |
| FR-WAT-17 | Xử lý khiếu nại / sự cố | `POST /incidents`, `GET /incidents`, `POST /incidents/{id}/resolve` |
| FR-WAT-18 | Báo cáo cuối ca gửi Quản lý | `GET /shift-reports/preview`, `POST /shift-reports` |

## 4. Bếp

| ID | Yêu cầu | API |
|---|---|---|
| FR-KIT-01 | Nhận đơn real-time, sắp cũ nhất trước (theo backlog US-13) | `GET /kitchen/queue` + socket `kitchen.order-received` |
| FR-KIT-02 | Chi tiết món, ghi chú, dị ứng | `GET /kitchen/queue` (`note`, `specialRequests`, `reservationNote`, `comboItems`) |
| FR-KIT-03 | Đã nhận → Đang làm → Hoàn thành → Đã giao | `PATCH /kitchen/items/{id}/status`, `POST /kitchen/orders/{id}/status` |
| FR-KIT-04 | Đánh dấu tạm hết, đồng bộ menu | `PATCH /kitchen/menu-items/{id}/availability` + socket `menu.item-updated` |

## 5. Quản lý

| ID | Yêu cầu | API |
|---|---|---|
| FR-MGR-01 | Doanh thu theo ca / ngày / tuần / tháng / năm, so sánh | `GET /reports/revenue?groupBy=&compare=` |
| FR-MGR-02 | Số khách, vòng quay bàn, thời gian phục vụ | `GET /reports/operations?groupBy=day|shift` |
| FR-MGR-03 | Món được thích / nhiều đánh giá / bị hủy nhiều | `GET /reports/dishes` |
| FR-MGR-04 | Hiệu suất nhân viên | `GET /reports/staff-performance` |
| FR-MGR-05 | Tỉ lệ đặt bàn thành công / hủy / no-show | `GET /reports/reservations` |
| FR-MGR-06 | Thêm / sửa / xóa món | `/menu/items` (CRUD), `POST /menu/items/{id}/image` |
| FR-MGR-07 | Quản lý danh mục | `/menu/categories` (CRUD) |
| FR-MGR-08 | Ẩn / hiện món, đồng bộ real-time | `PATCH /menu/items/{id}/visibility`, `/availability` |
| FR-MGR-09 | Combo, khuyến mãi theo giờ | `/menu/combos`, `/promotions` (`startTime`, `endTime`, `daysOfWeek`) |
| FR-MGR-10 | Giá theo ngày thường / cuối tuần / lễ | `/menu/items/{id}/price-rules`, `/menu/holidays` |
| FR-MGR-11 | Xem đánh giá, lọc theo món / nhân viên / thời gian | `GET /feedback?staffId=&from=&to=`, `GET /feedback/dish-reviews?menuItemId=` |
| FR-MGR-12 | Phản hồi công khai / riêng tư | `POST /feedback/{id}/respond`, `POST /feedback/dish-reviews/{id}/respond` (`isPublic`) |
| FR-MGR-13 | Gắn cờ đánh giá tiêu cực | `POST /feedback/{id}/flag`, `/unflag`, `/resolve` (đánh giá ≤ 2 sao tự gắn cờ) |
| FR-MGR-14 | Xuất Excel / PDF | `GET /reports/export?type=revenue|dishes|reservations|feedback&format=xlsx|pdf` |
| FR-MGR-15 | Khoảng ngày tùy chọn, lọc chi nhánh | Tham số `from`, `to`, `branchId` cho mọi báo cáo |
| FR-MGR-16 | Lịch tự động gửi báo cáo qua email | `/reports/schedules` (CRUD), `POST /reports/schedules/{id}/run` |
| FR-MGR-17 | Danh sách nhân viên, phân ca | `GET /staff`, `/shifts` (CRUD), `POST /shifts/{id}/assignments` |
| FR-MGR-18 | Chấm công, tích hợp máy chấm công | `POST /attendance/check-in`, `/check-out`, `GET /attendance`, webhook `POST /attendance/timekeeper` |

## 6. Quản trị hệ thống

| ID | Yêu cầu | API |
|---|---|---|
| FR-ADM-01 | Tạo / sửa / khóa / mở khóa tài khoản | `/admin/users` (CRUD), `/lock`, `/unlock` |
| FR-ADM-02 | Cấu hình RBAC chi tiết, cấp quyền trong nhóm Phục vụ | `GET /admin/permissions`, `/admin/roles` (CRUD) |
| FR-ADM-03 | Đặt lại mật khẩu, quản lý phiên | `POST /admin/users/{id}/reset-password`, `GET/DELETE /admin/users/{id}/sessions` |
| FR-ADM-04 | Nhật ký hoạt động | `GET /admin/audit-logs` |
| FR-ADM-05 | Thông tin nhà hàng, chi nhánh, giờ mở cửa | `PUT /admin/settings/restaurant`, `/admin/branches` |
| FR-ADM-06 | Sơ đồ bàn: bàn, khu vực, sức chứa | `/admin/zones`, `/admin/tables` |
| FR-ADM-07 | Chính sách đặt bàn | `PUT /admin/settings/reservationPolicy` |
| FR-ADM-08 | Phương thức thanh toán | `PUT /admin/settings/paymentMethods` |
| FR-ADM-09 | Mẫu thông báo | `GET/PUT/DELETE /admin/notification-templates` |
| FR-ADM-10 | Đa ngôn ngữ | `PUT /admin/settings/i18n`; `translations` của danh mục / món; `?lang=` ở menu |
| FR-ADM-11 | Tình trạng thiết bị | `GET /admin/system/health`, `/admin/devices`, heartbeat qua socket / `POST /public/devices/heartbeat` |
| FR-ADM-12 | Xem đánh giá toàn hệ thống | `GET /feedback` (admin không gắn chi nhánh) |
| FR-ADM-13 | Log lỗi kỹ thuật | `GET /admin/error-logs` |
| FR-ADM-14 | Sao lưu / phục hồi | `GET/POST /admin/backups`, `GET /admin/backups/{file}`, `POST /admin/backups/{file}/restore` |

## 7. Yêu cầu phi chức năng

| ID | Cách đáp ứng |
|---|---|
| NFR-01 Real-time | Socket.IO, phát sự kiện ngay sau khi ghi DB; phòng theo chi nhánh / bếp / bàn / người dùng |
| NFR-02 Hiệu năng | Index trên các cột truy vấn nhiều, báo cáo bằng SQL tổng hợp, cache cấu hình, giới hạn tần suất (Throttler) |
| NFR-03 Bảo mật | JWT + phiên có thể thu hồi, bcrypt, RBAC theo quyền, mã hóa AES-256-GCM thông tin giao dịch, Helmet |
| NFR-04 Sẵn sàng | `GET /api/health`, khóa advisory chống đặt trùng bàn, transaction cho thao tác nhiều bước |
| NFR-05 Tương thích | Khách dùng web qua QR, không cần cài app; toàn bộ API REST + Socket.IO |
| NFR-06 Truy vết | `AuditService` ghi: đổi / hủy món, đổi giá, đổi quyền, hoàn tiền, hủy bill, giảm giá đặc biệt, cấu hình |

## 8. Đối chiếu Product Backlog (SRS rút gọn)

Các quy tắc dưới đây đi theo Acceptance Criteria trong `Productbacklog.xlsx` (ưu tiên hơn SRS đầy đủ khi khác nhau).

| Story | AC | Nơi xử lý |
|---|---|---|
| US-1 AC1 | QR mở thực đơn + số bàn; QR sai báo lỗi thân thiện (404) | `POST /public/tables/{qrToken}/session` |
| US-2 | Số lượng 1-20, ghi chú ≤ 100 ký tự | `MAX_ITEM_QUANTITY`, `MAX_NOTE_LENGTH` trong `orders/dto/orders.dto.ts` |
| US-3 AC3 | Cùng loại yêu cầu không gửi lại trong 2 phút (trả 429 kèm thông báo) | `REPEAT_COOLDOWN_MINUTES` trong `service-requests.service.ts` |
| US-4 AC1 | Số khách 1-12 | `MAX_PARTY_SIZE` trong `reservations/dto/reservations.dto.ts` |
| US-4 AC2 | Hết bàn → 409 kèm `alternatives.timeSlots` (khung giờ khác) | `ReservationsService.create` |
| US-4 AC4, US-11 | Đặt bàn mới ở trạng thái Chờ xác nhận, phục vụ xác nhận / từ chối (kèm lý do) | `reservationPolicy.requireManualApproval = true`; `POST /reservations/{id}/confirm`, `/reject` |
| US-5 | Chỉ đánh giá món sau khi hóa đơn Paid; bắt buộc chấm sao; bình luận ≤ 300 ký tự | `FeedbackService.createDishReview`, `MAX_REVIEW_COMMENT_LENGTH` |
| US-6 AC1 | Đăng ký bắt buộc email duy nhất | `RegisterDto.email` |
| US-6, US-18 | Mật khẩu ≥ 8 ký tự | `MIN_PASSWORD_LENGTH` trong `auth/dto/auth.dto.ts` |
| US-7, US-18 | Nhân viên đăng nhập bằng tên đăng nhập duy nhất | Cột `User.username`, `AuthService.login`, `POST /admin/users` (`username`) |
| US-9 AC1 | Bàn chỉ có 4 trạng thái Trống / Đang có khách / Đã đặt / Đang dọn dẹp; quét QR **không** đổi trạng thái, **đơn đầu tiên** chuyển bàn sang Đang có khách; phục vụ chuyển Đang dọn dẹp → Trống | Enum `TableStatus` (migration `remove_table_ready_status`), `TableSessionsService.markOccupied` gọi trong `OrdersService.createOrder`, `ALLOWED_TRANSITIONS` trong `tables.service.ts` |
| US-9 AC2 | Thông báo cho phục vụ (đơn mới, yêu cầu phục vụ, món sẵn sàng) có số bàn + loại sự kiện, mới nhất trước, bộ đếm chưa đọc | `NotificationsService.notifyBranchStaff`; `GET /me/notifications`, `GET /me/notifications/unread-count`; socket `notification` |
| US-9 AC3 | Phục vụ đánh dấu đơn Sẵn sàng → Đã phục vụ | `POST /orders/{id}/serve` (cả đơn), `POST /order-items/{id}/serve` (từng món) |
| US-10 | Phục vụ chọn bàn để gọi hộ; đơn ghi "phục vụ tạo" + tên | `POST /orders` (`tableId`); `source = WAITER`, `createdBy` / `createdByWaiter` trên KDS |
| US-11 AC3, AC4 | Check-in → bàn Đang có khách; mã sai / đã dùng báo lỗi | `ReservationsService.checkIn` |
| US-13 AC1 | KDS sắp cũ nhất trước, đơn mới có `isNew` | `KitchenService.queue` |
| US-13 AC2 | Bếp chỉ đi tiến từng bước Đã nhận → Đang làm → Sẵn sàng | `NEXT` trong `orders/kitchen.service.ts` |
| US-13 AC3, DoD B-05 | Ghi thời gian + người đổi trạng thái | Cột `receivedAt / startedAt / readyAt / servedAt` + audit log `order.status`, `order_item.status` |
| US-15 AC1, DoD G-02 | Chạy dự án bằng 1 lệnh | `npm run quickstart` |
| US-16 AC1 | Giá món > 0 | `CreateMenuItemDto.price` |
| US-17, US-18 | Quản lý cấu hình bàn / QR, thông tin nhà hàng, tài khoản nhân viên | Vai trò `MANAGER` có `table.configure`, `settings.manage`, `user.manage`; không quản lý được tài khoản có quyền cao hơn mình |
| US-17 AC3 | Tên, địa chỉ, giờ mở cửa hiển thị trên trang thực đơn | `GET /public/menu` → `restaurant` |
| US-17 AC4 | Bàn có đơn chưa thanh toán không xóa được (409) | `BranchesService.deleteTable` |
| US-18 AC4 | Không tự khóa / tự đổi vai trò của chính mình | `UsersService.setLocked`, `UsersService.update` |
| US-19 | Doanh thu và top 10 món chỉ tính hóa đơn Paid; kỳ không có dữ liệu → 0 + "Không có dữ liệu" | `ReportsService.revenue*`, `ReportsService.dishes` (`topOrdered`, `hasData`, `message`) |
| DoD B-06 | Không tạo trùng khi gửi đồng thời: giỏ hàng, hóa đơn, thanh toán, đặt bàn, mã check-in | Giành giỏ hàng trong `createFromSession`; advisory lock trong `BillsService.generate` / `pay` và `ReservationsService.create`; `updateMany` có điều kiện trong `checkIn` |
| DoD B-07 | Migration chạy được trên DB trống và DB đã có dữ liệu | Migration `remove_table_ready_status` chuyển bàn READY → AVAILABLE trước khi đổi enum |
| US-20 | Lọc theo món / sao / ngày; điểm trung bình từng món; ≤ 2 sao gắn cờ | `GET /feedback/dish-reviews?menuItemId=&minRating=&maxRating=&from=&to=&flagged=` → `items[].isFlagged`, `dishAverages` |
| US-15 AC3 | Dữ liệu mẫu: 1 quản lý, 2 phục vụ, 1 bếp, 10 món, 8 bàn | `prisma/seed.ts` |
