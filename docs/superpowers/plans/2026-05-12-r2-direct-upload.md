# R2 Direct Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload large MP4 files directly from the admin dashboard to Cloudflare R2 using multipart presigned URLs, avoiding `/api/videos` large request bodies.

**Architecture:** Backend owns validation, R2 credentials, multipart session manifests, and video record creation. Frontend slices MP4 files into parts, obtains short-lived presigned URLs from the backend, uploads parts directly to R2, then asks the backend to complete the upload and create the app video record. Local/HLS upload remains unchanged.

**Tech Stack:** Node.js/Express 5, TypeScript, AWS SDK v3 S3-compatible Cloudflare R2 APIs, Angular 21, RxJS, Vitest, Node test runner, Supertest.

---

## File Structure

- Modify `backend/src/types.ts`: add R2 direct upload manifest and uploaded-part types.
- Modify `backend/src/services/r2-storage.service.ts`: add multipart R2 operations and test overrides.
- Create `backend/src/services/r2-upload-session.service.ts`: manage R2 upload manifests, resume lookup, uploaded part tracking, completion, abort cleanup.
- Modify `backend/src/services/video.service.ts`: export a record-creation helper for completed R2 objects.
- Modify `backend/src/routes/video.routes.ts`: add R2 direct upload endpoints before `/:id` routes.
- Modify `backend/test/api.test.js`: add backend integration tests for create, presign, complete, reject, and abort paths.
- Modify `frontend/src/app/services/api.service.ts`: add R2 direct upload request/response types and API methods.
- Create `frontend/src/app/features/dashboard/r2-direct-upload.service.ts`: perform browser-to-R2 multipart upload with retry and progress.
- Modify `frontend/src/app/features/dashboard/dashboard.store.ts`: inject and use the R2 direct upload service for R2 target.
- Create `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`: test multipart upload orchestration.
- No `frontend/src/app/features/dashboard/dashboard.store.spec.ts` exists; cover R2 upload orchestration in `r2-direct-upload.service.spec.ts` and verify store wiring with the frontend build.

---

## Task 1: Backend R2 multipart storage operations

**Files:**
- Modify: `backend/src/services/r2-storage.service.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Write failing backend integration test for R2 direct happy path**

Append this test near the existing R2 upload test in `backend/test/api.test.js`:

```js
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
```

- [ ] **Step 2: Run backend tests to verify failure**

Run:

```bash
cd backend && npm test
```

Expected: build or test fails because `/api/videos/r2/uploads` does not exist and R2 storage test overrides do not support multipart methods.

- [ ] **Step 3: Add multipart imports, interfaces, and test overrides**

In `backend/src/services/r2-storage.service.ts`, replace the first import with:

```ts
import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
```

Add these interfaces after `UploadObjectResult`:

```ts
interface CreateMultipartUploadInput {
    contentType: string;
    objectKey: string;
}

interface CreateMultipartUploadResult {
    objectKey: string;
    uploadId: string;
}

interface UploadPartUrlInput {
    objectKey: string;
    partNumber: number;
    uploadId: string;
}

export interface CompletedR2Part {
    etag: string;
    partNumber: number;
}

interface CompleteMultipartUploadInput {
    objectKey: string;
    parts: CompletedR2Part[];
    uploadId: string;
}

