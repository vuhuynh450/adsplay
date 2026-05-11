import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';
import type { AdminTokenPayload } from '../services/auth.service';
import { verifyAdminToken } from '../services/auth.service';
import { dbRepository } from '../db';
import { getConfig } from '../config';
import type { PageKey } from '../types';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        username: string;
        role: 'admin' | 'staff';
        isActive: boolean;
        mustChangePassword: boolean;
        allowedPages: PageKey[];
    };
}

const readBearerToken = (req: Request) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return null;
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
        throw new AppError(403, 'AUTH_INVALID', 'Authentication token is invalid.');
    }

    return token;
};

const assignVerifiedUser = async (req: AuthenticatedRequest, token: string) => {
    const payload = verifyAdminToken(token);

    const dbUser = await dbRepository.findUserByUsername(payload.username);
    if (dbUser) {
        req.user = {
            id: dbUser.id,
            username: dbUser.username,
            role: dbUser.role,
            isActive: dbUser.isActive,
            mustChangePassword: dbUser.mustChangePassword,
            allowedPages: dbUser.allowedPages,
        };
        return;
    }

    const config = getConfig();
    if (
        payload.userId !== 'default-admin' ||
        payload.username !== config.adminUsername ||
        payload.role !== 'admin'
    ) {
        throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.');
    }

    req.user = {
        id: payload.userId,
        username: payload.username,
        role: payload.role,
        isActive: true,
        mustChangePassword: false,
        allowedPages: ['videos', 'profiles', 'devices', 'system', 'employees'],
    };
};

export const authenticateToken = async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
) => {
    let token: string | null = null;

    try {
        token = readBearerToken(req);
    } catch (error) {
        next(error);
        return;
    }

    if (!token) {
        next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
        return;
    }

    try {
        await assignVerifiedUser(req, token);
        next();
    } catch (error) {
        next(error);
    }
};

export const authenticateTokenIfPresent = async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
) => {
    let token: string | null = null;

    try {
        token = readBearerToken(req);
    } catch (error) {
        next(error);
        return;
    }

    if (!token) {
        next();
        return;
    }

    try {
        await assignVerifiedUser(req, token);
        next();
    } catch (error) {
        next(error);
    }
};
