import crypto from 'node:crypto';
import fs from 'fs-extra';
import { getConfig } from './config';
import type { DatabaseSchema, Device, PageKey, Profile, ProfileOrientation, User, UserRole, Video } from './types';
import { slugify } from './utils/slugify';

const config = getConfig();

const initialData: DatabaseSchema = {
    devices: [],
    profiles: [],
    users: [],
    videos: [],
};

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
        storageProvider: video.storageProvider || 'local',
        r2ObjectKey: video.r2ObjectKey,
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

const normalizeDb = (db: Partial<DatabaseSchema>): DatabaseSchema => ({
    devices: (db.devices || []).map(normalizeDevice),
    profiles: (db.profiles || []).map(normalizeProfile),
    users: (db.users || []).map(normalizeUser),
    videos: (db.videos || []).map(normalizeVideo),
});

if (!fs.existsSync(config.dbFile)) {
    fs.writeJsonSync(config.dbFile, initialData, { spaces: 2 });
}

const dbCache = normalizeDb(fs.readJsonSync(config.dbFile));

let writeLock = Promise.resolve();

const persist = async () => {
    await fs.writeJson(config.dbFile, dbCache, { spaces: 2 });
};

const queueWrite = async () => {
    writeLock = writeLock.catch(() => undefined).then(() => persist());
    await writeLock;
};

