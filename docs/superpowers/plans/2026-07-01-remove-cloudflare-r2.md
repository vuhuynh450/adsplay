# Remove Cloudflare R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Cloudflare R2 upload/storage support completely and keep AdPlay local-only.

**Architecture:** Remove the R2 feature vertically across backend routes/services/config/types, frontend API/UI/store, tests, dependencies, and runtime session files. Keep the existing local resumable upload flow as the only upload path. Keep `storageProvider: 'local'` as a local-only field for this cleanup pass to reduce churn in persisted video records and frontend mocks, but remove `r2ObjectKey` and every active R2 code path.

**Tech Stack:** Node.js, Express, TypeScript, LowDB JSON storage, Angular 21, RxJS, Vitest/Jasmine-style Angular tests, Node test runner, npm.

## Global Constraints

- Full R2 removal: do not preserve legacy support for `storageProvider: "r2"` or `r2ObjectKey` records.
- No automated R2-to-local migration in this plan.
- Local resumable upload routes under `/api/videos/uploads/sessions` must continue to work.
- Admin UI must no longer show Cloudflare R2 upload target or R2 storage status.
- Backend must expose no `/api/videos/r2/*` routes after cleanup.
- Backend must no longer read `R2_*` env values.
- Remove backend AWS SDK S3/R2 dependencies.
- Do not edit historical docs except this implementation plan and the approved design spec.
- Do not commit unless explicitly instructed by the user.

---

## File Structure

Backend files to modify:

- `backend/src/routes/video.routes.ts` owns the video API route surface. It will become local-only by removing R2 routes and `storageTarget` handling.
- `backend/src/services/video.service.ts` owns video record creation, streaming source resolution, policy, and deletion. It will remove R2 object operations and return only local stream sources.
- `backend/src/services/system.service.ts` owns system status. It will stop returning R2 stats.
- `backend/src/config.ts` owns env parsing. It will stop parsing R2 config.
- `backend/src/types.ts` owns persisted/API types. It will remove R2 object/session types and keep `VideoStorageProvider = 'local'`.
- `backend/src/db.ts` owns DB normalization. It will drop `r2ObjectKey` normalization and normalize storage provider to local.
- `backend/test/api.test.js` owns backend route regression coverage. It will remove R2 tests and add local-only route/policy assertions.
- `backend/package.json` and `backend/package-lock.json` own backend dependency declarations. They will remove AWS SDK packages.
- `backend/.env` owns local runtime config. It will remove R2 credentials and settings.

Backend files to delete:

- `backend/src/services/r2-storage.service.ts`
- `backend/src/services/r2-upload-session.service.ts`
- `backend/src/services/r2-stats.service.ts`
- `backend/uploads/.sessions/r2`

Frontend files to modify:

- `frontend/src/app/services/api.service.ts` owns frontend API contracts. It will remove R2 types and methods.
- `frontend/src/app/features/dashboard/dashboard.store.ts` owns dashboard state and upload orchestration. It will always use `ResumableUploadService`.
- `frontend/src/app/features/dashboard/admin.ts` owns admin event wiring. It will pass only the file to upload.
- `frontend/src/app/features/dashboard/admin.html` owns admin layout. It will remove R2 bindings/card and upload target bindings.
- `frontend/src/app/features/dashboard/admin.spec.ts` owns admin component tests. It will remove the unused `uploadTarget` stub.
- `frontend/src/app/features/dashboard/components/video-list/video-list.ts` owns upload selection/validation UI logic. It will be local-only.
- `frontend/src/app/features/dashboard/components/video-list/video-list.html` owns media library upload UI. It will remove the Local/R2 switch and R2 badge.
- `frontend/src/app/features/dashboard/components/video-list/video-list.spec.ts` owns video-list unit tests. It will assert local-only upload payloads and format validation.

Frontend files to delete:

- `frontend/src/app/features/dashboard/r2-direct-upload.service.ts`
- `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`

---

### Task 1: Backend Contract Tests For Local-Only Video API

**Files:**
- Modify: `backend/test/api.test.js:39-42`
- Modify: `backend/test/api.test.js:93-98`
- Modify: `backend/test/api.test.js:480-486`
- Modify: `backend/test/api.test.js:947-1135`

**Interfaces:**
- Consumes: existing Express app from `../dist/app`, existing `loginAsAdmin()` helper, existing local upload route `POST /api/videos`.
- Produces: failing tests that define the new backend contract: no R2 service import, no `/api/videos/r2/*` route, `storageTarget=r2` ignored by normal form upload, policy contains only local storage.

- [ ] **Step 1: Remove R2 test service import**

In `backend/test/api.test.js`, delete this import block near the top:

```js
const {
  __resetR2StorageForTests,
  __setR2StorageForTests,
} = require('../dist/services/r2-storage.service');
```

- [ ] **Step 2: Remove R2 test reset call**

In `backend/test/api.test.js`, change `test.beforeEach` from:

```js
test.beforeEach(() => {
  __resetRegisterRateLimitForTests();
  __resetDeviceCodeGeneratorForTests();
  __resetPendingDeviceRegistrationsForTests();
  __resetR2StorageForTests();
});
```

to:

```js
test.beforeEach(() => {
  __resetRegisterRateLimitForTests();
  __resetDeviceCodeGeneratorForTests();
  __resetPendingDeviceRegistrationsForTests();
});
```

- [ ] **Step 3: Strengthen video policy assertion**

Find the existing test that fetches `/api/videos/policy`. Replace the local assertion block around the policy response with:

```js
  const policyResponse = await request(app).get('/api/videos/policy').set(authHeader);

  assert.equal(policyResponse.status, 200);
  assert.equal(policyResponse.body.maxUploadSizeBytes, 512 * 1024 * 1024);
  assert.equal(policyResponse.body.resumableChunkSizeBytes, resumableChunkSizeBytes);
  assert.deepEqual(policyResponse.body.storageTargets, ['local']);
  assert.ok(policyResponse.body.allowedMimeTypes.includes('video/mp4'));
  assert.ok(policyResponse.body.allowedMimeTypes.includes('image/png'));
```

- [ ] **Step 4: Replace R2 route tests with local-only regression tests**

Delete the R2 tests from `backend/test/api.test.js:947-1135`:

```js
test('R2 uploads keep MP4 direct stream and do not expose HLS manifest', async () => {
  const { authHeader } = await loginAsAdmin();
  __setR2StorageForTests({
    getStreamUrl: ({ key }) => `https://r2.example.com/${key}`,
    uploadObject: async () => ({ key: 'videos/r2-promo.mp4' }),
  });

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .field('storageTarget', 'r2')
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'r2-promo.mp4',
    });

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadResponse.body.mediaType, 'video');
  assert.equal(uploadResponse.body.processingStatus, 'ready');
  assert.equal(uploadResponse.body.hlsManifestPath, undefined);
  assert.equal(uploadResponse.body.storageProvider, 'r2');

  const streamResponse = await request(app).get(`/api/videos/${uploadResponse.body.id}/stream`);
  assert.equal(streamResponse.status, 302);
  assert.equal(streamResponse.headers.location, 'https://r2.example.com/videos/r2-promo.mp4');
});

test('R2 form upload rejects MP4 content type with non-MP4 filename', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .field('storageTarget', 'r2')
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'clip.webm',
    });

  assert.equal(uploadResponse.status, 400);
  assert.equal(uploadResponse.body.error.code, 'R2_UPLOAD_MP4_ONLY');
});

test('R2 direct multipart upload creates an R2 video record', async () => {
  const { authHeader } = await loginAsAdmin();
  const calls = [];

  __setR2StorageForTests({
    createMultipartUpload: async ({ contentType, objectKey }) => {
      calls.push(['createMultipartUpload', contentType, objectKey]);
      return { objectKey, uploadId: 'r2-upload-1' };
    },
    getStreamUrl: ({ key }) => `https://r2.example.com/${key}`,
    getUploadPartUrl: async ({ objectKey, partNumber, uploadId }) => {
      calls.push(['getUploadPartUrl', objectKey, uploadId, partNumber]);
      return `https://upload.example.com/${partNumber}`;
    },
    completeMultipartUpload: async ({ objectKey, parts, uploadId }) => {
      calls.push(['completeMultipartUpload', objectKey, uploadId, parts]);
      return { key: objectKey };
    },
  });

  const createResponse = await request(app)
    .post('/api/videos/r2/uploads')
    .set(authHeader)
    .send({
      fileKey: 'client-a:r2-large-promo',
      mimeType: 'video/mp4',
      originalName: 'large-promo.mp4',
      totalSizeBytes: 64 * 1024 * 1024,
    });

  assert.equal(createResponse.status, 200);
  assert.equal(createResponse.body.uploadId, 'r2-upload-1');
  assert.equal(createResponse.body.partSizeBytes, 32 * 1024 * 1024);
  assert.equal(createResponse.body.totalParts, 2);
  assert.deepEqual(createResponse.body.uploadedParts, []);

  const presignResponse = await request(app)
    .post(`/api/videos/r2/uploads/${createResponse.body.id}/parts/1/presign`)
    .set(authHeader)
    .send();

  assert.equal(presignResponse.status, 200);
  assert.equal(presignResponse.body.url, 'https://upload.example.com/1');
  assert.equal(presignResponse.body.method, 'PUT');

  const completeResponse = await request(app)
    .post(`/api/videos/r2/uploads/${createResponse.body.id}/complete`)
    .set(authHeader)
    .send({
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
      ],
    });

  assert.equal(completeResponse.status, 200);
  assert.equal(completeResponse.body.originalName, 'large-promo.mp4');
  assert.equal(completeResponse.body.storageProvider, 'r2');
  assert.equal(completeResponse.body.r2ObjectKey, createResponse.body.objectKey);
  assert.equal(completeResponse.body.processingStatus, 'ready');

  const streamResponse = await request(app).get(`/api/videos/${completeResponse.body.id}/stream`);
  assert.equal(streamResponse.status, 302);
  assert.equal(streamResponse.headers.location, `https://r2.example.com/${createResponse.body.objectKey}`);

  assert.equal(calls[0][0], 'createMultipartUpload');
  assert.equal(calls[1][0], 'getUploadPartUrl');
  assert.equal(calls[2][0], 'completeMultipartUpload');
});

