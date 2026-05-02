import type { NextFunction, Request, Response } from 'express';

export class AppError extends Error {
    constructor(
        public statusCode: number,
        public code: string,
        message: string,
        public details?: unknown,
    ) {
        super(message);
    }
}

export const asyncHandler =
    (
        handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
    ) =>
    (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
