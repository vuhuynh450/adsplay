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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-play-media-processing-'));
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

const loginAsAdmin = async () => {
  const loginResponse = await request(app).post('/api/auth/login').send({
    password: 'admin',
    username: 'admin',
  });

  assert.equal(loginResponse.status, 200);
  assert.ok(loginResponse.body.token);

  return { Authorization: `Bearer ${loginResponse.body.token}` };
};

const waitForVideoReady = async (videoId) => {
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    const video = await dbRepository.findVideoById(videoId);
    if (video?.processingStatus === 'ready') {
      return video;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Video processing did not finish in time.');
};

test.after(async () => {
  await fs.remove(tmpRoot);
});

test('media processing keeps uploaded video as the stream source', async () => {
  const authHeader = await loginAsAdmin();
  const sourceVideoPath = path.join(tmpRoot, 'source.mp4');

  await execFileAsync(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=15',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '12',
    '-pix_fmt',
    'yuv420p',
    sourceVideoPath,
  ]);

  const sourceStats = await fs.stat(sourceVideoPath);
  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', sourceVideoPath, {
      contentType: 'video/mp4',
      filename: 'source.mp4',
    });

  assert.equal(uploadResponse.status, 200);
  const processedVideo = await waitForVideoReady(uploadResponse.body.id);

  assert.equal(processedVideo.streamVariant, 'original');
  assert.equal(processedVideo.filename, processedVideo.sourceFilename);
  assert.equal(processedVideo.mimeType, processedVideo.sourceMimeType);
  assert.equal(processedVideo.size, sourceStats.size);
  assert.equal(processedVideo.processingError, undefined);
  assert.ok(processedVideo.posterFilename);
  assert.ok(processedVideo.hlsManifestPath);

  const streamResponse = await request(app)
    .get(`/api/videos/${processedVideo.id}/stream`)
    .set('Range', 'bytes=0-7');

  assert.equal(streamResponse.status, 206);
  assert.equal(streamResponse.headers['content-type'], 'video/mp4');
});
