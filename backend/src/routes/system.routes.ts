import { Router } from 'express';
import { asyncHandler } from '../errors';
import { authenticateToken } from '../middleware/auth';
import { requirePageAccess } from '../middleware/page-access';
import { getSystemStatus } from '../services/system.service';

export const systemRouter = Router();

systemRouter.get(
    '/status',
    authenticateToken,
    requirePageAccess('system'),
    asyncHandler(async (_req, res) => {
        res.json(getSystemStatus());
    }),
);
