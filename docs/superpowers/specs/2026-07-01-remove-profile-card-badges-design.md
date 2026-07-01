# Design: Remove device code and status badges from profile card

Date: 2026-07-01

## Context

Trong trang quản trị, mỗi card màn hình hiện 3 badge nhỏ bên dưới tên:

1. `{{ profile.videoIds.length }} nội dung` — số lượng nội dung trong playlist.
2. `{{ profile.slug }}` — slug của màn hình (ví dụ: `tivi`).
3. `online` / `offline` — trạng thái hoạt động tính từ `profile.lastSeen`.

Người dùng yêu cầu bỏ 2 badge khoanh đỏ: badge slug và badge trạng thái. Giữ lại badge số lượng nội dung.

## Decision

Sử dụng **cách A: xóa hoàn toàn 2 badge khỏi template**.

- Không thêm tùy chọn `@Input()` vì yêu cầu là xóa cố định.
- Không xóa hàm `isOnline()` trong `profile-manager.ts` vì nó còn được dùng cho `deletingProfileIsOnline` (xác nhận xóa màn hình đang online).
- Cập nhật regression test `profile-manager.spec.ts` nếu có assert lên các badge này.

## Files affected

- `frontend/src/app/features/dashboard/components/profile-manager/profile-manager.html`
- `frontend/src/app/features/dashboard/components/profile-manager/profile-manager.spec.ts` (nếu cần)

## Acceptance criteria

- [ ] Card màn hình chỉ hiển thị badge số lượng nội dung.
- [ ] Không còn badge slug hay badge online/offline trong card.
- [ ] Build và tests frontend vẫn pass.

## Notes

- Thay đổi này chỉ ảnh hưởng giao diện card ở trang admin; không ảnh hưởng đến logic device/presence hay dashboard store.