interface AbortMultipartUploadInput {
    objectKey: string;
    uploadId: string;
}
```

Extend `R2StorageTestOverrides` to:

```ts
interface R2StorageTestOverrides {
    abortMultipartUpload?: (input: AbortMultipartUploadInput) => Promise<void>;
    completeMultipartUpload?: (input: CompleteMultipartUploadInput) => Promise<UploadObjectResult>;
    createMultipartUpload?: (input: CreateMultipartUploadInput) => Promise<CreateMultipartUploadResult>;
    deleteObject?: (input: DeleteObjectInput) => Promise<void>;
    getStreamUrl?: (input: StreamUrlInput) => string;
    getUploadPartUrl?: (input: UploadPartUrlInput) => Promise<string>;
    uploadObject?: (input: UploadObjectInput) => Promise<UploadObjectResult>;
}
```

- [ ] **Step 4: Implement multipart storage methods**

Add these functions before `getStreamUrl` in `backend/src/services/r2-storage.service.ts`:

```ts
export const createMultipartUpload = async (
    input: CreateMultipartUploadInput,
): Promise<CreateMultipartUploadResult> => {
    if (testOverrides?.createMultipartUpload) {
        return testOverrides.createMultipartUpload(input);
    }

    requireR2Enabled();

    const client = getClient();
    const result = await client.send(
        new CreateMultipartUploadCommand({
            Bucket: config.r2.bucket,
            ContentType: input.contentType,
            Key: input.objectKey,
        }),
    );

    if (!result.UploadId) {
        throw new AppError(502, 'R2_MULTIPART_CREATE_FAILED', 'Cloudflare R2 did not return an upload id.');
    }

    return {
        objectKey: input.objectKey,
        uploadId: result.UploadId,
    };
};

export const getUploadPartUrl = async (input: UploadPartUrlInput) => {
    if (testOverrides?.getUploadPartUrl) {
        return testOverrides.getUploadPartUrl(input);
    }

    requireR2Enabled();

    const client = getClient();
    return getSignedUrl(
        client,
        new UploadPartCommand({
            Bucket: config.r2.bucket,
            Key: input.objectKey,
            PartNumber: input.partNumber,
            UploadId: input.uploadId,
        }),
        { expiresIn: config.r2.signedUrlExpiresSeconds },
    );
};

export const completeMultipartUpload = async (
    input: CompleteMultipartUploadInput,
): Promise<UploadObjectResult> => {
    if (testOverrides?.completeMultipartUpload) {
        return testOverrides.completeMultipartUpload(input);
    }

    requireR2Enabled();

    const client = getClient();
    await client.send(
        new CompleteMultipartUploadCommand({
            Bucket: config.r2.bucket,
            Key: input.objectKey,
            MultipartUpload: {
                Parts: input.parts.map((part) => ({
                    ETag: part.etag,
                    PartNumber: part.partNumber,
                })),
            },
            UploadId: input.uploadId,
        }),
    );

    return { key: input.objectKey };
};

export const abortMultipartUpload = async (input: AbortMultipartUploadInput) => {
    if (testOverrides?.abortMultipartUpload) {
        await testOverrides.abortMultipartUpload(input);
        return;
    }

    requireR2Enabled();

    const client = getClient();
    await client.send(
        new AbortMultipartUploadCommand({
            Bucket: config.r2.bucket,
            Key: input.objectKey,
            UploadId: input.uploadId,
        }),
    );
};
```

- [ ] **Step 5: Run backend build**

Run:

```bash
cd backend && npm run build
```

Expected: build still fails until route/session code is added, or passes if only storage changes compile. Fix only TypeScript import/signature errors in `r2-storage.service.ts` before continuing.

---

## Task 2: Backend R2 upload session manifest service

**Files:**
- Modify: `backend/src/types.ts`
- Create: `backend/src/services/r2-upload-session.service.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Add R2 upload manifest types**

In `backend/src/types.ts`, add after `UploadSessionManifest`:

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

- [ ] **Step 2: Create R2 upload session service**

Create `backend/src/services/r2-upload-session.service.ts` with:

```ts
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { getConfig } from '../config';
import { AppError } from '../errors';
import type { R2UploadedPartManifest, R2UploadSessionManifest } from '../types';
import {
    abortMultipartUpload,
    completeMultipartUpload,
    createMultipartUpload,
    getUploadPartUrl,
} from './r2-storage.service';
import { createR2VideoRecord } from './video.service';

const config = getConfig();
const R2_PART_SIZE_BYTES = 32 * 1024 * 1024;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getSessionsRoot = () => path.join(config.uploadSessionsDir, 'r2');
const getSessionDir = (sessionId: string) => {
    if (!sessionIdPattern.test(sessionId)) {
        throw new AppError(400, 'R2_UPLOAD_SESSION_INVALID', 'R2 upload session id is invalid.');
    }
    return path.join(getSessionsRoot(), sessionId);
};
const getManifestPath = (sessionId: string) => path.join(getSessionDir(sessionId), 'manifest.json');

const writeManifest = async (manifest: R2UploadSessionManifest) => {
    await fs.ensureDir(getSessionDir(manifest.id));
    await fs.writeJson(getManifestPath(manifest.id), manifest, { spaces: 2 });
};

const readManifest = async (sessionId: string): Promise<R2UploadSessionManifest | null> => {
    const manifestPath = getManifestPath(sessionId);
    if (!(await fs.pathExists(manifestPath))) {
        return null;
    }

    try {
        return await fs.readJson(manifestPath);
    } catch {
        return null;
    }
};

const createR2ObjectKey = (originalName: string) => {
    const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
    return `videos/r2/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
};

const matchesInput = (
    manifest: R2UploadSessionManifest,
    input: { fileKey: string; mimeType: string; originalName: string; totalSizeBytes: number },
) =>
    manifest.status === 'uploading' &&
    manifest.fileKey === input.fileKey &&
    manifest.mimeType === input.mimeType &&
    manifest.originalName === input.originalName &&
    manifest.totalSizeBytes === input.totalSizeBytes;

const findExistingSession = async (input: {
    fileKey: string;
    mimeType: string;
    originalName: string;
    totalSizeBytes: number;
}) => {
    await fs.ensureDir(getSessionsRoot());
    const sessionIds = await fs.readdir(getSessionsRoot());

    let latest: R2UploadSessionManifest | null = null;
    for (const sessionId of sessionIds) {
        if (!sessionIdPattern.test(sessionId)) {
            continue;
        }

        const manifest = await readManifest(sessionId);
        if (!manifest || !matchesInput(manifest, input)) {
            continue;
        }

        if (!latest || new Date(manifest.updatedAt).getTime() > new Date(latest.updatedAt).getTime()) {
            latest = manifest;
        }
    }

    return latest;
};

const toResponse = (manifest: R2UploadSessionManifest) => ({
    id: manifest.id,
    objectKey: manifest.objectKey,
    partSizeBytes: manifest.partSizeBytes,
    totalParts: manifest.totalParts,
    uploadId: manifest.uploadId,
    uploadedParts: manifest.completedParts,
});

export const createOrResumeR2UploadSession = async (input: {
    fileKey: string;
    mimeType: string;
    originalName: string;
    totalSizeBytes: number;
}) => {
    const existing = await findExistingSession(input);
    if (existing) {
        return toResponse(existing);
    }

    const objectKey = createR2ObjectKey(input.originalName);
    const multipart = await createMultipartUpload({
        contentType: input.mimeType,
        objectKey,
    });
    const now = new Date().toISOString();
    const manifest: R2UploadSessionManifest = {
        completedParts: [],
        createdAt: now,
        fileKey: input.fileKey,
        id: crypto.randomUUID(),
        mimeType: input.mimeType,
        objectKey: multipart.objectKey,
        originalName: input.originalName,
        partSizeBytes: R2_PART_SIZE_BYTES,
        status: 'uploading',
        totalParts: Math.max(1, Math.ceil(input.totalSizeBytes / R2_PART_SIZE_BYTES)),
        totalSizeBytes: input.totalSizeBytes,
        updatedAt: now,
        uploadId: multipart.uploadId,
    };

    await writeManifest(manifest);
    return toResponse(manifest);
};

export const getR2UploadSession = async (sessionId: string) => {
    const manifest = await readManifest(sessionId);
    if (!manifest) {
        throw new AppError(404, 'R2_UPLOAD_SESSION_NOT_FOUND', 'R2 upload session not found.');
    }
    return manifest;
};

