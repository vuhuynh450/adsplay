import { PAGE_KEYS, type PageKey } from '../constants/page-access';
import { AppError } from '../errors';

export const requireNonEmptyString = (
    value: unknown,
    field: string,
    maxLength = 120,
) => {
    if (typeof value !== 'string') {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} is required.`);
    }

    if (trimmed.length > maxLength) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be at most ${maxLength} characters.`);
    }

    return trimmed;
};

export const requireOptionalString = (value: unknown, field: string) => {
    if (value == null) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
    }

    return value;
};

export const requireStringArray = (value: unknown, field: string) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be an array of strings.`);
    }

    return [...new Set(value)];
};

export const requireOptionalOrientation = (value: unknown, field: string) => {
    if (value == null) {
        return undefined;
    }

    if (value === 'landscape' || value === 'rotate90' || value === 'rotate180' || value === 'rotate270') {
        return value;
    }

    throw new AppError(400, 'VALIDATION_ERROR', `${field} must be one of: landscape, rotate90, rotate180, rotate270.`);
};

export const requireAllowedPages = (value: unknown, field: string): PageKey[] => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be an array of strings.`);
    }

    const deduped = [...new Set(value.map((item) => item.trim()))].filter(Boolean);
    if (!deduped.length) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} is required.`);
    }

    const invalid = deduped.find((item) => !PAGE_KEYS.includes(item as PageKey));
    if (invalid) {
        throw new AppError(
            400,
            'VALIDATION_ERROR',
            `${field} contains invalid page key: ${invalid}. Allowed values: ${PAGE_KEYS.join(', ')}.`,
        );
    }

    return deduped as PageKey[];
};