test('R2 direct upload rejects non-MP4 and oversized files', async () => {
  const { authHeader } = await loginAsAdmin();

  const nonMp4Response = await request(app)
    .post('/api/videos/r2/uploads')
    .set(authHeader)
    .send({
      fileKey: 'client-a:not-mp4',
      mimeType: 'video/webm',
      originalName: 'clip.webm',
      totalSizeBytes: 1024,
    });

  assert.equal(nonMp4Response.status, 400);
  assert.equal(nonMp4Response.body.error.code, 'R2_UPLOAD_MP4_ONLY');

  const mismatchedExtensionResponse = await request(app)
    .post('/api/videos/r2/uploads')
    .set(authHeader)
    .send({
      fileKey: 'client-a:mismatched-extension',
      mimeType: 'video/mp4',
      originalName: 'clip.webm',
      totalSizeBytes: 1024,
    });

  assert.equal(mismatchedExtensionResponse.status, 400);
  assert.equal(mismatchedExtensionResponse.body.error.code, 'R2_UPLOAD_MP4_ONLY');

  const oversizedResponse = await request(app)
    .post('/api/videos/r2/uploads')
    .set(authHeader)
    .send({
      fileKey: 'client-a:too-large',
      mimeType: 'video/mp4',
      originalName: 'too-large.mp4',
      totalSizeBytes: 513 * 1024 * 1024,
    });

  assert.equal(oversizedResponse.status, 400);
  assert.equal(oversizedResponse.body.error.code, 'UPLOAD_INVALID_SIZE');
});

test('R2 direct upload abort closes unfinished multipart upload', async () => {
  const { authHeader } = await loginAsAdmin();
  const aborted = [];

  __setR2StorageForTests({
    abortMultipartUpload: async (input) => {
      aborted.push(input);
    },
    createMultipartUpload: async ({ objectKey }) => ({ objectKey, uploadId: 'r2-upload-abort' }),
  });

  const createResponse = await request(app)
    .post('/api/videos/r2/uploads')
    .set(authHeader)
    .send({
      fileKey: 'client-a:abort-me',
      mimeType: 'video/mp4',
      originalName: 'abort-me.mp4',
      totalSizeBytes: 1024,
    });

  assert.equal(createResponse.status, 200);

  const abortResponse = await request(app)
    .delete(`/api/videos/r2/uploads/${createResponse.body.id}`)
    .set(authHeader);

  assert.equal(abortResponse.status, 200);
  assert.deepEqual(abortResponse.body, { success: true });
  assert.equal(aborted.length, 1);
  assert.equal(aborted[0].objectKey, createResponse.body.objectKey);
  assert.equal(aborted[0].uploadId, 'r2-upload-abort');
});
```

Add these replacement tests in the same location:

```js
test('form uploads ignore removed R2 storageTarget and save locally', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .field('storageTarget', 'r2')
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'promo.mp4',
    });

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadResponse.body.mediaType, 'video');
  assert.equal(uploadResponse.body.processingStatus, 'ready');
  assert.equal(uploadResponse.body.storageProvider, 'local');
  assert.equal(uploadResponse.body.r2ObjectKey, undefined);

  const streamResponse = await request(app).get(`/api/videos/${uploadResponse.body.id}/stream`);
  assert.equal(streamResponse.status, 200);
  assert.equal(streamResponse.headers['content-type'], 'video/mp4');
});

