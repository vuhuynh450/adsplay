import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import fs from 'fs-extra';
import { getConfig } from './config';
import type { Device, PageKey, Profile, ProfileOrientation, User, UserRole, Video } from './types';
import { slugify } from './utils/slugify';

const config = getConfig();

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

const createEntityId = () => crypto.randomUUID();

const inferMediaType = (video: Partial<Video>): Video['mediaType'] => {
    if (video.mediaType) {
        return video.mediaType;
    }

    const mimeType = video.sourceMimeType || video.mimeType || '';
    return mimeType.startsWith('image/') ? 'image' : 'video';
};

const normalizeVideo = (video: Partial<Video>): Video => {
    const timestamp = video.uploadedAt || video.createdAt || new Date().toISOString();

    return {
        createdAt: video.createdAt || timestamp,
        filename: video.filename || '',
        hlsManifestPath: video.hlsManifestPath,
        durationSeconds: video.durationSeconds,
        height: video.height,
        id: video.id || createEntityId(),
        mediaType: inferMediaType(video),
        mimeType: video.mimeType,
        originalName: video.originalName || '',
        posterFilename: video.posterFilename,
        processingError: video.processingError,
        processingStatus: video.processingStatus || 'ready',
        sourceFilename: video.sourceFilename || video.filename || '',
        sourceMimeType: video.sourceMimeType || video.mimeType,
        sourceSize: video.sourceSize || video.size || 0,
        size: video.size || 0,
        storageProvider: 'local',
        streamVariant: video.streamVariant || 'original',
        updatedAt: video.updatedAt || timestamp,
        uploadedAt: video.uploadedAt || timestamp,
        width: video.width,
    };
};

const validProfileOrientations: ProfileOrientation[] = [
    'landscape',
    'rotate90',
    'rotate180',
    'rotate270',
];

const normalizeProfile = (profile: Partial<Profile>): Profile => {
    const timestamp = profile.updatedAt || profile.createdAt || new Date().toISOString();
    const rawOrientation = profile.orientation;
    const orientation = validProfileOrientations.includes(rawOrientation as ProfileOrientation)
        ? (rawOrientation as ProfileOrientation)
        : 'landscape';

    return {
        createdAt: profile.createdAt || timestamp,
        id: profile.id || createEntityId(),
        lastSeen: profile.lastSeen,
        name: profile.name || '',
        orientation,
        updatedAt: profile.updatedAt || timestamp,
        videoIds: Array.isArray(profile.videoIds) ? [...new Set(profile.videoIds)] : [],
    };
};

const normalizeDevice = (device: Partial<Device> & { profileId?: string }): Device => {
    const timestamp = device.updatedAt || device.createdAt || new Date().toISOString();

    return {
        assignedProfileId: device.assignedProfileId || device.profileId,
        createdAt: device.createdAt || timestamp,
        deviceCode: device.deviceCode || '',
        id: device.id || createEntityId(),
        lastSeen: device.lastSeen,
        name: device.name || 'TV Device',
        secretHash: device.secretHash || '',
        updatedAt: device.updatedAt || timestamp,
    };
};

const normalizeUser = (user: Partial<User>): User => {
    const now = user.updatedAt || user.createdAt || new Date().toISOString();
    return {
        id: user.id || createEntityId(),
        username: user.username || '',
        passwordHash: user.passwordHash || '',
        role: user.role === 'staff' ? 'staff' : 'admin',
        isActive: user.isActive !== false,
        mustChangePassword: Boolean(user.mustChangePassword),
        allowedPages: Array.isArray(user.allowedPages) ? [...new Set(user.allowedPages)] : ['videos', 'profiles', 'devices', 'system', 'employees'],
        createdAt: user.createdAt || now,
        updatedAt: user.updatedAt || now,
    };
};

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

let forceNextDeviceCodeConflictForTests = false;

export const __forceNextCreateDeviceCodeConflictForTests = () => {
    forceNextDeviceCodeConflictForTests = true;
};

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
        return sqlite.transaction(() => {
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
        })();
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
        return sqlite.transaction(() => {
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
        })();
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
