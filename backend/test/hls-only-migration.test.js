const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-play-hls-migration-'));
const frontendDistDir = path.join(tmpRoot, 'frontend');

fs.ensureDirSync(frontendDistDir);
fs.writeFileSync(path.join(frontendDistDir, 'index.html'), '<html><body>ok</body></html>');

const dbFile = path.join(tmpRoot, 'db.sqlite');

process.env.DB_FILE = dbFile;
process.env.UPLOADS_DIR = path.join(tmpRoot, 'uploads');
process.env.FRONTEND_DIST_DIR = frontendDistDir;
process.env.JWT_SECRET = 'test-secret';

const OLD_SCHEMA_SQL = `
CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('video', 'image')),
    mime_type TEXT,
    source_mime_type TEXT,
    source_size INTEGER NOT NULL,
    size INTEGER NOT NULL,
    storage_provider TEXT NOT NULL CHECK (storage_provider = 'local'),
    stream_variant TEXT NOT NULL CHECK (stream_variant IN ('optimized', 'original')),
    processing_status TEXT NOT NULL CHECK (processing_status IN ('pending', 'processing', 'ready')),
    processing_error TEXT,
    poster_filename TEXT,
    hls_manifest_path TEXT,
    duration_seconds REAL,
    width INTEGER,
    height INTEGER,
    uploaded_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

test('videos table migration adds hls-only/failed constraints and preserves legacy rows', async () => {
  const legacyRow = {
    id: 'legacy-video-1',
    filename: 'legacy.mp4',
    source_filename: 'legacy.mp4',
    original_name: 'legacy.mp4',
    media_type: 'video',
    mime_type: 'video/mp4',
    source_mime_type: 'video/mp4',
    source_size: 100,
    size: 100,
    storage_provider: 'local',
    stream_variant: 'optimized',
    processing_status: 'ready',
    processing_error: null,
    poster_filename: null,
    hls_manifest_path: null,
    duration_seconds: 10.5,
    width: 1280,
    height: 720,
    uploaded_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const legacyDb = new Database(dbFile);
  legacyDb.exec(OLD_SCHEMA_SQL);
  legacyDb.prepare(`
    INSERT INTO videos (
        id, filename, source_filename, original_name, media_type, mime_type,
        source_mime_type, source_size, size, storage_provider, stream_variant,
        processing_status, processing_error, poster_filename, hls_manifest_path,
        duration_seconds, width, height, uploaded_at, created_at, updated_at
    )
    VALUES (
        @id, @filename, @source_filename, @original_name, @media_type, @mime_type,
        @source_mime_type, @source_size, @size, @storage_provider, @stream_variant,
        @processing_status, @processing_error, @poster_filename, @hls_manifest_path,
        @duration_seconds, @width, @height, @uploaded_at, @created_at, @updated_at
    )
  `).run(legacyRow);
  legacyDb.close();

  require('../dist/db');

  const migrated = new Database(dbFile);
  try {
    const migratedRow = migrated.prepare('SELECT * FROM videos WHERE id = ?').get('legacy-video-1');
    assert.deepEqual(migratedRow, {
      ...legacyRow,
      duration_seconds: 10.5,
      processing_error: null,
    });

    migrated
      .prepare(`
        INSERT INTO videos (
            id, filename, source_filename, original_name, media_type, mime_type,
            source_mime_type, source_size, size, storage_provider, stream_variant,
            processing_status, processing_error, poster_filename, hls_manifest_path,
            duration_seconds, width, height, uploaded_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        'hls-only-video-1',
        'new.mp4',
        'new.mp4',
        'new.mp4',
        'video',
        'video/mp4',
        'video/mp4',
        200,
        200,
        'local',
        'hls-only',
        'failed',
        'boom',
        null,
        null,
        null,
        null,
        null,
        '2026-01-02T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      );

    const tableSql = migrated
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'videos'")
      .get().sql;
    assert.match(tableSql, /stream_variant IN \('optimized', 'original', 'hls-only'\)/);
    assert.match(tableSql, /processing_status IN \('pending', 'processing', 'ready', 'failed'\)/);
  } finally {
    migrated.close();
  }
});

test.after(async () => {
  await fs.remove(tmpRoot);
});
