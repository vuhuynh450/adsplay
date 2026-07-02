const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');
const request = require('supertest');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-play-backend-'));
const frontendDistDir = path.join(tmpRoot, 'frontend');

fs.ensureDirSync(frontendDistDir);
fs.writeFileSync(path.join(frontendDistDir, 'index.html'), '<html><body>ok</body></html>');
fs.writeFileSync(
  path.join(frontendDistDir, 'player-legacy.html'),
  '<html><body>legacy player</body></html>',
);

process.env.DB_FILE = path.join(tmpRoot, 'db.sqlite');
process.env.UPLOADS_DIR = path.join(tmpRoot, 'uploads');
process.env.FRONTEND_DIST_DIR = frontendDistDir;
process.env.JWT_SECRET = 'test-secret';
process.env.MAX_UPLOAD_SIZE_MB = '512';
process.env.MEDIA_TRANSCODE_ENABLED = 'false';

const { createApp } = require('../dist/app');
const {
  __forceNextCreateDeviceCodeConflictForTests,
  dbRepository,
} = require('../dist/db');
const {
  __resetDeviceCodeGeneratorForTests,
  __resetPendingDeviceRegistrationsForTests,
  __setDeviceCodeGeneratorForTests,
} = require('../dist/services/device.service');
const {
  __configureRegisterRateLimitForTests,
  __resetRegisterRateLimitForTests,
} = require('../dist/routes/device.routes');
const {
  __resetRemoveFileForTests,
  __setRemoveFileForTests,
} = require('../dist/services/video.service');
const {
  __configureLoginRateLimitForTests,
  __resetLoginRateLimitForTests,
} = require('../dist/routes/auth.routes');
const app = createApp();
const resumableChunkSizeBytes = 8 * 1024 * 1024;

const loginAsAdmin = async () => {
  const loginResponse = await request(app).post('/api/auth/login').send({
    password: 'vuhuynh450',
    username: 'vuhuynh450',
  });

  assert.equal(loginResponse.status, 200);
  assert.ok(loginResponse.body.token);

  return {
    authHeader: { Authorization: `Bearer ${loginResponse.body.token}` },
    token: loginResponse.body.token,
  };
};

const registerAndConfirmDevice = async (authHeader, name) => {
  const registerResponse = await request(app)
    .post('/api/devices/register')
    .send({ name });

  assert.equal(registerResponse.status, 200);
  assert.ok(registerResponse.body.requestId);
  assert.ok(registerResponse.body.deviceCode);
  assert.equal(registerResponse.body.deviceId, undefined);
  assert.equal(registerResponse.body.deviceToken, undefined);

  const confirmResponse = await request(app)
    .post(`/api/devices/pending/${registerResponse.body.requestId}/confirm`)
    .set(authHeader)
    .send({ deviceCode: registerResponse.body.deviceCode });
  assert.equal(confirmResponse.status, 200);

  const pendingStatusAfterConfirm = await request(app)
    .get(`/api/devices/register/${registerResponse.body.requestId}/status`);
  assert.equal(pendingStatusAfterConfirm.status, 200);
  assert.equal(pendingStatusAfterConfirm.body.status, 'confirmed');
  assert.ok(pendingStatusAfterConfirm.body.deviceId);
  assert.ok(pendingStatusAfterConfirm.body.deviceToken);

  return {
    adminDevice: confirmResponse.body,
    credentials: pendingStatusAfterConfirm.body,
    registerRequest: registerResponse.body,
  };
};

test.beforeEach(() => {
  __resetRegisterRateLimitForTests();
  __resetDeviceCodeGeneratorForTests();
  __resetPendingDeviceRegistrationsForTests();
  __resetRemoveFileForTests();
  __resetLoginRateLimitForTests();
});

test.after(async () => {
  await fs.remove(tmpRoot);
});

test('GET /api/health returns healthy state', async () => {
  const response = await request(app).get('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    status: 'healthy',
  });
});

test('legacy player route serves the standalone HTML page', async () => {
  const response = await request(app).get('/player-legacy/lobby-screen');

  assert.equal(response.status, 200);
  assert.match(response.text, /legacy player/i);
});

test('login response includes user role + page metadata', async () => {
  const response = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'vuhuynh450',
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.user);
  assert.equal(response.body.user.role, 'admin');
  assert.ok(Array.isArray(response.body.user.allowedPages));
});

test('login rate limit blocks after repeated failed credentials for the same username', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });

  const firstFailure = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'wrong-password',
  });
  assert.equal(firstFailure.status, 401);
  assert.equal(firstFailure.body.error.code, 'INVALID_CREDENTIALS');

  const secondFailure = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'wrong-password',
  });
  assert.equal(secondFailure.status, 401);
  assert.equal(secondFailure.body.error.code, 'INVALID_CREDENTIALS');

  const limited = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'vuhuynh450',
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  assert.equal(limited.body.error.message, 'Too many login attempts. Please try again later.');
});

test('successful login clears previous failed login attempts', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });

  const failure = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'wrong-password',
  });
  assert.equal(failure.status, 401);

  const success = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'vuhuynh450',
  });
  assert.equal(success.status, 200);
  assert.ok(success.body.token);

  const nextFailure = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'wrong-password',
  });
  assert.equal(nextFailure.status, 401);

  const stillNotLimited = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'wrong-password',
  });
  assert.equal(stillNotLimited.status, 401);
  assert.equal(stillNotLimited.body.error.code, 'INVALID_CREDENTIALS');
});

