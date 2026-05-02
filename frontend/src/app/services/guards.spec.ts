import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from './auth.service';
import { pageAccessGuard } from './page-access.guard';
import { adminOnlyGuard } from './admin-only.guard';
import { firstLoginGuard } from './first-login.guard';
import { authGuard } from './auth.guard';
import type { AuthLoginUser, PageKey } from './api.service';

const mockUser: AuthLoginUser = {
    id: 'user-1',
    username: 'staff1',
    role: 'staff',
    allowedPages: ['videos', 'profiles'],
    mustChangePassword: false,
};

const mockUserMustChange: AuthLoginUser = {
    id: 'user-2',
    username: 'newstaff',
    role: 'staff',
    allowedPages: ['videos'],
    mustChangePassword: true,
};

const mockAdmin: AuthLoginUser = {
    id: 'admin-1',
    username: 'admin',
    role: 'admin',
    allowedPages: [],
    mustChangePassword: false,
};

function setupGuardTest(user: AuthLoginUser | null) {
    const parseUrl = vi.fn((path: string) => ({ path } as unknown as ReturnType<Router['parseUrl']>));

    TestBed.configureTestingModule({
        providers: [
            {
                provide: AuthService,
                useValue: {
                    isLoggedIn: !!user,
                    getToken: () => (user ? 'token' : null),
                    currentUser: () => user,
                    isAdmin: () => user?.role === 'admin',
                    hasPageAccess: (key: PageKey) => {
                        if (!user) return false;
                        return user.role === 'admin' || user.allowedPages.includes(key);
                    },
                    requiresFirstLoginPasswordChange: () => Boolean(user?.mustChangePassword),
                },
            },
            {
                provide: Router,
                useValue: { parseUrl },
            },
        ],
    });

    return { parseUrl };
}

function mockRoute(pageKey?: string): ActivatedRouteSnapshot {
    return { data: pageKey ? { pageKey } : {} } as ActivatedRouteSnapshot;
}

const mockState = {} as RouterStateSnapshot;

describe('authGuard', () => {
    it('returns true when user has token', () => {
        setupGuardTest(mockUser);
        const result = TestBed.runInInjectionContext(() => authGuard(mockRoute(), mockState));
        expect(result).toBe(true);
    });

    it('redirects to /login when not authenticated', () => {
        const { parseUrl } = setupGuardTest(null);
        TestBed.runInInjectionContext(() => authGuard(mockRoute(), mockState));
        expect(parseUrl).toHaveBeenCalledWith('/login');
    });
});

describe('firstLoginGuard', () => {
    it('returns true when user does not need password change', () => {
        setupGuardTest(mockUser);
        const result = TestBed.runInInjectionContext(() => firstLoginGuard(mockRoute(), mockState));
        expect(result).toBe(true);
    });

    it('returns true for admin without mustChangePassword', () => {
        setupGuardTest(mockAdmin);
        const result = TestBed.runInInjectionContext(() => firstLoginGuard(mockRoute(), mockState));
        expect(result).toBe(true);
    });

    it('redirects to change-password-first-login when mustChangePassword', () => {
        const { parseUrl } = setupGuardTest(mockUserMustChange);
        TestBed.runInInjectionContext(() => firstLoginGuard(mockRoute(), mockState));
        expect(parseUrl).toHaveBeenCalledWith('/auth/change-password-first-login');
    });
});

describe('adminOnlyGuard', () => {
    it('returns true for admin', () => {
        setupGuardTest(mockAdmin);
        const result = TestBed.runInInjectionContext(() => adminOnlyGuard(mockRoute(), mockState));
        expect(result).toBe(true);
    });

    it('redirects staff to /admin', () => {
        const { parseUrl } = setupGuardTest(mockUser);
        TestBed.runInInjectionContext(() => adminOnlyGuard(mockRoute(), mockState));
        expect(parseUrl).toHaveBeenCalledWith('/admin');
    });
});

describe('pageAccessGuard', () => {
    it('returns true for admin regardless of pageKey', () => {
        setupGuardTest(mockAdmin);
        expect(TestBed.runInInjectionContext(() => pageAccessGuard(mockRoute('employees'), mockState))).toBe(true);
        expect(TestBed.runInInjectionContext(() => pageAccessGuard(mockRoute('system'), mockState))).toBe(true);
    });

    it('returns true for staff with matching page access', () => {
        setupGuardTest(mockUser);
        expect(TestBed.runInInjectionContext(() => pageAccessGuard(mockRoute('videos'), mockState))).toBe(true);
        expect(TestBed.runInInjectionContext(() => pageAccessGuard(mockRoute('profiles'), mockState))).toBe(true);
    });

    it('redirects staff to first allowed page when lacking access', () => {
        const { parseUrl } = setupGuardTest(mockUser);
        TestBed.runInInjectionContext(() => pageAccessGuard(mockRoute('system'), mockState));
        expect(parseUrl).toHaveBeenCalledWith('/admin/videos');
    });

    it('redirects to /login when route has no pageKey', () => {
        const { parseUrl } = setupGuardTest(mockUser);
        TestBed.runInInjectionContext(() => pageAccessGuard(mockRoute(undefined), mockState));
        expect(parseUrl).toHaveBeenCalledWith('/login');
    });

    it('redirects to /login when not authenticated', () => {
        const { parseUrl } = setupGuardTest(null);
        TestBed.runInInjectionContext(() => pageAccessGuard(mockRoute('videos'), mockState));
        expect(parseUrl).toHaveBeenCalledWith('/login');
    });
});
