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
const {
  validateHlsOnlySource,
  packageHlsOnly,
  enqueueVideoProcessing,
} = require('../dist/services/media.service');

const app = createApp();

const loginAsAdmin = async () => {
  const loginResponse = await request(app).post('/api/auth/login').send({
    password: 'vuhuynh450',
    username: 'vuhuynh450',
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

test('media processing packages an uploaded video as HLS-only and removes the source file', async () => {
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

  assert.equal(processedVideo.streamVariant, 'hls-only');
  assert.ok(processedVideo.hlsManifestPath);
  assert.equal(
    await fs.pathExists(path.join(process.env.UPLOADS_DIR, processedVideo.sourceFilename)),
    false,
  );
  assert.equal(processedVideo.filename, processedVideo.sourceFilename);
  assert.equal(processedVideo.mimeType, processedVideo.sourceMimeType);
  assert.equal(processedVideo.size, sourceStats.size);
  assert.equal(processedVideo.processingError, undefined);
  assert.ok(processedVideo.posterFilename);

  const streamResponse = await request(app)
    .get(`/api/videos/${processedVideo.id}/stream`)
    .set('Range', 'bytes=0-7');

  assert.equal(streamResponse.status, 409);
  assert.equal(streamResponse.body.error.code, 'VIDEO_STREAM_HLS_ONLY');
});

test('HLS-only: accepts an H.264 source with no audio track', async () => {
  const sourcePath = path.join(tmpRoot, 'supported-h264.mp4');

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
    sourcePath,
  ]);

  const metadata = await validateHlsOnlySource(sourcePath);

  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 180);
  assert.ok(metadata.durationSeconds > 0);
});

test('HLS-only: accepts an H.264 source with an AAC audio track', async () => {
  const sourcePath = path.join(tmpRoot, 'supported-h264-aac.mp4');

  await execFileAsync(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=15',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:duration=1',
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
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    sourcePath,
  ]);

  const metadata = await validateHlsOnlySource(sourcePath);

  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 180);
});

test('HLS-only: rejects an HEVC source with VIDEO_CODEC_UNSUPPORTED', async () => {
  const sourcePath = path.join(tmpRoot, 'unsupported-hevc.mp4');

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
    sourcePath,
  ]);

  await assert.rejects(
    () => validateHlsOnlySource(sourcePath),
    (error) => error.code === 'VIDEO_CODEC_UNSUPPORTED',
  );
});

test('HLS-only: rejects a source with non-AAC audio with VIDEO_CODEC_UNSUPPORTED', async () => {
  const sourcePath = path.join(tmpRoot, 'unsupported-mp3-audio.mp4');

  await execFileAsync(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=15',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:duration=1',
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
    '-c:a',
    'libmp3lame',
    '-shortest',
    sourcePath,
  ]);

  await assert.rejects(
    () => validateHlsOnlySource(sourcePath),
    (error) => error.code === 'VIDEO_CODEC_UNSUPPORTED',
  );
});

test('HLS-only: packages a compatible source into a playlist plus segments with stream copy', async () => {
  const sourcePath = path.join(tmpRoot, 'supported-h264.mp4');
  const hlsDir = path.join(tmpRoot, 'uploads', 'processed', 'hls', 'hls-only-test-video');

  await execFileAsync(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=15',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '12',
    '-pix_fmt',
    'yuv420p',
    sourcePath,
  ]);

  const result = await packageHlsOnly(sourcePath, 'hls-only-test-video');

  assert.equal(result.hlsManifestPath, path.join(hlsDir, 'playlist.m3u8'));
  assert.ok(await fs.pathExists(path.join(hlsDir, 'playlist.m3u8')));
  assert.ok(await fs.pathExists(path.join(hlsDir, 'segment-000.ts')));

  const playlistContent = await fs.readFile(path.join(hlsDir, 'playlist.m3u8'), 'utf8');
  assert.match(playlistContent, /segment-000\.ts/);

  const segmentStats = await fs.stat(path.join(hlsDir, 'segment-000.ts'));
  assert.ok(segmentStats.size > 0);
});

const waitForVideoFailed = async (videoId) => {
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    const video = await dbRepository.findVideoById(videoId);
    if (video?.processingStatus === 'failed') {
      return video;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Video processing did not fail in time.');
};

test('media processing keeps the source file and marks the video failed when HLS generation fails', async () => {
  const videoId = 'failure-path-video-id';
  const sourceFilename = 'failure-path-source.mp4';
  const sourcePath = path.join(process.env.UPLOADS_DIR, sourceFilename);

  await fs.writeFile(sourcePath, Buffer.from('not a real video'));
  await dbRepository.saveVideo({
    id: videoId,
    filename: sourceFilename,
    sourceFilename,
    originalName: 'failure-path-source.mp4',
    mediaType: 'video',
    mimeType: 'video/mp4',
    sourceMimeType: 'video/mp4',
    sourceSize: 16,
    size: 16,
    streamVariant: 'hls-only',
    processingStatus: 'pending',
    uploadedAt: new Date().toISOString(),
  });

  await enqueueVideoProcessing(videoId);
  const failedVideo = await waitForVideoFailed(videoId);

  assert.equal(failedVideo.processingStatus, 'failed');
  assert.ok(failedVideo.processingError);
  assert.equal(failedVideo.hlsManifestPath, undefined);
  assert.equal(failedVideo.posterFilename, undefined);
  assert.equal(failedVideo.streamVariant, 'hls-only');
  assert.equal(await fs.pathExists(sourcePath), true);
});

test('HLS-only: missing ffprobe binary throws a raw config error, not a client codec error', async () => {
  const ffprobeStatic = require('ffprobe-static');
  const originalPath = ffprobeStatic.path;

  try {
    ffprobeStatic.path = undefined;

    await assert.rejects(
      () => validateHlsOnlySource(path.join(tmpRoot, 'anything.mp4')),
      (error) => error instanceof Error && error.code === undefined,
    );
  } finally {
    ffprobeStatic.path = originalPath;
  }
});