export const getR2UploadPartPresignedUrl = async (sessionId: string, partNumber: number) => {
    const manifest = await getR2UploadSession(sessionId);
    if (manifest.status !== 'uploading') {
        throw new AppError(409, 'R2_UPLOAD_SESSION_CLOSED', 'R2 upload session is closed.');
    }
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > manifest.totalParts) {
        throw new AppError(400, 'R2_UPLOAD_PART_OUT_OF_RANGE', 'R2 upload part number is out of range.');
    }

    return {
        expiresInSeconds: config.r2.signedUrlExpiresSeconds,
        method: 'PUT' as const,
        url: await getUploadPartUrl({
            objectKey: manifest.objectKey,
            partNumber,
            uploadId: manifest.uploadId,
        }),
    };
};

const normalizeParts = (parts: R2UploadedPartManifest[], totalParts: number) => {
    const unique = new Map<number, string>();
    for (const part of parts) {
        if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > totalParts) {
            throw new AppError(400, 'R2_UPLOAD_PART_OUT_OF_RANGE', 'R2 upload part number is out of range.');
        }
        if (typeof part.etag !== 'string' || part.etag.trim() === '') {
            throw new AppError(400, 'R2_UPLOAD_PART_ETAG_INVALID', 'R2 upload part ETag is invalid.');
        }
        unique.set(part.partNumber, part.etag.trim());
    }

    const normalized = [...unique.entries()]
        .map(([partNumber, etag]) => ({ etag, partNumber }))
        .sort((left, right) => left.partNumber - right.partNumber);

    if (normalized.length !== totalParts || normalized.some((part, index) => part.partNumber !== index + 1)) {
        throw new AppError(409, 'R2_UPLOAD_INCOMPLETE', 'R2 upload is missing parts.');
    }

    return normalized;
};

export const completeR2UploadSession = async (sessionId: string, parts: R2UploadedPartManifest[]) => {
    const manifest = await getR2UploadSession(sessionId);
    if (manifest.status === 'completed' && manifest.videoId) {
        return createR2VideoRecord({
            mimeType: manifest.mimeType,
            objectKey: manifest.objectKey,
            originalName: manifest.originalName,
            size: manifest.totalSizeBytes,
        });
    }
    if (manifest.status !== 'uploading') {
        throw new AppError(409, 'R2_UPLOAD_SESSION_CLOSED', 'R2 upload session is closed.');
    }

    const normalizedParts = normalizeParts(parts, manifest.totalParts);
    manifest.completedParts = normalizedParts;
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(manifest);

    const uploaded = await completeMultipartUpload({
        objectKey: manifest.objectKey,
        parts: normalizedParts,
        uploadId: manifest.uploadId,
    });

    const video = await createR2VideoRecord({
        mimeType: manifest.mimeType,
        objectKey: uploaded.key,
        originalName: manifest.originalName,
        size: manifest.totalSizeBytes,
    });

    manifest.status = 'completed';
    manifest.videoId = video.id;
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(manifest);
    return video;
};

export const abortR2UploadSession = async (sessionId: string) => {
    const manifest = await getR2UploadSession(sessionId);
    if (manifest.status === 'uploading') {
        await abortMultipartUpload({
            objectKey: manifest.objectKey,
            uploadId: manifest.uploadId,
        });
    }

    manifest.status = 'aborted';
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(manifest);
    await fs.remove(getSessionDir(sessionId));
};
```

- [ ] **Step 3: Fix completed-session idempotency in service before use**

In the same file, replace the `if (manifest.status === 'completed' && manifest.videoId)` block inside `completeR2UploadSession` with:

```ts
    if (manifest.status === 'completed' && manifest.videoId) {
        const { getVideoById } = await import('./video.service');
        return getVideoById(manifest.videoId);
    }
