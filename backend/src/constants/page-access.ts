export const PAGE_KEYS = ['videos', 'profiles', 'devices', 'system', 'employees'] as const;
export type PageKey = typeof PAGE_KEYS[number];
