# Direct Cloudflare R2 Upload Design

## Goal

Enable large MP4 uploads from the admin dashboard directly to Cloudflare R2 without sending the full file through the backend `/api/videos` endpoint. This avoids Cloudflare/proxy `413 Payload Too Large` failures and prevents the backend from buffering multi-GB files in RAM or disk.

## Current Problem

The current R2 upload path posts the full file to the backend via `POST /api/videos` with `storageTarget=r2`. The backend stores the multipart form file locally, reads it fully into memory, then uploads it to R2 with `PutObject`. This design is fragile for large files because:

- Cloudflare/proxies can reject the request before it reaches the backend.
- Backend memory usage grows with file size.
- The upload endpoint is not suitable for multi-GB media.

## Selected Approach

Use direct browser-to-R2 multipart upload with backend-issued presigned URLs.

Flow:

1. Frontend requests an R2 multipart upload session from the backend using a stable file key.
2. Backend validates auth, permission, MIME type, size, and R2 configuration.
3. Backend creates a new multipart upload or resumes an unfinished matching session, then returns an app-level session id, R2 object key, upload id, part size, total parts, and uploaded parts.
4. Frontend slices the MP4 into parts and requests a presigned URL for each part.
5. Frontend uploads each part directly to R2 with `PUT`.
6. Frontend records each returned `ETag`.
7. Frontend asks backend to complete the multipart upload with the ordered `{ partNumber, etag }` list.
8. Backend completes the R2 multipart upload and creates the video record in the app database.
9. Dashboard refreshes and shows the uploaded R2 video.

## Backend API

Add R2-specific upload endpoints under the existing videos router:

```text
POST   /api/videos/r2/uploads
POST   /api/videos/r2/uploads/:id/parts/:partNumber/presign
POST   /api/videos/r2/uploads/:id/complete
DELETE /api/videos/r2/uploads/:id
```

### `POST /api/videos/r2/uploads`

Request body:

```json
{
  "fileKey": "client-stable-file-key",
  "originalName": "video.mp4",
  "mimeType": "video/mp4",
  "totalSizeBytes": 3228745728
}
```

Behavior:

- Requires authenticated admin with `videos` page access.
- Requires R2 enabled.
- Allows only `video/mp4`.
- Rejects files larger than `MAX_UPLOAD_SIZE_MB`.
- Creates a new R2 multipart upload using the S3-compatible API, or resumes an unfinished matching manifest for the same `fileKey`, name, MIME type, and size.
- Stores a local manifest for basic resume/retry recovery.

Response:

```json
{
  "id": "app-session-id",
  "objectKey": "videos/2026/...mp4",
  "uploadId": "r2-upload-id",
  "partSizeBytes": 33554432,
  "totalParts": 97,
  "uploadedParts": []
}
```

### `POST /api/videos/r2/uploads/:id/parts/:partNumber/presign`

Behavior:

- Validates session exists and is still uploading.
- Validates `partNumber` is in range.
- Returns a presigned `UploadPartCommand` URL for R2.

Response:

```json
{
  "url": "https://...r2.cloudflarestorage.com/...",
  "method": "PUT",
  "expiresInSeconds": 900
}
```

### `POST /api/videos/r2/uploads/:id/complete`

Request body:

```json
{
  "parts": [
    { "partNumber": 1, "etag": "\"...\"" },
    { "partNumber": 2, "etag": "\"...\"" }
  ]
}
```

Behavior:

- Validates all expected parts are present.
- Sorts parts by `partNumber`.
- Completes multipart upload in R2.
- Creates app video record with `storageProvider: "r2"` and `r2ObjectKey`.
- Marks manifest completed.

Response: the created `Video` object.

### `DELETE /api/videos/r2/uploads/:id`

Behavior:

- Aborts the R2 multipart upload if still open.
- Removes the local manifest.
- Returns `{ "success": true }`.

## Backend Services

Extend the R2 storage service with:

- `createMultipartUpload`
- `getUploadPartUrl`
- `completeMultipartUpload`
- `abortMultipartUpload`

Use existing AWS SDK v3 dependencies and Cloudflare R2 S3-compatible endpoint.

Add a small R2 upload-session service that stores manifests under the existing upload session area or a sibling R2-specific directory. The manifest stores:

- app session id
- file key
- object key
- R2 upload id
- original name
- MIME type
- total size
- part size
- total parts
- uploaded parts with ETags
- status
- created/updated timestamps
- completed video id when available

## Frontend

Add an R2 direct upload service used only when the selected upload target is Cloudflare R2.

Responsibilities:

- Create R2 upload session.
- Slice file into fixed-size parts.
- Presign and upload each part directly to R2.
- Read `ETag` from the R2 response headers.
- Track progress by uploaded bytes.
- Complete the session and return the created video.
- Abort the session on explicit cancellation or fatal failure when possible.

The dashboard store will replace the current R2 path:

```text
api.uploadVideo(file, 'r2')
```

with:

```text
r2DirectUpload.uploadFile(file, onProgress)
```

Local/HLS upload remains unchanged and continues using the existing resumable local upload service.

## Resume Scope

Implement basic resume:

- Backend keeps an R2 upload manifest.
- Frontend can reuse the same `fileKey` to find an existing unfinished upload session.
- Previously completed part metadata in the manifest can be skipped.
- If the browser loses all local state, the user may need to restart the upload.

This keeps the implementation focused while still avoiding re-uploading parts in common retry/failure cases.

## Error Handling

- R2 disabled: return a clear `R2_STORAGE_DISABLED` error.
- Non-MP4 file: reject in frontend and backend.
- File too large: reject using `MAX_UPLOAD_SIZE_MB` policy.
- Presigned URL expired: frontend retries by requesting a fresh URL for that part.
- Part upload failure: retry the part a limited number of times, then surface a user-facing error.
- Complete failure: keep the session manifest so the user can retry completion if parts are already uploaded.
- Cancel/fatal failure: call abort endpoint when appropriate.

## Security

- R2 credentials never leave the backend.
- Presigned URLs are short-lived.
- All session, presign, complete, and abort endpoints require existing auth and `videos` access.
- Backend validates MIME type, size, part range, and expected part count.
- Object keys are generated server-side, not trusted from the client.

## Testing

Backend tests:

- Creates R2 multipart upload session for valid MP4.
- Rejects non-MP4 R2 direct upload.
- Rejects files above `MAX_UPLOAD_SIZE_MB`.
- Presigns valid part numbers and rejects out-of-range parts.
- Completes upload and creates an R2 video record.
- Aborts unfinished upload sessions.

Frontend tests:

- R2 target uses the direct R2 upload service, not `/api/videos`.
- Progress updates after part uploads.
- Completion payload includes ordered part numbers and ETags.
- Failure path shows an upload error/toast.

## Out of Scope

- Full durable resume across browsers/devices.
- Parallel/concurrent part uploads beyond a conservative initial implementation.
- Uploading non-MP4 files to R2.
- R2 dashboard import/sync for manually uploaded objects.
- Reworking local/HLS upload flow.
