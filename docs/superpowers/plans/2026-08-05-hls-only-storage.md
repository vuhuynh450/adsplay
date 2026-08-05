# HLS-only Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly uploaded compatible video play from an HLS stream copied from the source, then remove the source file after successful processing.

**Architecture:** Validate a video synchronously with ffprobe before creating its database record, then keep the existing background queue for poster creation and HLS packaging. A new `hls-only` stream variant identifies new video records so the backend rejects MP4 stream requests and the player uses HLS without an MP4 fallback; old records retain their current behavior.

**Tech Stack:** Node.js, TypeScript, Express 5, FFmpeg/FFprobe static binaries, SQLite, Angular 21, hls.js, Node test runner, Vitest.

## Global Constraints

- New video uploads accept only H.264 video with AAC audio or no audio; reject incompatible codecs with an actionable H.264/AAC message.
- New compatible videos use FFmpeg stream copy only: no scale, CRF, bitrate limit, or video/audio re-encoding.
- Remove the source video only after a non-empty HLS playlist and at least one segment exist.
- Never delete the source if validation or HLS generation fails.
- Do not alter stored data or fallback behavior for videos created before this change.
- Do not create a database record or playlist entry for a rejected codec.
- No commit step is included because a commit was not requested.

---

## File Structure

- Modify `backend/src/types.ts`: add the `hls-only` stream variant and a failed processing state.
- Modify `backend/src/services/media.service.ts`: expose codec validation, create copy-only HLS, validate generated artifacts, remove the source only for `hls-only` records, and record failure state safely.
- Modify `backend/src/services/video.service.ts`: validate direct and resumable video source files before persistence, create `hls-only` records, reject MP4 stream lookup for them, and retain image behavior.
- Modify `backend/src/routes/video.routes.ts`: clean direct-upload files on validation failure and clean resumable assembled files/session data on validation failure.
- Modify `backend/src/config.ts` and `backend/.env.example`: retain processing as enabled by default and describe that it creates HLS-only output for new videos.
- Modify `frontend/src/app/services/api.service.ts`: expose new stream and processing variants.
- Modify `frontend/src/app/features/player/player-session.service.ts`: never fetch/cache/fallback to MP4 for `hls-only`, while preserving fallback for legacy records.
- Modify `frontend/src/app/features/dashboard/admin.ts` and `frontend/src/app/features/dashboard/components/video-list/video-list.ts`: use HLS previews and clear HLS-only/failed labels.
- Modify `backend/test/media-processing.test.js`, `backend/test/api.test.js`, `frontend/src/app/features/player/player-session.service.spec.ts`, `frontend/src/app/features/dashboard/components/video-list/video-list.spec.ts`, and `frontend/src/app/features/dashboard/admin.spec.ts`: cover the changed behavior.

### Task 1: Define HLS-only Media Contracts

**Files:**
- Modify: `backend/src/types.ts:2-5`
- Modify: `frontend/src/app/services/api.service.ts:6-29`
- Modify: `frontend/src/app/features/dashboard/admin.ts:214-233`
- Modify: `frontend/src/app/features/dashboard/components/video-list/video-list.ts:103-125`
- Test: `frontend/src/app/features/dashboard/admin.spec.ts`
- Test: `frontend/src/app/features/dashboard/components/video-list/video-list.spec.ts`

**Interfaces:**
- Produces: `VideoStreamVariant = 'optimized' | 'original' | 'hls-only'`.
- Produces: `VideoProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'`.
- Produces: dashboard labels `Dang dong goi HLS`, `San sang HLS goc`, and `Xu ly that bai`.

- [ ] **Step 1: Write failing frontend label tests**

Add `hls-only` ready and `failed` video fixtures, then assert the explicit labels:

```ts
expect(component.getProcessingLabel({ ...video, streamVariant: 'hls-only' })).toBe('Sẵn sàng HLS gốc');
expect(component.getProcessingLabel({ ...video, processingStatus: 'failed' })).toBe('Xử lý thất bại');
```

- [ ] **Step 2: Run the focused frontend tests and verify they fail**

