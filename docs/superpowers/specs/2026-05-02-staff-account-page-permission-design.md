# Staff Account & Page Permission Design

## Mục tiêu

Thêm chức năng quản lý tài khoản nhân viên và phân quyền theo từng trang trong admin.

- Admin tạo tài khoản nhân viên.
- Nhân viên đăng nhập lần đầu bắt buộc đổi mật khẩu.
- Phân quyền mức trang theo cơ chế ẩn/hiện UI + chặn truy cập URL trực tiếp.
- Hỗ trợ khóa/mở tài khoản nhân viên.
- Trang quản lý nhân viên chỉ tài khoản admin được truy cập.

## Phạm vi

Trong phạm vi:
- Backend: model tài khoản nhân viên, API quản lý nhân viên, middleware phân quyền trang, mở rộng login response.
- Frontend: auth state mở rộng, route guard theo page, ẩn/hiện menu theo quyền, màn hình quản lý nhân viên, luồng đổi mật khẩu lần đầu.
- Test: bổ sung test cho auth, permission và UI guard cơ bản.

Ngoài phạm vi:
- Không tách quyền chi tiết theo hành động (xem/sửa/xóa).
- Không thêm SSO/OAuth.
- Không thêm cơ chế role template phức tạp ở giai đoạn này.

## Yêu cầu đã chốt

1. Phân quyền theo trang (không tách xem/sửa).
2. Admin tạo tài khoản, nhân viên tự đổi mật khẩu lần đầu.
3. Chặn route trực tiếp khi không có quyền (không chỉ ẩn menu).
4. Áp dụng cho tất cả trang hiện có.
5. Trang quản lý nhân viên: admin-only.
6. Có hỗ trợ khóa/mở tài khoản nhân viên.

## Kiến trúc tổng thể

### 1) Account model

Mở rộng user account để dùng chung cho admin/staff:

- `id`
- `username`
- `passwordHash`
- `role`: `admin | staff`
- `isActive`: boolean
- `mustChangePassword`: boolean
- `allowedPages`: string[]
- `createdAt`, `updatedAt`

Quy ước:
- `admin` bỏ qua check `allowedPages`.
- `staff` phải thỏa cả `isActive=true` và có quyền theo page key tương ứng.

### 2) Auth flow

- `POST /api/auth/login` trả:
  - `token`
  - `user: { username, role, allowedPages, mustChangePassword }`
- Nếu tài khoản bị khóa: trả `ACCOUNT_INACTIVE`.
- Nếu đăng nhập lần đầu (`mustChangePassword=true`): frontend bắt vào màn đổi mật khẩu trước khi vào khu vực quản trị.

### 3) Authorization flow

- Frontend:
  - Ẩn/hiện menu theo `allowedPages`.
  - Guard chặn route theo `data.pageKey`.
- Backend:
  - Mọi API quản trị cần auth tiếp tục đi qua `authenticateToken`.
  - Bổ sung middleware kiểm tra quyền trang `requirePageAccess(pageKey)` để chặn gọi API trực tiếp.

### 4) Page key chuẩn hóa

Dùng enum/constant dùng chung trong backend và frontend:
- `videos`
- `profiles`
- `devices`
- `system`
- `employees`

Quy tắc:
- `employees` chỉ admin.

## Thiết kế component chi tiết

## Backend

### A. Auth service mở rộng

Cập nhật payload token và login metadata:
- JWT payload giữ thông tin nhận diện user (`id`, `username`, `role`).
- Metadata quyền (`allowedPages`, `mustChangePassword`) trả về cùng login response để frontend dùng ngay.

### B. Employee service + routes

Thêm module quản lý nhân viên:
- `GET /api/employees`: danh sách nhân viên
- `POST /api/employees`: tạo nhân viên
- `PATCH /api/employees/:id/pages`: cập nhật `allowedPages`
- `PATCH /api/employees/:id/active`: khóa/mở tài khoản
- `PATCH /api/employees/:id/reset-first-password`: reset trạng thái bắt đổi mật khẩu

Ràng buộc:
- Toàn bộ endpoint `employees` chỉ admin.
- Không cho sửa role của admin mặc định qua endpoint nhân viên.

### C. First login password endpoint

Thêm endpoint đổi mật khẩu lần đầu:
- `POST /api/auth/change-password-first-login`

Hành vi:
- Chỉ áp dụng khi `mustChangePassword=true`.
- Thành công thì set `mustChangePassword=false`.

### D. Permission middleware

Bổ sung middleware `requirePageAccess(pageKey)`:
- `admin`: pass.
- `staff`: kiểm tra `isActive` + `allowedPages`.
- Không đạt: trả `PAGE_FORBIDDEN`.

