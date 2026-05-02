import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.headers['x-request-id'] = String(requestId);
    res.setHeader('x-request-id', String(requestId));
    next();
};