Run: `npm run test:ci -- --include='src/app/features/dashboard/components/video-list/video-list.spec.ts'`

Expected: FAIL because `hls-only` and `failed` are not valid API types and labels do not exist.

- [ ] **Step 3: Add the shared variant/status values and labels**

Use matching backend and frontend union types:

```ts
export type VideoProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type VideoStreamVariant = 'optimized' | 'original' | 'hls-only';
```

For each dashboard label method, handle failed before ready and return `San sang HLS goc` for a ready `hls-only` video; preserve current labels for `optimized`, `original`, and images.

- [ ] **Step 4: Run the focused frontend tests and verify they pass**

Run: `npm run test:ci -- --include='src/app/features/dashboard/components/video-list/video-list.spec.ts' --include='src/app/features/dashboard/admin.spec.ts'`

Expected: PASS.

### Task 2: Validate Source Codecs and Package HLS Without Re-encoding

**Files:**
- Modify: `backend/src/services/media.service.ts:18-173`
- Test: `backend/test/media-processing.test.js`

**Interfaces:**
- Produces: `validateHlsOnlySource(sourcePath: string): Promise<Partial<Video>>` which throws `AppError(400, 'VIDEO_CODEC_UNSUPPORTED', ...)` unless video codec is `h264` and every audio stream is `aac`.
- Produces: `packageHlsOnly(sourcePath: string, videoId: string): Promise<{ hlsManifestPath: string }>` using `-c:v copy`, `-c:a copy`, `-hls_time 6`, `-hls_playlist_type vod`, and segment output `segment-%03d.ts`.

- [ ] **Step 1: Write failing media-processing tests**

Generate a small H.264/AAC fixture and an unsupported HEVC fixture with the installed FFmpeg binary. Assert the supported fixture resolves metadata, the unsupported fixture rejects with `VIDEO_CODEC_UNSUPPORTED`, and HLS output has a playlist plus `segment-000.ts`.

```js
await assert.rejects(
  () => validateHlsOnlySource(hevcPath),
  (error) => error.code === 'VIDEO_CODEC_UNSUPPORTED',
);
assert.ok(await fs.pathExists(path.join(hlsDir, 'playlist.m3u8')));
assert.ok(await fs.pathExists(path.join(hlsDir, 'segment-000.ts')));
```

- [ ] **Step 2: Run the media test and verify it fails**

Run: `npm test -- --test-name-pattern='HLS-only'`

Expected: FAIL because codec validation and copy-only packager are not exported.

- [ ] **Step 3: Implement probe validation and copy-only HLS packaging**

Extend `FfprobeStream` with `codec_name`, make probe return the complete stream list internally, and implement codec checks before FFmpeg starts. Replace the re-encode arguments with:

```ts
'-c:v', 'copy',
'-c:a', 'copy',
'-hls_time', '6',
'-hls_playlist_type', 'vod',
'-hls_segment_filename', segmentPattern,
'-f', 'hls',
playlistPath,
```

After FFmpeg exits successfully, read the playlist and require a `segment-*.ts` entry whose file exists and has non-zero size; otherwise remove the HLS directory and throw `VIDEO_HLS_GENERATION_FAILED`.

- [ ] **Step 4: Run the media test and verify it passes**

Run: `npm test -- --test-name-pattern='HLS-only'`

Expected: PASS.

### Task 3: Persist New Videos as HLS-only and Clean Up Their Source

**Files:**
- Modify: `backend/src/services/video.service.ts:49-99,124-141`
- Modify: `backend/src/services/media.service.ts:175-260`
- Modify: `backend/src/config.ts:46-135`
- Modify: `backend/.env.example:1-10`
- Test: `backend/test/media-processing.test.js`

**Interfaces:**
- Consumes: `validateHlsOnlySource(sourcePath)` before `createVideoRecord` persists a video.
- Consumes: `packageHlsOnly(sourcePath, video.id)` from the media queue.
- Produces: new video records with `streamVariant: 'hls-only'`, `processingStatus: 'pending'`, and a source file retained only while queued/processing.
- Produces: `getVideoStreamSource(id)` throwing `AppError(409, 'VIDEO_STREAM_HLS_ONLY', 'This video is available through HLS only.')` for ready `hls-only` videos.