test('removed R2 direct upload route returns not found', async () => {
  const { authHeader } = await loginAsAdmin();

  const response = await request(app)
    .post('/api/videos/r2/uploads')
    .set(authHeader)
    .send({
      fileKey: 'client-a:removed-r2-route',
      mimeType: 'video/mp4',
      originalName: 'removed.mp4',
      totalSizeBytes: 1024,
    });

  assert.equal(response.status, 404);
});
```

- [ ] **Step 5: Run backend tests and confirm RED**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="R2|storageTarget|policy"`

Expected: FAIL during build or test execution because backend implementation still imports R2 services, still exposes R2 route, or still returns policy with R2 when `R2_ENABLED=true`.

---

### Task 2: Remove Backend R2 Implementation

**Files:**
- Modify: `backend/src/routes/video.routes.ts`
- Modify: `backend/src/services/video.service.ts`
- Modify: `backend/src/services/system.service.ts`
- Modify: `backend/src/config.ts`
- Modify: `backend/src/types.ts`
- Modify: `backend/src/db.ts`
- Delete: `backend/src/services/r2-storage.service.ts`
- Delete: `backend/src/services/r2-upload-session.service.ts`
- Delete: `backend/src/services/r2-stats.service.ts`

**Interfaces:**
- Consumes: tests from Task 1.
- Produces: local-only backend API, local-only video type contract, no R2 service files, no `config.r2`.

- [ ] **Step 1: Make video routes local-only**

In `backend/src/routes/video.routes.ts`, remove R2 imports and `isR2Mp4Upload`, delete all `/r2/uploads` route blocks, and replace the `POST /api/videos` handler body with this local-only implementation:

```ts
    asyncHandler(async (req, res) => {
        if (!req.file) {
            throw new AppError(400, 'UPLOAD_MISSING_FILE', 'No file uploaded.');
        }

        const video = await saveUploadedVideo(req.file);
        res.json(video);
    }),
```

After the edit, the only imports from `../services/video.service` should be:

```ts
import {
    createStoredUploadFilename,
    deleteVideo,
    getVideoById,
    getVideoHlsAssetFile,
    getVideoPolicy,
    getVideoPosterFile,
    getVideoStreamSource,
    listVideos,
    saveUploadedVideo,
    saveUploadedVideoFromFile,
} from '../services/video.service';
```

- [ ] **Step 2: Make video service local-only**

In `backend/src/services/video.service.ts`, remove the R2 import and R2 helper/functions. The top of the file should no longer import `r2-storage.service`.

Use these local-only type and record creation signatures:

```ts
export type UploadStorageTarget = 'local';

const createVideoRecord = async (input: {
    filename: string;
    mimeType: string;
    originalName: string;
    size: number;
}) => {
    const mediaType = inferMediaType(input.mimeType);
    const shouldProcess = config.mediaProcessingEnabled && mediaType === 'video';

    const video = await dbRepository.saveVideo({
        filename: input.filename,
        id: crypto.randomUUID(),
        mediaType,
        mimeType: input.mimeType,
        originalName: input.originalName,
        processingStatus: shouldProcess ? 'pending' : 'ready',
        sourceFilename: input.filename,
        sourceMimeType: input.mimeType,
        sourceSize: input.size,
        size: input.size,
        storageProvider: 'local',
        streamVariant: 'original',
        uploadedAt: new Date().toISOString(),
    });

    if (video.mediaType === 'video') {
        void enqueueVideoProcessing(video.id);
    }

    return video;
};
```

Keep `saveUploadedVideo` as:

```ts
export const saveUploadedVideo = async (file: Express.Multer.File) =>
    createVideoRecord({
        filename: file.filename,
        mimeType: file.mimetype,
        originalName: file.originalname,
        size: file.size,
    });
```

Keep `saveUploadedVideoFromFile` as:

```ts
export const saveUploadedVideoFromFile = async (input: {
    filename: string;
    mimeType: string;
    originalName: string;
    size: number;
}) => createVideoRecord(input);
```

Replace `getVideoPolicy()` with:

```ts
export const getVideoPolicy = () => ({
    allowedMimeTypes: [...VIDEO_MIME_TYPES, ...IMAGE_MIME_TYPES],
    mediaProcessingEnabled: config.mediaProcessingEnabled,
    maxUploadSizeBytes: config.maxUploadSizeBytes,
    resumableChunkSizeBytes: config.resumableChunkSizeBytes,
    storageTargets: ['local'] as const,
});
```

Replace `VideoStreamSource` and `getVideoStreamSource` with:

