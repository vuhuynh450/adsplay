import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, EmployeeView } from '../../../services/api.service';
import { PAGE_KEYS } from '../../../constants/page-access';
import type { PageKey } from '../../../constants/page-access';
import { getErrorMessage } from '../../../shared/utils/error-message';

@Component({
    selector: 'app-employees',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div class="p-4 md:p-6 space-y-6 animate-fade-in">
        <!-- Header -->
        <div class="flex items-center justify-between">
            <div>
                <h2 class="text-2xl font-bold text-slate-900 dark:text-white">Quản Lý Nhân Viên</h2>
                <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Tạo và quản lý tài khoản nhân viên</p>
            </div>
            <button
                (click)="showCreateForm.set(!showCreateForm())"
                class="px-4 py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-semibold text-sm transition-all active:scale-[0.98] flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                {{ showCreateForm() ? 'Đóng' : 'Thêm Nhân Viên' }}
            </button>
        </div>

        <!-- Create Form -->
        <div *ngIf="showCreateForm()" class="p-6 rounded-2xl bg-white dark:bg-brand-surface border border-slate-200 dark:border-white/10 shadow-sm space-y-4">
            <h3 class="font-bold text-slate-700 dark:text-slate-200">Tạo Nhân Viên Mới</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Tài khoản</label>
                    <input
                        type="text"
                        [(ngModel)]="newUsername"
                        placeholder="Nhập tên tài khoản"
                        class="w-full px-4 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-brand-primary/20 text-slate-900 dark:text-white">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Mật khẩu</label>
                    <input
                        type="password"
                        [(ngModel)]="newPassword"
                        placeholder="Nhập mật khẩu"
                        class="w-full px-4 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-brand-primary/20 text-slate-900 dark:text-white">
                </div>
            </div>
            <div>
                <label class="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">Quyền truy cập trang</label>
                <div class="flex flex-wrap gap-3">
                    <label *ngFor="let page of allPageKeys" class="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            [checked]="newAllowedPages.includes(page)"
                            (change)="toggleNewPage(page)"
                            class="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary">
                        <span class="text-sm text-slate-700 dark:text-slate-300">{{ pageLabel(page) }}</span>
                    </label>
                </div>
            </div>
            <div *ngIf="createError" class="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">{{ createError }}</div>
            <button
                (click)="createEmployee()"
                [disabled]="creating()"
                class="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50">
                {{ creating() ? 'Đang tạo...' : 'Tạo Nhân Viên' }}
            </button>
        </div>

        <!-- Loading -->
        <div *ngIf="loading()" class="flex items-center justify-center py-12">
            <div class="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
        </div>

        <!-- Employee Table -->
        <div *ngIf="!loading()" class="rounded-2xl bg-white dark:bg-brand-surface border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-slate-50 dark:bg-white/5">
                        <tr>
                            <th class="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Tài khoản</th>
                            <th class="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Quyền truy cập</th>
                            <th class="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Trạng thái</th>
                            <th class="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Mật khẩu</th>
                            <th class="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-white/5">
                        <tr *ngFor="let emp of employees()" class="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                            <td class="px-4 py-3">
                                <div class="font-medium text-slate-800 dark:text-slate-200">{{ emp.username }}</div>
                                <div class="text-xs text-slate-400">{{ emp.createdAt | date:'shortDate' }}</div>
                            </td>
                            <td class="px-4 py-3">
                                <div class="flex flex-wrap gap-1">
                                    <span *ngFor="let page of emp.allowedPages"
                                        class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-primary/10 text-brand-primary">
                                        {{ pageLabel(page) }}
                                    </span>
                                </div>
                            </td>
                            <td class="px-4 py-3 text-center">
                                <button
                                    (click)="toggleActive(emp)"
                                    class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider transition-colors"
                                    [class.bg-emerald-100]="emp.isActive"
                                    [class.text-emerald-700]="emp.isActive"
                                    [class.bg-red-100]="!emp.isActive"
                                    [class.text-red-700]="!emp.isActive">
                                    {{ emp.isActive ? 'Hoạt động' : 'Đã khóa' }}
                                </button>
                            </td>
                            <td class="px-4 py-3 text-center">
                                <span class="text-xs"
                                    [class.text-amber-600]="emp.mustChangePassword"
                                    [class.text-slate-400]="!emp.mustChangePassword">
                                    {{ emp.mustChangePassword ? 'Cần đổi' : 'Đã đổi' }}
                                </span>
                            </td>
                            <td class="px-4 py-3 text-center">
                                <div class="flex items-center justify-center gap-2">
                                    <button
                                        (click)="resetPassword(emp)"
                                        class="px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                                        title="Yêu cầu đổi mật khẩu">
                                        Đặt lại MK
                                    </button>
                                </div>
                            </td>
                        </tr>
                        <tr *ngIf="employees().length === 0">
                            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Chưa có nhân viên nào</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  `,
})
export class Employees implements OnInit {
    private api = inject(ApiService);

    employees = signal<EmployeeView[]>([]);
    loading = signal(true);
    showCreateForm = signal(false);
    creating = signal(false);
    createError = '';

    newUsername = '';
    newPassword = '';
    newAllowedPages: PageKey[] = ['videos'];

    readonly allPageKeys = PAGE_KEYS;

    ngOnInit() {
        this.loadEmployees();
    }

    loadEmployees() {
        this.loading.set(true);
        this.api.getEmployees().subscribe({
            next: (list) => {
                this.employees.set(list);
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
            },
        });
    }

    createEmployee() {
        if (!this.newUsername.trim() || !this.newPassword.trim() || !this.newAllowedPages.length) {
            this.createError = 'Vui lòng điền đầy đủ thông tin.';
            return;
        }

        this.creating.set(true);
        this.createError = '';

        this.api.createEmployee({
            username: this.newUsername.trim(),
            password: this.newPassword,
            allowedPages: this.newAllowedPages,
        }).subscribe({
            next: () => {
                this.creating.set(false);
                this.newUsername = '';
                this.newPassword = '';
                this.newAllowedPages = ['videos'];
                this.showCreateForm.set(false);
                this.loadEmployees();
            },
            error: (err) => {
                this.creating.set(false);
                this.createError = getErrorMessage(err, 'Không thể tạo nhân viên.');
            },
        });
    }

    toggleActive(emp: EmployeeView) {
        this.api.updateEmployeeActiveStatus(emp.id, !emp.isActive).subscribe({
            next: () => this.loadEmployees(),
        });
    }

    resetPassword(emp: EmployeeView) {
        this.api.resetEmployeeFirstPassword(emp.id).subscribe({
            next: () => this.loadEmployees(),
        });
    }

    toggleNewPage(page: PageKey) {
        const current = this.newAllowedPages;
        if (current.includes(page)) {
            this.newAllowedPages = current.filter((p) => p !== page);
        } else {
            this.newAllowedPages = [...current, page];
        }
    }

    pageLabel(page: PageKey): string {
        const labels: Record<PageKey, string> = {
            videos: 'Kho Nội Dung',
            profiles: 'Quản Lý Màn Hình',
            devices: 'Thiết Bị TV',
            system: 'Hệ Thống',
            employees: 'Nhân Viên',
        };
        return labels[page];
    }
}
