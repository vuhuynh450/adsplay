import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService, Video } from '../../services/api.service';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { UploadMediaPayload, UploadTarget, VideoList } from './components/video-list/video-list';
import { ProfileManager } from './components/profile-manager/profile-manager';
import {
  AssignDeviceProfilePayload,
  ConfirmPendingDevicePayload,
  DeleteDevicesBulkPayload,
  DeviceManager,
  RenameDevicePayload,
} from './components/device-manager/device-manager';
import { ConfirmModal } from '../../shared/ui/confirm-modal/confirm-modal';
import { DashboardStore, SaveProfilePayload } from './dashboard.store';
import { Employees } from './employees/employees';
import type { PageKey } from '../../constants/page-access';

type AdminPage = 'videos' | 'profiles' | 'devices' | 'system' | 'employees';

interface MenuItem {
  key: AdminPage;
  label: string;
  route: string;
  description: string;
}

const ADMIN_MENU_ITEMS: MenuItem[] = [
  { key: 'videos', label: 'Kho Nội Dung', route: '/admin/videos', description: 'Quản lý và tải lên video hoặc hình ảnh' },
  { key: 'profiles', label: 'Quản Lý Màn Hình', route: '/admin/profiles', description: 'Cấu hình màn hình phát' },
  { key: 'devices', label: 'Thiết Bị TV', route: '/admin/devices', description: 'Gán TV vào màn hình phát' },
  { key: 'system', label: 'Hệ Thống', route: '/admin/system', description: 'Thông tin và trạng thái hệ thống' },
  { key: 'employees', label: 'Nhân Viên', route: '/admin/employees', description: 'Quản lý tài khoản nhân viên' },
];

@Component({
  selector: 'app-admin',
  imports: [CommonModule, RouterModule, VideoList, ProfileManager, DeviceManager, ThemeToggle, ConfirmModal, Employees],
  providers: [DashboardStore],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit {
  readonly store = inject(DashboardStore);
  private readonly authService = inject(AuthService);
  readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly playerUrl = computed(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    const url = new URL(window.location.origin);
    const localIp = this.store.systemInfo()?.localIps?.[0];
    if (localIp) {
      url.hostname = localIp;
    }

    return `${url.origin}/device`;
  });

  activeTab = signal<AdminPage>('videos');
  isMobileMenuOpen = signal(false);
  videoDeletingId = signal<string | null>(null);
  previewingVideo = signal<Video | null>(null);
  copySuccess = signal(false);

  readonly menuItems = ADMIN_MENU_ITEMS;
  readonly visibleMenus = computed(() =>
    this.menuItems.filter((item) => this.authService.hasPageAccess(item.key as PageKey))
  );

  readonly pageLabel = computed(() => {
    const item = this.menuItems.find((m) => m.key === this.activeTab());
    return item?.label ?? '';
  });

  readonly pageDescription = computed(() => {
    const item = this.menuItems.find((m) => m.key === this.activeTab());
    return item?.description ?? '';
  });

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: BeforeUnloadEvent) {
    if (this.store.isUploading()) {
      $event.preventDefault();
      $event.returnValue = true;
    }
  }

  ngOnInit() {
    this.route.data.subscribe((data) => {
      const key = data['pageKey'] as AdminPage;
      if (key) {
        this.activeTab.set(key);
      }
    });

    this.store.initialize();
  }

  onLogout() {
    this.authService.logout();
  }

  onUpload(payload: UploadMediaPayload) {
    this.store.uploadMedia(payload.file, payload.storageTarget);
  }

  onUploadTargetChange(target: UploadTarget) {
    this.store.setUploadTarget(target);
  }

  requestDeleteVideo(id: string) {
    this.videoDeletingId.set(id);
  }

  openPreview(video: Video) {
    this.previewingVideo.set(video);
  }

  closePreview() {
    this.previewingVideo.set(null);
  }

  confirmDeleteVideo() {
    const id = this.videoDeletingId();
    if (!id) {
      return;
    }

    this.videoDeletingId.set(null);
    this.store.deleteVideo(id);
  }

  cancelDeleteVideo() {
    this.videoDeletingId.set(null);
  }

  onSaveProfile(payload: SaveProfilePayload) {
    this.store.saveProfile(payload);
  }

  onDeleteProfile(id: string) {
    this.store.deleteProfile(id);
  }

  onConfirmPendingDevice(payload: ConfirmPendingDevicePayload) {
    this.store.confirmPendingDeviceRegistration(payload.requestId, payload.deviceCode);
  }

  onAssignDeviceProfile(payload: AssignDeviceProfilePayload) {
    this.store.assignDeviceProfile(payload.deviceId, payload.profileId);
  }

  onUnassignDeviceProfile(payload: { deviceId: string }) {
    this.store.unassignDeviceProfile(payload.deviceId);
  }

  onRenameDevice(payload: RenameDevicePayload) {
    this.store.renameDevice(payload.deviceId, payload.name);
  }

  onDeleteDevice(payload: { deviceId: string }) {
    this.store.deleteDevice(payload.deviceId);
  }

  onDeleteDevicesBulk(payload: DeleteDevicesBulkPayload) {
    this.store.deleteDevicesBulk(payload.deviceIds);
  }

  copyUrl() {
    const url = this.playerUrl();
    if (!url) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => this.showCopySuccess());
      return;
    }

    this.fallbackCopyTextToClipboard(url);
  }

  getDeleteVideoMessage() {
    const id = this.videoDeletingId();
    return id ? this.store.getVideoDeleteMessage(id) : 'Xóa nội dung?';
  }

  isImagePreview() {
    return this.previewingVideo()?.mediaType === 'image';
  }

  getPreviewUrl() {
    const video = this.previewingVideo();
    return video ? this.api.getMediaStreamUrl(video) : '';
  }

  getPreviewTypeLabel() {
    return this.isImagePreview() ? 'Ảnh' : 'Video';
  }

  getPreviewSizeLabel() {
    const video = this.previewingVideo();
    return video ? `${(video.size / 1024 / 1024).toFixed(2)} MB` : '';
  }

  getPreviewStatusLabel() {
    const video = this.previewingVideo();
    if (!video) {
      return '';
    }

    if (video.mediaType === 'image') {
      return 'Ảnh sẵn sàng';
    }

    if (video.processingStatus === 'processing') {
      return 'Đang tối ưu';
    }

    if (video.processingStatus === 'pending') {
      return 'Đang xếp hàng';
    }

    return video.streamVariant === 'optimized' ? 'Sẵn sàng HD' : 'Sẵn sàng bản gốc';
  }

  formatPreviewUploadedAt() {
    const video = this.previewingVideo();
    return video ? new Date(video.uploadedAt).toLocaleString() : '';
  }

  private fallbackCopyTextToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    this.showCopySuccess();
  }

  private showCopySuccess() {
    this.copySuccess.set(true);
    window.setTimeout(() => this.copySuccess.set(false), 2000);
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  formatRelativeTime(isoString?: string): string {
    if (!isoString) return '—';
    const date = new Date(isoString);
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    return `${days} ngày trước`;
  }
}