```ts
export type VideoStreamSource = {
    absolutePath: string;
    kind: 'local';
    video: Video;
};

export const getVideoStreamSource = async (id: string): Promise<VideoStreamSource> => {
    const video = await getVideoById(id);
    const preferredPath = path.join(config.uploadsDir, video.filename);
    const sourcePath = path.join(config.uploadsDir, video.sourceFilename);
    const candidatePaths = preferredPath === sourcePath ? [preferredPath] : [preferredPath, sourcePath];

    for (const candidatePath of candidatePaths) {
        if (await fs.pathExists(candidatePath)) {
            return {
                absolutePath: candidatePath,
                kind: 'local',
                video,
            };
        }
    }

    throw new AppError(404, 'VIDEO_FILE_NOT_FOUND', 'Video file is missing from disk.');
};
```

In `deleteVideo`, remove the R2 deletion branch and make the file path collection start as:

```ts
    const filePaths = new Set<string>();
    filePaths.add(path.join(config.uploadsDir, video.filename));
    filePaths.add(path.join(config.uploadsDir, video.sourceFilename));
```

- [ ] **Step 3: Remove R2 from config**

In `backend/src/config.ts`, delete `R2Config`, remove `r2: R2Config` from `AppConfig`, remove `const r2SignedUrlExpiresSeconds = ...`, remove the validation block for `R2_SIGNED_URL_EXPIRES_SECONDS`, remove the `const r2 = { ... }` object, and remove `r2` from `cachedConfig`.

The `AppConfig` interface should contain:

```ts
export interface AppConfig {
    adminPassword: string;
    adminUsername: string;
    dbFile: string;
    frontendDistDir: string;
    isProduction: boolean;
    jwtSecret: string;
    mediaProcessingEnabled: boolean;
    resumableChunkSizeBytes: number;
    maxUploadSizeBytes: number;
    processedUploadsDir: string;
    port: number;
    uploadSessionsDir: string;
    uploadsDir: string;
}
```

- [ ] **Step 4: Remove R2 from system status**

Replace `backend/src/services/system.service.ts` with this local-only version:

```ts
import os from 'node:os';

interface SystemStatus {
    localIps: string[];
    online: boolean;
    uptime: number;
}

export const getSystemStatus = async (): Promise<SystemStatus> => {
    const nets = os.networkInterfaces();
    const localIps: string[] = [];

    for (const interfaces of Object.values(nets)) {
        for (const network of interfaces || []) {
            if (network.family === 'IPv4' && !network.internal) {
                localIps.push(network.address);
            }
        }
    }

    return {
        localIps,
        online: true,
        uptime: process.uptime(),
    };
};
```

- [ ] **Step 5: Remove R2 types**

In `backend/src/types.ts`, change:

```ts
export type VideoStorageProvider = 'local' | 'r2';
```

to:

```ts
export type VideoStorageProvider = 'local';
```

Remove this field from `Video`:

```ts
    r2ObjectKey?: string;
```

Delete these R2 session types at the bottom of the file:

```ts
export type R2UploadSessionStatus = 'uploading' | 'completed' | 'aborted';

export interface R2UploadedPartManifest {
    etag: string;
    partNumber: number;
}

export interface R2UploadSessionManifest {
    completedParts: R2UploadedPartManifest[];
    createdAt: string;
    fileKey: string;
    id: string;
    mimeType: string;
    objectKey: string;
    originalName: string;
    partSizeBytes: number;
    status: R2UploadSessionStatus;
    totalParts: number;
    totalSizeBytes: number;
    updatedAt: string;
    uploadId: string;
    videoId?: string;
}
```

- [ ] **Step 6: Normalize DB records to local-only**

In `backend/src/db.ts`, replace these lines in `normalizeVideo`:

```ts
        storageProvider: video.storageProvider || 'local',
        r2ObjectKey: video.r2ObjectKey,
```

with:

```ts
        storageProvider: 'local',
```

- [ ] **Step 7: Delete R2 backend service files**

Delete these files:

```text
backend/src/services/r2-storage.service.ts
backend/src/services/r2-upload-session.service.ts
backend/src/services/r2-stats.service.ts
```

- [ ] **Step 8: Run backend focused tests and confirm GREEN**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="R2|storageTarget|policy"`

Expected: PASS.

- [ ] **Step 9: Run backend full tests**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test`

Expected: PASS.

---

### Task 3: Frontend Contract Tests For Local-Only Upload UI

**Files:**
- Modify: `frontend/src/app/features/dashboard/components/video-list/video-list.spec.ts`
- Modify: `frontend/src/app/features/dashboard/admin.spec.ts`
- Delete later in Task 4: `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`

**Interfaces:**
- Consumes: current frontend components and store contract.
- Produces: failing tests requiring local-only upload payloads and no upload target stub.

- [ ] **Step 1: Add local-only upload payload test**

In `frontend/src/app/features/dashboard/components/video-list/video-list.spec.ts`, add this test after the oversized-file test:

