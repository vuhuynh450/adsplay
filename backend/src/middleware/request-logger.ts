import type { NextFunction, Request, Response } from 'express';
import { logInfo } from '../logger';

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.on('finish', () => {
        logInfo('request.completed', {
            durationMs: Date.now() - startedAt,
            method: req.method,
            requestId: req.headers['x-request-id'],
            statusCode: res.statusCode,
            url: req.originalUrl,
        });
    });

    next();
};