const mutate = async (updater: (db: DatabaseSchema) => void) => {
    updater(dbCache);
    dbCache.videos = dbCache.videos.map(normalizeVideo);
    dbCache.profiles = dbCache.profiles.map(normalizeProfile);
    dbCache.devices = dbCache.devices.map(normalizeDevice);
    dbCache.users = dbCache.users.map(normalizeUser);
    await queueWrite();
    return dbCache;
};

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

        await mutate((db) => {
            if (forceNextDeviceCodeConflictForTests) {
                forceNextDeviceCodeConflictForTests = false;
                throw new Error('DEVICE_CODE_CONFLICT');
            }

            const duplicate = db.devices.find((device) => device.deviceCode === newDevice.deviceCode);
            if (duplicate) {
                throw new Error('DEVICE_CODE_CONFLICT');
            }
            db.devices.push(newDevice);
        });

        return { ...newDevice };
    },
    async listDevices() {
        return dbCache.devices.map((device) => ({ ...device }));
    },
    async findDeviceById(id: string) {
        return dbCache.devices.find((device) => device.id === id) || null;
    },
    async findDeviceByCode(deviceCode: string) {
        return dbCache.devices.find((device) => device.deviceCode === deviceCode) || null;
    },
    async updateDeviceName(id: string, name: string) {
        let updatedDevice: Device | null = null;
        await mutate((db) => {
            const target = db.devices.find((device) => device.id === id);
            if (!target) {
                return;
            }

            target.name = name;
            target.updatedAt = new Date().toISOString();
            updatedDevice = { ...target };
        });
        return updatedDevice;
    },
    async assignProfileToDevice(deviceId: string, profileId?: string) {
        let updatedDevice: Device | null = null;
        await mutate((db) => {
            const target = db.devices.find((device) => device.id === deviceId);
            if (!target) {
                return;
            }

            target.assignedProfileId = profileId;
            target.updatedAt = new Date().toISOString();
            updatedDevice = { ...target };
        });
        return updatedDevice;
    },
    async updateDeviceSecretHash(id: string, secretHash: string): Promise<Device | null> {
        let updatedDevice: Device | null = null;
        await mutate((db) => {
            const target = db.devices.find((device) => device.id === id);
            if (!target) {
                return;
            }

            target.secretHash = secretHash;
            target.updatedAt = new Date().toISOString();
            updatedDevice = { ...target };
        });
        return updatedDevice;
    },
    async touchDevice(id: string, heartbeatAt: string) {
        let updatedDevice: Device | null = null;
        await mutate((db) => {
            const target = db.devices.find((device) => device.id === id);
            if (!target) {
                return;
            }

            target.lastSeen = heartbeatAt;
            target.updatedAt = heartbeatAt;
            updatedDevice = { ...target };
        });
        return updatedDevice;
    },
    async deleteDevice(id: string) {
        let deleted = false;
        await mutate((db) => {
            const index = db.devices.findIndex((device) => device.id === id);
            if (index === -1) {
                return;
            }

            db.devices.splice(index, 1);
            deleted = true;
        });
        return deleted;
    },
    async findProfileById(id: string) {
        return dbCache.profiles.find((profile) => profile.id === id) || null;
    },
    async findProfileBySlug(profileSlug: string) {
        return dbCache.profiles.find((profile) => slugify(profile.name) === profileSlug) || null;
    },
    async findUserByUsername(username: string) {
        return dbCache.users.find((user) => user.username === username) || null;
    },
    async createUser(input: { username: string; passwordHash: string; role: UserRole; isActive: boolean; mustChangePassword: boolean; allowedPages: PageKey[] }) {
        const now = new Date().toISOString();
        const newUser = normalizeUser({
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

        await mutate((db) => {
            db.users.push(newUser);
        });

        return { ...newUser };
    },
    async updateUser(id: string, updater: (user: User) => void) {
        let updatedUser: User | null = null;
        await mutate((db) => {
            const target = db.users.find((user) => user.id === id);
            if (!target) {
                return;
            }

            updater(target);
            target.updatedAt = new Date().toISOString();
            updatedUser = { ...target };
        });
        return updatedUser;
    },
    async deleteUsers(ids: string[]) {
        const targetIds = new Set(ids);
        let deletedCount = 0;
        await mutate((db) => {
            const remainingUsers = db.users.filter((user) => {
                if (user.role !== 'staff' || !targetIds.has(user.id)) {
                    return true;
                }

                deletedCount += 1;
                return false;
            });

            db.users = remainingUsers;
        });
        return deletedCount;
    },
    async findVideoById(id: string) {
        return dbCache.videos.find((video) => video.id === id) || null;
    },
    async listProfiles() {
        return dbCache.profiles.map((profile) => ({ ...profile }));
    },
    async listUsers() {
        return dbCache.users.map((user) => ({ ...user }));
    },
    async listVideos() {
        return dbCache.videos.map((video) => ({ ...video }));
    },
    async touchProfile(id: string, heartbeatAt: string) {
        return mutate((db) => {
            const profile = db.profiles.find((item) => item.id === id);
            if (!profile) {
                return;
            }

            profile.lastSeen = heartbeatAt;
            profile.updatedAt = heartbeatAt;
        });
    },
    async upsertProfile(input: { id?: string; name: string; orientation: ProfileOrientation; videoIds: string[] }) {
        const now = new Date().toISOString();

        await mutate((db) => {
            if (input.id) {
                const existing = db.profiles.find((profile) => profile.id === input.id);
                if (existing) {
                    existing.name = input.name;
                    existing.orientation = input.orientation;
                    existing.videoIds = [...new Set(input.videoIds)];
                    existing.updatedAt = now;
                    return;
                }
            }

            db.profiles.push(
                normalizeProfile({
                    createdAt: now,
                    id: createEntityId(),
                    name: input.name,
                    orientation: input.orientation,
                    updatedAt: now,
                    videoIds: input.videoIds,
                }),
            );
        });
    },
    async saveVideo(input: Omit<Video, 'createdAt' | 'updatedAt'>) {
        const now = new Date().toISOString();
        const newVideo = normalizeVideo({
            ...input,
            createdAt: now,
            updatedAt: now,
        });

        await mutate((db) => {
            db.videos.push(newVideo);
        });

        return newVideo;
    },
    async updateVideo(id: string, updater: (video: Video) => void) {
        let updatedVideo: Video | null = null;
        await mutate((db) => {
            const target = db.videos.find((video) => video.id === id);
            if (!target) {
                return;
            }

            updater(target);
            target.updatedAt = new Date().toISOString();
            updatedVideo = { ...target };
        });
        return updatedVideo;
    },
    async deleteProfile(id: string) {
        let deleted = false;
        await mutate((db) => {
            const before = db.profiles.length;
            db.profiles = db.profiles.filter((profile) => profile.id !== id);
            db.devices = db.devices.map((device) =>
                device.assignedProfileId === id
                    ? { ...device, assignedProfileId: undefined, updatedAt: new Date().toISOString() }
                    : device,
            );
            deleted = db.profiles.length !== before;
        });
        return deleted;
    },
    async deleteVideo(id: string) {
        let deletedVideo: Video | null = null;
        await mutate((db) => {
            const target = db.videos.find((video) => video.id === id) || null;
            deletedVideo = target ? { ...target } : null;
            db.videos = db.videos.filter((video) => video.id !== id);
            db.profiles = db.profiles.map((profile) => ({
                ...profile,
                updatedAt: new Date().toISOString(),
                videoIds: profile.videoIds.filter((videoId) => videoId !== id),
            }));
        });
        return deletedVideo;
    },
};
