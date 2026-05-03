import bcrypt from 'bcryptjs';
import { dbRepository } from '../db';
import { AppError } from '../errors';
import type { PageKey, User } from '../types';

export interface EmployeeView {
    id: string;
    username: string;
    role: 'staff';
    isActive: boolean;
    mustChangePassword: boolean;
    allowedPages: PageKey[];
    createdAt: string;
    updatedAt: string;
}

const toEmployeeView = (user: User): EmployeeView => ({
    id: user.id,
    username: user.username,
    role: 'staff',
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    allowedPages: user.allowedPages,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
});

const getStaffUserById = async (id: string) => {
    const users = await dbRepository.listUsers();
    return users.find((user) => user.id === id && user.role === 'staff') || null;
};

export const listEmployees = async () => {
    const users = await dbRepository.listUsers();
    return users
        .filter((user) => user.role === 'staff')
        .map(toEmployeeView)
        .sort((a, b) => a.username.localeCompare(b.username));
};

export const createEmployee = async (input: {
    username: string;
    password: string;
    allowedPages: PageKey[];
}) => {
    const existed = await dbRepository.findUserByUsername(input.username);
    if (existed) {
        throw new AppError(409, 'USER_ALREADY_EXISTS', 'Username already exists.');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const created = await dbRepository.createUser({
        username: input.username,
        passwordHash,
        role: 'staff',
        isActive: true,
        mustChangePassword: true,
        allowedPages: input.allowedPages,
    });

    return toEmployeeView(created);
};

export const updateEmployeeAllowedPages = async (id: string, allowedPages: PageKey[]) => {
    const existing = await getStaffUserById(id);
    if (!existing) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    const updated = await dbRepository.updateUser(id, (draft) => {
        draft.allowedPages = allowedPages;
    });

    if (!updated) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    return toEmployeeView(updated);
};

export const updateEmployeeActiveStatus = async (id: string, isActive: boolean) => {
    const existing = await getStaffUserById(id);
    if (!existing) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    const updated = await dbRepository.updateUser(id, (draft) => {
        draft.isActive = isActive;
    });

    if (!updated) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    return toEmployeeView(updated);
};

export const resetEmployeeFirstPassword = async (id: string) => {
    const existing = await getStaffUserById(id);
    if (!existing) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    const updated = await dbRepository.updateUser(id, (draft) => {
        draft.mustChangePassword = true;
    });

    if (!updated) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    return toEmployeeView(updated);
};

export const updateEmployee = async (id: string, input: {
    username?: string;
    password?: string;
    allowedPages?: PageKey[];
}) => {
    const existing = await getStaffUserById(id);
    if (!existing) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    if (input.username && input.username !== existing.username) {
        const existed = await dbRepository.findUserByUsername(input.username);
        if (existed) {
            throw new AppError(409, 'USER_ALREADY_EXISTS', 'Username already exists.');
        }
    }

    const updated = await dbRepository.updateUser(id, (draft) => {
        if (input.username) {
            draft.username = input.username;
        }
        if (input.password) {
            draft.passwordHash = bcrypt.hashSync(input.password, 10);
            draft.mustChangePassword = false;
        }
        if (input.allowedPages) {
            draft.allowedPages = input.allowedPages;
        }
    });

    if (!updated) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    return toEmployeeView(updated);
};