```ts
  it('emits selected local files without a storage target', () => {
    const component = new VideoList();
    const emitted: unknown[] = [];
    component.upload.subscribe((payload) => emitted.push(payload));
    const file = new File(['hello'], 'promo.mp4', { type: 'video/mp4' });

    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    component.onFileSelected({ target: input } as unknown as Event);

    expect(emitted).toEqual([{ file }]);
    expect(component.uploadError).toBeNull();
  });
```

- [ ] **Step 2: Add local-only accept/hint test**

In the same spec file, add:

```ts
  it('uses only local supported upload formats', () => {
    const component = new VideoList();

    expect(component.getFileAccept()).toBe('video/mp4,video/webm,video/ogg,video/quicktime,image/jpeg,image/png,image/webp,image/gif');
    expect(component.getUploadHint()).toContain('MP4, WebM, OGG, MOV, JPG, PNG, GIF, WebP');
    expect(component.getUploadHint()).not.toContain('R2');
  });
```

- [ ] **Step 3: Remove uploadTarget from admin test stub**

In `frontend/src/app/features/dashboard/admin.spec.ts`, remove this property from `storeStub`:

```ts
  uploadTarget: signal('local'),
```

- [ ] **Step 4: Run frontend focused tests and confirm RED**

Run: `cd /home/vuhuynh450/projects/adsplay/frontend && npm run test:ci -- --include "src/app/features/dashboard/components/video-list/video-list.spec.ts"`

Expected: FAIL because `UploadMediaPayload` still includes `storageTarget` and `VideoList` still emits it.

---

### Task 4: Remove Frontend R2 API, Store, UI, And Direct Upload Service

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`
- Modify: `frontend/src/app/features/dashboard/dashboard.store.ts`
- Modify: `frontend/src/app/features/dashboard/admin.ts`
- Modify: `frontend/src/app/features/dashboard/admin.html`
- Modify: `frontend/src/app/features/dashboard/components/video-list/video-list.ts`
- Modify: `frontend/src/app/features/dashboard/components/video-list/video-list.html`
- Delete: `frontend/src/app/features/dashboard/r2-direct-upload.service.ts`
- Delete: `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`

**Interfaces:**
- Consumes: backend local-only contract from Task 2 and frontend tests from Task 3.
- Produces: frontend API contract with no R2 types/methods and dashboard upload flow always using `ResumableUploadService`.

- [ ] **Step 1: Simplify frontend API service types and methods**

In `frontend/src/app/services/api.service.ts`:

Remove `r2ObjectKey?: string;` from `Video`.

Change:

```ts
    storageProvider: 'local' | 'r2';
```

to:

```ts
    storageProvider: 'local';
```

Delete the full `R2Stats`, `R2UploadedPart`, `R2UploadSession`, and `R2UploadPartUrl` interfaces.

Change `VideoPolicy` storage targets from:

```ts
    storageTargets?: Array<'local' | 'r2'>;
```

to:

```ts
    storageTargets: ['local'];
```

Replace `uploadVideo` with:

```ts
    uploadVideo(file: File): Observable<HttpEvent<Video>> {
        const formData = new FormData();
        formData.append('video', file);
        return this.http.post<Video>(`${this.apiUrl}/videos`, formData, {
            reportProgress: true,
            observe: 'events'
        });
    }
```

Delete these methods:

```ts
    createR2UploadSession(payload: {
        fileKey: string;
        mimeType: string;
        originalName: string;
        totalSizeBytes: number;
    }): Observable<R2UploadSession> {
        return this.http.post<R2UploadSession>(`${this.apiUrl}/videos/r2/uploads`, payload);
    }

    getR2UploadPartUrl(sessionId: string, partNumber: number): Observable<R2UploadPartUrl> {
        return this.http.post<R2UploadPartUrl>(
            `${this.apiUrl}/videos/r2/uploads/${sessionId}/parts/${partNumber}/presign`,
            {},
        );
    }

    completeR2UploadSession(sessionId: string, parts: R2UploadedPart[]): Observable<Video> {
        return this.http.post<Video>(`${this.apiUrl}/videos/r2/uploads/${sessionId}/complete`, { parts });
    }

    abortR2UploadSession(sessionId: string): Observable<{ success: boolean }> {
        return this.http.delete<{ success: boolean }>(`${this.apiUrl}/videos/r2/uploads/${sessionId}`);
    }
```

Change `getSystemStatus` to:

```ts
    getSystemStatus(): Observable<{ online: boolean; uptime: number; localIps: string[] }> {
        return this.http.get<{ online: boolean; uptime: number; localIps: string[] }>(`${this.apiUrl}/system/status`);
    }
