# SQLite Metadata Store Design

## Goal

Replace AdPlay's JSON-file metadata store with SQLite for VPS production use.

The target deployment is a single-company VPS installation with 4 branches, roughly 10-12 TV/player devices, and 3-4 admin/staff users. The data volume is small, but the app needs stronger durability and safer concurrent reads/writes than `backend/db.json` can provide.

## Explicit Scope Decision

This change starts SQLite with a clean database. It does not migrate data from `backend/db.json`.

Consequences:

- Existing records in `backend/db.json` are ignored by the new runtime.
- Existing users, profiles, devices, and video records must be recreated manually after deployment.
- Existing uploaded media files under `backend/uploads/` are not imported into the media library automatically.
- The default admin login from `ADMIN_USERNAME` and `ADMIN_PASSWORD` remains available, so the administrator can sign in and recreate the needed data.
- `backend/db.json` becomes a legacy file only. It should not be read as a fallback because that would create two possible sources of truth.

## Current Storage Model

AdPlay currently stores app metadata in `backend/db.json` through `backend/src/db.ts`.

The current metadata collections are:

- `devices`
- `profiles`
- `users`
- `videos`

The app stores media files separately:

- uploaded source files under `backend/uploads/`
- generated posters and HLS assets under `backend/uploads/processed/`
- resumable upload session state under `backend/uploads/.sessions/`

This design changes only the app metadata store. It does not change local file storage or upload session storage.

## Recommended Approach

Use SQLite as a local embedded database and keep the existing repository boundary intact.

The repository exported from `backend/src/db.ts` remains the only persistence interface used by the service layer. The implementation changes from in-memory JSON cache plus full-file writes to SQLite queries and transactions.

This keeps the change focused:

- route handlers stay unchanged unless tests expose response differences
- service functions stay unchanged where possible
- frontend behavior stays unchanged
- data durability improves without adding a separate MySQL/Postgres service

## Driver Choice

Use `better-sqlite3` for the backend SQLite driver.

Reasons:

- it is simple and fast for a single Node.js backend process
- it has a synchronous API that maps cleanly to the current repository methods
- it supports transactions directly
- it avoids connection-pool complexity that is unnecessary for this deployment size

The repository methods can remain `async` for compatibility with existing callers even if the internal SQLite operations are synchronous.

## Database File Location

Change the default database path from JSON to SQLite:

- default: `backend/db.sqlite`
- override: existing `DB_FILE` env var

`DB_FILE` should now point to a SQLite file. If it is unset, the backend creates and uses `backend/db.sqlite`.

Tests should override `DB_FILE` with a temporary `.sqlite` path.

The app should not infer storage mode from the file extension. After this change, `DB_FILE` always means the SQLite database path.

## SQLite Runtime Configuration

On database open, configure SQLite with:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

Rationale:

- `journal_mode = WAL` improves web-app read/write concurrency. Readers do not block writers and writers do not block readers in normal cases.
- `foreign_keys = ON` enforces relational integrity for devices, profiles, videos, and playlist rows.
- `busy_timeout = 5000` gives SQLite time to wait for short write locks instead of failing immediately.
- `synchronous = NORMAL` is a practical VPS default with WAL. It improves performance while preserving database consistency. The trade-off is that the most recent transaction can be lost on sudden power loss or hard reboot. That is acceptable for this app because the data set is small, writes are frequent heartbeats, and regular backups are required.

The deployment must keep `db.sqlite`, `db.sqlite-wal`, and `db.sqlite-shm` in the same local filesystem directory while the app is running. SQLite WAL mode should not be used on a network filesystem.

## Schema Design

### `users`

Stores staff/admin accounts created through the employee management UI.

Columns:

- `id TEXT PRIMARY KEY`
- `username TEXT NOT NULL UNIQUE`
- `password_hash TEXT NOT NULL`
- `role TEXT NOT NULL CHECK (role IN ('admin', 'staff'))`
- `is_active INTEGER NOT NULL CHECK (is_active IN (0, 1))`
- `must_change_password INTEGER NOT NULL CHECK (must_change_password IN (0, 1))`
- `allowed_pages TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

`allowed_pages` is stored as a JSON string to preserve the existing `PageKey[]` shape without introducing a join table for a very small permission set.

### `videos`

Stores media metadata. The media files remain on disk.

Columns:

- `id TEXT PRIMARY KEY`
- `filename TEXT NOT NULL`
- `source_filename TEXT NOT NULL`
- `original_name TEXT NOT NULL`
- `media_type TEXT NOT NULL CHECK (media_type IN ('video', 'image'))`
- `mime_type TEXT`
- `source_mime_type TEXT`
- `source_size INTEGER NOT NULL`
- `size INTEGER NOT NULL`
- `storage_provider TEXT NOT NULL CHECK (storage_provider = 'local')`
- `stream_variant TEXT NOT NULL CHECK (stream_variant IN ('optimized', 'original'))`
- `processing_status TEXT NOT NULL CHECK (processing_status IN ('pending', 'processing', 'ready'))`
- `processing_error TEXT`
- `poster_filename TEXT`
- `hls_manifest_path TEXT`
- `duration_seconds REAL`
- `width INTEGER`
- `height INTEGER`
- `uploaded_at TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### `profiles`

Stores player playlist/profile metadata.

Columns:

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `slug TEXT NOT NULL UNIQUE`
- `orientation TEXT NOT NULL CHECK (orientation IN ('landscape', 'rotate90', 'rotate180', 'rotate270'))`
- `last_seen TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

The current code derives profile slugs from names with `slugify()`. SQLite should persist the slug as a column so uniqueness can be enforced at the database level. `upsertProfile()` is responsible for computing the slug with the existing `slugify()` helper before writing.

### `profile_videos`

Stores ordered profile playlists.

Columns:

- `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
- `video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE`
- `position INTEGER NOT NULL`
- `PRIMARY KEY (profile_id, position)`
- `UNIQUE (profile_id, video_id)`

Indexes:

- `idx_profile_videos_video_id` on `video_id`

The repository should return `Profile.videoIds` in `position` order to preserve current behavior.

When saving a profile, dedupe `videoIds` and replace that profile's playlist rows inside the same transaction as the profile insert/update.

### `devices`

Stores TV/player device registrations.

Columns:

- `id TEXT PRIMARY KEY`
- `device_code TEXT NOT NULL UNIQUE`
- `name TEXT NOT NULL`
- `secret_hash TEXT NOT NULL`
- `assigned_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL`
- `last_seen TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

## Repository Contract

Keep the current `dbRepository` API exported from `backend/src/db.ts`:

- `createDevice`
- `listDevices`
- `findDeviceById`
- `findDeviceByCode`
- `updateDeviceName`
- `assignProfileToDevice`
- `updateDeviceSecretHash`
- `touchDevice`
- `deleteDevice`
- `findProfileById`
- `findProfileBySlug`
- `findUserByUsername`
- `createUser`
- `updateUser`
- `deleteUsers`
- `findVideoById`
- `listProfiles`
- `listUsers`
- `listVideos`
- `touchProfile`
- `upsertProfile`
- `saveVideo`
- `updateVideo`
- `deleteProfile`
- `deleteVideo`

The service layer should not know whether the repository uses SQLite internally.

## Repository Behavior Details

### Normalization

Keep normalization behavior equivalent to the current JSON implementation where it matters:

- missing optional fields return as `undefined` or are omitted from response objects
- invalid/missing profile orientation defaults to `landscape` only when creating rows through repository input normalization
- video `mediaType` can still be inferred from MIME type when not explicitly provided
- `storageProvider` remains local-only
- `streamVariant` defaults to `original`
- `processingStatus` defaults to `ready`
- `allowedPages` defaults to all admin pages only through user normalization when needed

Because this is a clean SQLite start, compatibility with old malformed `db.json` records is not required.

### Transactions

Use SQLite transactions for multi-step mutations:

- `upsertProfile()` updates the profile row and playlist rows together
- `deleteProfile()` deletes the profile and relies on `devices.assigned_profile_id ON DELETE SET NULL` plus `profile_videos ON DELETE CASCADE`
- `deleteVideo()` deletes the video and relies on `profile_videos ON DELETE CASCADE`
- `deleteUsers()` deletes matching staff users as one operation
- `updateVideo()` reads, mutates, and writes the video row in one transaction
- `updateUser()` reads, mutates, validates, and writes the user row in one transaction

### Conflict Handling

Map SQLite constraint errors to existing repository/service semantics where required:

- duplicate `device_code` in `createDevice()` throws `Error('DEVICE_CODE_CONFLICT')`
- duplicate `username` is still surfaced by service-level checks as `USER_ALREADY_EXISTS`
- duplicate profile slug is still surfaced by service-level checks as `PROFILE_SLUG_CONFLICT`

Do not add broad backward-compatibility branches for `db.json` data.

## Startup Behavior

On startup:

1. Load config from `backend/src/config.ts`.
2. Ensure the directory containing `DB_FILE` exists.
3. Open the SQLite database file.
4. Apply PRAGMAs.
5. Create schema if missing.
6. Do not read `backend/db.json`.

If schema initialization fails, startup should fail fast instead of running with partial persistence.

## Configuration And Docs

Update backend config docs and examples:

- `DB_FILE` now describes a SQLite file path, not JSON.
- `.env.example` should show `# DB_FILE=./db.sqlite` instead of `# DB_FILE=./db.json`.
- README storage model should say app metadata lives in `backend/db.sqlite`.
- README production notes should explain SQLite backup plus `uploads/` backup.