```

This avoids creating duplicate video records when completion is retried.

- [ ] **Step 4: Run backend build to expose missing video helper**

Run:

```bash
cd backend && npm run build
```

Expected: FAIL because `createR2VideoRecord` is not exported from `video.service.ts`. Continue to Task 3.

---

## Task 3: Backend video helper and R2 direct routes

**Files:**
- Modify: `backend/src/services/video.service.ts`
- Modify: `backend/src/routes/video.routes.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Add R2 video record helper**

In `backend/src/services/video.service.ts`, add after `saveUploadedVideoToR2`:

```ts
export const createR2VideoRecord = async (input: {
    mimeType: string;
    objectKey: string;
    originalName: string;
    size: number;
}) =>
    createVideoRecord({
        filename: input.objectKey,
        mimeType: input.mimeType,
        originalName: input.originalName,
        r2ObjectKey: input.objectKey,
        size: input.size,
        storageProvider: 'r2',
    });
```

- [ ] **Step 2: Add route imports**

In `backend/src/routes/video.routes.ts`, extend the upload-session service import block by adding:

```ts
} from '../services/upload-session.service';
import {
    abortR2UploadSession,
    completeR2UploadSession,
    createOrResumeR2UploadSession,
    getR2UploadPartPresignedUrl,
} from '../services/r2-upload-session.service';
```

Ensure the final imports are syntactically valid and do not nest one import inside another.

- [ ] **Step 3: Add direct R2 route handlers before `/:id/stream`**

In `backend/src/routes/video.routes.ts`, insert this block before the first `videoRouter.get('/:id/stream', ...)` route:

```ts
videoRouter.post(
    '/r2/uploads',
    authenticateToken,
    requirePageAccess('videos'),
    asyncHandler(async (req, res) => {
        const originalName = requireNonEmptyString(req.body?.originalName, 'originalName', 255);
        const mimeType = requireNonEmptyString(req.body?.mimeType, 'mimeType', 255);
        const fileKey = requireNonEmptyString(req.body?.fileKey, 'fileKey', 255);
        const totalSizeBytes = Number(req.body?.totalSizeBytes);

        if (!Number.isFinite(totalSizeBytes) || totalSizeBytes <= 0 || totalSizeBytes > MAX_FILE_SIZE) {
            throw new AppError(400, 'UPLOAD_INVALID_SIZE', 'Upload size is invalid.');
        }

        if (mimeType !== 'video/mp4') {
            throw new AppError(400, 'R2_UPLOAD_MP4_ONLY', 'R2 upload currently supports MP4 videos only.');
        }

        res.json(
            await createOrResumeR2UploadSession({
                fileKey,
                mimeType,
                originalName,
                totalSizeBytes,
            }),
        );
    }),
);

videoRouter.post(
    '/r2/uploads/:id/parts/:partNumber/presign',
    authenticateToken,
    requirePageAccess('videos'),
    asyncHandler(async (req, res) => {
        res.json(
            await getR2UploadPartPresignedUrl(
                requireNonEmptyString(req.params.id, 'id'),
                Number.parseInt(requireNonEmptyString(req.params.partNumber, 'partNumber'), 10),
            ),
        );
    }),
);

videoRouter.post(
    '/r2/uploads/:id/complete',
    authenticateToken,
    requirePageAccess('videos'),
    asyncHandler(async (req, res) => {
        const parts = Array.isArray(req.body?.parts) ? req.body.parts : [];
        res.json(await completeR2UploadSession(requireNonEmptyString(req.params.id, 'id'), parts));
    }),
);

videoRouter.delete(
    '/r2/uploads/:id',
    authenticateToken,
    requirePageAccess('videos'),
    asyncHandler(async (req, res) => {
        await abortR2UploadSession(requireNonEmptyString(req.params.id, 'id'));
        res.json({ success: true });
    }),
);
```

- [ ] **Step 4: Run backend test for happy path**

Run:

```bash
cd backend && npm test
```

