import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { FirstLoginPassword } from './first-login-password';

describe('FirstLoginPassword', () => {
    let mockApi: { changePasswordFirstLogin: ReturnType<typeof vi.fn> };
    let mockAuth: { setAuthenticatedSession: ReturnType<typeof vi.fn> };
    let mockRouter: { navigate: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockApi = { changePasswordFirstLogin: vi.fn() };
        mockAuth = { setAuthenticatedSession: vi.fn() };
        mockRouter = { navigate: vi.fn(() => Promise.resolve(true)) };

        TestBed.configureTestingModule({
            providers: [
                FirstLoginPassword,
                { provide: ApiService, useValue: mockApi },
                { provide: AuthService, useValue: mockAuth },
                { provide: Router, useValue: mockRouter },
            ],
        });
    });

    it('creates the component', () => {
        const component = TestBed.inject(FirstLoginPassword);
        expect(component).toBeTruthy();
    });

    it('shows validation error for short password', () => {
        const component = TestBed.inject(FirstLoginPassword);
        component.newPassword = '12345';

        component.onSubmit(new Event('submit'));

        expect(component.error).toContain('6 ký tự');
        expect(mockApi.changePasswordFirstLogin).not.toHaveBeenCalled();
    });

    it('calls API and navigates on success', () => {
        const response = { token: 'new-token', user: { id: '1', username: 'staff', role: 'staff' as const, allowedPages: ['videos'], mustChangePassword: false } };
        mockApi.changePasswordFirstLogin.mockReturnValue(of(response));

        const component = TestBed.inject(FirstLoginPassword);
        component.newPassword = 'newpassword123';

        component.onSubmit(new Event('submit'));

        expect(mockApi.changePasswordFirstLogin).toHaveBeenCalledWith('newpassword123');
        expect(mockAuth.setAuthenticatedSession).toHaveBeenCalledWith('new-token', response.user);
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin']);
    });

    it('shows error on API failure', () => {
        mockApi.changePasswordFirstLogin.mockReturnValue(throwError(() => ({ status: 400 })));

        const component = TestBed.inject(FirstLoginPassword);
        component.newPassword = 'newpassword123';

        component.onSubmit(new Event('submit'));

        expect(component.submitting()).toBe(false);
        expect(component.error).toBeTruthy();
    });
});
