import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { getErrorMessage } from '../../../shared/utils/error-message';

@Component({
    selector: 'app-first-login-password',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div class="min-h-screen bg-brand-light dark:bg-transparent font-sans text-slate-900 dark:text-white transition-colors duration-300 flex items-center justify-center p-4 relative overflow-hidden">
        <!-- Background Orbs -->
        <div class="absolute -top-[20%] -right-[20%] w-[62.5rem] h-[62.5rem] bg-brand-primary opacity-5 rounded-full pointer-events-none z-0"></div>
        <div class="absolute -bottom-[20%] -left-[20%] w-[40rem] h-[40rem] bg-brand-primary opacity-5 rounded-full pointer-events-none z-0"></div>

        <div class="relative z-10 w-full max-w-md animate-scale-up">
            <div class="glass-panel p-8 md:p-10 rounded-3xl backdrop-blur-xl">
                <div class="flex flex-col items-center mb-8">
                    <div class="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mb-4 text-amber-600">
                        <svg class="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                    </div>
                    <h1 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mb-2">Đổi Mật Khẩu</h1>
                    <p class="text-slate-500 dark:text-slate-400 text-center text-sm">Đây là lần đăng nhập đầu tiên. Vui lòng đặt mật khẩu mới để tiếp tục.</p>
                </div>

                <form (submit)="onSubmit($event)" class="space-y-5">
                    <div>
                        <label for="newPassword" class="block text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1 mb-1">Mật khẩu mới</label>
                        <input
                            [type]="showPassword ? 'text' : 'password'"
                            id="newPassword"
                            [(ngModel)]="newPassword"
                            name="newPassword"
                            placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                            required
                            minlength="6"
                            class="w-full px-4 py-3.5 bg-slate-100/50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-2xl outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-slate-900 dark:text-white placeholder:text-slate-400">
                    </div>

                    <div *ngIf="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 p-4 rounded-2xl text-sm font-medium animate-fade-in flex items-center gap-3">
                        <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{{ error }}</span>
                    </div>

                    <button
                        type="submit"
                        [disabled]="submitting()"
                        class="w-full py-4 bg-brand-primary hover:bg-brand-secondary text-white rounded-2xl font-bold text-lg shadow-lg shadow-brand-primary/30 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                        <ng-container *ngIf="!submitting()">
                            <span>Đổi Mật Khẩu</span>
                        </ng-container>
                        <ng-container *ngIf="submitting()">
                            <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>Đang xử lý...</span>
                        </ng-container>
                    </button>
                </form>
            </div>
        </div>
    </div>
  `,
})
export class FirstLoginPassword {
    private api = inject(ApiService);
    private authService = inject(AuthService);
    private router = inject(Router);

    newPassword = '';
    error = '';
    showPassword = false;
    submitting = signal(false);

    onSubmit(event: Event) {
        event.preventDefault();
        if (!this.newPassword || this.newPassword.length < 6) {
            this.error = 'Mật khẩu phải có ít nhất 6 ký tự.';
            return;
        }

        this.submitting.set(true);
        this.error = '';

        this.api.changePasswordFirstLogin(this.newPassword).subscribe({
            next: (res) => {
                this.submitting.set(false);
                this.authService.setAuthenticatedSession(res.token, res.user);
                this.router.navigate(['/admin']);
            },
            error: (err) => {
                this.submitting.set(false);
                this.error = getErrorMessage(err, 'Không thể đổi mật khẩu.');
            },
        });
    }
}
