# Safer Video Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make video deletion remove SQLite metadata first and clean local files as best-effort afterward.

**Architecture:** Keep the existing `DELETE /api/videos/:id` route and response shape. Change `backend/src/services/video.service.ts` so `deleteVideo(id)` deletes the DB row first, then attempts file/folder cleanup while logging `video.delete_file_failed` failures without throwing them to the API caller.

**Tech Stack:** Express 5, TypeScript, `fs-extra`, SQLite repository, Node test runner, Supertest.

## Global Constraints

- SQLite metadata is the source of truth.
- `DELETE /api/videos/:id` must keep returning `{ success: true }` after successful DB deletion.
- Missing video must still return `404 VIDEO_NOT_FOUND`.
- Auth and page access behavior must not change.
- File cleanup failures must be logged with event name `video.delete_file_failed`, `videoId`, `filePath`, and error message.
- File cleanup failures must not be thrown to the API caller after DB deletion succeeds.
- Do not add soft delete, schema changes, orphan scanner, manual cleanup UI, storage dashboard changes, upload cleanup, disk guard, or login rate limiting.
- Do not add new runtime dependencies.
- Do not commit unless the user explicitly asks for a commit.

---

## File Structure

- Modify `backend/src/services/video.service.ts`: add local file-remove seam for tests, switch delete flow to DB-first, log best-effort cleanup failures.
- Modify `backend/test/api.test.js`: add API coverage for successful file cleanup, cleanup failure still returning success, missing video 404, and profile playlist cleanup remaining intact.

---

### Task 1: DB-First Best-Effort Video Delete

**Files:**
- Modify: `backend/src/services/video.service.ts`
- Modify: `backend/test/api.test.js`

**Interfaces:**
- Consumes: `dbRepository.findVideoById(id): Promise<Video | null>` and `dbRepository.deleteVideo(id): Promise<Video | null>`.
- Produces: `deleteVideo(id: string): Promise<void>` with DB-first semantics and test helpers `__setRemoveFileForTests(removeFile)` and `__resetRemoveFileForTests()`.

- [ ] **Step 1: Add failing API tests**

In `backend/test/api.test.js`, add this import near the existing service imports:

```js
const {
  __resetRemoveFileForTests,
  __setRemoveFileForTests,
} = require('../dist/services/video.service');
```

Update `test.beforeEach` to reset the test seam:

```js
test.beforeEach(() => {
  __resetRegisterRateLimitForTests();
  __resetDeviceCodeGeneratorForTests();
  __resetPendingDeviceRegistrationsForTests();
  __resetRemoveFileForTests();
});
```

Add this after `staff without videos permission cannot upload or delete videos`:

```js
test('delete video removes database record, playlist references, and local files', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('video content'), {
      contentType: 'video/mp4',
      filename: 'delete-files.mp4',
    });
  assert.equal(uploadResponse.status, 200);

  const video = uploadResponse.body;
  const sourcePath = path.join(process.env.UPLOADS_DIR, video.sourceFilename);
  const posterRelativePath = path.join('processed', 'posters', `${video.id}.jpg`);
  const hlsRelativePath = path.join('processed', 'hls', video.id, 'playlist.m3u8');
  const posterPath = path.join(process.env.UPLOADS_DIR, posterRelativePath);
  const hlsDir = path.dirname(path.join(process.env.UPLOADS_DIR, hlsRelativePath));

  await fs.outputFile(posterPath, Buffer.from('poster'));
  await fs.outputFile(path.join(hlsDir, 'playlist.m3u8'), Buffer.from('#EXTM3U'));

  await dbRepository.updateVideo(video.id, (draft) => {
    draft.posterFilename = posterRelativePath;
    draft.hlsManifestPath = hlsRelativePath;
  });

  const profileResponse = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({
      name: 'Delete Safety Screen',
      videoIds: [video.id],
    });
  assert.equal(profileResponse.status, 200);

  const deleteResponse = await request(app)
    .delete(`/api/videos/${video.id}`)
    .set(authHeader);
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(deleteResponse.body, { success: true });

  assert.equal(await dbRepository.findVideoById(video.id), null);
  assert.equal(await fs.pathExists(sourcePath), false);
  assert.equal(await fs.pathExists(posterPath), false);
  assert.equal(await fs.pathExists(hlsDir), false);

  const profileAfter = await request(app)
    .get(`/api/profiles/${profileResponse.body.id}`)
    .set(authHeader);
  assert.equal(profileAfter.status, 200);
  assert.equal(profileAfter.body.videoIds.includes(video.id), false);
});

test('delete video keeps database deleted when local file cleanup fails', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('video content'), {
      contentType: 'video/mp4',
      filename: 'cleanup-fails.mp4',
    });
  assert.equal(uploadResponse.status, 200);

  const video = uploadResponse.body;
  const sourcePath = path.join(process.env.UPLOADS_DIR, video.sourceFilename);
  const originalConsoleError = console.error;
  const logLines = [];

  console.error = (line) => {
    logLines.push(line);
  };

  __setRemoveFileForTests(async () => {
    throw new Error('simulated remove failure');
  });

  try {
    const deleteResponse = await request(app)
      .delete(`/api/videos/${video.id}`)
      .set(authHeader);

    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(deleteResponse.body, { success: true });
  } finally {
    console.error = originalConsoleError;
    __resetRemoveFileForTests();
    await fs.remove(sourcePath);
  }

  assert.equal(await dbRepository.findVideoById(video.id), null);
  assert.ok(logLines.some((line) => {
    const entry = JSON.parse(line);
    return entry.event === 'video.delete_file_failed' &&
      entry.videoId === video.id &&
      entry.filePath === sourcePath &&
      entry.error === 'simulated remove failure';
  }));
});

test('delete missing video returns VIDEO_NOT_FOUND', async () => {
  const { authHeader } = await loginAsAdmin();

  const response = await request(app)
    .delete('/api/videos/not-a-real-video')
    .set(authHeader);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'VIDEO_NOT_FOUND');
});
```

