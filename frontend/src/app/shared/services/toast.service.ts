import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  message: string;
  tone: 'error' | 'info' | 'success';
}

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  readonly toasts = signal<ToastMessage[]>([]);

  show(message: string, tone: ToastMessage['tone'] = 'info', durationMs = 4000) {
    const toast: ToastMessage = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      message,
      tone,
    };

    this.toasts.update((current) => [...current, toast]);

    window.setTimeout(() => {
      this.dismiss(toast.id);
    }, durationMs);
  }

  dismiss(id: number) {
    this.toasts.update((current) => current.filter((toast) => toast.id !== id));
  }
}