test('login rate limit is scoped by normalized username', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });

  const firstFailure = await request(app).post('/api/auth/login').send({
    username: 'missing_user',
    password: 'wrong-password',
  });
  assert.equal(firstFailure.status, 401);

  const secondFailure = await request(app).post('/api/auth/login').send({
    username: 'MISSING_USER ',
    password: 'wrong-password',
  });
  assert.equal(secondFailure.status, 401);

  const limitedSameNormalizedUsername = await request(app).post('/api/auth/login').send({
    username: ' missing_user ',
    password: 'wrong-password',
  });
  assert.equal(limitedSameNormalizedUsername.status, 429);
  assert.equal(limitedSameNormalizedUsername.body.error.code, 'RATE_LIMITED');

  const otherUsername = await request(app).post('/api/auth/login').send({
    username: 'another_missing_user',
    password: 'wrong-password',
  });
  assert.equal(otherUsername.status, 401);
  assert.equal(otherUsername.body.error.code, 'INVALID_CREDENTIALS');
});

test('inactive account login attempts count toward login rate limit', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('123456', 10);

  await dbRepository.createUser({
    username: 'staff_inactive_limited',
    passwordHash,
    role: 'staff',
    isActive: false,
    mustChangePassword: false,
    allowedPages: ['videos'],
  });

  const firstFailure = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive_limited',
    password: '123456',
  });
  assert.equal(firstFailure.status, 403);
  assert.equal(firstFailure.body.error.code, 'ACCOUNT_INACTIVE');

  const secondFailure = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive_limited',
    password: '123456',
  });
  assert.equal(secondFailure.status, 403);
  assert.equal(secondFailure.body.error.code, 'ACCOUNT_INACTIVE');

  const limited = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive_limited',
    password: '123456',
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
});

test('inactive staff login returns ACCOUNT_INACTIVE', async () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('123456', 10);

  await dbRepository.createUser({
    username: 'staff_inactive',
    passwordHash,
    role: 'staff',
    isActive: false,
    mustChangePassword: false,
    allowedPages: ['videos'],
  });

  const response = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive',
    password: '123456',
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ACCOUNT_INACTIVE');
});

test('first login password change clears mustChangePassword flag', async () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('temp123', 10);

  await dbRepository.createUser({
    username: 'staff_first_login',
    passwordHash,
    role: 'staff',
    isActive: true,
    mustChangePassword: true,
    allowedPages: ['videos'],
  });

  const loginResponse = await request(app).post('/api/auth/login').send({
    username: 'staff_first_login',
    password: 'temp123',
  });

  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.body.user.mustChangePassword, true);

  const changePasswordResponse = await request(app)
    .post('/api/auth/change-password-first-login')
    .set('Authorization', `Bearer ${loginResponse.body.token}`)
    .send({ newPassword: 'newpass456' });

  assert.equal(changePasswordResponse.status, 200);
  assert.ok(changePasswordResponse.body.token);
  assert.equal(changePasswordResponse.body.user.username, 'staff_first_login');
  assert.equal(changePasswordResponse.body.user.mustChangePassword, false);
  assert.deepEqual(changePasswordResponse.body.user.allowedPages, ['videos']);

  const loginAgainResponse = await request(app).post('/api/auth/login').send({
    username: 'staff_first_login',
    password: 'newpass456',
  });

  assert.equal(loginAgainResponse.status, 200);
  assert.equal(loginAgainResponse.body.user.mustChangePassword, false);
});

test('staff without profiles page permission cannot access /api/profiles', async () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('staff123', 10);

  await dbRepository.createUser({
    username: 'staff_no_profiles',
    passwordHash,
    role: 'staff',
    isActive: true,
    mustChangePassword: false,
    allowedPages: ['videos'],
  });

  const loginResponse = await request(app).post('/api/auth/login').send({
    username: 'staff_no_profiles',
    password: 'staff123',
  });

  assert.equal(loginResponse.status, 200);

  const response = await request(app)
    .get('/api/profiles')
    .set('Authorization', `Bearer ${loginResponse.body.token}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'PAGE_FORBIDDEN');
});

test('staff cannot access employees endpoints', async () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('staff-employees-123', 10);

  await dbRepository.createUser({
    username: 'staff_no_employees',
    passwordHash,
    role: 'staff',
    isActive: true,
    mustChangePassword: false,
    allowedPages: ['videos', 'profiles', 'devices', 'system'],
  });

  const loginResponse = await request(app).post('/api/auth/login').send({
    username: 'staff_no_employees',
    password: 'staff-employees-123',
  });

  assert.equal(loginResponse.status, 200);

  const response = await request(app)
    .get('/api/employees')
    .set('Authorization', `Bearer ${loginResponse.body.token}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ADMIN_ONLY');
});