`lowdb` should be removed from backend dependencies because it will no longer be used.

Add `better-sqlite3` and its TypeScript types if required by the compiler.

## Backup Guidance

Production backups must include:

- the SQLite database
- the `backend/uploads/` directory

Recommended SQLite backup command:

```bash
sqlite3 backend/db.sqlite ".backup '/path/to/backups/adplay-$(date +%F-%H%M%S).sqlite'"
```

The backup process should not blindly copy only `db.sqlite` while the app is running in WAL mode. If files are copied directly, `db.sqlite`, `db.sqlite-wal`, and `db.sqlite-shm` must be treated as a set. The SQLite `.backup` command is preferred.

## Testing Design

Backend tests should use temporary SQLite files instead of temporary JSON files:

- set `process.env.DB_FILE` to a temp `.sqlite` path before importing the built app/db modules
- keep `UPLOADS_DIR` and `FRONTEND_DIST_DIR` temp overrides unchanged
- ensure each test run starts with an empty SQLite database

Test coverage should include:

- schema is created automatically for a new SQLite file
- admin login still works through default admin credentials
- staff user create/update/delete behavior still works
- device registration still handles duplicate code conflicts
- profile save enforces profile slug uniqueness through existing service behavior
- profile playlists preserve video order
- deleting a profile unassigns devices and deletes playlist rows
- deleting a video removes that video from profile playlists
- video processing updates still persist correctly
- existing API tests continue to pass

Frontend tests should not need database-specific changes because the API contract remains unchanged.

## Deployment Notes

Recommended deployment sequence:

1. Stop the backend process.
2. Back up existing `backend/db.json` and `backend/uploads/` for rollback/reference.
3. Deploy the SQLite build.
4. Set `DB_FILE` to the desired SQLite path or rely on `backend/db.sqlite`.
5. Start the backend.
6. Log in with the default admin credentials from env.
7. Recreate staff users, videos, profiles, and device assignments manually.
8. Set up recurring backups for SQLite and uploads.

Rollback requires stopping the backend and deploying the previous JSON-backed build with the previous `db.json`. Data created only in SQLite will not automatically appear in the old JSON build.

## Non-Goals

This design does not include:

- automatic migration from `db.json`
- manual migration script from `db.json`
- MySQL/Postgres support
- ORM adoption
- multi-instance or high-availability database architecture
- object storage or CDN changes
- upload session storage changes
- frontend UX changes
- analytics, audit logs, or scheduling features

## Open Risk

The main operational risk is that existing video files under `backend/uploads/` will remain on disk but will not appear in the media library after the clean SQLite start. This is intentional for this design. The operator must either re-upload needed media through the admin UI or manage files manually outside the app.

## Acceptance Criteria

- Backend uses SQLite as the only runtime metadata store.
- Backend no longer reads or writes `backend/db.json`.
- New deployments create an empty SQLite schema automatically.
- Existing API behavior remains compatible from the frontend perspective.
- Backend build passes.
- Backend API test suite passes with temporary SQLite databases.
- README and `.env.example` describe SQLite `DB_FILE` behavior and backup expectations.
