# SQLite Metadata Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AdPlay's JSON metadata store with a clean SQLite metadata store for single-VPS production use.

**Architecture:** Keep the existing `dbRepository` boundary and replace only its persistence internals. SQLite owns metadata for users, devices, profiles, profile playlists, and videos; uploaded media files and upload session manifests remain on local disk. The new runtime creates an empty SQLite schema on first start and never imports or falls back to `backend/db.json`.

**Tech Stack:** Node.js, TypeScript, Express, `better-sqlite3`, SQLite WAL mode, Node built-in test runner, Supertest.

## Global Constraints

- SQLite starts clean: no automatic migration from `backend/db.json`.
- No manual migration script from `backend/db.json`.
- `backend/db.json` is legacy only and must not be read as a fallback.
- Runtime metadata default path is `backend/db.sqlite`.
- Existing `DB_FILE` env var remains the override and always means a SQLite database path.
- SQLite startup PRAGMAs: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`.
- Keep current `dbRepository` API exported from `backend/src/db.ts`.
- Keep route, service, and frontend API behavior compatible unless existing tests expose a necessary adjustment.
- Do not adopt an ORM.
- Do not change local media file storage or upload session storage.
- Do not add MySQL/Postgres support.
- Production backups must include the SQLite database and `backend/uploads/`.

---

## File Structure

- Modify `backend/package.json`: remove `lowdb`, add `better-sqlite3`, add `@types/better-sqlite3`.
- Modify `backend/package-lock.json`: regenerate through npm dependency commands.
- Modify `backend/src/config.ts`: change default `dbFile` from `../db.json` to `../db.sqlite` and ensure the parent directory exists before DB open.
- Modify `backend/src/db.ts`: replace JSON cache implementation with SQLite connection, schema initialization, row mappers, and repository methods.
- Modify `backend/.env.example`: update `DB_FILE` comment to SQLite.
- Modify `backend/test/api.test.js`: use temp `.sqlite` path and add assertions that the app no longer creates JSON DB files.
- Modify `backend/test/media-processing.test.js`: use temp `.sqlite` path.
- Create `backend/test/sqlite-repository.test.js`: focused repository contract tests for schema, relations, constraints, and clean-start behavior.
- Modify `README.md`: update storage model, data storage section, production notes, and backup command.

## Command Working Directories

- Run `npm`, `node --test`, and backend `rg src/...` commands from `/home/vuhuynh450/projects/adsplay/backend`.
- Run `git` commands and README-wide `rg` commands from `/home/vuhuynh450/projects/adsplay`.
- Do not run npm commands from the repository root; the backend package lives in `backend/`.

---

### Task 1: Add SQLite Dependency And Config Default

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/src/config.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: existing `getConfig(): AppConfig` from `backend/src/config.ts`.
- Produces: `getConfig().dbFile` defaulting to `path.join(__dirname, '../db.sqlite')` when `DB_FILE` is unset.

- [ ] **Step 1: Install runtime dependency and remove unused JSON DB dependency**

Run:

```bash
npm uninstall lowdb && npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3
```

Expected: command exits with status 0, `backend/package.json` contains `better-sqlite3` and `@types/better-sqlite3`, and `backend/package.json` no longer contains `lowdb`.

- [ ] **Step 2: Update the default DB path in config**

In `backend/src/config.ts`, replace:

```ts
const dbFile = process.env.DB_FILE || path.join(__dirname, '../db.json');
```

with:

```ts
const dbFile = process.env.DB_FILE || path.join(__dirname, '../db.sqlite');
```

Keep the rest of `getConfig()` unchanged in this task.

- [ ] **Step 3: Update env example DB path**

In `backend/.env.example`, replace:

```env
# DB_FILE=./db.json
```

with:

```env
# DB_FILE=./db.sqlite
```

- [ ] **Step 4: Build to verify dependency and TypeScript config are still valid**

Run:

```bash
npm run build
```

Expected:

```text
> backend@1.0.0 build
> node ./node_modules/typescript/bin/tsc
```

This should pass because `backend/src/db.ts` still does not import `better-sqlite3` yet.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/config.ts backend/.env.example
git commit -m "chore: prepare sqlite dependency and config"
```

---

### Task 2: Add Failing SQLite Repository Contract Tests

