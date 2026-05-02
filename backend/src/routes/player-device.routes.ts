import { Router } from 'express';
import { asyncHandler } from '../errors';
import { getPlayerBindingByDevice, heartbeatDevice } from '../services/device.service';
import { requireNonEmptyString } from '../utils/validation';

export const playerDeviceRouter = Router();

const readDeviceToken = (rawToken: unknown) =>
    requireNonEmptyString(Array.isArray(rawToken) ? rawToken[0] : rawToken, 'x-device-token', 2048);

const readDeviceId = (value: unknown) => requireNonEmptyString(value, 'deviceId', 120);

playerDeviceRouter.get(
    '/:deviceId',
    asyncHandler(async (req, res) => {
        const binding = await getPlayerBindingByDevice(
            readDeviceId(req.params.deviceId),
            readDeviceToken(req.headers['x-device-token']),
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json(binding);
    }),
);

playerDeviceRouter.post(
    '/:deviceId/heartbeat',
    asyncHandler(async (req, res) => {
        await heartbeatDevice(
            readDeviceId(req.params.deviceId),
            readDeviceToken(req.headers['x-device-token']),
        );
        res.json({ success: true });
    }),
);
