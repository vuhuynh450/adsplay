# Safer Video Delete Design

## Goal

Make video deletion safer by treating SQLite metadata as the source of truth and making disk file cleanup best-effort.

When an administrator deletes a video, the app should remove the video from the media library and all profile playlists even if deleting one or more local files fails. A leftover file on disk is less harmful than a database record that points to a missing file.

## Current State

`backend/src/services/video.service.ts` currently deletes files first and then deletes the database record:

```ts
for (const filePath of filePaths) {
    if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
    }
}

await dbRepository.deleteVideo(id);
```

Risk:

- if one or more files are removed successfully
- and `dbRepository.deleteVideo(id)` fails afterward
- the database can still contain a video record that points to missing local files

SQLite already handles playlist cleanup through the repository/database layer. `dbRepository.deleteVideo(id)` returns the deleted video when the row exists, and profile playlist rows are removed by SQLite foreign-key behavior.

## Recommended Approach

Delete the database row first, then remove local files as best-effort cleanup.

This preserves the app-facing state first:

- deleted video disappears from the media library
- deleted video disappears from profiles/playlists
- player/admin API no longer references the deleted video
- failed disk cleanup leaves only orphan files, which can be handled later by a cleanup tool

## Backend Design

### Delete Flow

Update `deleteVideo(id)` in `backend/src/services/video.service.ts`:

1. Load the video by ID.
2. If not found, throw `AppError(404, 'VIDEO_NOT_FOUND', 'Video not found.')`.
3. Build the set of local paths to remove from the loaded video metadata.
4. Delete the database record by calling `dbRepository.deleteVideo(id)`.
5. If the repository unexpectedly returns `null`, throw `AppError(404, 'VIDEO_NOT_FOUND', 'Video not found.')` and do not attempt file cleanup.
6. After DB deletion succeeds, attempt to remove each file/folder.
7. If a file/folder is missing, skip it.
8. If removing a file/folder fails, log the failure and continue.
9. Do not throw file cleanup failures to the API caller.

The public API behavior remains:

- `DELETE /api/videos/:id` returns `{ success: true }` when the DB record is deleted.
- Missing video still returns `404 VIDEO_NOT_FOUND`.
- Auth and page access behavior do not change.

### Paths To Remove

Keep the current path set behavior:

- `path.join(config.uploadsDir, video.filename)`
- `path.join(config.uploadsDir, video.sourceFilename)`
- `path.join(config.uploadsDir, video.posterFilename)` when present
- `path.join(config.uploadsDir, path.dirname(video.hlsManifestPath))` when present

Use a `Set<string>` to dedupe paths because `filename` and `sourceFilename` can point to the same file.

### Path Safety

The path list must remain constrained to files derived from stored video metadata and `config.uploadsDir`.

Do not add broad recursive cleanup or arbitrary path deletion in this change.

### Logging

Use the existing logger instead of surfacing cleanup failures to the UI.

For each failed cleanup path, log an error/warning event with:

- event name: `video.delete_file_failed`
- `videoId`
- `filePath`
- error message

If multiple paths fail, log each failed path separately and still return success after all cleanup attempts finish.

## Out Of Scope

This spec does not include:

- soft delete state
- database schema changes
- orphan file scanner
- manual cleanup button
- storage dashboard changes
- upload session cleanup
- disk usage guard
- login rate limiting

Those can be implemented later as separate focused changes.

## Test Design

Backend tests should cover:

- deleting an existing video removes it from the database and from profile playlists
- deleting an existing video removes source/poster/HLS local files when file cleanup succeeds
- if local file cleanup fails after DB deletion, the API still returns success and the video is absent from the database
- deleting a missing video returns `404 VIDEO_NOT_FOUND`

To test cleanup failure, use a focused seam that can simulate `fs.remove` failure without changing production behavior. Keep the seam local to `video.service.ts` and reset it after each test.

## Acceptance Criteria

- `DELETE /api/videos/:id` deletes the SQLite video row before deleting disk files.
- Profile playlists no longer reference the deleted video after successful DB deletion.
- File cleanup failures do not keep stale metadata in SQLite.
- File cleanup failures are logged with the video ID and path.
- Existing delete API response shape remains `{ success: true }` on successful DB deletion.
- Backend tests pass.
