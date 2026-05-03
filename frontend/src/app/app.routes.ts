import { Routes } from '@angular/router';
import { Admin } from './features/dashboard/admin';
import { Employees } from './features/dashboard/employees/employees';
import { Player } from './features/player/player';
import { Login } from './features/auth/login/login';
import { FirstLoginPassword } from './features/auth/first-login-password/first-login-password';
import { authGuard } from './services/auth.guard';
import { firstLoginGuard } from './services/first-login.guard';
import { pageAccessGuard } from './services/page-access.guard';
import { adminOnlyGuard } from './services/admin-only.guard';

export const routes: Routes = [
    { path: 'login', component: Login },
    { path: 'auth/change-password-first-login', component: FirstLoginPassword },
    {
        path: 'admin/videos',
        component: Admin,
        canActivate: [authGuard, firstLoginGuard, pageAccessGuard],
        data: { pageKey: 'videos' },
    },
    {
        path: 'admin/profiles',
        component: Admin,
        canActivate: [authGuard, firstLoginGuard, pageAccessGuard],
        data: { pageKey: 'profiles' },
    },
    {
        path: 'admin/devices',
        component: Admin,
        canActivate: [authGuard, firstLoginGuard, pageAccessGuard],
        data: { pageKey: 'devices' },
    },
    {
        path: 'admin/system',
        component: Admin,
        canActivate: [authGuard, firstLoginGuard, pageAccessGuard],
        data: { pageKey: 'system' },
    },
    {
        path: 'admin/employees',
        component: Admin,
        canActivate: [authGuard, firstLoginGuard, adminOnlyGuard],
        data: { pageKey: 'employees' },
    },
    { path: 'admin', redirectTo: '/admin/videos', pathMatch: 'full' },
    { path: 'device', component: Player, data: { mode: 'device' } },
    { path: 'player/device', redirectTo: 'device', pathMatch: 'full' },
    { path: 'player/:profileName', component: Player },
    { path: 'player', redirectTo: 'device', pathMatch: 'full' },
    { path: '', redirectTo: '/admin', pathMatch: 'full' },
];
