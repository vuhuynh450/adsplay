import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { dbRepository } from '../db';
import { AppError } from '../errors';
import type {
    AdminDevice,
    Device,
    PlayerDeviceBinding,
    PlayerProfile,
    Profile,
    Video,
} from '../types';
import { slugify } from '../utils/slugify';
import { createDeviceToken, verifyDeviceToken } from './auth.service';

const toVideoMap = (videos: Video[]) => new Map(videos.map((video) => [video.id, video] as const));
const toProfileSlug = (profile: Pick<Profile, 'name'>) => slugify(profile.name);

const toAdminDevice = (device: Device): AdminDevice => ({
    assignedProfileId: device.assignedProfileId,
    createdAt: device.createdAt,
    deviceCode: device.deviceCode,
    id: device.id,
    lastSeen: device.lastSeen,
    name: device.name,
    updatedAt: device.updatedAt,
});

const toPlayerProfile = async (profile: Profile): Promise<PlayerProfile> => {
    const videos = await dbRepository.listVideos();
    const videosById = toVideoMap(videos);

    return {
        name: profile.name,
        orientation: profile.orientation,
        slug: toProfileSlug(profile),
        videos: profile.videoIds
            .map((videoId) => videosById.get(videoId))
            .filter((video): video is Video => Boolean(video)),
    };
};

interface PendingDeviceRegistration {
    createdAt: string;
    deviceCode: string;
    expiresAt: string;
    lastSeenAt: string;
    name: string;
    requestId: string;
    confirmedCredentials?: {
        deviceCode: string;
        deviceId: string;
        deviceToken: string;
    };
}

const PENDING_DEVICE_REGISTRATION_TTL_MS = 10 * 60 * 1000;
const PENDING_DEVICE_REGISTRATION_STALE_MS = 30 * 1000;
const pendingDeviceRegistrations = new Map<string, PendingDeviceRegistration>();

const purgeExpiredPendingDeviceRegistrations = () => {
    const now = Date.now();
    for (const [requestId, registration] of pendingDeviceRegistrations) {
        const isExpired = new Date(registration.expiresAt).getTime() <= now;
        const isStalePending =
            !registration.confirmedCredentials &&
            now - new Date(registration.lastSeenAt).getTime() >= PENDING_DEVICE_REGISTRATION_STALE_MS;

        if (isExpired || isStalePending) {
            pendingDeviceRegistrations.delete(requestId);
        }
    }
};

const findPendingByCode = (deviceCode: string) => {
    const now = Date.now();
    for (const registration of pendingDeviceRegistrations.values()) {
        if (registration.deviceCode !== deviceCode) {
            continue;
        }

        if (new Date(registration.expiresAt).getTime() <= now) {
            continue;
        }

        return registration;
    }

    return null;
};

const requireDevice = async (id: string) => {
    const device = await dbRepository.findDeviceById(id);
    if (!device) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    }

    return device;
};

const verifyDeviceAccess = async (deviceId: string, token: string) => {
    const payload = verifyDeviceToken(token, deviceId);
    const device = await requireDevice(deviceId);

    const isValidSecret = await bcrypt.compare(payload.deviceSecret, device.secretHash);
    if (!isValidSecret) {
        throw new AppError(403, 'DEVICE_TOKEN_INVALID', 'Device token is invalid.');
    }

    return device;
};

let generateDeviceCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

const isDeviceCodeConflictError = (error: unknown) =>
    error instanceof Error && error.message === 'DEVICE_CODE_CONFLICT';

export const registerDeviceForPlayer = async (name?: string) => {
    purgeExpiredPendingDeviceRegistrations();

    const maxAttempts = 10;

    for (let index = 0; index < maxAttempts; index += 1) {
        const candidateCode = generateDeviceCode();
        const existing = await dbRepository.findDeviceByCode(candidateCode);
        if (existing || findPendingByCode(candidateCode)) {
            continue;
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + PENDING_DEVICE_REGISTRATION_TTL_MS);
        const requestId = crypto.randomUUID();

        pendingDeviceRegistrations.set(requestId, {
            createdAt: now.toISOString(),
            deviceCode: candidateCode,
            expiresAt: expiresAt.toISOString(),
            lastSeenAt: now.toISOString(),
            name: name?.trim() || 'TV Device',
            requestId,
        });

        return {
            deviceCode: candidateCode,
            expiresAt: expiresAt.toISOString(),
            requestId,
        };
    }

    throw new AppError(500, 'DEVICE_CODE_GENERATION_FAILED', 'Failed to generate a unique device code.');
};

export const getPendingDeviceRegistrationStatusForPlayer = async (requestId: string) => {
    purgeExpiredPendingDeviceRegistrations();

    const registration = pendingDeviceRegistrations.get(requestId);
    if (!registration) {
        throw new AppError(404, 'DEVICE_REGISTRATION_NOT_FOUND', 'Device registration request was not found.');
    }

    if (registration.confirmedCredentials) {
        return {
            ...registration.confirmedCredentials,
            status: 'confirmed' as const,
        };
    }

    registration.lastSeenAt = new Date().toISOString();

    return {
        deviceCode: registration.deviceCode,
        expiresAt: registration.expiresAt,
        requestId: registration.requestId,
        status: 'pending' as const,
    };
};

