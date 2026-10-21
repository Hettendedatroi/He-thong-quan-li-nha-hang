# Hướng dẫn đẩy code & merge trên GitHub

Repo của nhóm: **https://github.com/Hettendedatroi/He-thong-quan-li-nha-hang**
Repo hiện có 2 nhánh: `main` và `testing`.

## 0. Mô hình nhánh đề xuất

```
main      ← bản ổn định (demo / nộp bài). Chỉ merge từ testing qua Pull Request.
testing   ← nhánh tích hợp: code của mọi người gộp vào đây để test chung.
feature/* ← mỗi tính năng một nhánh, tách từ testing (vd: feature/backend-core)
fix/*     ← sửa lỗi (vd: fix/reservation-timezone)
```

Nguyên tắc: **không commit thẳng lên `main` / `testing`**. Mọi thay đổi đi qua Pull Request (PR) để người khác xem trước khi gộp.

Cấu trúc thư mục trong repo:

```
He-thong-quan-li-nha-hang/
├── README.md
├── .github/workflows/backend-ci.yml   ← CI tự kiểm tra build backend cho mỗi PR
├── backend/                           ← phần của bạn
└── frontend/                          ← phần của team frontend (nếu chung repo)
```

---

## 1. Chuẩn bị (làm một lần)

### 1.1. Xin quyền ghi vào repo
Repo thuộc tài khoản **Hettendedatroi**. Nhờ chủ repo vào **Settings → Collaborators → Add people**, thêm tài khoản GitHub của bạn, sau đó bạn mở email (hoặc https://github.com/notifications) để **Accept invitation**. Chưa được thêm thì `git push` sẽ báo `403 Permission denied`.

### 1.2. Khai báo danh tính Git (nếu chưa có)
```powershell
git config --global user.name "Tên của bạn"
git config --global user.email "email-dang-ky-github@example.com"
```

### 1.3. Clone repo ra ngoài OneDrive
```powershell
mkdir C:\dev
git clone https://github.com/Hettendedatroi/He-thong-quan-li-nha-hang.git C:\dev\He-thong-quan-li-nha-hang
cd C:\dev\He-thong-quan-li-nha-hang
```
Lần đầu `push`, Git Credential Manager sẽ mở trình duyệt để bạn đăng nhập GitHub. Chỉ cần đăng nhập một lần.

---

## 2. Đẩy code backend lần đầu

### 2.1. Tạo nhánh tính năng từ `testing`
```powershell
git switch testing
git pull
git switch -c feature/backend-core
```

### 2.2. Copy code vào repo (bỏ qua thư mục sinh tự động)
```powershell
robocopy "C:\Users\KIEN\OneDrive\Máy tính\Restaurant Management\backend" "C:\dev\He-thong-quan-li-nha-hang\backend" /E /XD node_modules dist /XF .env
robocopy "C:\Users\KIEN\OneDrive\Máy tính\Restaurant Management\.github" "C:\dev\He-thong-quan-li-nha-hang\.github" /E
```
(`robocopy` trả mã thoát 1 khi copy thành công. Đó không phải lỗi.)

### 2.3. Kiểm tra trước khi commit
```powershell
cd C:\dev\He-thong-quan-li-nha-hang\backend
npm install
npm run typecheck
cd ..
git status
```
Trong `git status` **không được** có `.env`, `node_modules/`, `dist/`. Các thư mục này đã nằm trong `backend/.gitignore`.

### 2.4. Commit
```powershell
git add backend .github
git commit -m "feat(backend): khởi tạo backend NestJS + Prisma cho hệ thống quản lý nhà hàng"
```

Quy ước message (Conventional Commits):

| Tiền tố | Dùng khi |
|---|---|
| `feat:` | Thêm tính năng |
| `fix:` | Sửa lỗi |
| `refactor:` | Sửa cấu trúc code, không đổi chức năng |
| `docs:` | Tài liệu |
| `chore:` | Cấu hình, thư viện |

Ví dụ: `feat(reservations): thêm gợi ý khung giờ khi hết bàn`, `fix(billing): sửa làm tròn VAT khi tách hóa đơn`.

### 2.5. Push nhánh lên GitHub
```powershell
git push -u origin feature/backend-core
```

---

## 3. Tạo Pull Request và merge

1. Mở repo trên GitHub. Sẽ có thanh vàng **"feature/backend-core had recent pushes" → Compare & pull request**.
2. Chọn **base: `testing`** ← **compare: `feature/backend-core`** (merge vào `testing` trước, **không** vào `main`).
3. Đặt tiêu đề, mô tả: làm gì, cách chạy thử, ảnh chụp Swagger nếu có. Ở mục *Reviewers*, chọn thành viên khác review.
4. Đợi CI (tab **Checks**) báo xanh ✅. CI đỏ thì bấm vào xem log, sửa code, commit, push lại; PR tự cập nhật.
5. Khi đã được approve: bấm **Merge pull request**. Nên chọn **Squash and merge** để lịch sử gọn, mỗi PR một commit.
6. Bấm **Delete branch** sau khi merge.

Cập nhật máy bạn sau khi merge:
```powershell
git switch testing
git pull
git branch -D feature/backend-core   # -D viết hoa: sau Squash merge, -d sẽ báo "not fully merged"
```

### Đưa `testing` lên `main` (khi cả nhóm test xong, chuẩn bị demo / nộp)
Tạo PR mới với **base: `main`** ← **compare: `testing`**, review rồi chọn **Create a merge commit** (giữ lịch sử).

---

## 4. Làm việc hằng ngày

```powershell
git switch testing
git pull                                   # lấy code mới nhất của cả nhóm
git switch -c feature/ten-tinh-nang        # nhánh mới cho việc sắp làm
# ... code ...
git add .
git commit -m "feat(...): ..."
git push -u origin feature/ten-tinh-nang   # rồi tạo PR vào testing
```

Nhánh đang làm bị cũ so với `testing` (người khác đã merge thêm):
```powershell
git switch feature/ten-tinh-nang
git fetch origin
git merge origin/testing                   # gộp code mới vào nhánh của mình
git push
```

### Khi có xung đột (conflict)
1. `git merge origin/testing` báo `CONFLICT in <file>`.
2. Mở file trong VS Code, tìm các đoạn:
   ```
   <<<<<<< HEAD
   code của bạn
   =======
   code từ testing
   >>>>>>> origin/testing
   ```
   VS Code có nút **Accept Current / Incoming / Both**. Chọn hoặc sửa tay cho đúng, xóa hết các dấu `<<<<<<<`, `=======`, `>>>>>>>`.
3. Chạy lại `npm run typecheck` cho chắc.
4. `git add <file>` rồi `git commit` (Git tự điền message merge), sau đó `git push`.

Hay xung đột nhất là file migration của Prisma. Nếu hai người cùng tạo migration: giữ migration của `testing`, xóa migration của mình, chạy lại `npm run prisma:migrate -- --name <ten>` để sinh migration mới phía sau.

---

## 5. Những điều KHÔNG làm

- Không commit `.env` (chứa mật khẩu DB, JWT secret). Chỉ commit `.env.example`.
- Không commit `node_modules/`, `dist/`, `uploads/`, `backups/`.
- Không `git push --force` lên `main` / `testing`.
- Không sửa migration đã merge. Cần thay đổi DB thì tạo migration mới.

**Gợi ý cho chủ repo:** vào **Settings → Branches → Add branch ruleset** cho `main` và `testing`: bật *Require a pull request before merging* và *Require status checks to pass* (chọn job `backend-ci`). Khi đó không ai push thẳng lên được.

---

## 6. Lệnh tra nhanh

| Mục đích | Lệnh |
|---|---|
| Xem thay đổi | `git status`, `git diff` |
| Xem lịch sử | `git log --oneline --graph -20` |
| Bỏ thay đổi chưa commit của 1 file | `git restore <file>` |
| Bỏ file khỏi vùng chuẩn bị commit | `git restore --staged <file>` |
| Sửa message commit cuối (chưa push) | `git commit --amend` |
| Cất tạm thay đổi để đổi nhánh | `git stash` → sau đó `git stash pop` |
| Xem các nhánh trên GitHub | `git fetch --prune` rồi `git branch -a` |
