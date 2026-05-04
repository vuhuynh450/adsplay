# Device Binding TV Assignment Design

## Mục tiêu

Ràng buộc mỗi thiết bị TV vào đúng một màn hình (profile) để loại bỏ việc nhân viên mở nhầm URL `player/:slug`.

## Phạm vi

- Thêm mô hình thiết bị (`device`) ở backend.
- Thêm API quản lý thiết bị và gán thiết bị -> màn hình.
- Thêm luồng player theo thiết bị (`/player/device`) thay cho slug thủ công.
- Giữ route slug hiện tại để chuyển đổi dần, không phá vỡ hệ thống đang chạy.

## Kiến trúc tổng thể

- Player sẽ hoạt động với định danh thiết bị (`deviceId`) + bí mật thiết bị (`deviceToken`) lưu localStorage.
- Backend quyết định thiết bị đó được phát profile nào qua mapping `assignedProfileId`.
- Admin quản lý danh sách thiết bị, đổi tên, gán/bỏ gán profile.
- Heartbeat chuyển từ cấp profile sang cấp thiết bị cho luồng mới.

## Mô hình dữ liệu

Thêm bảng `devices`:

- `id` (uuid, PK)
- `deviceCode` (mã ngắn duy nhất để nhận biết)
- `name` (tên thiết bị)
- `secretHash` (hash của token thiết bị)
- `assignedProfileId` (nullable, FK tới profile)
- `lastSeen` (ISO datetime)
- `createdAt`, `updatedAt`

Online/offline được suy ra từ `lastSeen` (ví dụ <= 60s là online).

## API thiết kế

### Player

1. `POST /api/devices/register`
   - Tạo thiết bị mới hoặc cấp lại token cho thiết bị chưa cấu hình.
2. `GET /api/player/device/:deviceId`
   - Trả profile + videos theo mapping thiết bị.
   - Nếu chưa gán: trả lỗi `DEVICE_NOT_ASSIGNED`.
3. `POST /api/player/device/:deviceId/heartbeat`
   - Cập nhật `lastSeen`.

### Admin (JWT)

4. `GET /api/devices`
5. `POST /api/devices/:deviceId/assign-profile`
6. `POST /api/devices/:deviceId/unassign-profile`
7. `PATCH /api/devices/:deviceId` (đổi tên)

## Frontend thay đổi

### Player

- Thêm route `/player/device`.
- Nếu chưa có deviceId/token thì gọi register.
- Dùng API player-by-device để lấy playlist.
- Nếu chưa gán profile: hiển thị trạng thái chờ gán.

### Admin

- Thêm tab “Thiết bị TV”.
- Hiển thị danh sách thiết bị: tên, code, online/offline, profile hiện tại.
- Cho phép gán, đổi gán, bỏ gán profile.

## Bảo mật

- `deviceToken` không lưu thô ở DB, chỉ lưu hash.
- API player-by-device và heartbeat bắt buộc header token.
- Token sai hoặc thiết bị không tồn tại trả 401/404 rõ ràng.

## Chiến lược chuyển đổi

1. Triển khai backend API + DB trước.
2. Triển khai admin tab quản lý thiết bị.
3. Triển khai player `/player/device`.
4. Rollout từng TV, gán profile tương ứng.
5. Khi ổn định, ẩn dần luồng `player/:slug` khỏi vận hành.

## Tiêu chí hoàn thành

- TV chỉ cần mở `/player/device` và luôn phát đúng màn hình đã gán.
- Admin đổi gán profile cho thiết bị thì TV đồng bộ theo chu kỳ poll.
- Không còn thao tác nhập slug thủ công ở vận hành thường ngày.
