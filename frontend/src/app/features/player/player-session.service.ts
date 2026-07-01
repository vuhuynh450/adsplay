import { DestroyRef, Injectable, NgZone, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { ApiService, PlayerDeviceBinding, PlayerProfile, PlayerProfileSummary, Video } from '../../services/api.service';

interface PlaybackSource {
  hlsUrl: string | null;
  loadToken: number;
  mediaType: Video['mediaType'];
  posterUrl: string;
  sourceUrl: string;
}

const ORIENTATION_ROTATION_MAP: Record<NonNullable<PlayerProfile['orientation']>, number> = {
  landscape: 0,
  rotate90: 90,
  rotate180: 180,
  rotate270: 270,
};

const PLAYER_TOKEN_STORAGE_PREFIX = 'adsplay-player-token:';
const DEVICE_ID_STORAGE_KEY = 'adsplay-device-id';
const DEVICE_TOKEN_STORAGE_KEY = 'adsplay-device-token';
const DEVICE_CODE_STORAGE_KEY = 'adsplay-device-code';
const DEVICE_REGISTRATION_REQUEST_ID_STORAGE_KEY = 'adsplay-device-registration-request-id';

type PlayerMode = 'selection' | 'profile' | 'device';

interface DeviceCredentials {
  deviceCode: string;
  deviceId: string;
  deviceToken: string;
}

@Injectable()
export class PlayerSessionService {
  private static readonly MAX_CACHEABLE_VIDEO_BYTES = 120 * 1024 * 1024;
  private static readonly MAX_PREFETCH_VIDEO_BYTES = 80 * 1024 * 1024;
  private static readonly IMAGE_DISPLAY_DURATION_SECONDS = 10;
  private static readonly PLAYLIST_SYNC_INTERVAL_MS = 60_000;
  private static readonly DEVICE_REGISTRATION_SYNC_INTERVAL_MS = 3_000;
  private static readonly DEVICE_ASSIGNED_SYNC_INTERVAL_MS = 3_000;
  private static readonly DEVICE_UNASSIGNED_SYNC_INTERVAL_MS = 5_000;

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  readonly isFullscreen = signal(false);
  readonly profile = signal<PlayerProfile | null>(null);
  readonly allProfiles = signal<PlayerProfileSummary[]>([]);
  readonly currentVideoIndex = signal(0);
  readonly currentMediaType = signal<Video['mediaType'] | null>(null);
  readonly currentImageUrl = signal('');
  readonly loading = signal(true);
  readonly showUnmuteOverlay = signal(false);
  readonly isCursorHidden = signal(false);
  readonly isVideoPortrait = signal(false);
  readonly currentVideoPosterUrl = signal('');
  readonly localVideoUrl = signal('');
  readonly statusMessage = signal<string | null>(null);
  readonly deviceCode = signal<string | null>(null);

  private containerElement: HTMLDivElement | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private currentObjectUrl: string | null = null;
  private activityTimeout: number | null = null;
  private heartbeatInterval: number | null = null;
  private hlsInstance: {
    attachMedia(media: HTMLMediaElement): void;
    destroy(): void;
    loadSource(source: string): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  } | null = null;
  private autoReloadInterval: number | null = null;
  private imageAdvanceTimeout: number | null = null;
  private playlistSyncInterval: number | null = null;
  private endedSafetyTimeout: number | null = null;
  private heartbeatFailures = 0;
  private activeLoadToken = 0;
  private activePlayback: PlaybackSource | null = null;
  private activePlaybackMode: 'hls' | 'mp4' | null = null;
  private hasTriedMp4Fallback = false;
  private pendingPlayback: PlaybackSource | null = null;
  private playerAccessToken: string | null = null;
  private playerMode: PlayerMode = 'selection';
  private routeRequestId = 0;
  private deviceCredentials: DeviceCredentials | null = null;
  private deviceRegistrationRequestId: string | null = null;
  private readonly prefetchingUrls = new Set<string>();
  private hlsLibraryPromise: Promise<typeof import('hls.js').default> | null = null;
  private unmuteOverlayTimeout: number | null = null;

  private readonly onFullscreenChangeBound = () => {
    this.zone.run(() => {
      const isFullscreen = !!document.fullscreenElement;
      this.isFullscreen.set(isFullscreen);
      if (!isFullscreen && this.profile()) {
        this.isCursorHidden.set(false);
      }
    });
  };

  private readonly onMouseMoveBound = () => {
    this.resetActivityTimer();
  };

  private readonly onUserGestureBound = (event: Event) => {
    if (!this.profile()) {
      return;
    }

    if (event instanceof KeyboardEvent && !this.isActivationKey(event)) {
      return;
    }

    this.zone.run(() => {
      this.handleInteractionGesture();
    });
  };

  private readonly onNetworkRestoreBound = () => {
    this.heartbeatFailures = 0;
    if (!this.heartbeatInterval) {
      this.startHeartbeat();
    }
    this.triggerManualSync();
  };

  private readonly onNetworkLostBound = () => undefined;

  initialize() {
    this.isFullscreen.set(!!document.fullscreenElement);

    this.zone.runOutsideAngular(() => {
      document.addEventListener('fullscreenchange', this.onFullscreenChangeBound);
      document.addEventListener('mousemove', this.onMouseMoveBound);
      document.addEventListener('click', this.onMouseMoveBound);
      document.addEventListener('click', this.onUserGestureBound);
      document.addEventListener('touchend', this.onUserGestureBound);
      document.addEventListener('keydown', this.onUserGestureBound);
      window.addEventListener('online', this.onNetworkRestoreBound);
      window.addEventListener('offline', this.onNetworkLostBound);
    });

    this.autoReloadInterval = window.setInterval(() => {
      if (!this.profile()) {
        window.location.reload();
      }
    }, 24 * 60 * 60 * 1000);

    this.resetActivityTimer();
  }

  destroy() {
    document.removeEventListener('fullscreenchange', this.onFullscreenChangeBound);
    document.removeEventListener('mousemove', this.onMouseMoveBound);
    document.removeEventListener('click', this.onMouseMoveBound);
    document.removeEventListener('click', this.onUserGestureBound);
    document.removeEventListener('touchend', this.onUserGestureBound);
    document.removeEventListener('keydown', this.onUserGestureBound);
    window.removeEventListener('online', this.onNetworkRestoreBound);
    window.removeEventListener('offline', this.onNetworkLostBound);

    this.stopHeartbeat();
    if (this.activityTimeout) {
      window.clearTimeout(this.activityTimeout);
    }
    if (this.autoReloadInterval) {
      window.clearInterval(this.autoReloadInterval);
    }
    this.stopPlaylistSync();
    if (this.endedSafetyTimeout) {
      window.clearTimeout(this.endedSafetyTimeout);
    }
    this.clearImageAdvanceTimer();
    this.clearUnmuteOverlayTimeout();

    if (this.currentObjectUrl) {
      this.releaseCurrentObjectUrl();
    }

    this.destroyHls();

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.load();
    }
  }

  attachVideoElement(element: HTMLVideoElement | null) {
    if (this.videoElement === element) {
      return;
    }

    this.destroyHls();
    this.videoElement = element;

    if (element && this.pendingPlayback) {
      void this.applyPlayback(this.pendingPlayback);
    }
  }

  attachContainerElement(element: HTMLDivElement | null) {
    this.containerElement = element;
  }

  isDeviceMode() {
    return this.playerMode === 'device';
  }

  handleRoute(profileSlug?: string, playerAccessToken?: string | null, mode?: unknown) {
    const requestId = ++this.routeRequestId;

    if (mode === 'device') {
      this.playerMode = 'device';
      this.playerAccessToken = null;
      this.loadDeviceRoute(requestId);
      return;
    }

    this.playerMode = profileSlug ? 'profile' : 'selection';
    this.deviceCredentials = null;
    this.deviceRegistrationRequestId = null;
    this.deviceCode.set(null);
    this.playerAccessToken = profileSlug
      ? this.resolvePlayerAccessToken(profileSlug, playerAccessToken)
      : null;

    if (profileSlug) {
      this.loadProfileBySlug(profileSlug, requestId);
      return;
    }

    this.resetPlaybackState();
    this.loadAllProfiles(requestId);
  }

  selectProfile(profile: PlayerProfileSummary) {
    this.requestFullscreenIfNeeded();
    void this.router.navigate(['/player', profile.slug]);
  }

  onVideoEnded() {
    if (this.endedSafetyTimeout) {
      window.clearTimeout(this.endedSafetyTimeout);
    }
    this.next();
  }

  onMetadataLoaded(event: Event) {
    const video = event.target as HTMLVideoElement;
    this.startEndedSafetyTimer(video.duration);
    this.isVideoPortrait.set(video.videoHeight > video.videoWidth);
    this.requestFullscreenIfNeeded();
    this.playVideo();
  }

  onVideoError() {
    if (this.activePlaybackMode === 'hls' && this.activePlayback && !this.hasTriedMp4Fallback) {
      void this.fallbackToMp4(this.activePlayback);
      return;
    }

    this.onVideoEnded();
  }

  backToSelection() {
    if (this.playerMode === 'device') {
      this.resetPlaybackState();
      this.loadDeviceRoute(++this.routeRequestId);
      return;
    }

    this.playerMode = 'selection';
    this.playerAccessToken = null;
    this.deviceCredentials = null;
    this.deviceCode.set(null);
    this.resetPlaybackState();
    void this.router.navigate(['/player']);
  }

  onImageLoaded() {
    this.requestFullscreenIfNeeded();
  }

  getRotationDegrees() {
    const orientation = this.profile()?.orientation || 'landscape';
    return ORIENTATION_ROTATION_MAP[orientation] ?? 0;
  }

  getMediaWrapperTransform() {
    return `rotate(${this.getRotationDegrees()}deg)`;
  }

  getMediaWrapperWidth() {
    return this.isQuarterTurnOrientation() ? '100vh' : '100%';
  }

  getMediaWrapperHeight() {
    return this.isQuarterTurnOrientation() ? '100vw' : '100%';
  }

  private isQuarterTurnOrientation() {
    const rotationDegrees = this.getRotationDegrees();
    return rotationDegrees === 90 || rotationDegrees === 270;
  }

  private resetActivityTimer() {
    if (this.isCursorHidden()) {
      this.zone.run(() => this.isCursorHidden.set(false));
    }

    if (this.activityTimeout) {
      window.clearTimeout(this.activityTimeout);
    }

    if (!this.profile()) {
      return;
    }

    this.activityTimeout = window.setTimeout(() => {
      this.zone.run(() => this.isCursorHidden.set(true));
    }, 3000);
  }

  private startHeartbeat() {
    const profile = this.profile();
    if (this.heartbeatInterval || !profile?.slug) {
      return;
    }

    if (this.playerMode === 'device') {
      if (!this.deviceCredentials) {
        return;
      }
    } else if (!this.playerAccessToken) {
      return;
    }

    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeatPulse();
    }, 30000);
    this.sendHeartbeatPulse();
  }

  private startPlaylistSync(intervalMs = PlayerSessionService.PLAYLIST_SYNC_INTERVAL_MS) {
    this.stopPlaylistSync();

    this.playlistSyncInterval = window.setInterval(() => {
      this.triggerManualSync();
    }, intervalMs);
  }

  private stopHeartbeat(resetFailures = false) {
    if (this.heartbeatInterval) {
      window.clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (resetFailures) {
      this.heartbeatFailures = 0;
    }
  }

  private stopPlaylistSync() {
    if (this.playlistSyncInterval) {
      window.clearInterval(this.playlistSyncInterval);
      this.playlistSyncInterval = null;
    }
  }

  private clearImageAdvanceTimer() {
    if (this.imageAdvanceTimeout) {
      window.clearTimeout(this.imageAdvanceTimeout);
      this.imageAdvanceTimeout = null;
    }
  }

  private clearUnmuteOverlayTimeout() {
    if (this.unmuteOverlayTimeout) {
      window.clearTimeout(this.unmuteOverlayTimeout);
      this.unmuteOverlayTimeout = null;
    }
  }

  private sendHeartbeatPulse() {
    const profile = this.profile();
    if (!profile?.slug) {
      return;
    }

    const request = this.playerMode === 'device'
      ? this.deviceCredentials
        ? this.api.sendDeviceHeartbeat(this.deviceCredentials.deviceId, this.deviceCredentials.deviceToken)
        : null
      : this.playerAccessToken
        ? this.api.sendHeartbeat(profile.slug, this.playerAccessToken)
        : null;

    if (!request) {
      return;
    }

    request.subscribe({
      next: () => {
        this.heartbeatFailures = 0;
      },
      error: (error: { status?: number }) => {
        if (this.playerMode === 'device') {
          const errorCode = this.getApiErrorCode(error);
          if (
            errorCode === 'DEVICE_TOKEN_INVALID' ||
            errorCode === 'DEVICE_NOT_FOUND' ||
            error?.status === 403 ||
            error?.status === 404
          ) {
            this.clearStoredDeviceCredentials();
            this.deviceCredentials = null;
            this.deviceRegistrationRequestId = null;
            this.registerDeviceAndLoadBinding(++this.routeRequestId);
            return;
          }
        } else if (error?.status === 400 || error?.status === 403 || error?.status === 404) {
          this.clearStoredPlayerAccessToken(profile.slug);
          this.playerAccessToken = null;
        }

        this.heartbeatFailures += 1;
        if (this.heartbeatFailures >= 5) {
          this.stopHeartbeat();
        }
      },
    });
  }

  private triggerManualSync() {
    if (this.playerMode === 'device') {
      this.syncDeviceBinding();
      return;
    }

    const activeProfile = this.profile();
    if (!activeProfile?.slug) {
      return;
    }

    this.api.getProfileBySlug(activeProfile.slug).subscribe({
      next: (updatedProfile) => {
        this.heartbeatFailures = 0;
        if (!this.heartbeatInterval) {
          this.startHeartbeat();
        }

        this.applyProfileUpdate(updatedProfile, activeProfile);
      },
      error: () => undefined,
    });
  }

  private resetPlaybackState() {
    this.stopHeartbeat(true);
    this.stopPlaylistSync();
    this.clearImageAdvanceTimer();
    this.clearUnmuteOverlayTimeout();
    this.profile.set(null);
    this.showUnmuteOverlay.set(false);
    this.currentMediaType.set(null);
    this.currentImageUrl.set('');
    this.currentVideoPosterUrl.set('');
    this.releaseCurrentObjectUrl();
    this.localVideoUrl.set('');
    this.statusMessage.set(null);
    this.pendingPlayback = null;
    this.activePlayback = null;
    this.destroyHls();
  }

  private loadDeviceRoute(requestId: number) {
    this.resetPlaybackState();
    this.loading.set(true);

    const storedCredentials = this.getStoredDeviceCredentials();
    if (storedCredentials) {
      this.deviceCredentials = storedCredentials;
      this.deviceRegistrationRequestId = null;
      this.clearStoredDeviceRegistrationRequestId();
      this.deviceCode.set(storedCredentials.deviceCode);
      this.loadDeviceBinding(storedCredentials, requestId);
      return;
    }

    const storedRequestId = this.getStoredDeviceRegistrationRequestId();
    if (storedRequestId) {
      this.deviceCredentials = null;
      this.deviceRegistrationRequestId = storedRequestId;
      this.syncPendingDeviceRegistration(storedRequestId, requestId, true);
      return;
    }

    this.registerDeviceAndLoadBinding(requestId);
  }

  private registerDeviceAndLoadBinding(requestId: number = this.routeRequestId) {
    this.resetPlaybackState();
    this.loading.set(true);
    this.api
      .registerDevice()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registration) => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'device') {
            return;
          }

          this.deviceCredentials = null;
          this.deviceRegistrationRequestId = registration.requestId;
          this.storeDeviceRegistrationRequestId(registration.requestId);
          this.deviceCode.set(registration.deviceCode);
          this.loading.set(false);
          this.statusMessage.set('Nhập đúng mã trên TV trong trang quản trị để xác nhận kết nối.');
          this.startPlaylistSync(PlayerSessionService.DEVICE_REGISTRATION_SYNC_INTERVAL_MS);
        },
        error: () => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'device') {
            return;
          }

          this.loading.set(false);
          this.statusMessage.set('Không thể tạo yêu cầu kết nối thiết bị. Vui lòng kiểm tra mạng.');
        },
      });
  }

  private syncPendingDeviceRegistration(
    requestId: string,
    routeRequestId: number = this.routeRequestId,
    keepPolling = true,
  ) {
    this.api
      .getDeviceRegistrationStatus(requestId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          if (routeRequestId !== this.routeRequestId || this.playerMode !== 'device') {
            return;
          }

          if (status.status === 'pending') {
            this.deviceCredentials = null;
            this.deviceRegistrationRequestId = requestId;
            this.deviceCode.set(status.deviceCode);
            this.loading.set(false);
            this.statusMessage.set('Thiết bị đang chờ quản trị xác nhận mã.');
            if (keepPolling) {
              this.startPlaylistSync(PlayerSessionService.DEVICE_REGISTRATION_SYNC_INTERVAL_MS);
            }
            return;
          }

          const credentials = {
            deviceCode: status.deviceCode,
            deviceId: status.deviceId,
            deviceToken: status.deviceToken,
          };

          this.deviceCredentials = credentials;
          this.deviceRegistrationRequestId = null;
          this.clearStoredDeviceRegistrationRequestId();
          this.storeDeviceCredentials(credentials);
          this.deviceCode.set(credentials.deviceCode);
          this.loadDeviceBinding(credentials, routeRequestId);
        },
        error: (error) => {
          if (routeRequestId !== this.routeRequestId || this.playerMode !== 'device') {
            return;
          }

          if ((error as { status?: number })?.status === 404) {
            this.clearStoredDeviceRegistrationRequestId();
            this.deviceRegistrationRequestId = null;
            this.deviceCode.set(null);
            this.registerDeviceAndLoadBinding(++this.routeRequestId);
            return;
          }

          this.loading.set(false);
          this.statusMessage.set('Không thể kiểm tra trạng thái xác nhận thiết bị. Hệ thống sẽ tự thử lại.');
          this.startPlaylistSync(PlayerSessionService.DEVICE_REGISTRATION_SYNC_INTERVAL_MS);
        },
      });
  }

  private loadDeviceBinding(
    credentials: DeviceCredentials,
    requestId: number = this.routeRequestId,
    keepCurrentPlayback = false,
  ) {
    this.api
      .getPlayerBindingByDevice(credentials.deviceId, credentials.deviceToken)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (binding) => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'device') {
            return;
          }

          const activeProfile = keepCurrentPlayback ? this.profile() : null;
          this.applyDeviceBinding(binding, activeProfile || undefined);
        },
        error: (error) => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'device') {
            return;
          }

          this.handleDeviceBindingError(error, keepCurrentPlayback);
        },
      });
  }

  private syncDeviceBinding() {
    const credentials = this.deviceCredentials;
    const requestId = this.routeRequestId;

    if (!credentials) {
      const registrationRequestId = this.deviceRegistrationRequestId || this.getStoredDeviceRegistrationRequestId();
      if (registrationRequestId) {
        this.syncPendingDeviceRegistration(registrationRequestId, requestId, false);
        return;
      }

      this.registerDeviceAndLoadBinding(++this.routeRequestId);
      return;
    }

    this.loadDeviceBinding(credentials, requestId, true);
  }

  private applyDeviceBinding(binding: PlayerDeviceBinding, previousProfile?: PlayerProfile) {
    this.deviceCode.set(binding.device.deviceCode);
    this.heartbeatFailures = 0;
    this.loading.set(false);
    this.statusMessage.set(null);

    if (previousProfile) {
      this.applyProfileUpdate(binding.profile, previousProfile);
      this.startHeartbeat();
      this.startPlaylistSync(PlayerSessionService.DEVICE_ASSIGNED_SYNC_INTERVAL_MS);
      return;
    }

    this.startHeartbeat();
    this.startPlaylistSync(PlayerSessionService.DEVICE_ASSIGNED_SYNC_INTERVAL_MS);
    this.switchPlaybackToProfile(binding.profile);
  }

  private handleDeviceBindingError(error: unknown, keepCurrentPlayback = false) {
    const errorCode = this.getApiErrorCode(error);

    if (
      errorCode === 'DEVICE_TOKEN_INVALID' ||
      errorCode === 'DEVICE_NOT_FOUND' ||
      (error as { status?: number })?.status === 403 ||
      (error as { status?: number })?.status === 404
    ) {
      this.clearStoredDeviceCredentials();
      this.deviceCredentials = null;
      this.deviceRegistrationRequestId = null;
      this.deviceCode.set(null);
      this.registerDeviceAndLoadBinding(++this.routeRequestId);
      return;
    }

    if (errorCode === 'DEVICE_NOT_ASSIGNED' || (error as { status?: number })?.status === 409) {
      if (!keepCurrentPlayback) {
        this.profile.set(null);
        this.currentMediaType.set(null);
        this.currentImageUrl.set('');
        this.currentVideoPosterUrl.set('');
        this.pendingPlayback = null;
        this.activePlayback = null;
        this.localVideoUrl.set('');
      }
      this.stopHeartbeat(true);
      this.loading.set(false);
      this.statusMessage.set('Thiết bị chưa được gán màn hình. Vui lòng gán thiết bị trong trang quản trị.');
      this.startPlaylistSync(PlayerSessionService.DEVICE_UNASSIGNED_SYNC_INTERVAL_MS);
      return;
    }

    this.loading.set(false);
    this.statusMessage.set('Không thể tải cấu hình thiết bị. Hệ thống sẽ tự thử lại.');
    this.startPlaylistSync();
  }

  private applyProfileUpdate(updatedProfile: PlayerProfile, activeProfile: PlayerProfile) {
    if (this.getProfilePlaybackSignature(activeProfile) !== this.getProfilePlaybackSignature(updatedProfile)) {
      this.switchPlaybackToProfile(updatedProfile);
    }
  }

  private getProfilePlaybackSignature(profile: PlayerProfile) {
    const videosSignature = profile.videos
      ?.map((video) => `${video.id}:${video.updatedAt}`)
      .join(',') || '';

    return [profile.slug, profile.orientation, videosSignature].join('|');
  }

  private switchPlaybackToProfile(profile: PlayerProfile) {
    this.profile.set(profile);
    this.currentVideoIndex.set(0);
    this.currentMediaType.set(null);
    this.currentImageUrl.set('');
    this.currentVideoPosterUrl.set('');
    this.pendingPlayback = null;
    this.activePlayback = null;
    this.localVideoUrl.set('');
    this.statusMessage.set(null);
    this.clearImageAdvanceTimer();
    this.clearUnmuteOverlayTimeout();

    if (!profile.videos.length) {
      this.statusMessage.set('Playlist hiện tại không có nội dung.');
      return;
    }

    void this.syncCacheWithBackend(profile.videos);
    void this.loadAndPlayMedia(0);
  }

  private loadAllProfiles(requestId: number) {
    this.loading.set(true);
    this.api
      .getPlayerProfiles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profiles) => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'selection') {
            return;
          }

          this.allProfiles.set(profiles);
          this.loading.set(false);
        },
        error: () => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'selection') {
            return;
          }

          this.statusMessage.set('Không thể tải danh sách màn hình.');
          this.loading.set(false);
        },
      });
  }

  private loadProfileBySlug(profileSlug: string, requestId: number) {
    this.stopHeartbeat(true);
    this.stopPlaylistSync();
    this.clearImageAdvanceTimer();
    this.clearUnmuteOverlayTimeout();
    this.loading.set(true);
    this.api
      .getProfileBySlug(profileSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'profile') {
            return;
          }

          this.profile.set(profile);
          this.currentVideoIndex.set(0);
          this.loading.set(false);
          this.statusMessage.set(null);
          this.heartbeatFailures = 0;
          this.startHeartbeat();

          if (profile.videos.length) {
            void this.syncCacheWithBackend(profile.videos);
            void this.loadAndPlayMedia(0);
          } else {
            this.currentMediaType.set(null);
            this.currentImageUrl.set('');
            this.currentVideoPosterUrl.set('');
            this.pendingPlayback = null;
            this.activePlayback = null;
            this.localVideoUrl.set('');
            this.statusMessage.set('Playlist hiện tại không có nội dung.');
          }

          this.startPlaylistSync();
        },
        error: () => {
          if (requestId !== this.routeRequestId || this.playerMode !== 'profile') {
            return;
          }

          this.stopHeartbeat(true);
          this.stopPlaylistSync();
          this.clearImageAdvanceTimer();
          this.clearUnmuteOverlayTimeout();
          this.loading.set(false);
          this.statusMessage.set('Không tìm thấy màn hình được yêu cầu.');
          this.profile.set(null);
          void this.router.navigate(['/player']);
        },
      });
  }

  private async loadAndPlayMedia(index: number) {
    const activeProfile = this.profile();
    if (!activeProfile?.videos?.length) {
      return;
    }

    const video = activeProfile.videos[index];
    const serverUrl = this.api.getMediaStreamUrl(video);
    const posterUrl = video.posterFilename ? this.api.getVideoPosterUrl(video) : '';
    const hlsUrl =
      video.mediaType === 'video' && video.processingStatus === 'ready' && video.hlsManifestPath
        ? this.api.getVideoHlsManifestUrl(video)
        : null;
    const loadToken = ++this.activeLoadToken;

    if (video.mediaType === 'image') {
      this.releaseCurrentObjectUrl();
      await this.applyPlayback({
        hlsUrl: null,
        loadToken,
        mediaType: 'image',
        posterUrl: '',
        sourceUrl: serverUrl,
      });
      return;
    }

    if (hlsUrl) {
      this.releaseCurrentObjectUrl();
      await this.applyPlayback({
        hlsUrl,
        loadToken,
        mediaType: 'video',
        posterUrl,
        sourceUrl: serverUrl,
      });
      return;
    }

    if (!this.shouldCacheVideo(video)) {
      this.releaseCurrentObjectUrl();
      await this.applyPlayback({
        hlsUrl: null,
        loadToken,
        mediaType: 'video',
        posterUrl,
        sourceUrl: serverUrl,
      });
      void this.prefetchUpcomingVideo(index);
      return;
    }

    try {
      const cache = await caches.open('adsplay-video-cache');
      let response = await cache.match(serverUrl);

      if (!response) {
        response = await fetch(serverUrl);
        if (!response.ok) {
          this.triggerManualSync();
          this.next();
          return;
        }

        try {
          await cache.put(serverUrl, response.clone());
        } catch (error) {
          if ((error as { name?: string }).name === 'QuotaExceededError') {
            await caches.delete('adsplay-video-cache');
          }
        }
      }

      const blob = await response.blob();
      if (loadToken !== this.activeLoadToken) {
        return;
      }

      this.releaseCurrentObjectUrl();
      this.currentObjectUrl = URL.createObjectURL(blob);
      await this.applyPlayback({
        hlsUrl: null,
        loadToken,
        mediaType: 'video',
        posterUrl,
        sourceUrl: this.currentObjectUrl,
      });
      void this.prefetchUpcomingVideo(index);
    } catch {
      if (loadToken !== this.activeLoadToken) {
        return;
      }

      this.releaseCurrentObjectUrl();
      await this.applyPlayback({
        hlsUrl: null,
        loadToken,
        mediaType: 'video',
        posterUrl,
        sourceUrl: serverUrl,
      });
    }
  }

  private async syncCacheWithBackend(validVideos: Video[]) {
    try {
      const cache = await caches.open('adsplay-video-cache');
      const cachedRequests = await cache.keys();
      const validUrls = new Set(
        validVideos
          .filter((video) => video.mediaType === 'video' && this.shouldCacheVideo(video))
          .map((video) => new URL(this.api.getMediaStreamUrl(video), window.location.origin).toString()),
      );

      for (const request of cachedRequests) {
        if (!validUrls.has(request.url)) {
          await cache.delete(request);
        }
      }
    } catch {
      return;
    }
  }

  private startEndedSafetyTimer(duration: number) {
    if (this.endedSafetyTimeout) {
      window.clearTimeout(this.endedSafetyTimeout);
    }

    if (!duration || Number.isNaN(duration)) {
      return;
    }

    this.endedSafetyTimeout = window.setTimeout(() => {
      if (this.videoElement && !this.videoElement.paused) {
        this.onVideoEnded();
      }
    }, (duration + 2) * 1000);
  }

  private async playVideo() {
    if (!this.videoElement) {
      return;
    }

    try {
      this.videoElement.muted = false;
      await this.videoElement.play();
      this.clearUnmuteOverlayTimeout();
      this.showUnmuteOverlay.set(false);
    } catch {
      this.videoElement.muted = true;
      try {
        await this.videoElement.play();
        this.setUnmuteOverlayAutoHide();
        this.showUnmuteOverlay.set(true);
      } catch {
        this.setUnmuteOverlayAutoHide();
        this.showUnmuteOverlay.set(true);
      }
    }
  }

  private setUnmuteOverlayAutoHide() {
    this.clearUnmuteOverlayTimeout();
    this.unmuteOverlayTimeout = window.setTimeout(() => {
      this.zone.run(() => {
        this.showUnmuteOverlay.set(false);
        this.unmuteOverlayTimeout = null;
      });
    }, 5000);
  }

  private unmuteAndPlay() {
    if (!this.videoElement) {
      return;
    }

    this.videoElement.muted = false;
    void this.videoElement.play();
    this.clearUnmuteOverlayTimeout();
    this.showUnmuteOverlay.set(false);
  }

  private handleInteractionGesture() {
    if (this.currentMediaType() === 'video') {
      this.unmuteAndPlay();
    }
    this.requestFullscreenIfNeeded();
  }

  private isActivationKey(event: KeyboardEvent) {
    return (
      event.key === 'Enter' ||
      event.key === 'NumpadEnter' ||
      event.key === ' ' ||
      event.key === 'Spacebar' ||
      event.key === 'MediaPlay' ||
      event.key === 'MediaPlayPause' ||
      event.key === 'Select' ||
      event.key === 'Accept' ||
      event.key === 'OK' ||
      event.code === 'Enter' ||
      event.code === 'NumpadEnter' ||
      event.keyCode === 13 ||
      event.keyCode === 23 ||
      event.keyCode === 32
    );
  }

  private requestFullscreenIfNeeded() {
    if (document.fullscreenElement) {
      return;
    }

    const target = this.containerElement;
    if (target?.requestFullscreen) {
      try {
        target.requestFullscreen().catch(() => undefined);
        return;
      } catch {
        // Fall back to video fullscreen on WebKit-based browsers.
      }
    }

    const video = this.videoElement as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (video && typeof video.webkitEnterFullscreen === 'function') {
      try {
        video.webkitEnterFullscreen();
      } catch {
        return;
      }
    }
  }

  private shouldCacheVideo(video: Video) {
    return (
      video.mediaType === 'video' &&
      video.processingStatus === 'ready' &&
      video.size > 0 &&
      video.size <= PlayerSessionService.MAX_CACHEABLE_VIDEO_BYTES
    );
  }

  private async prefetchUpcomingVideo(currentIndex: number) {
    const activeProfile = this.profile();
    if (!activeProfile?.videos?.length || activeProfile.videos.length < 2) {
      return;
    }

    const nextIndex = (currentIndex + 1) % activeProfile.videos.length;
    const nextVideo = activeProfile.videos[nextIndex];

    if (
      !this.shouldCacheVideo(nextVideo) ||
      nextVideo.size > PlayerSessionService.MAX_PREFETCH_VIDEO_BYTES
    ) {
      return;
    }

    const streamUrl = this.api.getMediaStreamUrl(nextVideo);
    if (this.prefetchingUrls.has(streamUrl)) {
      return;
    }

    this.prefetchingUrls.add(streamUrl);

    try {
      const cache = await caches.open('adsplay-video-cache');
      const existing = await cache.match(streamUrl);
      if (existing) {
        return;
      }

      const response = await fetch(streamUrl);
      if (response.ok) {
        await cache.put(streamUrl, response);
      }
    } catch {
      // Background prefetch should never affect playback.
    } finally {
      this.prefetchingUrls.delete(streamUrl);
    }
  }

  private releaseCurrentObjectUrl() {
    if (!this.currentObjectUrl) {
      return;
    }

    URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = null;
  }

  private destroyHls() {
    if (!this.hlsInstance) {
      return;
    }

    this.hlsInstance.destroy();
    this.hlsInstance = null;
  }

  private resolvePlayerAccessToken(profileSlug: string, routeToken?: string | null) {
    const normalizedRouteToken = routeToken?.trim() || '';
    if (normalizedRouteToken) {
      this.storePlayerAccessToken(profileSlug, normalizedRouteToken);
      this.stripTokenFromUrl();
      return normalizedRouteToken;
    }

    return this.getStoredPlayerAccessToken(profileSlug);
  }

  private getStoredPlayerAccessToken(profileSlug: string) {
    if (typeof localStorage === 'undefined' || !profileSlug) {
      return null;
    }

    try {
      return localStorage.getItem(`${PLAYER_TOKEN_STORAGE_PREFIX}${profileSlug}`);
    } catch {
      return null;
    }
  }

  private storePlayerAccessToken(profileSlug: string, playerAccessToken: string) {
    if (typeof localStorage === 'undefined' || !profileSlug || !playerAccessToken) {
      return;
    }

    try {
      localStorage.setItem(`${PLAYER_TOKEN_STORAGE_PREFIX}${profileSlug}`, playerAccessToken);
    } catch {
      return;
    }
  }

  private clearStoredPlayerAccessToken(profileSlug: string) {
    if (typeof localStorage === 'undefined' || !profileSlug) {
      return;
    }

    try {
      localStorage.removeItem(`${PLAYER_TOKEN_STORAGE_PREFIX}${profileSlug}`);
    } catch {
      return;
    }
  }

  private getStoredDeviceRegistrationRequestId() {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      return localStorage.getItem(DEVICE_REGISTRATION_REQUEST_ID_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private storeDeviceRegistrationRequestId(requestId: string) {
    if (typeof localStorage === 'undefined' || !requestId) {
      return;
    }

    try {
      localStorage.setItem(DEVICE_REGISTRATION_REQUEST_ID_STORAGE_KEY, requestId);
    } catch {
      return;
    }
  }

  private clearStoredDeviceRegistrationRequestId() {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.removeItem(DEVICE_REGISTRATION_REQUEST_ID_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private getStoredDeviceCredentials(): DeviceCredentials | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const deviceCode = localStorage.getItem(DEVICE_CODE_STORAGE_KEY);
      const deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      const deviceToken = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
      return deviceCode && deviceId && deviceToken ? { deviceCode, deviceId, deviceToken } : null;
    } catch {
      return null;
    }
  }

  private storeDeviceCredentials(credentials: DeviceCredentials) {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(DEVICE_CODE_STORAGE_KEY, credentials.deviceCode);
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, credentials.deviceId);
      localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, credentials.deviceToken);
      localStorage.removeItem(DEVICE_REGISTRATION_REQUEST_ID_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private clearStoredDeviceCredentials() {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.removeItem(DEVICE_CODE_STORAGE_KEY);
      localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
      localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
      localStorage.removeItem(DEVICE_REGISTRATION_REQUEST_ID_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private getApiErrorCode(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      return error.error?.error?.code as string | undefined;
    }

    return (error as { error?: { error?: { code?: string } } })?.error?.error?.code;
  }

  private stripTokenFromUrl() {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const currentUrl = new URL(window.location.href);
      if (!currentUrl.searchParams.has('token')) {
        return;
      }

      currentUrl.searchParams.delete('token');
      const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      window.history.replaceState(window.history.state, document.title, nextUrl);
    } catch {
      return;
    }
  }

  private async loadHlsLibrary() {
    this.hlsLibraryPromise ??= import('hls.js').then((module) => module.default);
    return this.hlsLibraryPromise;
  }

  private async applyPlayback(playback: PlaybackSource) {
    if (playback.loadToken !== this.activeLoadToken) {
      return;
    }

    this.pendingPlayback = playback;
    this.activePlayback = playback;
    this.currentMediaType.set(playback.mediaType);
    this.currentVideoPosterUrl.set(playback.posterUrl);
    this.statusMessage.set(null);
    this.hasTriedMp4Fallback = false;
    this.clearImageAdvanceTimer();

    if (playback.mediaType === 'image') {
      this.applyImagePlayback(playback);
      return;
    }

    if (playback.hlsUrl) {
      if (!this.videoElement) {
        this.currentImageUrl.set('');
        this.localVideoUrl.set('');
        this.activePlaybackMode = 'hls';
        return;
      }

      if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        this.destroyHls();
        this.activePlaybackMode = 'hls';
        this.localVideoUrl.set(playback.hlsUrl);
        this.videoElement.src = playback.hlsUrl;
        this.videoElement.load();
        return;
      }

      const Hls = await this.loadHlsLibrary().catch(() => null);
      if (Hls?.isSupported()) {
        this.destroyHls();
        this.activePlaybackMode = 'hls';
        this.localVideoUrl.set('');
        this.videoElement.removeAttribute('src');
        this.videoElement.load();

        const hlsInstance = new Hls();
        this.hlsInstance = hlsInstance;

        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || playback.loadToken !== this.activeLoadToken) {
            return;
          }

          void this.fallbackToMp4(playback);
        });

        hlsInstance.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (playback.loadToken !== this.activeLoadToken) {
            return;
          }

          hlsInstance.loadSource(playback.hlsUrl as string);
        });

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (playback.loadToken !== this.activeLoadToken) {
            return;
          }

          void this.playVideo();
        });

        hlsInstance.attachMedia(this.videoElement);
        return;
      }
    }

    this.applyMp4Playback(playback);
  }

  private applyImagePlayback(playback: PlaybackSource) {
    this.destroyHls();
    this.activePlaybackMode = null;
    this.clearUnmuteOverlayTimeout();
    this.showUnmuteOverlay.set(false);
    this.currentVideoPosterUrl.set('');
    this.currentImageUrl.set(playback.sourceUrl);
    this.localVideoUrl.set('');
    this.isVideoPortrait.set(false);

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
    }

    this.requestFullscreenIfNeeded();

    const activeProfile = this.profile();
    const currentItem = activeProfile?.videos?.[this.currentVideoIndex()];
    const durationSeconds = Math.max(
      3,
      Math.round(currentItem?.durationSeconds || PlayerSessionService.IMAGE_DISPLAY_DURATION_SECONDS),
    );

    this.imageAdvanceTimeout = window.setTimeout(() => {
      this.next();
    }, durationSeconds * 1000);
  }

  private applyMp4Playback(playback: PlaybackSource) {
    this.destroyHls();
    this.activePlaybackMode = 'mp4';
    this.currentImageUrl.set('');
    this.localVideoUrl.set(playback.sourceUrl);

    if (this.videoElement) {
      this.videoElement.src = playback.sourceUrl;
      this.videoElement.load();
    }
  }

  private async fallbackToMp4(playback: PlaybackSource) {
    if (this.hasTriedMp4Fallback || playback.loadToken !== this.activeLoadToken) {
      return;
    }

    this.hasTriedMp4Fallback = true;
    await this.applyPlayback({
      ...playback,
      hlsUrl: null,
    });
  }

  private next() {
    const activeProfile = this.profile();
    if (!activeProfile?.videos?.length) {
      this.backToSelection();
      return;
    }

    let nextIndex = this.currentVideoIndex() + 1;
    if (nextIndex >= activeProfile.videos.length) {
      nextIndex = 0;
    }

    if (
      nextIndex === this.currentVideoIndex() &&
      activeProfile.videos.length === 1 &&
      activeProfile.videos[0]?.mediaType === 'video' &&
      this.videoElement
    ) {
      this.videoElement.currentTime = 0;
      void this.playVideo();
      return;
    }

    this.clearImageAdvanceTimer();
    this.clearUnmuteOverlayTimeout();
    this.currentVideoIndex.set(nextIndex);
    void this.loadAndPlayMedia(nextIndex);
  }
}
