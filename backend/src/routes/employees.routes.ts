import { Router } from 'express';
import { asyncHandler, AppError } from '../errors';
import { authenticateToken } from '../middleware/auth';
import { requireAdminOnly } from '../middleware/page-access';
import {
    createEmployee,
    deleteEmployeesBulk,
    listEmployees,
    resetEmployeeFirstPassword,
    updateEmployee,
    updateEmployeeActiveStatus,
    updateEmployeeAllowedPages,
} from '../services/employee.service';
import { requireAllowedPages, requireNonEmptyString, requireStringArray } from '../utils/validation';

export const employeesRouter = Router();

const readEmployeeId = (value: unknown) => requireNonEmptyString(value, 'id', 120);

const readEmployeeIds = (value: unknown) => {
    const ids = requireStringArray(value, 'employeeIds')
        .map((id) => id.trim())
        .filter(Boolean);

    if (!ids.length) {
        throw new AppError(400, 'VALIDATION_ERROR', 'employeeIds is required.');
    }

    return ids;
};

const readIsActive = (value: unknown) => {
    if (typeof value !== 'boolean') {
        throw new AppError(400, 'VALIDATION_ERROR', 'isActive must be a boolean.');
    }

    return value;
};

employeesRouter.get(
    '/',
    authenticateToken,
    requireAdminOnly,
    asyncHandler(async (_req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(await listEmployees());
    }),
);

employeesRouter.post(
    '/',
    authenticateToken,
    requireAdminOnly,
    asyncHandler(async (req, res) => {
        const employee = await createEmployee({
            username: requireNonEmptyString(req.body?.username, 'username', 120),
            password: requireNonEmptyString(req.body?.password, 'password', 120),
            allowedPages: requireAllowedPages(req.body?.allowedPages, 'allowedPages'),
        });

        res.setHeader('Cache-Control', 'private, no-store');
        res.json(employee);
    }),
);

employeesRouter.delete(
    '/',
    authenticateToken,
    requireAdminOnly,
    asyncHandler(async (req, res) => {
        const result = await deleteEmployeesBulk(readEmployeeIds(req.body?.employeeIds));
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(result);
    }),
);

employeesRouter.patch(
    '/:id/pages',
    authenticateToken,
    requireAdminOnly,
    asyncHandler(async (req, res) => {
        const employee = await updateEmployeeAllowedPages(
            readEmployeeId(req.params.id),
            requireAllowedPages(req.body?.allowedPages, 'allowedPages'),
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(employee);
    }),
);

employeesRouter.patch(
    '/:id/active',
    authenticateToken,
    requireAdminOnly,
    asyncHandler(async (req, res) => {
        const employee = await updateEmployeeActiveStatus(
            readEmployeeId(req.params.id),
            readIsActive(req.body?.isActive),
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(employee);
    }),
);

employeesRouter.patch(
    '/:id/reset-first-password',
    authenticateToken,
    requireAdminOnly,
    asyncHandler(async (req, res) => {
        const employee = await resetEmployeeFirstPassword(readEmployeeId(req.params.id));
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(employee);
    }),
);

employeesRouter.patch(
    '/:id',
    authenticateToken,
    requireAdminOnly,
    asyncHandler(async (req, res) => {
        const employee = await updateEmployee(
            readEmployeeId(req.params.id),
            {
                username: req.body?.username || undefined,
                password: req.body?.password || undefined,
                allowedPages: req.body?.allowedPages || undefined,
            },
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(employee);
    }),
);
