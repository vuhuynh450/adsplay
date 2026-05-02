import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-employees',
    standalone: true,
    imports: [CommonModule],
    template: `<div class="p-8"><h2 class="text-2xl font-bold mb-4">Quản lý nhân viên</h2><p class="text-slate-500">Đang phát triển...</p></div>`,
})
export class Employees {}
