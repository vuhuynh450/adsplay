export const PAGE_KEYS = ['videos', 'profiles', 'devices', 'system', 'employees'] as const;
export type PageKey = typeof PAGE_KEYS[number];

export const ADMIN_PAGE_ROUTES: Record<PageKey, string> = {
    videos: '/admin/videos',
    profiles: '/admin/profiles',
    devices: '/admin/devices',
    system: '/admin/system',
    employees: '/admin/employees',
};

export const firstAllowedAdminRoute = (allowedPages: PageKey[]): string => {
    for (const key of PAGE_KEYS) {
        if (allowedPages.includes(key)) {
            return ADMIN_PAGE_ROUTES[key];
        }
    }
    return '/login';
};
