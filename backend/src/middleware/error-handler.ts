import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';
import { logError } from '../logger';

export const notFoundMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} was not found.`));
};

export const errorMiddleware = (
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
) => {
    const appError =
        error instanceof AppError
            ? error
            : new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');

    logError('request.failed', {
        code: appError.code,
        details: appError.details,
        message: appError.message,
        method: req.method,
        requestId: req.headers['x-request-id'],
        statusCode: appError.statusCode,
        url: req.originalUrl,
    });

    res.status(appError.statusCode).json({
        error: {
            code: appError.code,
            details: appError.details,
            message: appError.message,
        },
    });
};