Expected: PASS for the new happy-path test after Tasks 1-3 are complete.

- [ ] **Step 5: Add reject and abort tests**

Append these tests to `backend/test/api.test.js`:

```js
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

- [ ] **Step 6: Run backend tests**

Run:

```bash
cd backend && npm test
```

Expected: PASS for backend tests.

---

## Task 4: Frontend API methods for R2 direct upload

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`
- Test: frontend build in later task

- [ ] **Step 1: Add R2 direct upload interfaces**

In `frontend/src/app/services/api.service.ts`, add after the existing `UploadSession` interface:

```ts
export interface R2UploadedPart {
    etag: string;
    partNumber: number;
}

export interface R2UploadSession {
    id: string;
    objectKey: string;
    partSizeBytes: number;
    totalParts: number;
    uploadId: string;
    uploadedParts: R2UploadedPart[];
}

export interface R2UploadPartUrl {
    expiresInSeconds: number;
    method: 'PUT';
    url: string;
}
```

If `UploadSession` is not near the top, place these interfaces with the other exported API types.

- [ ] **Step 2: Add ApiService methods**

In `ApiService`, add after `cancelUploadSession`:

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

- [ ] **Step 3: Run frontend build to verify API typings**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS. If it fails, fix TypeScript issues in `api.service.ts` before continuing.

---

## Task 5: Frontend R2 direct upload service

**Files:**
- Create: `frontend/src/app/features/dashboard/r2-direct-upload.service.ts`
- Create: `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`

- [ ] **Step 1: Write failing service spec**

Create `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService, R2UploadSession, Video } from '../../services/api.service';
import { R2DirectUploadService } from './r2-direct-upload.service';

const video: Video = {
  createdAt: '2026-05-12T00:00:00.000Z',
  filename: 'videos/r2/demo.mp4',
  id: 'video-1',
  mediaType: 'video',
  mimeType: 'video/mp4',
  originalName: 'demo.mp4',
  processingStatus: 'ready',
  r2ObjectKey: 'videos/r2/demo.mp4',
  sourceFilename: 'videos/r2/demo.mp4',
  sourceMimeType: 'video/mp4',
  sourceSize: 6,
  size: 6,
  storageProvider: 'r2',
  streamVariant: 'original',
  updatedAt: '2026-05-12T00:00:00.000Z',
  uploadedAt: '2026-05-12T00:00:00.000Z',
};

describe('R2DirectUploadService', () => {
  let api: {
    abortR2UploadSession: ReturnType<typeof vi.fn>;
    completeR2UploadSession: ReturnType<typeof vi.fn>;
    createR2UploadSession: ReturnType<typeof vi.fn>;
    getR2UploadPartUrl: ReturnType<typeof vi.fn>;
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const session: R2UploadSession = {
      id: 'session-1',
      objectKey: 'videos/r2/demo.mp4',
      partSizeBytes: 3,
      totalParts: 2,
      uploadId: 'upload-1',
      uploadedParts: [],
    };

    api = {
      abortR2UploadSession: vi.fn(() => of({ success: true })),
      completeR2UploadSession: vi.fn(() => of(video)),
      createR2UploadSession: vi.fn(() => of(session)),
      getR2UploadPartUrl: vi.fn((_: string, partNumber: number) =>
        of({ expiresInSeconds: 900, method: 'PUT' as const, url: `https://upload.example.com/${partNumber}` }),
      ),
    };

    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('PUT');
      return new Response(null, {
        headers: { ETag: '"etag"' },
        status: 200,
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    TestBed.configureTestingModule({
      providers: [
        R2DirectUploadService,
        { provide: ApiService, useValue: api },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads each part directly to R2 and completes the backend session', async () => {
    const service = TestBed.inject(R2DirectUploadService);
    const progress: number[] = [];
    const file = new File(['abcdef'], 'demo.mp4', { type: 'video/mp4', lastModified: 1 });

    const result = await service.uploadFile(file, (percent) => progress.push(percent));

    expect(result).toEqual(video);
    expect(api.createR2UploadSession).toHaveBeenCalledWith({
      fileKey: expect.any(String),
      mimeType: 'video/mp4',
      originalName: 'demo.mp4',
      totalSizeBytes: 6,
    });
    expect(api.getR2UploadPartUrl).toHaveBeenCalledWith('session-1', 1);
    expect(api.getR2UploadPartUrl).toHaveBeenCalledWith('session-1', 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.completeR2UploadSession).toHaveBeenCalledWith('session-1', [
      { partNumber: 1, etag: '"etag"' },
      { partNumber: 2, etag: '"etag"' },
    ]);
    expect(progress).toEqual([0, 50, 100]);
  });
});
```

- [ ] **Step 2: Run frontend test to verify failure**

Run:

```bash
cd frontend && npm run test:ci -- r2-direct-upload.service.spec.ts
```

Expected: FAIL because `r2-direct-upload.service.ts` does not exist.

- [ ] **Step 3: Implement R2 direct upload service**

Create `frontend/src/app/features/dashboard/r2-direct-upload.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService, R2UploadedPart, R2UploadSession, Video } from '../../services/api.service';
import { buildUploadFileKey } from './resumable-upload.service';

