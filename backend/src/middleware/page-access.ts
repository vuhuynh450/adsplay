import type { NextFunction, Response } from 'express';
import { AppError } from '../errors';
import type { AuthenticatedRequest } from './auth';
import type { PageKey } from '../types';

export const requirePageAccess = (pageKey: PageKey) => (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
) => {
    // Allow public requests (no user) to pass through
    if (!req.user) {
        return next();
    }

    // Admin has access to all pages
    if (req.user.role === 'admin') {
        return next();
    }

    // Staff must be active
    if (!req.user.isActive) {
        return next(new AppError(403, 'ACCOUNT_INACTIVE', 'Account is inactive.'));
    }

    // Staff must have page permission
    if (!req.user.allowedPages.includes(pageKey)) {
        return next(new AppError(403, 'PAGE_FORBIDDEN', 'Page access denied.'));
    }

    next();
};

export const requireAdminOnly = (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
) => {
    if (!req.user) {
        return next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
    }

    if (req.user.role !== 'admin') {
        return next(new AppError(403, 'ADMIN_ONLY', 'Admin access required.'));
    }

    next();
};