**Files:**
- Create: `backend/test/sqlite-repository.test.js`
- Modify: `backend/test/api.test.js`
- Modify: `backend/test/media-processing.test.js`

**Interfaces:**
- Consumes: built `../dist/db` export `{ dbRepository }`.
- Produces: failing tests proving SQLite runtime requirements before implementation.

- [ ] **Step 1: Create repository test file**

Create `backend/test/sqlite-repository.test.js` with this content:

```js
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
```

- [ ] **Step 2: Update existing backend tests to use `.sqlite` DB paths**

In `backend/test/api.test.js`, replace:

```js
process.env.DB_FILE = path.join(tmpRoot, 'db.json');
```

with:

```js
process.env.DB_FILE = path.join(tmpRoot, 'db.sqlite');
```

In `backend/test/media-processing.test.js`, replace:

```js
process.env.DB_FILE = path.join(tmpRoot, 'db.json');
```

with:

```js
process.env.DB_FILE = path.join(tmpRoot, 'db.sqlite');
```

- [ ] **Step 3: Run the new repository test and verify it fails for the right reason**

Run:

```bash
npm run build && node --test test/sqlite-repository.test.js
```

Expected before implementation:

```text
not ok 1 - repository creates a SQLite database and ignores legacy db.json
```

The failure should show that the DB file is not a SQLite database, because the current implementation writes JSON to `DB_FILE`.

- [ ] **Step 4: Commit failing tests**

```bash
git add backend/test/sqlite-repository.test.js backend/test/api.test.js backend/test/media-processing.test.js
git commit -m "test: define sqlite repository contract"
```

---

### Task 3: Replace JSON Repository With SQLite Repository

**Files:**
- Modify: `backend/src/db.ts`

**Interfaces:**
- Consumes: `getConfig().dbFile`, `slugify()`, and existing TypeScript types from `backend/src/types.ts`.
- Produces: same exported `dbRepository` object and same `__forceNextCreateDeviceCodeConflictForTests()` test hook.

- [ ] **Step 1: Replace JSON imports with SQLite imports**

At the top of `backend/src/db.ts`, remove `fs-extra` and add `path` plus `better-sqlite3`:

```ts
import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import fs from 'fs-extra';
import { getConfig } from './config';
import type { Device, PageKey, Profile, ProfileOrientation, User, UserRole, Video } from './types';
import { slugify } from './utils/slugify';
```

Keep `fs-extra` only for `fs.ensureDirSync(path.dirname(config.dbFile))`; do not use `fs.readJsonSync()` or `fs.writeJson()` in `db.ts` after this task.

- [ ] **Step 2: Add SQLite connection and schema initialization**

In `backend/src/db.ts`, after `const config = getConfig();`, add this schema bootstrap block:

```ts
fs.ensureDirSync(path.dirname(config.dbFile));

const sqlite = new Database(config.dbFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('synchronous = NORMAL');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    must_change_password INTEGER NOT NULL CHECK (must_change_password IN (0, 1)),
    allowed_pages TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
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

CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    orientation TEXT NOT NULL CHECK (orientation IN ('landscape', 'rotate90', 'rotate180', 'rotate270')),
    last_seen TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_videos (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (profile_id, position),
    UNIQUE (profile_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_videos_video_id ON profile_videos(video_id);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    device_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    assigned_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    last_seen TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`);
```

- [ ] **Step 3: Add row types and mappers**

Add these row types and mapper helpers in `backend/src/db.ts` above `export const dbRepository`:

```ts
interface DeviceRow {
    assigned_profile_id: string | null;
    created_at: string;
    device_code: string;
    id: string;
    last_seen: string | null;
    name: string;
    secret_hash: string;
    updated_at: string;
}

interface ProfileRow {
    created_at: string;
    id: string;
    last_seen: string | null;
    name: string;
    orientation: ProfileOrientation;
    slug: string;
    updated_at: string;
}

interface UserRow {
    allowed_pages: string;
    created_at: string;
    id: string;
    is_active: 0 | 1;
    must_change_password: 0 | 1;
    password_hash: string;
    role: UserRole;
    updated_at: string;
    username: string;
}

