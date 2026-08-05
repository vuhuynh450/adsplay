const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('fs-extra');
const request = require('supertest');
const ffmpegPath = require('ffmpeg-static');

const execFileAsync = promisify(execFile);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-play-upload-rejection-'));
const frontendDistDir = path.join(tmpRoot, 'frontend');

fs.ensureDirSync(frontendDistDir);
fs.writeFileSync(path.join(frontendDistDir, 'index.html'), '<html><body>ok</body></html>');

process.env.DB_FILE = path.join(tmpRoot, 'db.sqlite');
process.env.UPLOADS_DIR = path.join(tmpRoot, 'uploads');
process.env.FRONTEND_DIST_DIR = frontendDistDir;
process.env.JWT_SECRET = 'test-secret';
process.env.MAX_UPLOAD_SIZE_MB = '512';
process.env.MEDIA_TRANSCODE_ENABLED = 'true';

const { createApp } = require('../dist/app');
const { dbRepository } = require('../dist/db');

const app = createApp();
const uploadsDir = process.env.UPLOADS_DIR;
const sessionsDir = path.join(uploadsDir, '.sessions');

const loginAsAdmin = async () => {
  const loginResponse = await request(app).post('/api/auth/login').send({
    password: 'vuhuynh450',
    username: 'vuhuynh450',
  });

  assert.equal(loginResponse.status, 200);
  assert.ok(loginResponse.body.token);

  return { Authorization: `Bearer ${loginResponse.body.token}` };
};

const countUploadedFiles = async () => {
  const entries = await fs.readdir(uploadsDir);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(uploadsDir, entry);
    if ((await fs.stat(entryPath)).isFile()) {
      files.push(entry);
    }
  }
  return files;
};

const generateHevcFixture = async (filePath) => {
  await execFileAsync(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=15',
    '-t',
    '1',
    '-c:v',
    'libx265',
    '-preset',
    'ultrafast',
    '-crf',
    '30',
    '-pix_fmt',
    'yuv420p',
    filePath,
  ]);
};

test.after(async () => {
  await fs.remove(tmpRoot);
});

test('unsupported codec: direct upload of an HEVC source is rejected with no record and no leftover file', async () => {
  const authHeader = await loginAsAdmin();
  const sourceVideoPath = path.join(tmpRoot, 'unsupported-hevc.mp4');
  await generateHevcFixture(sourceVideoPath);

  const videoCountBefore = (await dbRepository.listVideos()).length;
  const filesBefore = await countUploadedFiles();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', sourceVideoPath, {
      contentType: 'video/mp4',
      filename: 'unsupported-hevc.mp4',
    });

  assert.equal(uploadResponse.status, 400);
  assert.equal(uploadResponse.body.error.code, 'VIDEO_CODEC_UNSUPPORTED');
  assert.match(uploadResponse.body.error.message, /H\.264\/AAC/);
  assert.equal((await dbRepository.listVideos()).length, videoCountBefore);

  const filesAfter = await countUploadedFiles();
  assert.deepEqual(filesAfter, filesBefore);
});

test('unsupported codec: resumable upload of an HEVC source is rejected with no record, no assembled file, and no session dir', async () => {
  const authHeader = await loginAsAdmin();
  const sourceVideoPath = path.join(tmpRoot, 'unsupported-hevc-resumable.mp4');
  await generateHevcFixture(sourceVideoPath);

  const fileBuffer = await fs.readFile(sourceVideoPath);
  const videoCountBefore = (await dbRepository.listVideos()).length;
  const filesBefore = await countUploadedFiles();

  const sessionResponse = await request(app)
    .post('/api/videos/uploads/sessions')
    .set(authHeader)
    .send({
      fileKey: 'client-a:unsupported-hevc-resumable.mp4',
      mimeType: 'video/mp4',
      originalName: 'unsupported-hevc-resumable.mp4',
      totalSizeBytes: fileBuffer.length,
    });

  assert.equal(sessionResponse.status, 200);
  const sessionId = sessionResponse.body.id;

  const chunkResponse = await request(app)
    .put(`/api/videos/uploads/sessions/${sessionId}/chunks/0`)
    .set(authHeader)
    .set('Content-Type', 'application/octet-stream')
    .send(fileBuffer);

  assert.equal(chunkResponse.status, 200);
  assert.deepEqual(chunkResponse.body.uploadedChunkIndexes, [0]);

  const completeResponse = await request(app)
    .post(`/api/videos/uploads/sessions/${sessionId}/complete`)
    .set(authHeader);

  assert.equal(completeResponse.status, 400);
  assert.equal(completeResponse.body.error.code, 'VIDEO_CODEC_UNSUPPORTED');
  assert.match(completeResponse.body.error.message, /H\.264\/AAC/);
  assert.equal((await dbRepository.listVideos()).length, videoCountBefore);

  const filesAfter = await countUploadedFiles();
  assert.deepEqual(filesAfter, filesBefore);
  assert.equal(await fs.pathExists(path.join(sessionsDir, sessionId)), false);
});

test('unsupported codec: direct upload of a corrupt file is rejected with no leftover file', async () => {
  const authHeader = await loginAsAdmin();

  const videoCountBefore = (await dbRepository.listVideos()).length;
  const filesBefore = await countUploadedFiles();

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('this is not a video'), {
      contentType: 'video/mp4',
      filename: 'corrupt.mp4',
    });

  assert.equal(uploadResponse.status, 400);
  assert.equal(uploadResponse.body.error.code, 'VIDEO_CODEC_UNSUPPORTED');
  assert.match(uploadResponse.body.error.message, /H\.264\/AAC/);
  assert.equal((await dbRepository.listVideos()).length, videoCountBefore);

  const filesAfter = await countUploadedFiles();
  assert.deepEqual(filesAfter, filesBefore);
});
