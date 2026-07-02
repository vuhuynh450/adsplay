const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-play-sqlite-repository-'));
const sqlitePath = path.join(tmpRoot, 'adplay.sqlite');
const legacyJsonPath = path.join(tmpRoot, 'db.json');

process.env.DB_FILE = sqlitePath;
process.env.UPLOADS_DIR = path.join(tmpRoot, 'uploads');
process.env.FRONTEND_DIST_DIR = path.join(tmpRoot, 'frontend');
process.env.JWT_SECRET = 'test-secret';
process.env.MAX_UPLOAD_SIZE_MB = '512';
process.env.MEDIA_TRANSCODE_ENABLED = 'false';

fs.ensureDirSync(process.env.FRONTEND_DIST_DIR);
fs.writeFileSync(path.join(process.env.FRONTEND_DIST_DIR, 'index.html'), '<html><body>ok</body></html>');
fs.writeJsonSync(legacyJsonPath, {
  devices: [{ id: 'legacy-device', deviceCode: 'OLD123', name: 'Legacy', secretHash: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  profiles: [],
  users: [],
  videos: [],
});

const { dbRepository } = require('../dist/db');

test.after(async () => {
  await fs.remove(tmpRoot);
});

test('repository creates a SQLite database and ignores legacy db.json', async () => {
  const header = await fs.readFile(sqlitePath);
  assert.equal(header.subarray(0, 16).toString('utf8'), 'SQLite format 3\0');

  const devices = await dbRepository.listDevices();
  assert.deepEqual(devices, []);
});

test('repository persists users, videos, profiles, and ordered playlists', async () => {
  const user = await dbRepository.createUser({
    username: 'staff_sqlite',
    passwordHash: 'hash',
    role: 'staff',
    isActive: true,
    mustChangePassword: true,
    allowedPages: ['videos', 'profiles'],
  });
  assert.equal(user.username, 'staff_sqlite');

  const firstVideo = await dbRepository.saveVideo({
    filename: 'first.mp4',
    id: 'video-first',
    mediaType: 'video',
    mimeType: 'video/mp4',
    originalName: 'first.mp4',
    processingStatus: 'ready',
    sourceFilename: 'first.mp4',
    sourceMimeType: 'video/mp4',
    sourceSize: 10,
    size: 10,
    storageProvider: 'local',
    streamVariant: 'original',
    uploadedAt: new Date().toISOString(),
  });
  const secondVideo = await dbRepository.saveVideo({
    filename: 'second.mp4',
    id: 'video-second',
    mediaType: 'video',
    mimeType: 'video/mp4',
    originalName: 'second.mp4',
    processingStatus: 'ready',
    sourceFilename: 'second.mp4',
    sourceMimeType: 'video/mp4',
    sourceSize: 20,
    size: 20,
    storageProvider: 'local',
    streamVariant: 'original',
    uploadedAt: new Date().toISOString(),
  });

  await dbRepository.upsertProfile({
    name: 'Branch One',
    orientation: 'landscape',
    videoIds: [secondVideo.id, firstVideo.id, secondVideo.id],
  });

  const profile = await dbRepository.findProfileBySlug('branch-one');
  assert.ok(profile);
  assert.deepEqual(profile.videoIds, ['video-second', 'video-first']);
});

test('repository enforces device code uniqueness and relation cleanup', async () => {
  const video = await dbRepository.saveVideo({
    filename: 'device-branch.mp4',
    id: 'video-device-branch',
    mediaType: 'video',
    mimeType: 'video/mp4',
    originalName: 'device-branch.mp4',
    processingStatus: 'ready',
    sourceFilename: 'device-branch.mp4',
    sourceMimeType: 'video/mp4',
    sourceSize: 30,
    size: 30,
    storageProvider: 'local',
    streamVariant: 'original',
    uploadedAt: new Date().toISOString(),
  });

  await dbRepository.upsertProfile({
    name: 'Device Branch',
    orientation: 'rotate90',
    videoIds: [video.id],
  });
  const profile = await dbRepository.findProfileBySlug('device-branch');
  assert.ok(profile);

  const device = await dbRepository.createDevice({
    deviceCode: 'ABC123',
    name: 'Lobby TV',
    secretHash: 'secret-hash',
  });
  await dbRepository.assignProfileToDevice(device.id, profile.id);

  await assert.rejects(
    () => dbRepository.createDevice({ deviceCode: 'ABC123', name: 'Duplicate TV', secretHash: 'secret-hash' }),
    /DEVICE_CODE_CONFLICT/,
  );

  const deleted = await dbRepository.deleteProfile(profile.id);
  assert.equal(deleted, true);
  const updatedDevice = await dbRepository.findDeviceById(device.id);
  assert.equal(updatedDevice.assignedProfileId, undefined);
});