```

- [ ] **Step 2: Simplify dashboard store upload flow**

In `frontend/src/app/features/dashboard/dashboard.store.ts`, remove `R2Stats` from the import list and delete:

```ts
import { R2DirectUploadService } from './r2-direct-upload.service';
```

Remove this injected field:

```ts
  private readonly r2DirectUpload = inject(R2DirectUploadService);
```

Delete this signal:

```ts
  readonly uploadTarget = signal<'local' | 'r2'>('local');
```

Change `systemInfo` to:

```ts
  readonly systemInfo = signal<{ uptime: number; localIps: string[] } | null>(null);
```

In `startSystemPolling()` and `refreshSystemStatus()`, set system info without R2:

```ts
        this.systemInfo.set({ localIps: status.localIps, uptime: status.uptime });
```

Replace `uploadMedia` with:

```ts
  async uploadMedia(file: File) {
    this.isUploading.set(true);
    this.uploadProgress.set(0);
    this.uploadStatusLabel.set('Đang tạo phiên tải lên...');

    try {
      await this.resumableUpload.uploadFile(file, (progressPercent, session) => {
        this.uploadProgress.set(progressPercent);
        this.uploadStatusLabel.set(
          session.uploadedChunkIndexes.length > 0
            ? `Đang tiếp tục tải lên (${session.uploadedChunkIndexes.length}/${session.totalChunks} chunk đã có)`
            : 'Đang tải lên theo từng chunk...',
        );
      });

      const successLabel = file.type.startsWith('image/') ? 'Ảnh' : 'Video';
      this.toastService.show(`${successLabel} đã được tải lên thành công.`, 'success');
      this.refreshAll();
    } catch (error) {
      this.toastService.show(getErrorMessage(error, 'Tải nội dung thất bại.'), 'error');
    } finally {
      this.isUploading.set(false);
      this.uploadProgress.set(0);
      this.uploadStatusLabel.set('Sẵn sàng tải lên');
    }
  }
```

In `loadVideoPolicy()`, keep only:

```ts
        next: (policy) => {
          this.maxUploadSizeBytes.set(policy.maxUploadSizeBytes);
        },
```

Delete `setUploadTarget()` and `uploadR2WithProgress()`.

- [ ] **Step 3: Simplify admin event wiring**

In `frontend/src/app/features/dashboard/admin.ts`, change the import:

```ts
import { UploadMediaPayload, UploadTarget, VideoList } from './components/video-list/video-list';
```

to:

```ts
import { UploadMediaPayload, VideoList } from './components/video-list/video-list';
```

Replace `onUpload` with:

```ts
  onUpload(payload: UploadMediaPayload) {
    this.store.uploadMedia(payload.file);
  }
```

Delete:

```ts
  onUploadTargetChange(target: UploadTarget) {
    this.store.setUploadTarget(target);
  }
```

In `frontend/src/app/features/dashboard/admin.html`, update the `<app-video-list>` binding from:

```html
                    [uploadStatusLabel]="store.uploadStatusLabel()" [selectedUploadTarget]="store.uploadTarget()"
                    (uploadTargetChange)="onUploadTargetChange($event)"
```

to:

```html
                    [uploadStatusLabel]="store.uploadStatusLabel()"
```

Delete the entire R2 Storage Info block from `<!-- R2 Storage Info -->` through the closing `</div>` for that card.

- [ ] **Step 4: Simplify video list component class**

In `frontend/src/app/features/dashboard/components/video-list/video-list.ts`, remove `FormsModule` only if still unused after checking the template; keep it because search/sort still use `ngModel`.

Delete:

```ts
export type UploadTarget = 'local' | 'r2';
```

Change `UploadMediaPayload` to:

```ts
export interface UploadMediaPayload {
  file: File;
}
```

Delete these members:

```ts
  @Input() selectedUploadTarget: UploadTarget = 'local';
  @Output() uploadTargetChange = new EventEmitter<UploadTarget>();
  private readonly R2_ALLOWED_TYPES = ['video/mp4'];
```

In `onFileSelected`, replace the allowed type block with:

```ts
    if (!this.LOCAL_ALLOWED_TYPES.includes(file.type)) {
      this.uploadError = `Định dạng không hỗ trợ (${file.type || 'unknown'}). Chọn MP4, WebM, OGG, MOV, JPG, PNG, GIF hoặc WebP.`;
      input.value = '';
      return;
    }
```

Replace upload emit with:

```ts
    this.upload.emit({ file });
```

Delete `setUploadTarget()`.

Replace `getFileAccept()` with:

```ts
  getFileAccept() {
    return 'video/mp4,video/webm,video/ogg,video/quicktime,image/jpeg,image/png,image/webp,image/gif';
  }