Map router quản trị -> page key:
- `/api/videos/*` -> `videos`
- `/api/profiles/*` -> `profiles`
- `/api/devices/*` -> `devices`
- `/api/system/*` -> `system`
- `/api/employees/*` -> `employees` (admin-only)

## Frontend

### A. Auth state

Auth service lưu thêm:
- `role`
- `allowedPages`
- `mustChangePassword`

### B. Route guard

Tách guard theo vai trò:
- `authGuard`: yêu cầu đăng nhập.
- `pageAccessGuard`: check `data.pageKey`.
- `adminOnlyGuard`: chặn trang quản lý nhân viên cho staff.

### C. Cấu trúc route admin

Mở rộng route để phân quyền theo trang rõ ràng:
- `/admin/videos`
- `/admin/profiles`
- `/admin/devices`
- `/admin/system`
- `/admin/employees`

Trang nào không có quyền:
- Guard chặn điều hướng.
- Điều hướng về route admin đầu tiên mà user có quyền.

### D. Admin UI

- Sidebar chỉ render mục user được cấp quyền.
- Nếu không có quyền nào (trường hợp dữ liệu sai), hiển thị trạng thái “không có quyền truy cập” thay vì lỗi trắng.
- Trang quản lý nhân viên gồm:
  - Danh sách nhân viên
  - Form thêm mới
  - Chọn trang được phép truy cập
  - Bật/tắt trạng thái hoạt động

## Data flow nghiệp vụ

### 1) Admin tạo nhân viên

1. Admin nhập username, mật khẩu tạm, chọn trang.
2. Backend tạo staff với `mustChangePassword=true`, `isActive=true`.
3. Frontend cập nhật danh sách nhân viên.

### 2) Staff đăng nhập lần đầu

1. Staff login nhận `token + user metadata`.
2. Nếu `mustChangePassword=true`, frontend chuyển sang màn đổi mật khẩu.
3. Đổi mật khẩu thành công -> `mustChangePassword=false`.
4. Cho phép vào khu vực admin theo `allowedPages`.

### 3) Staff truy cập trang không được cấp

1. Guard frontend chặn route.
2. Nếu cố gọi API trực tiếp, backend middleware chặn với 403.

### 4) Admin khóa tài khoản

1. Admin set `isActive=false`.
2. Request tiếp theo của staff bị backend chặn (kể cả token còn hạn).

## Error handling

Mã lỗi chuẩn:
- `INVALID_CREDENTIALS` (401)
- `ACCOUNT_INACTIVE` (403)
- `MUST_CHANGE_PASSWORD` (403)
- `PAGE_FORBIDDEN` (403)
- `ADMIN_ONLY` (403)
- `VALIDATION_ERROR` (400)

Frontend mapping:
- 401: báo sai tài khoản/mật khẩu.
- 403 `ACCOUNT_INACTIVE`: báo liên hệ admin.
- 403 `MUST_CHANGE_PASSWORD`: ép vào màn đổi mật khẩu.
- 403 `PAGE_FORBIDDEN`/`ADMIN_ONLY`: điều hướng về trang hợp lệ + thông báo không có quyền.

## Testing strategy

### Backend

- Unit/service:
  - Tạo staff mặc định `mustChangePassword=true`.
  - Khóa/mở cập nhật đúng `isActive`.
  - Validate `allowedPages` theo enum.
- Integration/API:
  - Staff thiếu quyền page -> 403.
  - Staff có quyền page -> 200.
  - Staff truy cập employees API -> 403.
  - Staff bị khóa sau login -> request kế tiếp bị chặn.

### Frontend

- Guard tests:
  - Chưa login -> về `/login`.
  - Đăng nhập nhưng thiếu page -> bị chặn route.
  - Staff vào `/admin/employees` -> bị chặn.
- UI tests:
  - Sidebar chỉ hiện menu đúng quyền.
  - Luồng first login buộc đổi mật khẩu trước khi dùng dashboard.

## Trade-off đã chọn

Giải pháp hiện tại chọn mô hình `allowedPages` trực tiếp trên user thay vì role template:
- Ưu điểm: đơn giản, đúng nhu cầu ẩn/hiện theo trang, triển khai nhanh.
- Nhược điểm: nếu số user tăng lớn sẽ cần thao tác gán quyền lặp lại.

Định hướng sau này (nếu cần): bổ sung role template nhưng vẫn giữ `allowedPages` override để tương thích.

## Tiêu chí hoàn thành

1. Admin thêm nhân viên mới thành công.
2. Nhân viên buộc đổi mật khẩu lần đầu.
3. Menu chỉ hiển thị trang được cấp.
4. Truy cập URL/API trái quyền bị chặn.
5. Admin khóa/mở tài khoản và hiệu lực ngay ở request tiếp theo.
6. Trang quản lý nhân viên chỉ admin truy cập được.