test('admin can bulk delete staff employees', async () => {
  const { authHeader } = await loginAsAdmin();

  const firstResponse = await request(app)
    .post('/api/employees')
    .set(authHeader)
    .send({
      username: 'bulk_delete_staff_one',
      password: 'staff123',
      allowedPages: ['videos'],
    });
  const secondResponse = await request(app)
    .post('/api/employees')
    .set(authHeader)
    .send({
      username: 'bulk_delete_staff_two',
      password: 'staff123',
      allowedPages: ['devices'],
    });

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);

  const deleteResponse = await request(app)
    .delete('/api/employees')
    .set(authHeader)
    .send({ employeeIds: [firstResponse.body.id, secondResponse.body.id, firstResponse.body.id] });

  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.body.deletedCount, 2);

  const listResponse = await request(app)
    .get('/api/employees')
    .set(authHeader);

  assert.equal(listResponse.status, 200);
  assert.equal(
    listResponse.body.some((employee) => employee.id === firstResponse.body.id),
    false,
  );
  assert.equal(
    listResponse.body.some((employee) => employee.id === secondResponse.body.id),
    false,
  );
});

test('bulk delete employees requires at least one employee id', async () => {
  const { authHeader } = await loginAsAdmin();

  const response = await request(app)
    .delete('/api/employees')
    .set(authHeader)
    .send({ employeeIds: [] });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('upload session route without token returns AUTH_REQUIRED', async () => {
  const response = await request(app).post('/api/videos/uploads/sessions').send({
    fileKey: 'missing-token',
    mimeType: 'video/mp4',
    originalName: 'missing-token.mp4',
    totalSizeBytes: 1024,
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});

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

test('auth and system status flow works', async () => {
  const { authHeader, token } = await loginAsAdmin();

  const unauthorized = await request(app).get('/api/system/status');
  assert.equal(unauthorized.status, 401);

  const authorized = await request(app)
    .get('/api/system/status')
    .set(authHeader);

  assert.equal(authorized.status, 200);
  assert.equal(typeof authorized.body.online, 'boolean');
  assert.ok(Array.isArray(authorized.body.localIps));

  const malformedAdminAttempt = await request(app)
    .get('/api/system/status')
    .set('Authorization', `Bearer ${token}.tampered`);

  assert.equal(malformedAdminAttempt.status, 403);
});

test('system status includes local storage usage details', async () => {
  const { authHeader } = await loginAsAdmin();

  const sourceFilePath = path.join(process.env.UPLOADS_DIR, 'source-test.mp4');
  const processedFilePath = path.join(process.env.UPLOADS_DIR, 'processed', 'hls', 'segment-000.ts');
  const sessionFilePath = path.join(process.env.UPLOADS_DIR, '.sessions', '11111111-1111-4111-8111-111111111111', 'chunks', '000000.part');

  await fs.outputFile(sourceFilePath, Buffer.alloc(10));
  await fs.outputFile(processedFilePath, Buffer.alloc(20));
  await fs.outputFile(sessionFilePath, Buffer.alloc(30));

  const response = await request(app)
    .get('/api/system/status')
    .set(authHeader);

  assert.equal(response.status, 200);
  assert.ok(response.body.storage);
  assert.ok(response.body.storage.disk === null || typeof response.body.storage.disk.totalBytes === 'number');
  assert.equal(typeof response.body.storage.directories.uploadsRootBytes, 'number');
  assert.equal(typeof response.body.storage.directories.sourceFilesBytes, 'number');
  assert.equal(typeof response.body.storage.directories.processedBytes, 'number');
  assert.equal(typeof response.body.storage.directories.sessionsBytes, 'number');
  assert.equal(response.body.storage.directories.sourceFilesBytes, 10);
  assert.ok(response.body.storage.directories.processedBytes >= 20);
  assert.ok(response.body.storage.directories.sessionsBytes >= 30);
  assert.equal(response.body.storage.database.path, process.env.DB_FILE);
  assert.equal(typeof response.body.storage.database.totalBytes, 'number');
});

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

  const cleanupResponse = await request(app)
    .delete(`/api/videos/${adminUpload.body.id}`)
    .set(authHeader);
  assert.equal(cleanupResponse.status, 200);
});

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

test('video upload and profile lifecycle work end-to-end', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'promo.mp4',
    });

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadResponse.body.originalName, 'promo.mp4');

  const createProfileResponse = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({
      name: 'Lobby Screen',
      videoIds: [uploadResponse.body.id],
    });

  assert.equal(createProfileResponse.status, 200);
  assert.equal(createProfileResponse.body.slug, 'lobby-screen');
  assert.equal(createProfileResponse.body.videos.length, 1);
  assert.ok(createProfileResponse.body.playerAccessToken);
  const profileTokenPayload = require('jsonwebtoken').decode(createProfileResponse.body.playerAccessToken);
  assert.equal(typeof profileTokenPayload.exp, 'number');

  const publicProfilesResponse = await request(app).get('/api/profiles');
  assert.equal(publicProfilesResponse.status, 200);
  const publicProfileSummary = publicProfilesResponse.body.find((profile) => profile.slug === 'lobby-screen');
  assert.deepEqual(publicProfileSummary, {
    name: 'Lobby Screen',
    slug: 'lobby-screen',
    videoCount: 1,
  });

  const adminProfilesResponse = await request(app).get('/api/profiles').set(authHeader);
  assert.equal(adminProfilesResponse.status, 200);
  const adminProfile = adminProfilesResponse.body.find((profile) => profile.id === createProfileResponse.body.id);
  assert.equal(adminProfile.playerAccessToken, createProfileResponse.body.playerAccessToken);
  assert.equal(adminProfile.videoIds.length, 1);

  const publicProfile = await request(app).get('/api/profiles/slug/lobby-screen');
  assert.equal(publicProfile.status, 200);
  assert.equal(publicProfile.body.name, 'Lobby Screen');
  assert.equal(publicProfile.body.slug, 'lobby-screen');
  assert.equal(publicProfile.body.id, undefined);
  assert.equal(publicProfile.body.lastSeen, undefined);

  const unauthorizedProfileById = await request(app).get(`/api/profiles/${createProfileResponse.body.id}`);
  assert.equal(unauthorizedProfileById.status, 401);

  const videosResponse = await request(app).get('/api/videos').set(authHeader);
  assert.equal(videosResponse.status, 200);
  assert.equal(videosResponse.body[0].usageCount, 1);
  assert.equal(videosResponse.body[0].processingStatus, 'ready');

  const policyResponse = await request(app).get('/api/videos/policy').set(authHeader);

  assert.equal(policyResponse.status, 200);
  assert.equal(policyResponse.body.maxUploadSizeBytes, 512 * 1024 * 1024);
  assert.equal(policyResponse.body.resumableChunkSizeBytes, resumableChunkSizeBytes);
  assert.deepEqual(policyResponse.body.storageTargets, ['local']);
  assert.ok(policyResponse.body.allowedMimeTypes.includes('video/mp4'));
  assert.ok(policyResponse.body.allowedMimeTypes.includes('image/png'));

  const streamResponse = await request(app)
    .get(`/api/videos/${uploadResponse.body.id}/stream`)
    .set('Range', 'bytes=0-3');
  assert.equal(streamResponse.status, 206);
  assert.match(streamResponse.headers['content-range'], /^bytes 0-3\//);

  const publicHeartbeatWithoutToken = await request(app).post('/api/profiles/slug/lobby-screen/heartbeat');
  assert.equal(publicHeartbeatWithoutToken.status, 400);

  const publicHeartbeatWithToken = await request(app)
    .post('/api/profiles/slug/lobby-screen/heartbeat')
    .set('X-Profile-Token', createProfileResponse.body.playerAccessToken);
  assert.equal(publicHeartbeatWithToken.status, 200);

  const legacyHeartbeatResponse = await request(app).post(
    `/api/profiles/${createProfileResponse.body.id}/heartbeat`,
  );
  assert.equal(legacyHeartbeatResponse.status, 401);

  const heartbeatTokenCannotAccessAdminRoutes = await request(app)
    .get('/api/system/status')
    .set('Authorization', `Bearer ${createProfileResponse.body.playerAccessToken}`);
  assert.equal(heartbeatTokenCannotAccessAdminRoutes.status, 403);

  const heartbeatResponse = await request(app)
    .post(`/api/profiles/${createProfileResponse.body.id}/heartbeat`)
    .set(authHeader);
  assert.equal(heartbeatResponse.status, 200);

  const deleteVideoResponse = await request(app)
    .delete(`/api/videos/${uploadResponse.body.id}`)
    .set(authHeader);
  assert.equal(deleteVideoResponse.status, 200);

  const updatedProfile = await request(app)
    .get(`/api/profiles/${createProfileResponse.body.id}`)
    .set(authHeader);
  assert.equal(updatedProfile.status, 200);
  assert.equal(updatedProfile.body.videos.length, 0);
  assert.ok(updatedProfile.body.lastSeen);

  const deleteProfileResponse = await request(app)
    .delete(`/api/profiles/${createProfileResponse.body.id}`)
    .set(authHeader);
  assert.equal(deleteProfileResponse.status, 200);
});

