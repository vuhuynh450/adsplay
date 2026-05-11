# Security Priority Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the prioritized security and API contract issues found in review using TDD.

**Architecture:** Keep changes minimal and local: route tests in `backend/test/api.test.js`, backend fixes in auth/page-access/video/upload-session services, and frontend contract alignment in `ApiService`. Authorization remains route-level middleware chained after authentication.

**Tech Stack:** Express 5, TypeScript, jsonwebtoken, bcryptjs, Node test runner, Supertest, Angular 21 HttpClient.

---

## File Structure

- Modify: `backend/test/api.test.js` — add RED regression tests for auth contract, unknown DB user tokens, video page permissions, missing user page access, and invalid upload session IDs.
- Modify: `backend/src/services/auth.service.ts` — make `changePasswordFirstLogin` return the updated auth user and add token expirations for device/profile tokens.
- Modify: `backend/src/routes/auth.routes.ts` — return `{ token, user }` after first-login password change.
- Modify: `backend/src/middleware/auth.ts` — reject admin tokens whose user no longer exists, except configured default admin.
- Modify: `backend/src/middleware/page-access.ts` — return `AUTH_REQUIRED` when protected middleware is invoked without `req.user`.
- Modify: `backend/src/routes/video.routes.ts` — add `requirePageAccess('videos')` to upload/delete and ensure upload-session routes are protected.
- Modify: `backend/src/services/upload-session.service.ts` — validate `sessionId` as UUID before joining paths.
- Modify: `backend/src/services/employee.service.ts` — replace sync bcrypt hashing with async hashing in employee update.
- Modify: `frontend/src/app/services/api.service.ts` — keep `changePasswordFirstLogin` typing aligned with backend `{ token, user }` response.

## Task 1: First-login password change contract

**Files:**
- Modify: `backend/test/api.test.js:155-190`
- Modify: `backend/src/services/auth.service.ts:125-141`
- Modify: `backend/src/routes/auth.routes.ts:19-32`
- Verify: `frontend/src/app/services/api.service.ts:365-369`

- [ ] **Step 1: Strengthen failing test**

```js
assert.equal(changePasswordResponse.status, 200);
assert.ok(changePasswordResponse.body.token);
assert.equal(changePasswordResponse.body.user.username, 'staff_first_login');
assert.equal(changePasswordResponse.body.user.mustChangePassword, false);
assert.deepEqual(changePasswordResponse.body.user.allowedPages, ['videos']);
```

- [ ] **Step 2: Run RED**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="first login password change"`
Expected: FAIL because response lacks `token` and `user`.

- [ ] **Step 3: Implement service return value and route token**

```ts
export const changePasswordFirstLogin = async (userId: string, newPassword: string) => {
    const user = await dbRepository.findUserByUsername(userId);
    if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    if (!user.mustChangePassword) {
        throw new AppError(400, 'PASSWORD_CHANGE_NOT_REQUIRED', 'Password change is not required.');
    }
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    const updated = await dbRepository.updateUser(user.id, (draft) => {
        draft.passwordHash = newPasswordHash;
        draft.mustChangePassword = false;
    });
    if (!updated) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    return login(updated.username, newPassword);
};
```

Route:

```ts
const result = await changePasswordFirstLogin(req.user.username, newPassword);
res.json(result);
```

- [ ] **Step 4: Run GREEN**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="first login password change"`
Expected: PASS.

## Task 2: Reject tokens for deleted DB users

**Files:**
- Modify: `backend/test/api.test.js`
- Modify: `backend/src/middleware/auth.ts:33-56`

- [ ] **Step 1: Add failing test**

```js
test('token for deleted staff user is rejected', async () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('staff-deleted-123', 10);

  const user = await dbRepository.createUser({
    username: 'staff_deleted_token',
    passwordHash,
    role: 'staff',
    isActive: true,
    mustChangePassword: false,
    allowedPages: ['system'],
  });

  const loginResponse = await request(app).post('/api/auth/login').send({
    username: 'staff_deleted_token',
    password: 'staff-deleted-123',
  });
  assert.equal(loginResponse.status, 200);

  await dbRepository.deleteUsers([user.id]);

  const response = await request(app)
    .get('/api/system/status')
    .set('Authorization', `Bearer ${loginResponse.body.token}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});
```

- [ ] **Step 2: Run RED**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="deleted staff user"`
Expected: FAIL because fallback grants access.

- [ ] **Step 3: Implement minimal fix**

```ts
if (!dbUser) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.');
}
```

Keep a default-admin exception only for `payload.userId === 'default-admin' && payload.username === config.adminUsername && payload.role === 'admin'`.

