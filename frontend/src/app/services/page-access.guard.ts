import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { firstAllowedAdminRoute } from '../constants/page-access';
import type { PageKey } from '../constants/page-access';

export const pageAccessGuard: CanActivateFn = (route) => {
    const authService = inject(AuthService);
    const router = inject(Router);
    const pageKey = route.data?.['pageKey'] as PageKey;

    if (!pageKey) {
        return router.parseUrl('/login');
    }

    if (authService.hasPageAccess(pageKey)) {
        return true;
    }

    const user = authService.currentUser();
    if (user) {
        const fallback = firstAllowedAdminRoute(user.allowedPages);
        return router.parseUrl(fallback);
    }

    return router.parseUrl('/login');
};