test('device binding flow supports pending registration, confirmation, assignment, and token heartbeat', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'device-promo.mp4',
    });
  assert.equal(uploadResponse.status, 200);

  const profileResponse = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({
      name: 'Device Lobby',
      videoIds: [uploadResponse.body.id],
    });
  assert.equal(profileResponse.status, 200);

  const registerResponse = await request(app)
    .post('/api/devices/register')
    .send({
      name: 'Lobby TV',
    });
  assert.equal(registerResponse.status, 200);
  assert.ok(registerResponse.body.requestId);
  assert.ok(registerResponse.body.deviceCode);
  assert.equal(registerResponse.body.deviceId, undefined);
  assert.equal(registerResponse.body.deviceToken, undefined);

  const pendingList = await request(app)
    .get('/api/devices/pending')
    .set(authHeader);
  assert.equal(pendingList.status, 200);
  const pendingItem = pendingList.body.find((item) => item.requestId === registerResponse.body.requestId);
  assert.ok(pendingItem);

  const deviceListBeforeConfirm = await request(app)
    .get('/api/devices')
    .set(authHeader);
  assert.equal(deviceListBeforeConfirm.status, 200);
  const unconfirmedDevice = deviceListBeforeConfirm.body.find((item) => item.deviceCode === registerResponse.body.deviceCode);
  assert.equal(unconfirmedDevice, undefined);

  const wrongConfirmResponse = await request(app)
    .post(`/api/devices/pending/${registerResponse.body.requestId}/confirm`)
    .set(authHeader)
    .send({ deviceCode: 'WRONG1' });
  assert.equal(wrongConfirmResponse.status, 409);
  assert.equal(wrongConfirmResponse.body.error.code, 'DEVICE_CODE_MISMATCH');

  const confirmResponse = await request(app)
    .post(`/api/devices/pending/${registerResponse.body.requestId}/confirm`)
    .set(authHeader)
    .send({ deviceCode: registerResponse.body.deviceCode });
  assert.equal(confirmResponse.status, 200);
  assert.ok(confirmResponse.body.id);

  const registrationStatus = await request(app)
    .get(`/api/devices/register/${registerResponse.body.requestId}/status`);
  assert.equal(registrationStatus.status, 200);
  assert.equal(registrationStatus.body.status, 'confirmed');
  assert.ok(registrationStatus.body.deviceId);
  assert.ok(registrationStatus.body.deviceToken);
  const deviceTokenPayload = require('jsonwebtoken').decode(registrationStatus.body.deviceToken);
  assert.equal(deviceTokenPayload.exp, undefined);

  const unassignedBindingResponse = await request(app)
    .get(`/api/player/device/${registrationStatus.body.deviceId}`)
    .set('X-Device-Token', registrationStatus.body.deviceToken);
  assert.equal(unassignedBindingResponse.status, 409);
  assert.equal(unassignedBindingResponse.body.error.code, 'DEVICE_NOT_ASSIGNED');

  const assignResponse = await request(app)
    .post(`/api/devices/${registrationStatus.body.deviceId}/assign-profile`)
    .set(authHeader)
    .send({ profileId: profileResponse.body.id });
  assert.equal(assignResponse.status, 200);
  assert.equal(assignResponse.body.assignedProfileId, profileResponse.body.id);

  const bindingResponse = await request(app)
    .get(`/api/player/device/${registrationStatus.body.deviceId}`)
    .set('X-Device-Token', registrationStatus.body.deviceToken);
  assert.equal(bindingResponse.status, 200);
  assert.equal(bindingResponse.body.device.id, registrationStatus.body.deviceId);
  assert.equal(bindingResponse.body.profile.name, 'Device Lobby');
  assert.equal(bindingResponse.body.profile.slug, 'device-lobby');
  assert.equal(bindingResponse.body.profile.videos.length, 1);

  const heartbeatResponse = await request(app)
    .post(`/api/player/device/${registrationStatus.body.deviceId}/heartbeat`)
    .set('X-Device-Token', registrationStatus.body.deviceToken);
  assert.equal(heartbeatResponse.status, 200);
  assert.equal(heartbeatResponse.body.success, true);

  const devicesResponse = await request(app).get('/api/devices').set(authHeader);
  assert.equal(devicesResponse.status, 200);
  const device = devicesResponse.body.find((item) => item.id === registrationStatus.body.deviceId);
  assert.equal(device.assignedProfileId, profileResponse.body.id);
  assert.ok(device.lastSeen);
  assert.equal(device.secretHash, undefined);

  const deleteResponse = await request(app)
    .delete(`/api/devices/${registrationStatus.body.deviceId}`)
    .set(authHeader);
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.body.success, true);

  const devicesAfterDelete = await request(app).get('/api/devices').set(authHeader);
  assert.equal(devicesAfterDelete.status, 200);
  const deletedDevice = devicesAfterDelete.body.find((item) => item.id === registrationStatus.body.deviceId);
  assert.equal(deletedDevice, undefined);

  const deletedDeviceBinding = await request(app)
    .get(`/api/player/device/${registrationStatus.body.deviceId}`)
    .set('X-Device-Token', registrationStatus.body.deviceToken);
  assert.equal(deletedDeviceBinding.status, 404);
  assert.equal(deletedDeviceBinding.body.error.code, 'DEVICE_NOT_FOUND');
});