const MAX_PART_UPLOAD_ATTEMPTS = 3;

@Injectable({
  providedIn: 'root',
})
export class R2DirectUploadService {
  private readonly api = inject(ApiService);

  async uploadFile(file: File, onProgress: (progressPercent: number, session: R2UploadSession) => void): Promise<Video> {
    const session = await firstValueFrom(
      this.api.createR2UploadSession({
        fileKey: buildUploadFileKey(file),
        mimeType: file.type,
        originalName: file.name,
        totalSizeBytes: file.size,
      }),
    );

    const completedParts = new Map(session.uploadedParts.map((part) => [part.partNumber, part.etag]));
    let uploadedBytes = this.getUploadedBytes(file, session, completedParts);
    onProgress(Math.round((uploadedBytes / file.size) * 100), session);

    try {
      for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
        if (completedParts.has(partNumber)) {
          continue;
        }

        const part = await this.uploadPartWithRetry(file, session, partNumber);
        completedParts.set(part.partNumber, part.etag);
        session.uploadedParts = [...completedParts.entries()]
          .map(([completedPartNumber, etag]) => ({ etag, partNumber: completedPartNumber }))
          .sort((left, right) => left.partNumber - right.partNumber);

        uploadedBytes += this.getPartSize(file, session, partNumber);
        onProgress(Math.round((uploadedBytes / file.size) * 100), session);
      }

      return await firstValueFrom(this.api.completeR2UploadSession(session.id, session.uploadedParts));
    } catch (error) {
      try {
        await firstValueFrom(this.api.abortR2UploadSession(session.id));
      } catch {
        // Keep the original upload error for the UI.
      }
      throw error;
    }
  }

  private async uploadPartWithRetry(file: File, session: R2UploadSession, partNumber: number): Promise<R2UploadedPart> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PART_UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        return await this.uploadPart(file, session, partNumber);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  private async uploadPart(file: File, session: R2UploadSession, partNumber: number): Promise<R2UploadedPart> {
    const presigned = await firstValueFrom(this.api.getR2UploadPartUrl(session.id, partNumber));
    const start = (partNumber - 1) * session.partSizeBytes;
    const end = Math.min(start + session.partSizeBytes, file.size);
    const response = await fetch(presigned.url, {
      body: file.slice(start, end),
      method: presigned.method,
    });

    if (!response.ok) {
      throw new Error(`R2 part upload failed with status ${response.status}`);
    }

    const etag = response.headers.get('ETag') || response.headers.get('etag');
    if (!etag) {
      throw new Error('R2 part upload response did not include an ETag.');
    }

    return { etag, partNumber };
  }

  private getUploadedBytes(file: File, session: R2UploadSession, completedParts: Map<number, string>) {
    let uploadedBytes = 0;
    for (const partNumber of completedParts.keys()) {
      uploadedBytes += this.getPartSize(file, session, partNumber);
    }
    return uploadedBytes;
  }

  private getPartSize(file: File, session: R2UploadSession, partNumber: number) {
    const start = (partNumber - 1) * session.partSizeBytes;
    const end = Math.min(start + session.partSizeBytes, file.size);
    return end - start;
  }
}
```

- [ ] **Step 4: Run service spec**

Run:

```bash
cd frontend && npm run test:ci -- r2-direct-upload.service.spec.ts
```

Expected: PASS.

---

## Task 6: Wire frontend store to R2 direct upload

**Files:**
- Modify: `frontend/src/app/features/dashboard/dashboard.store.ts`
- Test: `frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts`, frontend build

- [ ] **Step 1: Update dashboard store imports**

In `frontend/src/app/features/dashboard/dashboard.store.ts`, remove:

```ts
import { HttpEventType } from '@angular/common/http';
```

Add:

```ts
import { R2DirectUploadService } from './r2-direct-upload.service';
```

- [ ] **Step 2: Inject direct upload service**

Add a field beside `resumableUpload`:

```ts
  private readonly r2DirectUpload = inject(R2DirectUploadService);
