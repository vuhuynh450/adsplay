import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from './auth.service';
import type { AuthLoginUser } from './api.service';

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

describe('AuthService', () => {
    let service: AuthService;
    let mockHttpPost: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();

        mockHttpPost = vi.fn();

        TestBed.configureTestingModule({
            providers: [
                AuthService,
                { provide: HttpClient, useValue: { post: mockHttpPost } },
                {
                    provide: Router,
                    useValue: {
                        navigate: vi.fn(() => Promise.resolve(true)),
                        url: '/login',
                    },
                },
            ],
        });

        service = TestBed.inject(AuthService);
    });

    afterEach(() => {
        localStorage.clear();
    });

    describe('login', () => {
        it('stores token and user after successful login', () => {
            const response = { token: 'test-token', user: mockUser };
            mockHttpPost.mockReturnValue(of(response));

            service.login('staff1', 'password').subscribe(() => {
                expect(service.getToken()).toBe('test-token');
                expect(service.isLoggedIn).toBe(true);
                expect(service.currentUser()).toEqual(mockUser);
                expect(service.isAdmin()).toBe(false);
            });
        });

        it('stores token in localStorage after login', () => {
            const response = { token: 'test-token', user: mockUser };
            mockHttpPost.mockReturnValue(of(response));

            service.login('staff1', 'password').subscribe(() => {
                expect(localStorage.getItem('token')).toBe('test-token');
            });
        });
    });

    describe('currentUser', () => {
        it('returns null when not logged in', () => {
            expect(service.currentUser()).toBeNull();
        });

        it('returns user after login', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.currentUser()).toEqual(mockUser);
            });
        });
    });

    describe('isAdmin', () => {
        it('returns false for staff user', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.isAdmin()).toBe(false);
            });
        });

        it('returns true for admin user', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockAdmin }));
            service.login('u', 'p').subscribe(() => {
                expect(service.isAdmin()).toBe(true);
            });
        });

        it('returns false when not logged in', () => {
            expect(service.isAdmin()).toBe(false);
        });
    });

    describe('hasPageAccess', () => {
        it('returns false when not logged in', () => {
            expect(service.hasPageAccess('videos')).toBe(false);
        });

        it('returns true for admin regardless of allowedPages', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockAdmin }));
            service.login('u', 'p').subscribe(() => {
                expect(service.hasPageAccess('employees')).toBe(true);
                expect(service.hasPageAccess('system')).toBe(true);
            });
        });

        it('returns true for staff with matching allowed page', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.hasPageAccess('videos')).toBe(true);
                expect(service.hasPageAccess('profiles')).toBe(true);
            });
        });

        it('returns false for staff without matching allowed page', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.hasPageAccess('system')).toBe(false);
                expect(service.hasPageAccess('devices')).toBe(false);
                expect(service.hasPageAccess('employees')).toBe(false);
            });
        });
    });

    describe('requiresFirstLoginPasswordChange', () => {
        it('returns false when not logged in', () => {
            expect(service.requiresFirstLoginPasswordChange()).toBe(false);
        });

        it('returns false for user without mustChangePassword', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.requiresFirstLoginPasswordChange()).toBe(false);
            });
        });

        it('returns true for user with mustChangePassword', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUserMustChange }));
            service.login('u', 'p').subscribe(() => {
                expect(service.requiresFirstLoginPasswordChange()).toBe(true);
            });
        });
    });

    describe('loginRedirectPath', () => {
        it('returns /login when not authenticated', () => {
            expect(service.loginRedirectPath()).toBe('/login');
        });

        it('returns /admin for normal user', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.loginRedirectPath()).toBe('/admin');
            });
        });

        it('returns /auth/change-password-first-login when mustChangePassword', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUserMustChange }));
            service.login('u', 'p').subscribe(() => {
                expect(service.loginRedirectPath()).toBe('/auth/change-password-first-login');
            });
        });
    });

    describe('isActiveSessionForPage', () => {
        it('returns false when not logged in', () => {
            expect(service.isActiveSessionForPage('videos')).toBe(false);
        });

        it('returns true when logged in and has page access', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.isActiveSessionForPage('videos')).toBe(true);
            });
        });

        it('returns false when logged in but lacks page access', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                expect(service.isActiveSessionForPage('system')).toBe(false);
            });
        });
    });

    describe('logout', () => {
        it('clears token and user', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                service.logout();
                expect(service.getToken()).toBeNull();
                expect(service.isLoggedIn).toBe(false);
                expect(service.currentUser()).toBeNull();
            });
        });

        it('removes token from localStorage', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                service.logout();
                expect(localStorage.getItem('token')).toBeNull();
            });
        });

        it('navigates to /login', () => {
            const router = TestBed.inject(Router);
            Object.defineProperty(router, 'url', { value: '/admin' });
            service.logout();
            expect(router.navigate).toHaveBeenCalledWith(['/login']);
        });
    });

    describe('updateSessionUser', () => {
        it('updates user without affecting token', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                const updated: AuthLoginUser = { ...mockUser, allowedPages: ['videos'] };
                service.updateSessionUser(updated);
                expect(service.getToken()).toBe('tk');
                expect(service.currentUser()?.allowedPages).toEqual(['videos']);
            });
        });

        it('does nothing when no token', () => {
            service.updateSessionUser(mockUser);
            expect(service.currentUser()).toBeNull();
        });
    });

    describe('clearSessionAndStay', () => {
        it('clears session without navigating', () => {
            mockHttpPost.mockReturnValue(of({ token: 'tk', user: mockUser }));
            service.login('u', 'p').subscribe(() => {
                const router = TestBed.inject(Router);
                service.clearSessionAndStay();
                expect(service.getToken()).toBeNull();
                expect(service.currentUser()).toBeNull();
                expect(router.navigate).not.toHaveBeenCalled();
            });
        });
    });
});
