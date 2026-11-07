# Bản đồ Sprint - Backend

Code nền của backend đã lên nhánh `testing` trước khi các sprint bắt đầu (PR #1 đến #9), nên lịch sử git không chia theo sprint.
Bảng này cho biết mỗi User Story thuộc sprint nào, code nằm ở đâu và đã được nghiệm thu theo sprint chưa.
Sprint 1 không có PR riêng: các lỗi tồn đọng của Sprint 1 được sửa và viết test trong PR Sprint 2.

Từ Sprint 2, mỗi sprint có **một PR kiểm thử + sửa lỗi** vào `testing`, gắn milestone của sprint và tag sau khi merge. Không viết lại lịch sử git của `testing`.

## Quy trình cho mỗi sprint

1. Tạo nhánh `sprint-N/backend` từ `origin/testing`.
2. Đối chiếu từng AC của các story trong sprint, viết test và sửa lỗi.
3. Mở PR vào `testing`, gắn milestone `Sprint N`, liệt kê kết quả theo AC và những gì còn thuộc về frontend. Cần ít nhất 1 người duyệt (DoD F-01).
4. Sau khi merge, tạo tag `sprint-N-backend` trên commit merge rồi cập nhật bảng dưới đây.

## Bảng story

| Sprint | Story | Nội dung | Module | PR code nền | Nghiệm thu theo sprint |
|---|---|---|---|---|---|
| 1 | US-15 | Nền tảng, chạy một lệnh | `prisma`, `core`, `app.module` | #1, #9 | Test trong PR Sprint 2 |
| 1 | US-7 | Đăng nhập nhân viên, phân quyền | `auth`, `common` | #1, #8 | Test trong PR Sprint 2 |
| 1 | US-16 | Thực đơn, danh mục | `menu` | #2, #8 | Test trong PR Sprint 2 |
| 1 | US-17 | Thông tin nhà hàng, bàn, QR | `branches`, `tables` | #2, #8 | Sửa + test trong PR Sprint 2 (link QR, trùng số bàn) |
| 1 | US-18 | Tài khoản nhân viên | `users` | #1, #8 | Sửa + test trong PR Sprint 2 (gán vai trò Bếp, lọc nhân viên, câu báo lỗi) |
| 1 | US-1 | Quét QR xem thực đơn | `tables`, `menu` | #2, #9 | Sửa + test trong PR Sprint 2 (link QR) |
| 2 | US-2 | Giỏ hàng, gửi đơn, gọi thêm | `orders` | #2, #5, #9 | PR Sprint 2 |
| 2 | US-12 | Cập nhật thời gian thực | `realtime` | #1, #5 | PR Sprint 2 |
| 2 | US-13 | Màn hình bếp | `orders` (`kitchen.service`) | #5, #9 | PR Sprint 2 |
| 2 | US-8 | Hóa đơn, thanh toán | `billing` | #6, #9 | PR Sprint 2 |
| 3 | US-3 | Trạng thái đơn, yêu cầu nhanh | `service-requests`, `orders` | #5, #8 | Chưa làm |
| 3 | US-9 | Sơ đồ bàn, thông báo | `tables`, `notifications` | #2, #9 | Chưa làm |
| 3 | US-10 | Đơn hộ khách | `orders` | #5, #9 | Chưa làm |
| 3 | US-14 | Đánh dấu hết món | `orders`, `menu` | #5 | Chưa làm |
| 3 | US-19 | Báo cáo doanh thu | `reports` | #7, #8 | Chưa làm |
| 4 | US-4 | Đặt bàn | `reservations` | #4, #9 | Chưa làm |
| 4 | US-11 | Xác nhận đặt bàn, check-in | `reservations` | #4, #9 | Chưa làm |
| 4 | US-5 | Đánh giá món | `feedback` | #6, #8 | Chưa làm |
| 4 | US-20 | Xem và phản hồi đánh giá | `feedback` | #6, #8 | Chưa làm |
| 4 | US-6 | Tài khoản khách | `auth`, `customers` | #1, #6, #8 | Chưa làm |

## Chạy test

Chỉ chạy trên database vừa migrate + seed ở máy cá nhân, không chạy trên server dùng chung vì test tạo đơn, hóa đơn và thử tải.

```bash
npm run build
npm run start:prod                # terminal 1
BASE_URL=http://localhost:3000 npm run test:e2e       # terminal 2: Sprint 1 rồi Sprint 2
```

Chạy riêng từng sprint: `npm run test:sprint1`, `npm run test:sprint2` (Sprint 2 cần các bàn đang Trống, nên chạy trên DB vừa seed).
Kết quả in theo từng AC / DoD, có thể chép vào bảng AC - Test case (DoD A-01, F-03).
