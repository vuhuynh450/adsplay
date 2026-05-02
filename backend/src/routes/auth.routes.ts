import { Router } from 'express';
import { asyncHandler } from '../errors';
import { login } from '../services/auth.service';
import { requireNonEmptyString } from '../utils/validation';

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