test('pending device registration is removed when player stops polling status', async (context) => {
  const { authHeader } = await loginAsAdmin();

  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-01T00:00:00.000Z') });

  const registerResponse = await request(app)
    .post('/api/devices/register')
    .send({ name: 'Stale TV' });
  assert.equal(registerResponse.status, 200);

  const pendingBeforeStale = await request(app)
    .get('/api/devices/pending')
    .set(authHeader);
  assert.equal(pendingBeforeStale.status, 200);
  const pendingItemBeforeStale = pendingBeforeStale.body.find((item) => item.requestId === registerResponse.body.requestId);
  assert.ok(pendingItemBeforeStale);

  context.mock.timers.tick(31_000);

  const pendingAfterStale = await request(app)
    .get('/api/devices/pending')
    .set(authHeader);
  assert.equal(pendingAfterStale.status, 200);
  const pendingItemAfterStale = pendingAfterStale.body.find((item) => item.requestId === registerResponse.body.requestId);
  assert.equal(pendingItemAfterStale, undefined);
});

test('device routes enforce token validation and profile assignment errors', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'security-promo.mp4',
    });
  assert.equal(uploadResponse.status, 200);

  const profileA = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({ name: 'Security A', videoIds: [uploadResponse.body.id] });
  assert.equal(profileA.status, 200);

  const profileB = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({ name: 'Security B', videoIds: [uploadResponse.body.id] });
  assert.equal(profileB.status, 200);

  const deviceA = await registerAndConfirmDevice(authHeader, 'Device A');
  const deviceB = await registerAndConfirmDevice(authHeader, 'Device B');

  const missingToken = await request(app).get(`/api/player/device/${deviceA.credentials.deviceId}`);
  assert.equal(missingToken.status, 400);

  const tamperedToken = await request(app)
    .get(`/api/player/device/${deviceA.credentials.deviceId}`)
    .set('X-Device-Token', `${deviceA.credentials.deviceToken}.bad`);
  assert.equal(tamperedToken.status, 403);
  assert.equal(tamperedToken.body.error.code, 'DEVICE_TOKEN_INVALID');

  const wrongDeviceToken = await request(app)
    .get(`/api/player/device/${deviceB.credentials.deviceId}`)
    .set('X-Device-Token', deviceA.credentials.deviceToken);
  assert.equal(wrongDeviceToken.status, 403);
  assert.equal(wrongDeviceToken.body.error.code, 'DEVICE_TOKEN_INVALID');

  const assignMissingProfile = await request(app)
    .post(`/api/devices/${deviceA.credentials.deviceId}/assign-profile`)
    .set(authHeader)
    .send({ profileId: 'profile-does-not-exist' });
  assert.equal(assignMissingProfile.status, 404);
  assert.equal(assignMissingProfile.body.error.code, 'PROFILE_NOT_FOUND');

  const assignA = await request(app)
    .post(`/api/devices/${deviceA.credentials.deviceId}/assign-profile`)
    .set(authHeader)
    .send({ profileId: profileA.body.id });
  assert.equal(assignA.status, 200);

  const rotateResponse = await request(app)
    .post(`/api/devices/${deviceA.credentials.deviceId}/rotate-token`)
    .set(authHeader);
  assert.equal(rotateResponse.status, 200);
  assert.ok(rotateResponse.body.deviceToken);

  const oldTokenAfterRotate = await request(app)
    .get(`/api/player/device/${deviceA.credentials.deviceId}`)
    .set('X-Device-Token', deviceA.credentials.deviceToken);
  assert.equal(oldTokenAfterRotate.status, 403);
  assert.equal(oldTokenAfterRotate.body.error.code, 'DEVICE_TOKEN_INVALID');

  const newTokenAfterRotate = await request(app)
    .get(`/api/player/device/${deviceA.credentials.deviceId}`)
    .set('X-Device-Token', rotateResponse.body.deviceToken);
  assert.equal(newTokenAfterRotate.status, 200);
  assert.equal(newTokenAfterRotate.body.profile.slug, 'security-a');

  const listResponse = await request(app).get('/api/devices').set(authHeader);
  assert.equal(listResponse.status, 200);
  const listedDevice = listResponse.body.find((item) => item.id === deviceA.credentials.deviceId);
  assert.equal(listedDevice.secretHash, undefined);

  const registerLeakCheck = await request(app).post('/api/devices/register').send({ name: 'No Leak' });
  assert.equal(registerLeakCheck.status, 200);
  assert.equal(registerLeakCheck.body.secretHash, undefined);

  const assignB = await request(app)
    .post(`/api/devices/${deviceB.credentials.deviceId}/assign-profile`)
    .set(authHeader)
    .send({ profileId: profileB.body.id });
  assert.equal(assignB.status, 200);
});