```

- [ ] **Step 3: Replace R2 upload implementation**

Replace the entire `private uploadR2WithProgress(file: File) { ... }` method with:

```ts
  private async uploadR2WithProgress(file: File) {
    await this.r2DirectUpload.uploadFile(file, (progressPercent, session) => {
      this.uploadProgress.set(progressPercent);
      this.uploadStatusLabel.set(
        session.uploadedParts.length > 0
          ? `Đang tải lên Cloudflare R2 (${session.uploadedParts.length}/${session.totalParts} part đã xong)`
          : 'Đang chuẩn bị upload Cloudflare R2...',
      );
    });

    this.uploadProgress.set(100);
    this.uploadStatusLabel.set('Đang hoàn tất upload...');
  }
```

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd frontend && npm run test:ci
```

Expected: PASS.

---

## Task 7: Final verification and cleanup

**Files:**
- Verify: `backend/src/services/r2-storage.service.ts`
- Verify: `backend/src/services/r2-upload-session.service.ts`
- Verify: `backend/src/routes/video.routes.ts`
- Verify: `frontend/src/app/features/dashboard/r2-direct-upload.service.ts`
- Verify: `frontend/src/app/features/dashboard/dashboard.store.ts`

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd backend && npm test
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run frontend test suite**

Run:

```bash
cd frontend && npm run test:ci
```

Expected: PASS.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git diff -- backend/src/types.ts backend/src/services/r2-storage.service.ts backend/src/services/r2-upload-session.service.ts backend/src/services/video.service.ts backend/src/routes/video.routes.ts backend/test/api.test.js frontend/src/app/services/api.service.ts frontend/src/app/features/dashboard/r2-direct-upload.service.ts frontend/src/app/features/dashboard/r2-direct-upload.service.spec.ts frontend/src/app/features/dashboard/dashboard.store.ts
```

Expected: diff only contains direct R2 upload implementation and tests. No unrelated formatting or behavior changes.

- [ ] **Step 5: Manual production configuration check**

Before testing with a real browser upload, confirm deployment has:

```env
R2_ENABLED=true
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=<bucket-name>
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<secret>
MAX_UPLOAD_SIZE_MB=4096
R2_SIGNED_URL_EXPIRES_SECONDS=900
```

Expected: frontend R2 upload no longer sends the MP4 body to `https://play.ktbeauty.com.vn/api/videos`; it sends small JSON requests to `/api/videos/r2/uploads...` and large `PUT` requests directly to `*.r2.cloudflarestorage.com`.
