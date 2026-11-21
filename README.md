# Bếp Nhà

Website demo và backend quản lý nhà hàng. Docker Compose chạy web, NestJS API và PostgreSQL. Cloudflare Tunnel đưa domain `restaurantc.acehhung.id.vn` tới web qua kết nối đi ra, không cần mở cổng public trên router.

## Chạy trên server Docker

Yêu cầu Docker Engine/Desktop với Compose v2. Lấy tunnel token của tunnel Cloudflare đang dùng cho domain này. Trong Cloudflare Zero Trust, cấu hình Public Hostname:

- Hostname: `restaurantc.acehhung.id.vn`
- Service type: `HTTP`
- URL: `web:80`

Tunnel connector cần chạy bằng service `cloudflared` trong compose dưới đây để nó phân giải được tên `web`.

Trên server, từ thư mục project:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Sửa `.env`: đặt mật khẩu PostgreSQL dài, ngẫu nhiên và điền tunnel token vào `CLOUDFLARE_TUNNEL_TOKEN`. Sửa `backend/.env`: thay `JWT_SECRET` và `PAYMENT_ENCRYPTION_KEY` bằng giá trị ngẫu nhiên riêng. Các khóa mẫu không dùng để triển khai.

Khởi chạy cả web, API, database và Cloudflare Tunnel:

```bash
docker compose --profile tunnel up -d --build
```

Mở <https://restaurantc.acehhung.id.vn>. API health: <https://restaurantc.acehhung.id.vn/api/health>; Swagger: <https://restaurantc.acehhung.id.vn/docs>. Migration database tự chạy khi API khởi động. Để thêm dữ liệu mẫu cho môi trường thử:

```bash
docker compose exec api npm run db:seed
```

Web cũng được bind riêng trên loopback của server tại cổng `8080`; kiểm tra bằng `curl http://127.0.0.1:8080`. Không cần mở cổng này ra Internet.

## Quản lý

```bash
docker compose ps
docker compose logs -f web api cloudflared
docker compose down
```

Dữ liệu PostgreSQL, ảnh tải lên và bản sao lưu nằm trong các Docker volumes. `docker compose down -v` sẽ xóa các volumes và dữ liệu đó.

## Chạy giao diện không cần Docker

Yêu cầu Python 3:

```bash
npm run dev
```

Mở <http://localhost:5173>.

## Giao diện quản trị

Mở <http://localhost:5173/manage.html> và đăng nhập bằng tài khoản nhân viên. Giao diện gọi trực tiếp API tại `/api`, dùng cùng host với reverse proxy Docker. Các trang quản trị cũ (`admin-dashboard.html`, `reservations.html`, `orders.html`, `menu.html`, `customers.html`) chuyển tới giao diện mới.

Reverse proxy chuyển tiếp `/api`, `/docs`, `/socket.io` và `/uploads` tới backend. Giao diện quản trị cần quyền backend tương ứng với từng mục; dữ liệu được lấy từ API và không lưu dữ liệu mẫu trong trình duyệt.