test('device register applies rate limit and returns 429 when exceeded', async () => {
  __configureRegisterRateLimitForTests({ maxRequests: 3, windowMs: 60_000 });

  let statusCodes = [];

  for (let index = 0; index < 4; index += 1) {
    const response = await request(app).post('/api/devices/register').send({ name: `Rate ${index}` });
    statusCodes.push(response.status);
  }

  assert.equal(statusCodes.slice(0, 3).every((code) => code === 200), true);
  assert.equal(statusCodes[3], 429);
});

test('device register validates max length for optional name', async () => {
  const tooLongName = 'x'.repeat(121);

  const response = await request(app).post('/api/devices/register').send({ name: tooLongName });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('device register accepts whitespace name and uses default name after confirmation', async () => {
  const { authHeader } = await loginAsAdmin();
  const response = await request(app).post('/api/devices/register').send({ name: '   ' });

  assert.equal(response.status, 200);

  const confirmResponse = await request(app)
    .post(`/api/devices/pending/${response.body.requestId}/confirm`)
    .set(authHeader)
    .send({ deviceCode: response.body.deviceCode });
  assert.equal(confirmResponse.status, 200);

  const device = await dbRepository.findDeviceById(confirmResponse.body.id);
  assert.ok(device);
  assert.equal(device.name, 'TV Device');
});

test('device registration retries code generation to avoid duplicates', async () => {
  const firstRegister = await request(app).post('/api/devices/register').send({ name: 'Unique Seed' });
  assert.equal(firstRegister.status, 200);

  let callCount = 0;
  __setDeviceCodeGeneratorForTests(() => {
    callCount += 1;
    if (callCount === 1) {
      return firstRegister.body.deviceCode;
    }

    return 'A1B2C3';
  });

  const secondRegister = await request(app).post('/api/devices/register').send({ name: 'Unique Retry' });
  __resetDeviceCodeGeneratorForTests();

  assert.equal(secondRegister.status, 200);
  assert.notEqual(secondRegister.body.deviceCode, firstRegister.body.deviceCode);
  assert.equal(secondRegister.body.deviceCode, 'A1B2C3');
});

test('device confirmation returns conflict when create path conflict happens', async () => {
  const { authHeader } = await loginAsAdmin();
  __setDeviceCodeGeneratorForTests(() => 'RACE01');

  const response = await request(app).post('/api/devices/register').send({ name: 'Race Retry' });
  assert.equal(response.status, 200);
  assert.equal(response.body.deviceCode, 'RACE01');

  __forceNextCreateDeviceCodeConflictForTests();

  const confirmResponse = await request(app)
    .post(`/api/devices/pending/${response.body.requestId}/confirm`)
    .set(authHeader)
    .send({ deviceCode: response.body.deviceCode });
  __resetDeviceCodeGeneratorForTests();

  assert.equal(confirmResponse.status, 409);
  assert.equal(confirmResponse.body.error.code, 'DEVICE_CODE_ALREADY_USED');
});

test('upload session routes reject path traversal session ids', async () => {
  const { authHeader } = await loginAsAdmin();

  const response = await request(app)
    .get('/api/videos/uploads/sessions/..%2fdb.json')
    .set(authHeader);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'UPLOAD_SESSION_INVALID');
});

test('resumable upload sessions resume per client key without cross-client collisions', async () => {
  const { authHeader } = await loginAsAdmin();
  const fileBuffer = Buffer.from('abcdefghijklmnopqrstuvwxyz');

  const firstSessionResponse = await request(app)
    .post('/api/videos/uploads/sessions')
    .set(authHeader)
    .send({
      fileKey: 'client-a:promo.mov:26:123',
      mimeType: 'video/quicktime',
      originalName: 'promo.mov',
      totalSizeBytes: fileBuffer.length,
    });

  assert.equal(firstSessionResponse.status, 200);
  assert.equal(firstSessionResponse.body.totalChunks, 1);

  const resumedSessionResponse = await request(app)
    .post('/api/videos/uploads/sessions')
    .set(authHeader)
    .send({
      fileKey: 'client-a:promo.mov:26:123',
      mimeType: 'video/quicktime',
      originalName: 'promo.mov',
      totalSizeBytes: fileBuffer.length,
    });

  assert.equal(resumedSessionResponse.status, 200);
  assert.equal(resumedSessionResponse.body.id, firstSessionResponse.body.id);

  const secondClientSessionResponse = await request(app)
    .post('/api/videos/uploads/sessions')
    .set(authHeader)
    .send({
      fileKey: 'client-b:promo.mov:26:123',
      mimeType: 'video/quicktime',
      originalName: 'promo.mov',
      totalSizeBytes: fileBuffer.length,
    });

  assert.equal(secondClientSessionResponse.status, 200);
  assert.notEqual(secondClientSessionResponse.body.id, firstSessionResponse.body.id);
});

test('image uploads are returned as image media and can be used in profiles', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake png content'), {
      contentType: 'image/png',
      filename: 'poster.png',
    });

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadResponse.body.originalName, 'poster.png');
  assert.equal(uploadResponse.body.mediaType, 'image');
  assert.equal(uploadResponse.body.processingStatus, 'ready');

  const imageStreamResponse = await request(app).get(`/api/videos/${uploadResponse.body.id}/stream`);
  assert.equal(imageStreamResponse.status, 200);
  assert.equal(imageStreamResponse.headers['content-type'], 'image/png');

  const createProfileResponse = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({
      name: 'Image Screen',
      videoIds: [uploadResponse.body.id],
    });

  assert.equal(createProfileResponse.status, 200);
  assert.equal(createProfileResponse.body.videos.length, 1);
  assert.equal(createProfileResponse.body.videos[0].mediaType, 'image');

  const publicProfile = await request(app).get('/api/profiles/slug/image-screen');
  assert.equal(publicProfile.status, 200);
  assert.equal(publicProfile.body.videos[0].mediaType, 'image');
});

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

