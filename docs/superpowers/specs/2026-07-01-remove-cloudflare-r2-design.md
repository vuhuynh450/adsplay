# Remove Cloudflare R2 Upload Design

## Goal

Remove the Cloudflare R2 video upload feature completely from AdPlay.

AdPlay should return to a local-only media model:

- uploads go through the existing local resumable upload flow
- media streams from local files under `backend/uploads`
- the admin UI no longer offers a Cloudflare R2 upload target
- system status no longer fetches or displays Cloudflare R2 storage stats
- backend no longer depends on AWS SDK S3/R2 packages

## Explicit Scope Decision

The cleanup is a full R2 removal. It will not preserve legacy support for records with `storageProvider: "r2"` or `r2ObjectKey` in `backend/db.json`.

If existing R2 videos are still needed, they must be removed from the database or migrated manually before this cleanup is deployed. This design does not include an automated R2-to-local migration.

## Current R2 Touchpoints

Backend:

- `backend/src/routes/video.routes.ts` exposes R2 direct multipart routes and accepts `storageTarget=r2` on form uploads.
- `backend/src/services/video.service.ts` creates R2 video records, uploads form-uploaded files to R2, redirects R2 streams, and deletes R2 objects.
- `backend/src/services/r2-storage.service.ts` wraps S3-compatible R2 operations.
- `backend/src/services/r2-upload-session.service.ts` manages R2 multipart upload manifests under `backend/uploads/.sessions/r2`.
- `backend/src/services/r2-stats.service.ts` fetches bucket object and size stats.
- `backend/src/services/system.service.ts` includes optional R2 status.
- `backend/src/config.ts` parses `R2_*` env values.
- `backend/src/types.ts` includes R2 upload manifests, `VideoStorageProvider = 'local' | 'r2'`, and `r2ObjectKey`.
- `backend/package.json` depends on `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.

Frontend:

- `frontend/src/app/services/api.service.ts` exposes R2 types and R2 upload API methods.
- `frontend/src/app/features/dashboard/r2-direct-upload.service.ts` uploads file parts directly to R2 presigned URLs.
- `frontend/src/app/features/dashboard/dashboard.store.ts` injects `R2DirectUploadService`, tracks `uploadTarget`, and stores R2 system info.
- `frontend/src/app/features/dashboard/components/video-list/video-list.ts` and `.html` show the Local/R2 upload target switch and R2-specific validation/hints/badges.
- `frontend/src/app/features/dashboard/admin.html` displays the Cloudflare R2 Storage status card.

Tests and generated state:

- `backend/test/api.test.js` has R2 upload, stream, validation, and abort tests.
- `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts` tests direct multipart R2 upload behavior.
- `backend/uploads/.sessions/r2/*` contains old R2 multipart session manifests.

## Recommended Approach

Remove R2 vertically across backend, frontend, tests, config, and dependencies in one coordinated change.

This is preferable to leaving disabled R2 code because the user no longer uses the feature, and local-only upload is already implemented. Keeping disabled R2 code would retain credentials, AWS SDK dependencies, UI branching, and API surface area without product value.

## Backend Design

### Video Routes

Update `backend/src/routes/video.routes.ts`:

- Remove imports from `r2-upload-session.service`.
- Remove `saveUploadedVideoToR2` import.
- Remove `isR2Mp4Upload`.
- Delete these routes:
  - `POST /api/videos/r2/uploads`
  - `POST /api/videos/r2/uploads/:id/parts/:partNumber/presign`
  - `POST /api/videos/r2/uploads/:id/complete`
  - `DELETE /api/videos/r2/uploads/:id`
- Simplify `POST /api/videos`:
  - no longer read `req.body.storageTarget`
  - no longer accept `r2`
  - always call `saveUploadedVideo(req.file)`
- Keep local resumable upload routes under `/api/videos/uploads/sessions` unchanged.

### Video Service

Update `backend/src/services/video.service.ts`:

- Remove `r2-storage.service` imports.
- Remove `UploadStorageTarget` union or reduce it to local-only if still useful.
- Remove `createR2ObjectKey`.
- Remove `saveUploadedVideoToR2`.
- Remove `createR2VideoRecord`.
- Update `createVideoRecord` so `storageProvider` is always local or remove that input if callers no longer need it.
- Update `getVideoPolicy()` to return only local upload capability. Prefer removing `storageTargets` if no frontend consumer needs it; otherwise return `['local']` during the same cleanup.
- Simplify `getVideoStreamSource()` to only resolve local files and return a local source.
- Simplify `deleteVideo()` to only remove local source, poster, and HLS files.

### R2 Services

Delete these files:

- `backend/src/services/r2-storage.service.ts`
- `backend/src/services/r2-upload-session.service.ts`
- `backend/src/services/r2-stats.service.ts`

### Config and System Status

Update `backend/src/config.ts`:

- Remove `R2Config`.
- Remove `r2` from `AppConfig`.
- Remove parsing and validation for `R2_SIGNED_URL_EXPIRES_SECONDS`.
- Remove all `R2_*` env reads.

Update `backend/src/services/system.service.ts`:

- Remove `getR2Stats` import and `R2Stats` type.
- Remove optional `r2` property from `SystemStatus`.
- Return only `localIps`, `online`, and `uptime`.

### Types and Database Normalization

Update `backend/src/types.ts`:

- Change `VideoStorageProvider` to local-only or remove it if not needed.
- Remove `r2ObjectKey` from `Video`.
- Remove `R2UploadSessionStatus`, `R2UploadedPartManifest`, and `R2UploadSessionManifest`.

Update `backend/src/db.ts`:

- Remove `r2ObjectKey` normalization.
- Normalize `storageProvider` to local-only if the field remains.
- Do not add compatibility behavior for old R2 records.

### Dependencies and Runtime Files

Update backend dependencies:

- Remove `@aws-sdk/client-s3`.
- Remove `@aws-sdk/s3-request-presigner`.
- Regenerate `backend/package-lock.json` through npm.

Update env files:

- Remove all `R2_*` values from `backend/.env`.
- Remove any `R2_*` examples if present in `backend/.env.example`.

Delete generated old R2 upload session files:

- `backend/uploads/.sessions/r2`

Security note: because R2 credentials exist in the local `.env`, revoke or rotate those credentials in Cloudflare after the cleanup if they were ever shared or committed.

## Frontend Design

### API Service

Update `frontend/src/app/services/api.service.ts`:

- Remove `R2Stats`.
- Remove `R2UploadedPart`.
- Remove `R2UploadSession`.
- Remove `R2UploadPartUrl`.
- Remove `r2ObjectKey` from `Video`.
- Change `Video.storageProvider` to local-only or remove it if no UI/tests use it.
- Remove `storageTargets` from `VideoPolicy` if backend removes it; otherwise restrict it to local-only.
- Simplify `uploadVideo(file)` so it only appends the file and does not accept or append `storageTarget`.
- Remove R2 API methods:
  - `createR2UploadSession`
  - `getR2UploadPartUrl`
  - `completeR2UploadSession`
  - `abortR2UploadSession`
- Simplify `getSystemStatus()` return type so it no longer includes `r2`.

### Dashboard Store

Update `frontend/src/app/features/dashboard/dashboard.store.ts`:

- Remove `R2Stats` import.
- Remove `R2DirectUploadService` import and injection.
- Remove `uploadTarget` signal.
- Remove R2 from `systemInfo`.
- Simplify `uploadMedia(file)` to always use `ResumableUploadService`.
- Remove `uploadR2WithProgress`.
- Simplify upload status labels to local/chunk upload messages only.
- Simplify `loadVideoPolicy()` so it only updates max upload size.
- Remove `setUploadTarget()`.

### R2 Direct Upload Service

Delete:

- `frontend/src/app/features/dashboard/r2-direct-upload.service.ts`
- `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`

### Video List Component

Update `frontend/src/app/features/dashboard/components/video-list/video-list.ts`:

- Remove `UploadTarget`.
- Remove `storageTarget` from `UploadMediaPayload`.
- Remove `selectedUploadTarget` input.
- Remove `uploadTargetChange` output.
- Remove `R2_ALLOWED_TYPES`.
- Validate only the local supported formats.
- Simplify `getFileAccept()` to local supported formats.
- Simplify `getUploadHint()` to local supported formats and max size.

Update `frontend/src/app/features/dashboard/components/video-list/video-list.html`:

- Remove the Local/R2 target toggle.
- Change upload button label to local-only wording.
- Remove the `R2 MP4` badge.

### Admin Dashboard Template

Update `frontend/src/app/features/dashboard/admin.html`:

- Remove the Cloudflare R2 Storage info card.
- Remove bindings to `store.systemInfo()?.r2`.

Update `frontend/src/app/features/dashboard/admin.ts`:

- Update upload handler calls so they pass only `file`, not `storageTarget`.

## Test Design

Backend tests:

- Remove imports from `dist/services/r2-storage.service`.
- Remove R2 test setup/reset calls.
- Delete tests for:
  - R2 form uploads
  - R2 MP4-only validation
  - R2 direct multipart upload creation/completion
  - R2 upload abort
  - R2 stream redirect
- Keep and adjust local upload tests.
- Add or retain coverage that `POST /api/videos` still uploads local files and rejects unsupported types.
- Adjust `/api/videos/policy` assertions to match local-only policy.

Frontend tests:

- Delete `r2-direct-upload.service.spec.ts`.
- Update dashboard/video-list specs so uploads emit only the file payload.
- Update mock `Video` objects to remove R2-only fields.
- Update system status mocks to remove `r2`.

## Verification Plan

Run these checks after implementation:

```bash
cd backend && npm test
cd frontend && npm run test:ci
cd backend && npm run build
cd frontend && npm run build
```

Run final source searches to confirm no R2 feature code remains:

```bash
rg -i "cloudflare|\br2\b|R2_|@aws-sdk|r2ObjectKey|storageTarget|/videos/r2" .
```

Allowed remaining matches should only be historical design/plan docs, if those docs are intentionally kept.

## Risks

- Existing records in `backend/db.json` with `storageProvider: "r2"` will no longer work.
- Existing files under `backend/uploads/.sessions/r2` will be deleted as obsolete upload session state.
- Removing `storageProvider` entirely may touch many UI mocks; if this creates excessive churn, keep `storageProvider: 'local'` as a local-only field for one cleanup pass.
- Package lock changes should be generated by npm to avoid dependency drift.

## Success Criteria

- Admin UI no longer shows Cloudflare R2 upload or storage status.
- Backend exposes no `/api/videos/r2/*` endpoints.
- Backend no longer reads `R2_*` env values.
- AWS SDK packages are removed from backend dependencies.
- Local upload, local chunk resume, local streaming, poster, HLS, image playback, profile assignment, and player playback still pass tests/builds.
- Final grep finds no active R2 implementation code.