interface VideoRow {
    created_at: string;
    duration_seconds: number | null;
    filename: string;
    height: number | null;
    hls_manifest_path: string | null;
    id: string;
    media_type: Video['mediaType'];
    mime_type: string | null;
    original_name: string;
    poster_filename: string | null;
    processing_error: string | null;
    processing_status: Video['processingStatus'];
    size: number;
    source_filename: string;
    source_mime_type: string | null;
    source_size: number;
    storage_provider: 'local';
    stream_variant: Video['streamVariant'];
    updated_at: string;
    uploaded_at: string;
    width: number | null;
}

const toOptional = <T>(value: T | null): T | undefined => value ?? undefined;

const toDevice = (row: DeviceRow): Device => ({
    assignedProfileId: toOptional(row.assigned_profile_id),
    createdAt: row.created_at,
    deviceCode: row.device_code,
    id: row.id,
    lastSeen: toOptional(row.last_seen),
    name: row.name,
    secretHash: row.secret_hash,
    updatedAt: row.updated_at,
});

const listProfileVideoIds = (profileId: string) => sqlite
    .prepare('SELECT video_id FROM profile_videos WHERE profile_id = ? ORDER BY position ASC')
    .all(profileId)
    .map((row) => (row as { video_id: string }).video_id);

const toProfile = (row: ProfileRow): Profile => ({
    createdAt: row.created_at,
    id: row.id,
    lastSeen: toOptional(row.last_seen),
    name: row.name,
    orientation: row.orientation,
    updatedAt: row.updated_at,
    videoIds: listProfileVideoIds(row.id),
});

const parseAllowedPages = (value: string): PageKey[] => {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? [...new Set(parsed)] : ['videos', 'profiles', 'devices', 'system', 'employees'];
    } catch {
        return ['videos', 'profiles', 'devices', 'system', 'employees'];
    }
};

const toUser = (row: UserRow): User => ({
    allowedPages: parseAllowedPages(row.allowed_pages),
    createdAt: row.created_at,
    id: row.id,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    passwordHash: row.password_hash,
    role: row.role,
    updatedAt: row.updated_at,
    username: row.username,
});

const toVideo = (row: VideoRow): Video => ({
    createdAt: row.created_at,
    durationSeconds: toOptional(row.duration_seconds),
    filename: row.filename,
    height: toOptional(row.height),
    hlsManifestPath: toOptional(row.hls_manifest_path),
    id: row.id,
    mediaType: row.media_type,
    mimeType: toOptional(row.mime_type),
    originalName: row.original_name,
    posterFilename: toOptional(row.poster_filename),
    processingError: toOptional(row.processing_error),
    processingStatus: row.processing_status,
    size: row.size,
    sourceFilename: row.source_filename,
    sourceMimeType: toOptional(row.source_mime_type),
    sourceSize: row.source_size,
    storageProvider: 'local',
    streamVariant: row.stream_variant,
    updatedAt: row.updated_at,
    uploadedAt: row.uploaded_at,
    width: toOptional(row.width),
});
```

If TypeScript complains about `all()` returning `unknown[]`, cast the rows at the statement call site, as shown in `listProfileVideoIds()`.

- [ ] **Step 4: Keep normalization helpers, remove JSON cache helpers**

Keep the existing helper definitions named `createEntityId`, `inferMediaType`, `normalizeVideo`, `normalizeProfile`, `normalizeDevice`, and `normalizeUser` because repository inputs still need the same normalization behavior.

Delete these JSON-specific declarations and functions:

- `const initialData`
- `const normalizeDb`
- the `if (!fs.existsSync(config.dbFile))` block that creates JSON data
- `const dbCache`
- `let writeLock = Promise.resolve()`
- `const persist`
- `const queueWrite`
- `const mutate`

No code in `backend/src/db.ts` should call `fs.readJsonSync`, `fs.writeJson`, or mutate `dbCache` after this task.

- [ ] **Step 5: Implement read helpers and statement wrappers**

Add helpers before `dbRepository`:

```ts
const findDeviceRowById = (id: string) => sqlite
    .prepare('SELECT * FROM devices WHERE id = ?')
    .get(id) as DeviceRow | undefined;

const findProfileRowById = (id: string) => sqlite
    .prepare('SELECT * FROM profiles WHERE id = ?')
    .get(id) as ProfileRow | undefined;

const findUserRowById = (id: string) => sqlite
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(id) as UserRow | undefined;

const findVideoRowById = (id: string) => sqlite
    .prepare('SELECT * FROM videos WHERE id = ?')
    .get(id) as VideoRow | undefined;

