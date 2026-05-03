import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, tap } from 'rxjs';
import { Router } from '@angular/router';
import type { AuthLoginUser } from './api.service';

const TOKEN_STORAGE_KEY = 'token';
const USER_STORAGE_KEY = 'user';

const readStoredToken = () => {
    if (typeof localStorage === 'undefined') {
        return null;
    }

    return localStorage.getItem(TOKEN_STORAGE_KEY);
};

const writeStoredToken = (token: string | null) => {
    if (typeof localStorage === 'undefined') {
        return;
    }

    if (!token) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        return;
    }

    localStorage.setItem(TOKEN_STORAGE_KEY, token);
};

const readStoredUser = (): AuthLoginUser | null => {
    if (typeof localStorage === 'undefined') {
        return null;
    }

    const userJson = localStorage.getItem(USER_STORAGE_KEY);
    if (!userJson) {
        return null;
    }

    try {
        return JSON.parse(userJson) as AuthLoginUser;
    } catch {
        return null;
    }
};

const writeStoredUser = (user: AuthLoginUser | null) => {
    if (typeof localStorage === 'undefined') {
        return;
    }

    if (!user) {
        localStorage.removeItem(USER_STORAGE_KEY);
        return;
    }

    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
};

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private http = inject(HttpClient);
    private router = inject(Router);
    private tokenSubject = new BehaviorSubject<string | null>(readStoredToken());
    private userSubject = new BehaviorSubject<AuthLoginUser | null>(readStoredUser());

    isLoggedIn$ = new BehaviorSubject<boolean>(!!readStoredToken());

    login(username: string, password: string) {
        return this.http.post<{ token: string; user: AuthLoginUser }>('/api/auth/login', { username, password })
            .pipe(
                tap(res => {
                    this.setSession(res.token, res.user);
                })
            );
    }

    currentUser() {
        return this.userSubject.value;
    }

    isAdmin() {
        return this.userSubject.value?.role === 'admin';
    }

    hasPageAccess(pageKey: AuthLoginUser['allowedPages'][number]) {
        const user = this.userSubject.value;
        if (!user) {
            return false;
        }

        return user.role === 'admin' || user.allowedPages.includes(pageKey);
    }

    requiresFirstLoginPasswordChange() {
        return Boolean(this.userSubject.value?.mustChangePassword);
    }

    isActiveSessionForPage(pageKey: AuthLoginUser['allowedPages'][number]) {
        return this.isLoggedIn && this.hasPageAccess(pageKey);
    }

    loginRedirectPath() {
        const user = this.userSubject.value;
        if (!user) {
            return '/login';
        }

        if (user.mustChangePassword) {
            return '/auth/change-password-first-login';
        }

        return '/admin';
    }

    setAuthenticatedSession(token: string, user: AuthLoginUser) {
        this.setSession(token, user);
    }

    updateSessionUser(user: AuthLoginUser) {
        const token = this.getToken();
        if (!token) {
            return;
        }

        this.setSession(token, user);
    }

    clearSessionAndStay() {
        this.clearSession();
    }

    logout() {
        this.clearSession();
        this.navigateToLogin();
    }

    handleAuthFailure() {
        this.clearSession();
        this.navigateToLogin();
    }

    getToken() {
        return this.tokenSubject.value;
    }

    get isLoggedIn() {
        return !!this.getToken();
    }

    private setSession(token: string | null, user?: AuthLoginUser | null) {
        writeStoredToken(token);
        writeStoredUser(user || null);
        this.tokenSubject.next(token);
        this.isLoggedIn$.next(!!token);
        this.userSubject.next(user || null);
    }

    private clearSession() {
        this.setSession(null, null);
    }

    private navigateToLogin() {
        if (this.router.url !== '/login') {
            void this.router.navigate(['/login']);
        }
    }
}
