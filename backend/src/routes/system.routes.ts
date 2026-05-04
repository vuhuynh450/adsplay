import { Router } from 'express';
import { asyncHandler } from '../errors';
import { authenticateToken } from '../middleware/auth';
import { getSystemStatus } from '../services/system.service';

export const systemRouter = Router();

systemRouter.get(
    '/status',
    authenticateToken,
    asyncHandler(async (_req, res) => {
        res.json(await getSystemStatus());
    }),
);