test('resumable upload sessions reject undersized non-final chunks and still assemble valid uploads', async () => {
  const { authHeader } = await loginAsAdmin();
  const fileBuffer = Buffer.alloc(resumableChunkSizeBytes + 32, 'a');

  const sessionResponse = await request(app)
    .post('/api/videos/uploads/sessions')
    .set(authHeader)
    .send({
      fileKey: 'client-a:large-promo.mov',
      mimeType: 'video/quicktime',
      originalName: 'large-promo.mov',
      totalSizeBytes: fileBuffer.length,
    });

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.body.totalChunks, 2);

  const shortChunkResponse = await request(app)
    .put(`/api/videos/uploads/sessions/${sessionResponse.body.id}/chunks/0`)
    .set(authHeader)
    .set('Content-Type', 'application/octet-stream')
    .send(fileBuffer.subarray(0, resumableChunkSizeBytes - 1024));

  assert.equal(shortChunkResponse.status, 400);
  assert.equal(shortChunkResponse.body.error.code, 'UPLOAD_CHUNK_INVALID_SIZE');

  const chunkResponse = await request(app)
    .put(`/api/videos/uploads/sessions/${sessionResponse.body.id}/chunks/0`)
    .set(authHeader)
    .set('Content-Type', 'application/octet-stream')
    .send(fileBuffer.subarray(0, resumableChunkSizeBytes));

  assert.equal(chunkResponse.status, 200);
  assert.deepEqual(chunkResponse.body.uploadedChunkIndexes, [0]);

  const finalChunkResponse = await request(app)
    .put(`/api/videos/uploads/sessions/${sessionResponse.body.id}/chunks/1`)
    .set(authHeader)
    .set('Content-Type', 'application/octet-stream')
    .send(fileBuffer.subarray(resumableChunkSizeBytes));
  assert.equal(finalChunkResponse.status, 200);
  assert.deepEqual(finalChunkResponse.body.uploadedChunkIndexes, [0, 1]);

  const completeResponse = await request(app)
    .post(`/api/videos/uploads/sessions/${sessionResponse.body.id}/complete`)
    .set(authHeader);

  assert.equal(completeResponse.status, 200);
  assert.equal(completeResponse.body.originalName, 'large-promo.mov');
  assert.equal(completeResponse.body.sourceSize, fileBuffer.length);
});

