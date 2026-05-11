import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { AppError } from '../errors';
import { dbRepository } from '../db';
import { slugify } from '../utils/slugify';
import type { PageKey } from '../types';

const config = getConfig();

export interface AdminAuthUserView {
    id: string;
    username: string;
    role: 'admin' | 'staff';
    allowedPages: PageKey[];
    mustChangePassword: boolean;
}

export interface AdminTokenPayload extends jwt.JwtPayload {
    tokenType: 'admin';
    userId: string;
    username: string;
    role: 'admin' | 'staff';
}

export interface ProfileHeartbeatTokenPayload extends jwt.JwtPayload {
    profileId: string;
    profileSlug: string;
    tokenType: 'profile-heartbeat';
}

export interface DeviceTokenPayload extends jwt.JwtPayload {
    deviceId: string;
    deviceSecret: string;
    tokenType: 'device';
}

const verifySignedToken = (token: string) => {
    try {
        return jwt.verify(token, config.jwtSecret);
    } catch {
        throw new AppError(403, 'AUTH_INVALID', 'Authentication token is invalid.');
    }
};

const isAdminTokenPayload = (payload: string | jwt.JwtPayload): payload is AdminTokenPayload =>
    typeof payload !== 'string' &&
    payload.tokenType === 'admin' &&
    typeof payload.userId === 'string' &&
    typeof payload.username === 'string' &&
    (payload.role === 'admin' || payload.role === 'staff');

const isProfileHeartbeatTokenPayload = (
    payload: string | jwt.JwtPayload,
): payload is ProfileHeartbeatTokenPayload =>
    typeof payload !== 'string' &&
    payload.tokenType === 'profile-heartbeat' &&
    typeof payload.profileId === 'string' &&
    typeof payload.profileSlug === 'string';

const isDeviceTokenPayload = (payload: string | jwt.JwtPayload): payload is DeviceTokenPayload =>
    typeof payload !== 'string' &&
    payload.tokenType === 'device' &&
    typeof payload.deviceId === 'string' &&
    typeof payload.deviceSecret === 'string';

export const login = async (username: string, password: string) => {
    const dbUser = await dbRepository.findUserByUsername(username);

    let isValid = false;
    let user: AdminAuthUserView | null = null;

    if (dbUser) {
        isValid = await bcrypt.compare(password, dbUser.passwordHash);
        if (isValid) {
            if (!dbUser.isActive) {
                throw new AppError(403, 'ACCOUNT_INACTIVE', 'Account is inactive.');
            }
            user = {
                id: dbUser.id,
                username: dbUser.username,
                role: dbUser.role,
                allowedPages: dbUser.allowedPages,
                mustChangePassword: dbUser.mustChangePassword,
            };
        }
    } else if (username === config.adminUsername && password === config.adminPassword) {
        isValid = true;
        user = {
            id: 'default-admin',
            username: config.adminUsername,
            role: 'admin',
            allowedPages: ['videos', 'profiles', 'devices', 'system', 'employees'],
            mustChangePassword: false,
        };
    }

    if (!isValid || !user) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    }

    const token = jwt.sign(
        {
            tokenType: 'admin',
            userId: user.id,
            username: user.username,
            role: user.role,
        },
        config.jwtSecret,
        { expiresIn: '24h' }
    );

    return { token, user };
};

export const verifyAdminToken = (token: string) => {
    const payload = verifySignedToken(token);
    if (!isAdminTokenPayload(payload)) {
        throw new AppError(403, 'AUTH_INVALID', 'Authentication token is invalid.');
    }

    return payload;
};

export const changePasswordFirstLogin = async (username: string, newPassword: string) => {
    const user = await dbRepository.findUserByUsername(username);
    if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    if (!user.mustChangePassword) {
        throw new AppError(400, 'PASSWORD_CHANGE_NOT_REQUIRED', 'Password change is not required.');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    const updated = await dbRepository.updateUser(user.id, (draft) => {
        draft.passwordHash = newPasswordHash;
        draft.mustChangePassword = false;
    });

    if (!updated) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    return login(username, newPassword);
};

export const createProfileHeartbeatToken = (profile: { id: string; name: string }) =>
    jwt.sign(
        {
            profileId: profile.id,
            profileSlug: slugify(profile.name),
            tokenType: 'profile-heartbeat',
        },
        config.jwtSecret,
        { expiresIn: '30d' },
    );

export const verifyProfileHeartbeatToken = (token: string, expectedSlug: string) => {
    const payload = verifySignedToken(token);
    if (!isProfileHeartbeatTokenPayload(payload) || payload.profileSlug !== expectedSlug) {
        throw new AppError(403, 'PROFILE_HEARTBEAT_INVALID', 'Player heartbeat token is invalid.');
    }

    return payload;
};

export const createDeviceToken = (device: { id: string; deviceSecret: string }) =>
    jwt.sign(
        {
            deviceId: device.id,
            deviceSecret: device.deviceSecret,
            tokenType: 'device',
        },
        config.jwtSecret,
        { expiresIn: '30d' },
    );

export const verifyDeviceToken = (token: string, expectedDeviceId: string) => {
    let payload: string | jwt.JwtPayload;

    try {
        payload = verifySignedToken(token);
    } catch {
        throw new AppError(403, 'DEVICE_TOKEN_INVALID', 'Device token is invalid.');
    }

    if (!isDeviceTokenPayload(payload) || payload.deviceId !== expectedDeviceId) {
        throw new AppError(403, 'DEVICE_TOKEN_INVALID', 'Device token is invalid.');
    }

    return payload;
};
