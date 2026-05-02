import { Router } from 'express';
import { asyncHandler } from '../errors';
import { changePasswordFirstLogin, login } from '../services/auth.service';
import { requireNonEmptyString } from '../utils/validation';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth';

export const authRouter = Router();

authRouter.post(
    '/login',
    asyncHandler(async (req, res) => {
        const username = requireNonEmptyString(req.body?.username, 'username');
        const password = requireNonEmptyString(req.body?.password, 'password');
        const result = await login(username, password);
        res.json(result);
    }),
);

authRouter.post(
    '/change-password-first-login',
    authenticateToken,
    asyncHandler(async (_req, res) => {
        const req = _req as AuthenticatedRequest;
        const newPassword = requireNonEmptyString(req.body?.newPassword, 'newPassword');

        if (!req.user) {
            throw new Error('User not authenticated');
        }

        await changePasswordFirstLogin(req.user.username, newPassword);
        res.json({ success: true });
    }),
);