export const listPendingDeviceRegistrationsForAdmin = async () => {
    purgeExpiredPendingDeviceRegistrations();

    return [...pendingDeviceRegistrations.values()]
        .filter((registration) => !registration.confirmedCredentials)
        .map((registration) => ({
            createdAt: registration.createdAt,
            expiresAt: registration.expiresAt,
            requestId: registration.requestId,
        }));
};

export const confirmPendingDeviceRegistrationForAdmin = async (requestId: string, deviceCode: string) => {
    purgeExpiredPendingDeviceRegistrations();

    const registration = pendingDeviceRegistrations.get(requestId);
    if (!registration) {
        throw new AppError(404, 'DEVICE_REGISTRATION_NOT_FOUND', 'Device registration request was not found.');
    }

    const normalizedDeviceCode = deviceCode.trim().toUpperCase();
    if (registration.deviceCode !== normalizedDeviceCode) {
        throw new AppError(409, 'DEVICE_CODE_MISMATCH', 'Device code does not match this request.');
    }

    if (registration.confirmedCredentials) {
        const existingDevice = await dbRepository.findDeviceById(registration.confirmedCredentials.deviceId);
        if (!existingDevice) {
            throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
        }

        return toAdminDevice(existingDevice);
    }

    const deviceSecret = crypto.randomBytes(24).toString('hex');
    const secretHash = await bcrypt.hash(deviceSecret, 10);

    let device: Device;
    try {
        device = await dbRepository.createDevice({
            deviceCode: registration.deviceCode,
            name: registration.name,
            secretHash,
        });
    } catch (error) {
        if (isDeviceCodeConflictError(error)) {
            throw new AppError(409, 'DEVICE_CODE_ALREADY_USED', 'Device code is already used. Please retry registration.');
        }
        throw error;
    }

    registration.confirmedCredentials = {
        deviceCode: device.deviceCode,
        deviceId: device.id,
        deviceToken: createDeviceToken({ deviceSecret, id: device.id }),
    };

    return toAdminDevice(device);
};

export const listDevicesForAdmin = async () => {
    const devices = await dbRepository.listDevices();
    return devices.map(toAdminDevice);
};

export const assignDeviceToProfile = async (deviceId: string, profileId: string) => {
    await requireDevice(deviceId);

    const profile = await dbRepository.findProfileById(profileId);
    if (!profile) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
    }

    const device = await dbRepository.assignProfileToDevice(deviceId, profileId);
    if (!device) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    }

    return toAdminDevice(device);
};

export const unassignDeviceFromProfile = async (deviceId: string) => {
    await requireDevice(deviceId);

    const device = await dbRepository.assignProfileToDevice(deviceId, undefined);
    if (!device) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    }

    return toAdminDevice(device);
};

export const renameDeviceForAdmin = async (deviceId: string, name: string) => {
    await requireDevice(deviceId);

    const device = await dbRepository.updateDeviceName(deviceId, name);
    if (!device) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    }

    return toAdminDevice(device);
};

export const deleteDeviceForAdmin = async (deviceId: string) => {
    await requireDevice(deviceId);

    const deleted = await dbRepository.deleteDevice(deviceId);
    if (!deleted) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    }

    return { success: true };
};

export const getPlayerBindingByDevice = async (
    deviceId: string,
    token: string,
): Promise<PlayerDeviceBinding> => {
    const device = await verifyDeviceAccess(deviceId, token);
    if (!device.assignedProfileId) {
        throw new AppError(409, 'DEVICE_NOT_ASSIGNED', 'Device is not assigned to a profile.');
    }

    const profile = await dbRepository.findProfileById(device.assignedProfileId);
    if (!profile) {
        throw new AppError(409, 'DEVICE_NOT_ASSIGNED', 'Device is not assigned to a valid profile.');
    }

    return {
        device: toAdminDevice(device),
        profile: await toPlayerProfile(profile),
    };
};

export const heartbeatDevice = async (deviceId: string, token: string) => {
    await verifyDeviceAccess(deviceId, token);

    const device = await dbRepository.touchDevice(deviceId, new Date().toISOString());
    if (!device) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    }

    return toAdminDevice(device);
};

export const rotateDeviceTokenForAdmin = async (deviceId: string) => {
    const device = await requireDevice(deviceId);

    const deviceSecret = crypto.randomBytes(24).toString('hex');
    const secretHash = await bcrypt.hash(deviceSecret, 10);
    const updatedDevice = await dbRepository.updateDeviceSecretHash(device.id, secretHash);

    if (!updatedDevice) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    }

    return {
        deviceCode: updatedDevice.deviceCode,
        deviceId: updatedDevice.id,
        deviceToken: createDeviceToken({ deviceSecret, id: updatedDevice.id }),
    };
};

export const __setDeviceCodeGeneratorForTests = (generator: () => string) => {
    generateDeviceCode = generator;
};

export const __resetDeviceCodeGeneratorForTests = () => {
    generateDeviceCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
};

export const __resetPendingDeviceRegistrationsForTests = () => {
    pendingDeviceRegistrations.clear();
};
