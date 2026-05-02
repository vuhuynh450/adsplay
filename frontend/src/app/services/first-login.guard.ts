import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const firstLoginGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!authService.requiresFirstLoginPasswordChange()) {
        return true;
    }

    return router.parseUrl('/auth/change-password-first-login');
};
