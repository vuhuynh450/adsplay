import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-outlet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-outlet.html',
})
export class ToastOutlet {
  protected readonly toastService = inject(ToastService);
}