- [ ] **Step 1: Replace the existing processing assertion with the desired failing behavior**

In `media-processing.test.js`, assert a completed compatible upload has `hls-only`, a ready manifest, a missing original source file, and a rejected MP4 stream endpoint:

```js
assert.equal(processedVideo.streamVariant, 'hls-only');
assert.ok(processedVideo.hlsManifestPath);
assert.equal(await fs.pathExists(path.join(process.env.UPLOADS_DIR, processedVideo.sourceFilename)), false);
assert.equal(streamResponse.status, 409);
assert.equal(streamResponse.body.error.code, 'VIDEO_STREAM_HLS_ONLY');
```

- [ ] **Step 2: Run the focused backend test and verify it fails**

Run: `npm test -- --test-name-pattern='media processing'`

Expected: FAIL because records remain `original`, source files remain, and `/stream` serves MP4.

- [ ] **Step 3: Implement the lifecycle**

In `createVideoRecord`, use `validateHlsOnlySource` for video files before `dbRepository.saveVideo`; preserve immediate image creation. Persist accepted videos with `streamVariant: 'hls-only'` and pending status. In `processNext`, create poster, package HLS, update the record to ready only after artifact validation, then remove `sourcePath`. If source removal fails, log it without deleting the usable HLS. If packaging fails, remove partial HLS/poster, retain the source, set `processingStatus: 'failed'`, and preserve a clear `processingError`.

Guard `getVideoStreamSource` before file lookup:

```ts
if (video.streamVariant === 'hls-only') {
  throw new AppError(409, 'VIDEO_STREAM_HLS_ONLY', 'This video is available through HLS only.');
}
```

Keep `MEDIA_TRANSCODE_ENABLED=true` as the documented default; rename its description in `.env.example` to explain that it performs HLS-only packaging for accepted videos. Do not change existing records when the setting is false.

- [ ] **Step 4: Run backend media and type verification**

Run: `npm test -- --test-name-pattern='media processing'`

Expected: PASS.

Run: `npm run build`

Expected: exit code 0.

### Task 4: Reject Unsupported Direct and Resumable Uploads Without Residual Files

**Files:**
- Modify: `backend/src/routes/video.routes.ts:166-197,269-297`
- Modify: `backend/src/services/upload-session.service.ts:205-275`
- Test: `backend/test/api.test.js`

**Interfaces:**
- Consumes: validation errors from `saveUploadedVideo` and `saveUploadedVideoFromFile`.
- Produces: `400 VIDEO_CODEC_UNSUPPORTED` with a message containing `H.264/AAC`.
- Produces: no database record, no assembled source file, and no resumable session directory for rejected uploads.

- [ ] **Step 1: Write failing direct and resumable API tests**

Use a small HEVC fixture in the direct route and the resumable completion route. Assert each response is 400, the code/message are actionable, `dbRepository.listVideos()` is unchanged, and `uploads` contains no source file/session folder for the rejected upload.

```js
assert.equal(response.status, 400);
assert.equal(response.body.error.code, 'VIDEO_CODEC_UNSUPPORTED');
assert.match(response.body.error.message, /H\.264\/AAC/);
assert.equal((await dbRepository.listVideos()).length, videoCountBefore);
```

- [ ] **Step 2: Run the focused API tests and verify they fail**

Run: `npm test -- --test-name-pattern='unsupported codec'`

Expected: FAIL because the routes save the file/record before codec inspection or leave assembled artifacts behind.

- [ ] **Step 3: Add route cleanup around validation failures**

For direct uploads, wrap `saveUploadedVideo(req.file)` and remove `uploadsDir/req.file.filename` before rethrowing any validation error. For resumable completion, retain the existing assembled-file cleanup and also call `deleteUploadSession(sessionId)` for `VIDEO_CODEC_UNSUPPORTED`; only call `markUploadSessionCompleted` after a video record was saved.

Use the existing `AppError` code check rather than matching error message text:

```ts
if (error instanceof AppError && error.code === 'VIDEO_CODEC_UNSUPPORTED') {
  await fs.remove(destinationPath);
  await deleteUploadSession(sessionId);
}
throw error;
```

- [ ] **Step 4: Run the focused API tests and verify they pass**

Run: `npm test -- --test-name-pattern='unsupported codec'`

Expected: PASS.

### Task 5: Make the Player and Admin Preview HLS-only Aware

**Files:**
- Modify: `frontend/src/app/features/player/player-session.service.ts:814-915,1277-1407`
- Modify: `frontend/src/app/features/dashboard/admin.ts:200-233`
- Modify: `frontend/src/app/features/dashboard/components/video-list/video-list.ts:119-125`
- Test: `frontend/src/app/features/player/player-session.service.spec.ts`

**Interfaces:**
- Consumes: `video.streamVariant === 'hls-only'` and `video.hlsManifestPath`.
- Produces: HLS URLs for ready HLS-only previews/playback; MP4 cache, prefetch, and fallback are never used for these videos.
- Preserves: original MP4 fallback and caching for legacy video records.

- [ ] **Step 1: Write failing player tests**

Create a ready HLS-only fixture with `hlsManifestPath`. Spy on the private MP4 fallback path and assert an HLS fatal event does not call it. Add a legacy fixture assertion that fallback behavior remains enabled.

```ts
expect(fallbackSpy).not.toHaveBeenCalled();
expect(api.getVideoStreamUrl).not.toHaveBeenCalledWith(hlsOnlyVideo);
```

- [ ] **Step 2: Run the focused player test and verify it fails**

Run: `npm run test:ci -- --include='src/app/features/player/player-session.service.spec.ts'`

Expected: FAIL because all HLS failures currently call `fallbackToMp4` and `loadAndPlayMedia` creates a stream URL before choosing HLS.

- [ ] **Step 3: Implement HLS-only playback and preview URLs**

In `loadAndPlayMedia`, derive `hlsUrl` first. For a ready `hls-only` video, call `applyPlayback` with the HLS URL and an empty source URL; do not invoke cache/prefetch code. In the HLS error handler and `onVideoError`, only call `fallbackToMp4` when `playback.sourceUrl` is non-empty and the active video is not HLS-only.

Make admin and list preview URL methods return `api.getVideoHlsManifestUrl(video)` for ready HLS-only video and retain the stream URL for images and legacy videos. Update status text to distinguish HLS-only and failed state.

- [ ] **Step 4: Run focused frontend tests and build**

Run: `npm run test:ci -- --include='src/app/features/player/player-session.service.spec.ts' --include='src/app/features/dashboard/components/video-list/video-list.spec.ts' --include='src/app/features/dashboard/admin.spec.ts'`

Expected: PASS.

Run: `npm run build`

Expected: exit code 0.

### Task 6: Run Regression Verification

**Files:**
- Modify only if a regression test exposes a real defect.

**Interfaces:**
- Verifies: direct upload, resumable upload, deletion, existing HLS asset route, legacy MP4 stream, compatible HLS-only processing, and unsupported-codec cleanup.

- [ ] **Step 1: Run all backend tests**

Run: `npm test`

Expected: all Node tests PASS.

- [ ] **Step 2: Run all frontend tests**

Run: `npm run test:ci`

Expected: all Vitest tests PASS.

- [ ] **Step 3: Inspect changed files and status**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only intentional implementation and documentation files are listed, plus any pre-existing unrelated user changes.

## Self-review

- Spec coverage: Tasks 1-4 cover default copy-only HLS, H.264/AAC rejection, artifact validation, source deletion, error retention, API stream handling, direct/resumable cleanup, and compatibility. Task 5 covers HLS playback without MP4 fallback and HLS admin previews. Task 6 covers regression verification.
- Placeholder scan: no TBD/TODO or deferred implementation steps are present.
- Type consistency: `hls-only`, `failed`, `VIDEO_CODEC_UNSUPPORTED`, and `VIDEO_STREAM_HLS_ONLY` are used consistently across all tasks.