- [ ] **Step 4: Run GREEN**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="deleted staff user"`
Expected: PASS.

## Task 3: Enforce videos page permission on upload/delete

**Files:**
- Modify: `backend/test/api.test.js`
- Modify: `backend/src/routes/video.routes.ts:275-324`

- [ ] **Step 1: Add failing tests**

```js
test('staff without videos permission cannot upload or delete videos', async () => {
  const bcrypt = require('bcryptjs');
  const { authHeader } = await loginAsAdmin();
  const passwordHash = await bcrypt.hash('staff-no-videos-123', 10);

  await dbRepository.createUser({
    username: 'staff_no_videos_write',
    passwordHash,
    role: 'staff',
    isActive: true,
    mustChangePassword: false,
    allowedPages: ['profiles'],
  });

  const staffLogin = await request(app).post('/api/auth/login').send({
    username: 'staff_no_videos_write',
    password: 'staff-no-videos-123',
  });
  assert.equal(staffLogin.status, 200);

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set('Authorization', `Bearer ${staffLogin.body.token}`)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'forbidden.mp4',
    });
  assert.equal(uploadResponse.status, 403);
  assert.equal(uploadResponse.body.error.code, 'PAGE_FORBIDDEN');

  const adminUpload = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'admin-video.mp4',
    });
  assert.equal(adminUpload.status, 200);

  const deleteResponse = await request(app)
    .delete(`/api/videos/${adminUpload.body.id}`)
    .set('Authorization', `Bearer ${staffLogin.body.token}`);
  assert.equal(deleteResponse.status, 403);
  assert.equal(deleteResponse.body.error.code, 'PAGE_FORBIDDEN');
});
```

- [ ] **Step 2: Run RED**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="without videos permission"`
Expected: FAIL because upload/delete are allowed after auth.

- [ ] **Step 3: Add middleware after auth**

```ts
videoRouter.post('/', authenticateToken, requirePageAccess('videos'), ...);
videoRouter.delete('/:id', authenticateToken, requirePageAccess('videos'), ...);
```

- [ ] **Step 4: Run GREEN**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="without videos permission"`
Expected: PASS.

## Task 4: Missing user in requirePageAccess is AUTH_REQUIRED

**Files:**
- Modify: `backend/test/api.test.js`
- Modify: `backend/src/middleware/page-access.ts:6-14`

- [ ] **Step 1: Add failing test**

```js
test('upload session route without token returns AUTH_REQUIRED instead of passing page access', async () => {
  const response = await request(app).post('/api/videos/uploads/sessions').send({
    fileKey: 'missing-token',
    mimeType: 'video/mp4',
    originalName: 'missing-token.mp4',
    totalSizeBytes: 1024,
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});
```

- [ ] **Step 2: Run RED or confirm existing behavior**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="without token returns AUTH_REQUIRED"`
Expected: PASS if authenticateToken already catches it; unit behavior still needs code fix for defense-in-depth.

- [ ] **Step 3: Implement defense-in-depth**

```ts
if (!req.user) {
    return next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
}
```

- [ ] **Step 4: Run related auth tests**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="staff without profiles|auth and system|without token returns AUTH_REQUIRED"`
Expected: PASS.

## Task 5: Validate upload session IDs

**Files:**
- Modify: `backend/test/api.test.js`
- Modify: `backend/src/services/upload-session.service.ts:10-14`

- [ ] **Step 1: Add failing test**

```js
test('upload session routes reject path traversal session ids', async () => {
  const { authHeader } = await loginAsAdmin();

  const response = await request(app)
    .get('/api/videos/uploads/sessions/..%2fdb.json')
    .set(authHeader);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'UPLOAD_SESSION_INVALID');
});
```

- [ ] **Step 2: Run RED**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="path traversal session ids"`
Expected: FAIL with 404 or unexpected behavior.

- [ ] **Step 3: Implement UUID validation before path join**

```ts
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertValidSessionId = (sessionId: string) => {
    if (!sessionIdPattern.test(sessionId)) {
        throw new AppError(400, 'UPLOAD_SESSION_INVALID', 'Upload session id is invalid.');
    }
};

const getSessionDir = (sessionId: string) => {
    assertValidSessionId(sessionId);
    return path.join(config.uploadSessionsDir, sessionId);
};
```

- [ ] **Step 4: Run GREEN**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test -- --test-name-pattern="path traversal session ids"`
Expected: PASS.

## Task 6: Opportunistic medium fixes covered by priority work

**Files:**
- Modify: `backend/src/services/auth.service.ts:143-170`
- Modify: `backend/src/services/employee.service.ts:146-153`

- [ ] **Step 1: Add token expiry during auth service edit**

```ts
jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' })
```

Use for profile heartbeat and device tokens. `jwt.verify` rejects expired tokens automatically.

- [ ] **Step 2: Replace sync hash**

```ts
const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
```

Then assign `draft.passwordHash = passwordHash` inside `updateUser`.

- [ ] **Step 3: Run full backend test**

Run: `cd /home/vuhuynh450/projects/adsplay/backend && npm test`
Expected: PASS.

## Final Verification

- [ ] Run backend full suite: `cd /home/vuhuynh450/projects/adsplay/backend && npm test`
- [ ] Run frontend CI tests if frontend files changed: `cd /home/vuhuynh450/projects/adsplay/frontend && npm run test:ci`
- [ ] Inspect git diff: `git diff -- backend/test/api.test.js backend/src/services/auth.service.ts backend/src/routes/auth.routes.ts backend/src/middleware/auth.ts backend/src/middleware/page-access.ts backend/src/routes/video.routes.ts backend/src/services/upload-session.service.ts backend/src/services/employee.service.ts frontend/src/app/services/api.service.ts`