- [ ] **Step 2: Run the targeted failing tests**

Run:

```bash
npm test -- --test-name-pattern="delete video"
```

Workdir: `backend`

Expected: fail because `__resetRemoveFileForTests` and `__setRemoveFileForTests` are not exported yet.

- [ ] **Step 3: Implement DB-first best-effort cleanup**

In `backend/src/services/video.service.ts`, update the logger import section by adding:

```ts
import { logError } from '../logger';
```

Add this near the constants after `IMAGE_MIME_TYPES`:

```ts
type RemoveFile = (filePath: string) => Promise<void>;

let removeFile: RemoveFile = (filePath) => fs.remove(filePath);

export const __setRemoveFileForTests = (nextRemoveFile: RemoveFile) => {
    removeFile = nextRemoveFile;
};

export const __resetRemoveFileForTests = () => {
    removeFile = (filePath) => fs.remove(filePath);
};
```

Replace the existing `deleteVideo` implementation with:

```ts
export const deleteVideo = async (id: string) => {
    const video = await dbRepository.findVideoById(id);
    if (!video) {
        throw new AppError(404, 'VIDEO_NOT_FOUND', 'Video not found.');
    }

    const filePaths = new Set<string>();
    filePaths.add(path.join(config.uploadsDir, video.filename));
    filePaths.add(path.join(config.uploadsDir, video.sourceFilename));

    if (video.posterFilename) {
        filePaths.add(path.join(config.uploadsDir, video.posterFilename));
    }

    if (video.hlsManifestPath) {
        filePaths.add(path.join(config.uploadsDir, path.dirname(video.hlsManifestPath)));
    }

    const deletedVideo = await dbRepository.deleteVideo(id);
    if (!deletedVideo) {
        throw new AppError(404, 'VIDEO_NOT_FOUND', 'Video not found.');
    }

    for (const filePath of filePaths) {
        if (!(await fs.pathExists(filePath))) {
            continue;
        }

        try {
            await removeFile(filePath);
        } catch (error) {
            logError('video.delete_file_failed', {
                error: error instanceof Error ? error.message : String(error),
                filePath,
                videoId: id,
            });
        }
    }
};
```

- [ ] **Step 4: Run targeted tests again**

Run:

```bash
npm test -- --test-name-pattern="delete video"
```

Workdir: `backend`

Expected: PASS for delete-video matching tests.

- [ ] **Step 5: Run full backend verification**

Run:

```bash
npm test
```

Workdir: `backend`

Expected: all backend tests pass.

---

## Final Verification

- [ ] Run backend tests:

```bash
npm test
```

Workdir: `backend`

- [ ] Inspect changed files:

```bash
git diff -- backend/src/services/video.service.ts backend/test/api.test.js docs/superpowers/specs/2026-07-02-safer-video-delete-design.md docs/superpowers/plans/2026-07-02-safer-video-delete.md
```

Expected: diff only contains safer video delete changes and the approved spec/plan docs.

## Self-Review Notes

- Spec coverage: DB-first deletion, unchanged route response, 404 for missing videos, best-effort cleanup, logging event details, playlist cleanup, and no out-of-scope features are covered.
- Placeholder scan: no TBD/TODO/fill-in instructions.
- Type consistency: test helpers are `__setRemoveFileForTests(removeFile)` and `__resetRemoveFileForTests()`; implementation and tests use the same names.
- Commit steps are intentionally omitted because commits require explicit user approval in this workspace.
