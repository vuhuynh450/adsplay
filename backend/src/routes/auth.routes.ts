import { Router } from 'express';
import { AppError, asyncHandler } from '../errors';
import { changePasswordFirstLogin, login } from '../services/auth.service';
import { requireNonEmptyString } from '../utils/validation';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth';

export const authRouter = Router();

let loginRateLimitWindowMs = 10 * 60_000;
let loginRateLimitMaxFailures = 10;
const failedLoginAttemptsByKey = new Map<string, number[]>();

const getLoginRateLimitKey = (ip: string, username: string) =>
    `${ip}:${username.trim().toLowerCase()}`;

const getRecentFailedLoginAttempts = (ip: string, username: string) => {
    const now = Date.now();
    const key = getLoginRateLimitKey(ip, username);
    const attempts = failedLoginAttemptsByKey.get(key) || [];
    const recentAttempts = attempts.filter((timestamp) => now - timestamp < loginRateLimitWindowMs);
    failedLoginAttemptsByKey.set(key, recentAttempts);
    return { key, recentAttempts };
};

const enforceLoginRateLimit = (ip: string, username: string) => {
    const { recentAttempts } = getRecentFailedLoginAttempts(ip, username);
    if (recentAttempts.length >= loginRateLimitMaxFailures) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Please try again later.');
    }
};

const recordFailedLoginAttempt = (ip: string, username: string) => {
    const { key, recentAttempts } = getRecentFailedLoginAttempts(ip, username);
    recentAttempts.push(Date.now());
    failedLoginAttemptsByKey.set(key, recentAttempts);
};

const resetLoginRateLimit = (ip: string, username: string) => {
    failedLoginAttemptsByKey.delete(getLoginRateLimitKey(ip, username));
};

const shouldRecordFailedLogin = (error: unknown) =>
    error instanceof AppError && (error.code === 'INVALID_CREDENTIALS' || error.code === 'ACCOUNT_INACTIVE');

export const __resetLoginRateLimitForTests = () => {
    failedLoginAttemptsByKey.clear();
    loginRateLimitWindowMs = 10 * 60_000;
    loginRateLimitMaxFailures = 10;
};

export const __configureLoginRateLimitForTests = (input: { windowMs: number; maxFailures: number }) => {
    loginRateLimitWindowMs = input.windowMs;
    loginRateLimitMaxFailures = input.maxFailures;
};

authRouter.post(
    '/login',
    asyncHandler(async (req, res) => {
        const username = requireNonEmptyString(req.body?.username, 'username');
        const password = requireNonEmptyString(req.body?.password, 'password');
        const ip = req.ip || 'unknown';

        enforceLoginRateLimit(ip, username);

        try {
            const result = await login(username, password);
            resetLoginRateLimit(ip, username);
            res.json(result);
        } catch (error) {
            if (shouldRecordFailedLogin(error)) {
                recordFailedLoginAttempt(ip, username);
            }

            throw error;
        }
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

        const result = await changePasswordFirstLogin(req.user.username, newPassword);
        res.json(result);
    }),
);
