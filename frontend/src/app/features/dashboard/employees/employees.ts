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
    <div class="py-4 md:py-6 space-y-6 animate-fade-in">
        <!-- Header -->
        <div class="flex items-center justify-between gap-4">
            <div>
                <h2 class="text-2xl font-bold text-slate-900 dark:text-white">Quản Lý Nhân Viên</h2>
                <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Tạo và quản lý tài khoản nhân viên</p>
            </div>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    (click)="deleteSelectedEmployees()"
                    [disabled]="!hasSelectedEmployees()"
                    class="px-4 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10 rounded-xl font-semibold text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50">
                    Xóa đã chọn ({{ getSelectedEmployeeCount() }})
                </button>
                <button
                    (click)="showCreateForm.set(!showCreateForm())"
                    class="px-4 py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-semibold text-sm transition-all active:scale-[0.98] flex items-center gap-2">
                    <svg *ngIf="!showCreateForm()" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                    <svg *ngIf="showCreateForm()" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {{ showCreateForm() ? 'Đóng' : 'Thêm Nhân Viên' }}
                </button>
            </div>
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

        <div *ngIf="formError" class="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">{{ formError }}</div>

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
                            <th class="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    class="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
                                    [checked]="areAllEmployeesSelected()"
                                    (change)="toggleAllEmployeesFromEvent($event)">
                            </th>
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
                                <input
                                    type="checkbox"
                                    class="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
                                    [checked]="isEmployeeSelected(emp.id)"
                                    (change)="toggleEmployeeSelectionFromEvent(emp.id, $event)">
                            </td>
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
                                        (click)="openEditModal(emp)"
                                        class="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                        title="Chỉnh sửa nhân viên">
                                        Sửa
                                    </button>
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
                            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Chưa có nhân viên nào</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Edit Modal -->
    <div *ngIf="showEditModal()" class="fixed inset-0 z-[120] flex items-center justify-center p-4 animate-fade-in font-sans">
        <div class="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" (click)="closeEditModal()"></div>
        <div class="relative w-full max-w-lg bg-white dark:bg-brand-surface rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl p-6 space-y-4">
            <div class="flex items-center justify-between">
                <h3 class="text-lg font-bold text-slate-800 dark:text-white">Chỉnh Sửa Nhân Viên</h3>
                <button (click)="closeEditModal()" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                    <svg class="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Tài khoản</label>
                    <input
                        type="text"
                        [(ngModel)]="editUsername"
                        placeholder="Nhập tên tài khoản"
                        class="w-full px-4 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-brand-primary/20 text-slate-900 dark:text-white">
                </div>

                <div>
                    <label class="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Mật khẩu mới
                        <span class="text-slate-400 font-normal">(để trống nếu không đổi)</span>
                    </label>
                    <input
                        type="password"
                        [(ngModel)]="editPassword"
                        placeholder="Nhập mật khẩu mới"
                        class="w-full px-4 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-brand-primary/20 text-slate-900 dark:text-white">
                </div>

                <div>
                    <label class="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">Quyền truy cập trang</label>
                    <div class="flex flex-wrap gap-3">
                        <label *ngFor="let page of allPageKeys" class="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                [checked]="editAllowedPages.includes(page)"
                                (change)="toggleEditPage(page)"
                                class="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary">
                            <span class="text-sm text-slate-700 dark:text-slate-300">{{ pageLabel(page) }}</span>
                        </label>
                    </div>
                </div>
            </div>

            <div *ngIf="editError" class="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">{{ editError }}</div>

            <div class="flex justify-end gap-3 pt-2">
                <button
                    (click)="closeEditModal()"
                    class="px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition-colors">
                    Hủy
                </button>
                <button
                    (click)="saveEdit()"
                    [disabled]="editing()"
                    class="px-6 py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50">
                    {{ editing() ? 'Đang lưu...' : 'Lưu Thay Đổi' }}
                </button>
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
    formError = '';

    private readonly selectedEmployeeIds = new Set<string>();

    newUsername = '';
    newPassword = '';
    newAllowedPages: PageKey[] = ['videos'];

    showEditModal = signal(false);
    editing = signal(false);
    editError = '';
    editEmployeeId = '';
    editUsername = '';
    editPassword = '';
    editAllowedPages: PageKey[] = [];

    readonly allPageKeys = PAGE_KEYS;

    ngOnInit() {
        this.loadEmployees();
    }

    loadEmployees() {
        this.loading.set(true);
        this.api.getEmployees().subscribe({
            next: (list) => {
                this.employees.set(list);
                this.pruneSelectedEmployees();
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
            },
        });
    }

    isEmployeeSelected(employeeId: string) {
        return this.selectedEmployeeIds.has(employeeId);
    }

    hasSelectedEmployees() {
        return this.selectedEmployeeIds.size > 0;
    }

    getSelectedEmployeeCount() {
        return this.selectedEmployeeIds.size;
    }

    areAllEmployeesSelected() {
        const employees = this.employees();
        return employees.length > 0 && employees.every((employee) => this.selectedEmployeeIds.has(employee.id));
    }

    setEmployeeSelected(employeeId: string, selected: boolean) {
        if (selected) {
            this.selectedEmployeeIds.add(employeeId);
            return;
        }

        this.selectedEmployeeIds.delete(employeeId);
    }

    setAllEmployeesSelected(selected: boolean) {
        if (!selected) {
            this.selectedEmployeeIds.clear();
            return;
        }

        for (const employee of this.employees()) {
            this.selectedEmployeeIds.add(employee.id);
        }
    }

    toggleEmployeeSelectionFromEvent(employeeId: string, event: Event) {
        const target = event.target as HTMLInputElement | null;
        this.setEmployeeSelected(employeeId, !!target?.checked);
    }

    toggleAllEmployeesFromEvent(event: Event) {
        const target = event.target as HTMLInputElement | null;
        this.setAllEmployeesSelected(!!target?.checked);
    }

    deleteSelectedEmployees() {
        const employeeIds = this.employees()
            .filter((employee) => this.selectedEmployeeIds.has(employee.id))
            .map((employee) => employee.id);

        if (!employeeIds.length) {
            this.formError = 'Chọn ít nhất 1 nhân viên để xóa.';
            return;
        }

        this.formError = '';
        if (typeof window !== 'undefined') {
            const accepted = window.confirm(`Xóa ${employeeIds.length} nhân viên đã chọn?`);
            if (!accepted) {
                return;
            }
        }

        this.api.deleteEmployeesBulk(employeeIds).subscribe({
            next: () => {
                this.selectedEmployeeIds.clear();
                this.loadEmployees();
            },
            error: (err) => {
                this.formError = getErrorMessage(err, 'Không thể xóa nhân viên đã chọn.');
            },
        });
    }

    private pruneSelectedEmployees() {
        const validEmployeeIds = new Set(this.employees().map((employee) => employee.id));
        for (const selectedEmployeeId of this.selectedEmployeeIds) {
            if (!validEmployeeIds.has(selectedEmployeeId)) {
                this.selectedEmployeeIds.delete(selectedEmployeeId);
            }
        }
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

    openEditModal(emp: EmployeeView) {
        this.editEmployeeId = emp.id;
        this.editUsername = emp.username;
        this.editPassword = '';
        this.editAllowedPages = [...emp.allowedPages];
        this.editError = '';
        this.showEditModal.set(true);
    }

    closeEditModal() {
        this.showEditModal.set(false);
        this.editEmployeeId = '';
        this.editUsername = '';
        this.editPassword = '';
        this.editAllowedPages = [];
        this.editError = '';
    }

    saveEdit() {
        if (!this.editUsername.trim()) {
            this.editError = 'Vui lòng nhập tên tài khoản.';
            return;
        }

        if (this.editAllowedPages.length === 0) {
            this.editError = 'Vui lòng chọn ít nhất một quyền truy cập.';
            return;
        }

        this.editing.set(true);
        this.editError = '';

        const payload: {
            username?: string;
            password?: string;
            allowedPages?: PageKey[];
        } = {};

        payload.username = this.editUsername.trim();
        payload.allowedPages = this.editAllowedPages;

        if (this.editPassword.trim()) {
            payload.password = this.editPassword.trim();
        }

        this.api.updateEmployee(this.editEmployeeId, payload).subscribe({
            next: () => {
                this.editing.set(false);
                this.closeEditModal();
                this.loadEmployees();
            },
            error: (err) => {
                this.editing.set(false);
                this.editError = getErrorMessage(err, 'Không thể cập nhật nhân viên.');
            },
        });
    }

    toggleEditPage(page: PageKey) {
        const current = this.editAllowedPages;
        if (current.includes(page)) {
            this.editAllowedPages = current.filter((p) => p !== page);
        } else {
            this.editAllowedPages = [...current, page];
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
