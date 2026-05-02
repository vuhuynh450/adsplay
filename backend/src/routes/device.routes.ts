import { Router } from 'express';
import { AppError, asyncHandler } from '../errors';
import { authenticateToken } from '../middleware/auth';
import { requirePageAccess } from '../middleware/page-access';
import {
    assignDeviceToProfile,
    confirmPendingDeviceRegistrationForAdmin,
    deleteDeviceForAdmin,
    getPendingDeviceRegistrationStatusForPlayer,
    listDevicesForAdmin,
    listPendingDeviceRegistrationsForAdmin,
    registerDeviceForPlayer,
    renameDeviceForAdmin,
    rotateDeviceTokenForAdmin,
    unassignDeviceFromProfile,
} from '../services/device.service';
import { requireNonEmptyString, requireOptionalString } from '../utils/validation';

export const deviceRouter = Router();

const readDeviceId = (value: unknown) => requireNonEmptyString(value, 'deviceId', 120);
const readDeviceName = (value: unknown) => requireNonEmptyString(value, 'name', 120);
const readProfileId = (value: unknown) => requireNonEmptyString(value, 'profileId', 120);
const readRequestId = (value: unknown) => requireNonEmptyString(value, 'requestId', 120);
const readDeviceCode = (value: unknown) => requireNonEmptyString(value, 'deviceCode', 120);

let registerRateLimitWindowMs = 60_000;
let registerRateLimitMaxRequests = 20;
const registerAttemptsByIp = new Map<string, number[]>();

const enforceRegisterRateLimit = (ip: string) => {
    const now = Date.now();
    const attempts = registerAttemptsByIp.get(ip) || [];
    const recentAttempts = attempts.filter((timestamp) => now - timestamp < registerRateLimitWindowMs);

    if (recentAttempts.length >= registerRateLimitMaxRequests) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many register requests. Please try again later.');
    }

    recentAttempts.push(now);
    registerAttemptsByIp.set(ip, recentAttempts);
};

export const __resetRegisterRateLimitForTests = () => {
    registerAttemptsByIp.clear();
    registerRateLimitWindowMs = 60_000;
    registerRateLimitMaxRequests = 20;
};

export const __configureRegisterRateLimitForTests = (input: { windowMs: number; maxRequests: number }) => {
    registerRateLimitWindowMs = input.windowMs;
    registerRateLimitMaxRequests = input.maxRequests;
};

deviceRouter.post(
    '/register',
    asyncHandler(async (req, res) => {
        enforceRegisterRateLimit(req.ip || 'unknown');
        const optionalName = requireOptionalString(req.body?.name, 'name');
        if (optionalName != null && optionalName.trim().length > 120) {
            throw new AppError(400, 'VALIDATION_ERROR', 'name must be at most 120 characters.');
        }
        const device = await registerDeviceForPlayer(optionalName);
        res.setHeader('Cache-Control', 'no-store');
        res.json(device);
    }),
);

deviceRouter.get(
    '/register/:requestId/status',
    asyncHandler(async (req, res) => {
        const status = await getPendingDeviceRegistrationStatusForPlayer(readRequestId(req.params.requestId));
        res.setHeader('Cache-Control', 'no-store');
        res.json(status);
    }),
);

deviceRouter.get(
    '/',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (_req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(await listDevicesForAdmin());
    }),
);

deviceRouter.get(
    '/pending',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (_req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(await listPendingDeviceRegistrationsForAdmin());
    }),
);

deviceRouter.post(
    '/pending/:requestId/confirm',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (req, res) => {
        const device = await confirmPendingDeviceRegistrationForAdmin(
            readRequestId(req.params.requestId),
            readDeviceCode(req.body?.deviceCode),
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(device);
    }),
);

deviceRouter.post(
    '/:deviceId/assign-profile',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (req, res) => {
        const device = await assignDeviceToProfile(
            readDeviceId(req.params.deviceId),
            readProfileId(req.body?.profileId),
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(device);
    }),
);

deviceRouter.post(
    '/:deviceId/unassign',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (req, res) => {
        const device = await unassignDeviceFromProfile(readDeviceId(req.params.deviceId));
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(device);
    }),
);

deviceRouter.patch(
    '/:deviceId',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (req, res) => {
        const device = await renameDeviceForAdmin(
            readDeviceId(req.params.deviceId),
            readDeviceName(req.body?.name),
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(device);
    }),
);

deviceRouter.post(
    '/:deviceId/rotate-token',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (req, res) => {
        const payload = await rotateDeviceTokenForAdmin(readDeviceId(req.params.deviceId));
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(payload);
    }),
);

deviceRouter.delete(
    '/:deviceId',
    authenticateToken,
    requirePageAccess('devices'),
    asyncHandler(async (req, res) => {
        const result = await deleteDeviceForAdmin(readDeviceId(req.params.deviceId));
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(result);
    }),
);