const isUniqueConstraintError = (error: unknown) =>
    error instanceof Error && error.message.includes('UNIQUE constraint failed');

const boolToInteger = (value: boolean) => (value ? 1 : 0);
```

- [ ] **Step 6: Implement repository methods with SQL**

Replace the body of the current exported `dbRepository` object with SQLite-backed methods. Use these exact SQL behaviors:

```ts
export const dbRepository = {
    async createDevice(input: { name: string; secretHash: string; deviceCode: string; id?: string }) {
        const now = new Date().toISOString();
        const newDevice = normalizeDevice({
            assignedProfileId: undefined,
            createdAt: now,
            deviceCode: input.deviceCode,
            id: input.id || createEntityId(),
            name: input.name,
            secretHash: input.secretHash,
            updatedAt: now,
        });

        if (forceNextDeviceCodeConflictForTests) {
            forceNextDeviceCodeConflictForTests = false;
            throw new Error('DEVICE_CODE_CONFLICT');
        }

        try {
            sqlite.prepare(`
                INSERT INTO devices (id, device_code, name, secret_hash, assigned_profile_id, last_seen, created_at, updated_at)
                VALUES (@id, @deviceCode, @name, @secretHash, @assignedProfileId, @lastSeen, @createdAt, @updatedAt)
            `).run(newDevice);
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new Error('DEVICE_CODE_CONFLICT');
            }
            throw error;
        }

        return { ...newDevice };
    },
    async listDevices() {
        return (sqlite.prepare('SELECT * FROM devices ORDER BY created_at ASC').all() as DeviceRow[]).map(toDevice);
    },
    async findDeviceById(id: string) {
        const row = findDeviceRowById(id);
        return row ? toDevice(row) : null;
    },
    async findDeviceByCode(deviceCode: string) {
        const row = sqlite.prepare('SELECT * FROM devices WHERE device_code = ?').get(deviceCode) as DeviceRow | undefined;
        return row ? toDevice(row) : null;
    },
    async updateDeviceName(id: string, name: string) {
        const updatedAt = new Date().toISOString();
        sqlite.prepare('UPDATE devices SET name = ?, updated_at = ? WHERE id = ?').run(name, updatedAt, id);
        const row = findDeviceRowById(id);
        return row ? toDevice(row) : null;
    },
    async assignProfileToDevice(deviceId: string, profileId?: string) {
        const updatedAt = new Date().toISOString();
        sqlite.prepare('UPDATE devices SET assigned_profile_id = ?, updated_at = ? WHERE id = ?').run(profileId ?? null, updatedAt, deviceId);
        const row = findDeviceRowById(deviceId);
        return row ? toDevice(row) : null;
    },
    async updateDeviceSecretHash(id: string, secretHash: string): Promise<Device | null> {
        const updatedAt = new Date().toISOString();
        sqlite.prepare('UPDATE devices SET secret_hash = ?, updated_at = ? WHERE id = ?').run(secretHash, updatedAt, id);
        const row = findDeviceRowById(id);
        return row ? toDevice(row) : null;
    },
    async touchDevice(id: string, heartbeatAt: string) {
        sqlite.prepare('UPDATE devices SET last_seen = ?, updated_at = ? WHERE id = ?').run(heartbeatAt, heartbeatAt, id);
        const row = findDeviceRowById(id);
        return row ? toDevice(row) : null;
    },
    async deleteDevice(id: string) {
        const result = sqlite.prepare('DELETE FROM devices WHERE id = ?').run(id);
        return result.changes > 0;
    },
    async findProfileById(id: string) {
        const row = findProfileRowById(id);
        return row ? toProfile(row) : null;
    },
    async findProfileBySlug(profileSlug: string) {
        const row = sqlite.prepare('SELECT * FROM profiles WHERE slug = ?').get(profileSlug) as ProfileRow | undefined;
        return row ? toProfile(row) : null;
    },
    async findUserByUsername(username: string) {
        const row = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
        return row ? toUser(row) : null;
    },
    async createUser(input: { username: string; passwordHash: string; role: UserRole; isActive: boolean; mustChangePassword: boolean; allowedPages: PageKey[] }) {
        const now = new Date().toISOString();
        const user = normalizeUser({
            id: createEntityId(),
            username: input.username,
            passwordHash: input.passwordHash,
            role: input.role,
            isActive: input.isActive,
            mustChangePassword: input.mustChangePassword,
            allowedPages: input.allowedPages,
            createdAt: now,
            updatedAt: now,
        });
        sqlite.prepare(`
            INSERT INTO users (id, username, password_hash, role, is_active, must_change_password, allowed_pages, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(user.id, user.username, user.passwordHash, user.role, boolToInteger(user.isActive), boolToInteger(user.mustChangePassword), JSON.stringify(user.allowedPages), user.createdAt, user.updatedAt);
        return { ...user };
    },
    async updateUser(id: string, updater: (user: User) => void) {
        const row = findUserRowById(id);
        if (!row) return null;
        const user = toUser(row);
        updater(user);
        user.updatedAt = new Date().toISOString();
        const normalized = normalizeUser(user);
        sqlite.prepare(`
            UPDATE users
            SET username = ?, password_hash = ?, role = ?, is_active = ?, must_change_password = ?, allowed_pages = ?, updated_at = ?
            WHERE id = ?
        `).run(normalized.username, normalized.passwordHash, normalized.role, boolToInteger(normalized.isActive), boolToInteger(normalized.mustChangePassword), JSON.stringify(normalized.allowedPages), normalized.updatedAt, id);
        const updatedRow = findUserRowById(id);
        return updatedRow ? toUser(updatedRow) : null;
    },
    async deleteUsers(ids: string[]) {
        const uniqueIds = [...new Set(ids)];
        const deleteOne = sqlite.prepare("DELETE FROM users WHERE role = 'staff' AND id = ?");
        return sqlite.transaction((targetIds: string[]) => targetIds.reduce((count, id) => count + deleteOne.run(id).changes, 0))(uniqueIds);
    },
    async findVideoById(id: string) {
        const row = findVideoRowById(id);
        return row ? toVideo(row) : null;
    },
    async listProfiles() {
        return (sqlite.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all() as ProfileRow[]).map(toProfile);
    },
    async listUsers() {
        return (sqlite.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[]).map(toUser);
    },
    async listVideos() {
        return (sqlite.prepare('SELECT * FROM videos ORDER BY created_at ASC').all() as VideoRow[]).map(toVideo);
    },
    async touchProfile(id: string, heartbeatAt: string) {
        sqlite.prepare('UPDATE profiles SET last_seen = ?, updated_at = ? WHERE id = ?').run(heartbeatAt, heartbeatAt, id);
        const row = findProfileRowById(id);
        return row ? toProfile(row) : null;
    },
    async upsertProfile(input: { id?: string; name: string; orientation: ProfileOrientation; videoIds: string[] }) {
        const now = new Date().toISOString();
        const slug = slugify(input.name);
        const dedupedVideoIds = [...new Set(input.videoIds)];
        sqlite.transaction(() => {
            let profileId = input.id;
            if (profileId && findProfileRowById(profileId)) {
                sqlite.prepare('UPDATE profiles SET name = ?, slug = ?, orientation = ?, updated_at = ? WHERE id = ?')
                    .run(input.name, slug, input.orientation, now, profileId);
            } else {
                profileId = createEntityId();
                sqlite.prepare('INSERT INTO profiles (id, name, slug, orientation, last_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(profileId, input.name, slug, input.orientation, null, now, now);
            }
            sqlite.prepare('DELETE FROM profile_videos WHERE profile_id = ?').run(profileId);
            const insertPlaylistRow = sqlite.prepare('INSERT INTO profile_videos (profile_id, video_id, position) VALUES (?, ?, ?)');
            dedupedVideoIds.forEach((videoId, index) => insertPlaylistRow.run(profileId, videoId, index));
        })();
    },
    async saveVideo(input: Omit<Video, 'createdAt' | 'updatedAt'>) {
        const now = new Date().toISOString();
        const video = normalizeVideo({ ...input, createdAt: now, updatedAt: now });
        sqlite.prepare(`
            INSERT INTO videos (id, filename, source_filename, original_name, media_type, mime_type, source_mime_type, source_size, size, storage_provider, stream_variant, processing_status, processing_error, poster_filename, hls_manifest_path, duration_seconds, width, height, uploaded_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(video.id, video.filename, video.sourceFilename, video.originalName, video.mediaType, video.mimeType ?? null, video.sourceMimeType ?? null, video.sourceSize, video.size, video.storageProvider, video.streamVariant, video.processingStatus, video.processingError ?? null, video.posterFilename ?? null, video.hlsManifestPath ?? null, video.durationSeconds ?? null, video.width ?? null, video.height ?? null, video.uploadedAt, video.createdAt, video.updatedAt);
        return video;
    },
    async updateVideo(id: string, updater: (video: Video) => void) {
        const row = findVideoRowById(id);
        if (!row) return null;
        const video = toVideo(row);
        updater(video);
        video.updatedAt = new Date().toISOString();
        const normalized = normalizeVideo(video);
        sqlite.prepare(`
            UPDATE videos
            SET filename = ?, source_filename = ?, original_name = ?, media_type = ?, mime_type = ?, source_mime_type = ?, source_size = ?, size = ?, storage_provider = ?, stream_variant = ?, processing_status = ?, processing_error = ?, poster_filename = ?, hls_manifest_path = ?, duration_seconds = ?, width = ?, height = ?, uploaded_at = ?, updated_at = ?
            WHERE id = ?
        `).run(normalized.filename, normalized.sourceFilename, normalized.originalName, normalized.mediaType, normalized.mimeType ?? null, normalized.sourceMimeType ?? null, normalized.sourceSize, normalized.size, normalized.storageProvider, normalized.streamVariant, normalized.processingStatus, normalized.processingError ?? null, normalized.posterFilename ?? null, normalized.hlsManifestPath ?? null, normalized.durationSeconds ?? null, normalized.width ?? null, normalized.height ?? null, normalized.uploadedAt, normalized.updatedAt, id);
        const updatedRow = findVideoRowById(id);
        return updatedRow ? toVideo(updatedRow) : null;
    },
    async deleteProfile(id: string) {
        const result = sqlite.prepare('DELETE FROM profiles WHERE id = ?').run(id);
        return result.changes > 0;
    },
    async deleteVideo(id: string) {
        const row = findVideoRowById(id);
        const deletedVideo = row ? toVideo(row) : null;
        sqlite.prepare('DELETE FROM videos WHERE id = ?').run(id);
        return deletedVideo;
    },
};
```

After adding this block, split any long SQL strings or `.run(...)` argument lists only for readability. Do not change method names or return shapes.

- [ ] **Step 7: Run repository test and build**

Run:

```bash
npm run build && node --test test/sqlite-repository.test.js
```

Expected:

```text
ok 1 - repository creates a SQLite database and ignores legacy db.json
ok 2 - repository persists users, videos, profiles, and ordered playlists
ok 3 - repository enforces device code uniqueness and relation cleanup
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/db.ts
git commit -m "feat: store metadata in sqlite"
```

---

### Task 4: Verify Full Backend API With SQLite

**Files:**
- Modify: `backend/test/api.test.js` only if test assumptions still reference JSON behavior.
- Modify: `backend/test/media-processing.test.js` only if test assumptions still reference JSON behavior.

**Interfaces:**
- Consumes: SQLite-backed `dbRepository` from Task 3.
- Produces: passing backend test suite using temporary SQLite files.

- [ ] **Step 1: Run full backend tests**

Run:

```bash
npm test
```

Expected:

```text
> backend@1.0.0 test
> npm run build && node --test test/**/*.test.js
```

Expected final result: all backend tests pass.

- [ ] **Step 2: If tests fail due to old JSON assumptions, update only the failing assertions**

Allowed updates:

```js
process.env.DB_FILE = path.join(tmpRoot, 'db.sqlite');
```

Allowed assertion replacement if a test checks for JSON files:

```js
assert.equal(await fs.pathExists(path.join(tmpRoot, 'db.json')), false);
assert.equal(await fs.pathExists(path.join(tmpRoot, 'db.sqlite')), true);
```

Do not remove behavior tests for auth, employees, devices, profiles, uploads, or media processing.

- [ ] **Step 3: Re-run backend tests**

Run:

```bash
npm test
```

Expected: all backend tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/test/api.test.js backend/test/media-processing.test.js backend/test/sqlite-repository.test.js
git commit -m "test: run backend api tests on sqlite"
```

---

### Task 5: Update README Production And Storage Docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: SQLite behavior from Tasks 1-4.
- Produces: user-facing docs explaining SQLite, clean start, and backup.

- [ ] **Step 1: Update storage model wording**

In `README.md`, replace the storage model bullets that mention `backend/db.json` with:

```md
AdPlay uses local file storage plus a local SQLite metadata database.

- uploaded video files live under `backend/uploads/`
- generated poster and HLS assets live under `backend/uploads/processed/`
- resumable upload session state lives under `backend/uploads/.sessions/`
- app metadata lives in `backend/db.sqlite` by default
```

- [ ] **Step 2: Update data storage customization section**

Where README currently says `SQLite or Postgres instead of db.json`, replace that suggestion with a production-oriented statement:

```md
AdPlay stores metadata in SQLite by default. The cleanest seam for future storage changes is still `backend/src/db.ts`: keep the route and service layers stable and replace the repository behavior there.
```

- [ ] **Step 3: Update production backup notes**

In the production notes, replace the `db.json` backup bullet with:

```md
- keep regular backups of the SQLite database and the `uploads/` folder
- prefer SQLite's `.backup` command for live database backups, for example:

```bash
sqlite3 backend/db.sqlite ".backup '/path/to/backups/adplay-$(date +%F-%H%M%S).sqlite'"
```
```

If this creates a nested fenced-code conflict in Markdown, use a four-backtick outer fence in the README edit.

- [ ] **Step 4: Document clean-start behavior**

Add this paragraph near the storage model or production notes:

```md
SQLite starts as a clean metadata database. Old `backend/db.json` records are not imported automatically, so existing users, profiles, device registrations, and video records must be recreated manually after switching from an older JSON-backed build.
```

- [ ] **Step 5: Verify docs grep no longer presents JSON as active DB**

Run:

```bash
rg "db\.json|DB_FILE" README.md backend/.env.example
```

Expected allowed output:

```text
README.md:<line>:SQLite starts as a clean metadata database. Old `backend/db.json` records are not imported automatically, so existing users, profiles, device registrations, and video records must be recreated manually after switching from an older JSON-backed build.
README.md:<line>:- `DB_FILE`
backend/.env.example:<line>:# DB_FILE=./db.sqlite
```

No line should describe `backend/db.json` as the active runtime database.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document sqlite metadata storage"
```

---

### Task 6: Final Verification And Clean-Up

**Files:**
- Inspect: `backend/package.json`
- Inspect: `backend/src/db.ts`
- Inspect: `backend/.env.example`
- Inspect: `README.md`

**Interfaces:**
- Consumes: completed SQLite implementation and docs.
- Produces: verified branch ready for review/merge.

- [ ] **Step 1: Verify `lowdb` is gone and `better-sqlite3` exists**

Run:

```bash
npm ls lowdb better-sqlite3
```

Expected: output contains `better-sqlite3` under `backend@1.0.0`, and `lowdb` does not appear as an installed dependency of the backend package.

- [ ] **Step 2: Verify no JSON DB file APIs remain in runtime DB module**

Run:

```bash
rg "readJsonSync|writeJson|dbCache|initialData|lowdb" src/db.ts package.json
```

Expected: no matches.

- [ ] **Step 3: Run backend build**

Run:

```bash
npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 4: Run backend test suite**

Run:

```bash
npm test
```

Expected: all backend tests pass.

- [ ] **Step 5: Inspect git diff before review**

Run:

```bash
git status --short && git diff --stat
```

Expected files changed are limited to backend SQLite implementation, backend tests, backend dependency files, env example, and README.

- [ ] **Step 6: Commit final fixes if any were needed**

If Step 1-5 required final edits, commit them:

```bash
git add backend/package.json backend/package-lock.json backend/src/db.ts backend/test/api.test.js backend/test/media-processing.test.js backend/test/sqlite-repository.test.js backend/.env.example README.md
git commit -m "chore: finalize sqlite metadata store"
```

If no final edits were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: Tasks 1-6 cover SQLite dependency, default path, clean schema startup, no `db.json` fallback, repository API compatibility, WAL PRAGMAs, foreign keys, backend tests, docs, and backup guidance.
- Migration scope: Plan explicitly excludes automatic and manual migration from `backend/db.json`.
- Type consistency: Existing `dbRepository` method names and return shapes are preserved.
- Test flow: Task 2 adds failing tests first; Task 3 implements SQLite; Task 4 runs existing API tests; Task 6 performs final verification.