test('missing video files return a clean app error', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'missing.mp4',
    });

  await fs.remove(path.join(process.env.UPLOADS_DIR, uploadResponse.body.filename));

  const streamResponse = await request(app).get(`/api/videos/${uploadResponse.body.id}/stream`);

  assert.equal(streamResponse.status, 404);
  assert.equal(streamResponse.body.error.code, 'VIDEO_FILE_NOT_FOUND');
});

test('poster and HLS asset routes serve generated media artifacts when metadata exists', async () => {
  const { authHeader } = await loginAsAdmin();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'artifacts.mp4',
    });

  const posterRelativePath = path.join('processed', 'posters', `${uploadResponse.body.id}.jpg`);
  const hlsManifestRelativePath = path.join('processed', 'hls', uploadResponse.body.id, 'playlist.m3u8');
  const hlsSegmentRelativePath = path.join('processed', 'hls', uploadResponse.body.id, 'segment-000.ts');

  await fs.outputFile(path.join(process.env.UPLOADS_DIR, posterRelativePath), Buffer.from('poster'));
  await fs.outputFile(
    path.join(process.env.UPLOADS_DIR, hlsManifestRelativePath),
    '#EXTM3U\n#EXTINF:6,\nsegment-000.ts\n#EXT-X-ENDLIST\n',
  );
  await fs.outputFile(path.join(process.env.UPLOADS_DIR, hlsSegmentRelativePath), Buffer.from('segment'));

  await dbRepository.updateVideo(uploadResponse.body.id, (draft) => {
    draft.posterFilename = posterRelativePath;
    draft.hlsManifestPath = hlsManifestRelativePath;
  });

  const posterResponse = await request(app).get(`/api/videos/${uploadResponse.body.id}/poster`);
  assert.equal(posterResponse.status, 200);
  assert.equal(posterResponse.headers['content-type'], 'image/jpeg');

  const manifestResponse = await request(app).get(`/api/videos/${uploadResponse.body.id}/hls/playlist.m3u8`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.text, /#EXTM3U/);
  assert.equal(
    manifestResponse.headers['content-type'],
    'application/vnd.apple.mpegurl',
  );

  const segmentResponse = await request(app).get(`/api/videos/${uploadResponse.body.id}/hls/segment-000.ts`);
  assert.equal(segmentResponse.status, 200);
  assert.equal(segmentResponse.headers['content-type'], 'video/mp2t');
});

test('staff with videos permission can access /api/videos and /api/system', async () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('staff-videos-only', 10);

  await dbRepository.createUser({
    username: 'staff_videos_only',
    passwordHash,
    role: 'staff',
    isActive: true,
    mustChangePassword: false,
    allowedPages: ['videos'],
  });

  const loginResponse = await request(app).post('/api/auth/login').send({
    username: 'staff_videos_only',
    password: 'staff-videos-only',
  });

  assert.equal(loginResponse.status, 200);
  const token = `Bearer ${loginResponse.body.token}`;

  const videosResponse = await request(app)
    .get('/api/videos')
    .set('Authorization', token);

  assert.equal(videosResponse.status, 200);
  assert.ok(Array.isArray(videosResponse.body));

  const systemResponse = await request(app)
    .get('/api/system/status')
    .set('Authorization', token);

  assert.equal(systemResponse.status, 200);
  assert.ok(systemResponse.body.online);
  assert.ok(Array.isArray(systemResponse.body.localIps));
});

test('locked staff is blocked on next request even with valid token', async () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('locked123', 10);

  await dbRepository.createUser({
    username: 'staff_locked',
    passwordHash,
    role: 'staff',
    isActive: true,
    mustChangePassword: false,
    allowedPages: ['videos'],
  });

  const loginResponse = await request(app).post('/api/auth/login').send({
    username: 'staff_locked',
    password: 'locked123',
  });

  assert.equal(loginResponse.status, 200);
  const token = `Bearer ${loginResponse.body.token}`;

  // Initially can access videos
  const initialResponse = await request(app)
    .get('/api/videos')
    .set('Authorization', token);

  assert.equal(initialResponse.status, 200);

  // Lock the user account
  const adminLogin = await request(app).post('/api/auth/login').send({
    username: 'vuhuynh450',
    password: 'vuhuynh450',
  });

  const employeeId = loginResponse.body.user.id;
  await request(app)
    .patch(`/api/employees/${employeeId}/active`)
    .set('Authorization', `Bearer ${adminLogin.body.token}`)
    .send({ isActive: false });

  // Locked staff is now blocked
  const blockedResponse = await request(app)
    .get('/api/videos')
    .set('Authorization', token);

  assert.equal(blockedResponse.status, 403);
  assert.equal(blockedResponse.body.error.code, 'ACCOUNT_INACTIVE');
});