```

Replace `getUploadHint()` with:

```ts
  getUploadHint() {
    return `Local: MP4, WebM, OGG, MOV, JPG, PNG, GIF, WebP. Tối đa ${this.getMaxUploadSizeLabel()}.`;
  }
```

- [ ] **Step 5: Simplify video list template**

In `frontend/src/app/features/dashboard/components/video-list/video-list.html`, delete the upload target switch block from:

```html
  <div class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-black/20">
```

through its closing `</div>` containing `Cloudflare R2 (MP4)`.

Change the upload card label interpolation from:

```html
            {{ isUploading ? uploadStatusLabel : (selectedUploadTarget === 'r2' ? 'Tải Lên Cloudflare R2' : 'Tải Nội Dung Local') }}
```

to:

```html
            {{ isUploading ? uploadStatusLabel : 'Tải Nội Dung Local' }}
```

Delete this badge:

```html
          <span *ngIf="video.storageProvider === 'r2'" class="rounded bg-sky-500/20 px-2 py-1 text-sky-200">R2 MP4</span>
```

- [ ] **Step 6: Delete R2 direct upload service and spec**

Delete:

```text
frontend/src/app/features/dashboard/r2-direct-upload.service.ts
frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts
```

- [ ] **Step 7: Run frontend focused tests and confirm GREEN**

Run: `cd /home/vuhuynh450/projects/adsplay/frontend && npm run test:ci -- --include "src/app/features/dashboard/components/video-list/video-list.spec.ts"`

Expected: PASS.

- [ ] **Step 8: Run frontend build**

Run: `cd /home/vuhuynh450/projects/adsplay/frontend && npm run build`

Expected: PASS.

---

### Task 5: Remove R2 Dependencies, Env Values, And Runtime Session State

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/.env`
- Possibly modify: `backend/.env.example`
- Delete: `backend/uploads/.sessions/r2`

**Interfaces:**
- Consumes: backend code no longer imports AWS SDK from Task 2.
- Produces: dependency tree and runtime config with no R2 credentials/settings.

- [ ] **Step 1: Remove AWS SDK dependencies through npm**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm uninstall @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

Expected: `backend/package.json` no longer contains `@aws-sdk/client-s3` or `@aws-sdk/s3-request-presigner`, and `backend/package-lock.json` is updated by npm.

- [ ] **Step 2: Remove R2 env values**

In `backend/.env`, delete every line whose key starts with `R2_`:

```env
R2_ACCESS_KEY_ID=...
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ENABLED=...
R2_ENDPOINT=...
R2_PUBLIC_BASE_URL=...
R2_SECRET_ACCESS_KEY=...
R2_SIGNED_URL_EXPIRES_SECONDS=...
```

If `backend/.env.example` contains any `R2_` lines, delete those as well.

- [ ] **Step 3: Delete old R2 upload session state**

Delete this directory if it exists:

```text
backend/uploads/.sessions/r2
```

- [ ] **Step 4: Run backend build after dependency cleanup**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm run build`

Expected: PASS. If it fails with missing `@aws-sdk/*`, search and remove the remaining import.

---

### Task 6: Final R2 Source Sweep And Full Verification

**Files:**
- Modify only files with active R2 leftovers found by the searches below.
- Do not modify historical docs except this plan/spec.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified local-only app with no active R2 implementation code.

- [ ] **Step 1: Search for active R2 leftovers**

Run: `cd /home/vuhuynh450/projects/adsplay && rg -i "cloudflare|\br2\b|R2_|@aws-sdk|r2ObjectKey|storageTarget|/videos/r2" backend frontend package.json package-lock.json launch-adplay.cjs start.sh start.bat start.command`

Expected: no matches in active app code/config. Matches inside `docs/superpowers/specs/*` or `docs/superpowers/plans/*` are acceptable and should not be removed.

- [ ] **Step 2: Run backend full test suite**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test`

Expected: PASS.

- [ ] **Step 3: Run frontend full test suite**

Run: `cd /home/vuhuynh450/projects/adsplay/frontend && npm run test:ci`

Expected: PASS.

- [ ] **Step 4: Run backend build**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm run build`

Expected: PASS.

- [ ] **Step 5: Run frontend build**

Run: `cd /home/vuhuynh450/projects/adsplay/frontend && npm run build`

Expected: PASS.

- [ ] **Step 6: Check git diff for intended scope**

Run: `cd /home/vuhuynh450/projects/adsplay && git diff --stat`

Expected: changes are limited to R2 cleanup files, package lock updates, test updates, and the new plan/spec docs.

- [ ] **Step 7: Report residual risk**

Include this in the completion report:

```text
Residual risk: existing backend/db.json records that previously pointed to R2 objects are normalized as local-only and will not play unless their files exist locally under backend/uploads.
```
