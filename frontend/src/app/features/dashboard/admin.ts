import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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

type AdminTab = 'videos' | 'profiles' | 'devices';

@Component({
  selector: 'app-admin',
  imports: [CommonModule, VideoList, ProfileManager, DeviceManager, ThemeToggle, ConfirmModal],
  providers: [DashboardStore],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit {
  readonly store = inject(DashboardStore);
  private readonly authService = inject(AuthService);
  private readonly api = inject(ApiService);
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

  private readonly activeTabStorageKey = 'adsplay-admin-active-tab';

  activeTab: AdminTab = 'videos';
  isMobileMenuOpen = signal(false);
  videoDeletingId = signal<string | null>(null);
  previewingVideo = signal<Video | null>(null);
  copySuccess = signal(false);

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: BeforeUnloadEvent) {
    if (this.store.isUploading()) {
      $event.preventDefault();
      $event.returnValue = true;
    }
  }

  ngOnInit() {
    this.activeTab = this.getPersistedActiveTab();
    this.store.initialize();
  }

  setActiveTab(tab: AdminTab) {
    this.activeTab = tab;
    this.isMobileMenuOpen.set(false);

    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(this.activeTabStorageKey, tab);
    } catch {
      return;
    }
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

  private getPersistedActiveTab(): AdminTab {
    if (typeof window === 'undefined') {
      return 'videos';
    }

    try {
      const persistedTab = window.localStorage.getItem(this.activeTabStorageKey);
      if (persistedTab === 'videos' || persistedTab === 'profiles' || persistedTab === 'devices') {
        return persistedTab;
      }
    } catch {
      return 'videos';
    }

    return 'videos';
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
}
