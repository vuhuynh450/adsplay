# Storage Dashboard Design

## Goal

Add a storage dashboard to the existing System tab so an administrator can understand local VPS disk usage without SSH access.

The project will keep the current local storage model:

- uploaded source media under `backend/uploads/`
- generated posters and HLS assets under `backend/uploads/processed/`
- resumable upload session chunks under `backend/uploads/.sessions/`
- SQLite metadata in `backend/db.sqlite` by default

This change is focused on visibility only. It does not block uploads, clean upload sessions, change video deletion behavior, or add login rate limiting.

## Current State

Backend:

- `backend/src/services/system.service.ts` returns only `localIps`, `online`, and `uptime`.
- `backend/src/routes/system.routes.ts` exposes `GET /api/system/status` behind `authenticateToken`.
- `backend/src/config.ts` already centralizes `uploadsDir`, `processedUploadsDir`, `uploadSessionsDir`, and `dbFile`.

Frontend:

- `frontend/src/app/services/api.service.ts` types `getSystemStatus()` as `{ online, uptime, localIps }`.
- `frontend/src/app/features/dashboard/dashboard.store.ts` polls system status every 30 seconds and stores it in `systemInfo`.
- `frontend/src/app/features/dashboard/admin.html` already has a System tab with a server information card.

## Recommended Approach

Extend the existing `GET /api/system/status` response with a `storage` object.

This is the smallest correct change because the dashboard already polls system status and the System tab already renders from `store.systemInfo()`. A separate `/api/system/storage` endpoint is unnecessary for the current scope.

Trade-off: calculating directory sizes during the 30-second poll does add filesystem I/O. For this VPS scale, that is acceptable, and the implementation should keep the calculation simple and defensive.

## Backend Design

### Response Shape

Extend `SystemStatus` with:

```ts
interface StorageStatus {
    disk: {
        path: string;
        totalBytes: number;
        freeBytes: number;
        usedBytes: number;
        usedPercent: number;
        status: 'ok' | 'warning' | 'critical';
    } | null;
    directories: {
        uploadsRootBytes: number | null;
        sourceFilesBytes: number | null;
        processedBytes: number | null;
        sessionsBytes: number | null;
    };
    database: {
        path: string;
        totalBytes: number | null;
        mainBytes: number | null;
        walBytes: number | null;
        shmBytes: number | null;
    };
}
```

`SystemStatus` becomes:

```ts
interface SystemStatus {
    localIps: string[];
    online: boolean;
    uptime: number;
    storage: StorageStatus;
}
```

### Disk Usage

Use Node filesystem stats for the filesystem that contains `config.uploadsDir`.

The disk values should mean:

- `totalBytes`: total size of the mounted filesystem
- `freeBytes`: available/free bytes reported by the filesystem
- `usedBytes`: `totalBytes - freeBytes`
- `usedPercent`: rounded percentage with one decimal or nearest integer, whichever is simpler in the existing style
- `status`:
  - `ok` when free percent is at least 20%
  - `warning` when free percent is below 20%
  - `critical` when free percent is below 10%

If disk stats cannot be read, return `disk: null` and keep the rest of `/api/system/status` working.

### Directory Size Breakdown

Calculate sizes defensively:

- `uploadsRootBytes`: recursive size of `config.uploadsDir`
- `sourceFilesBytes`: size of files directly inside `config.uploadsDir`, excluding subdirectories such as `processed` and `.sessions`
- `processedBytes`: recursive size of `config.processedUploadsDir`
- `sessionsBytes`: recursive size of `config.uploadSessionsDir`

If an individual directory does not exist or cannot be read, return `null` for that specific field rather than failing the whole endpoint.

The recursive size helper should:

- ignore entries that disappear during traversal
- not follow symlinks
- return bytes as numbers
- stay local to `system.service.ts` unless another service needs it later

### SQLite Size

Report SQLite file size separately so storage usage explains both media and metadata.

Read these files if they exist:

- `config.dbFile`
- `${config.dbFile}-wal`
- `${config.dbFile}-shm`

Return:

- `mainBytes`
- `walBytes`
- `shmBytes`
- `totalBytes`: sum of available values, or `null` only if none can be read

Missing WAL/SHM files should count as `0`, not as an error, because SQLite only creates them when needed.

### Error Handling

Storage collection is observability. It must not make the System tab unusable.

Rules:

- endpoint still returns `online`, `uptime`, and `localIps` if storage stats partially fail
- unreadable optional paths produce `null` for that field
- unexpected storage scan errors can be logged, but should not leak stack traces to the frontend
- existing auth requirement remains unchanged

## Frontend Design

### API Types

Update `frontend/src/app/services/api.service.ts`:

- add `StorageStatus` and related interfaces
- update `getSystemStatus()` return type to include `storage`

### Dashboard Store

Update `frontend/src/app/features/dashboard/dashboard.store.ts`:

- update `systemInfo` signal type to include optional `storage`
- preserve current polling behavior
- when system status loads, store the entire status shape instead of manually copying only `localIps` and `uptime`
- keep `isSystemOnline` behavior unchanged

### System Tab UI

Add a new card under the existing “Thông Tin Máy Chủ” card in `frontend/src/app/features/dashboard/admin.html`.

The card title should be “Dung Lượng Lưu Trữ”.

Display:

- disk status badge: `Ổn định`, `Cảnh báo`, or `Nguy cấp`
- progress bar for disk used percent
- total disk, used disk, and free disk
- upload source files size
- processed HLS/poster size
- temporary upload sessions size
- SQLite database size

When storage data is missing:

- show `Không đọc được` or `—` for that field
- do not hide the whole System tab

The UI should keep the current dashboard visual style: rounded white/dark cards, slate text colors, brand primary accent, and responsive grid layout.

### Formatting Helpers

Add small formatting helpers in `admin.ts` or the closest existing component scope:

- `formatBytes(bytes?: number | null): string`
- `getStorageStatusLabel(status?: 'ok' | 'warning' | 'critical'): string`
- `getStorageStatusClass(...)` if needed for badge styling

Use binary units for readability:

- B
- KB
- MB
- GB
- TB

## Out Of Scope

This spec does not include:

- disk guard before upload
- disk guard before transcode
- automatic cleanup of stale upload sessions
- safer video deletion flow
- login rate limiting
- backup automation
- manual storage cleanup actions in the UI
- new database tables

These can be implemented later using the storage visibility added here.

## Test Design

Backend tests:

- `GET /api/system/status` includes a `storage` object for authenticated requests.
- storage response contains disk, directory, and database sections with byte numbers or `null`.
- missing upload subdirectories do not crash the endpoint.
- unauthenticated access remains rejected by existing auth middleware.

Frontend tests:

- `ApiService.getSystemStatus()` type supports storage fields.
- `DashboardStore` preserves storage information from polling responses.
- System tab renders storage values when available.
- System tab renders fallback text when storage fields are `null`.

## Acceptance Criteria

- Admin can open the System tab and see current local disk usage.
- Admin can distinguish total disk usage from app media usage.
- Admin can see whether temporary upload sessions are consuming meaningful space.
- System status polling continues to work every 30 seconds.
- The System tab remains usable if storage stats partially fail.
- Backend and frontend tests pass.
