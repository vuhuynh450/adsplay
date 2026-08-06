import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NEVER, throwError } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { Login } from './login';

describe('Login', () => {
  let mockAuth: { login: ReturnType<typeof vi.fn>; loginRedirectPath: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockAuth = {
      login: vi.fn(),
      loginRedirectPath: vi.fn(() => '/admin'),
    };

    TestBed.configureTestingModule({
      providers: [
        Login,
        { provide: AuthService, useValue: mockAuth },
        { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)) } },
      ],
    });
  });

  it('shows an invalid-credentials error and stops loading when login fails', () => {
    mockAuth.login.mockReturnValue(throwError(() => ({ status: 401 })));
    const component = TestBed.inject(Login);
    component.username = 'admin';
    component.password = 'wrong-password';

    component.onSubmit(new Event('submit'));

    expect(component.loading).toBe(false);
    expect(component.error).toBe('Tài khoản hoặc mật khẩu không chính xác');
  });

  it('stops loading and shows a connection error when login does not respond', async () => {
    vi.useFakeTimers();
    mockAuth.login.mockReturnValue(NEVER);
    const component = TestBed.inject(Login);
    component.username = 'admin';
    component.password = 'password';

    component.onSubmit(new Event('submit'));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(component.loading).toBe(false);
    expect(component.error).toContain('Không thể kết nối');
    vi.useRealTimers();
  });
});
