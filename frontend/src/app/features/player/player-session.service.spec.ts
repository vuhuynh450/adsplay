import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlayerProfile, Video } from '../../services/api.service';
import { ApiService } from '../../services/api.service';
import { PlayerSessionService } from './player-session.service';

interface PlaybackSourceLike {
  hlsUrl: string | null;
  loadToken: number;
  mediaType: 'image' | 'video';
  posterUrl: string;
  sourceUrl: string;
}

interface MockHlsInstance {
  attachMedia: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  loadSource: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

const createMockHlsClass = (instances: MockHlsInstance[], handlers: Map<string, (event: unknown, data: { fatal?: boolean }) => void>) => {
  class MockHls {
    static isSupported() {
      return true;
    }

    static Events = {
      ERROR: 'hlsError',
      MANIFEST_PARSED: 'hlsManifestParsed',
      MEDIA_ATTACHED: 'hlsMediaAttached',
    };

    attachMedia = vi.fn();
    destroy = vi.fn();
    loadSource = vi.fn();
    on = vi.fn((event: string, handler: (event: unknown, data: { fatal?: boolean }) => void) => {
      handlers.set(event, handler);
    });

    constructor() {
      instances.push(this);
    }
  }

  return MockHls;
};

describe('PlayerSessionService orientation mapping', () => {
  let service: PlayerSessionService;
  let api: { getMediaStreamUrl: ReturnType<typeof vi.fn>; getVideoHlsManifestUrl: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = {
      getMediaStreamUrl: vi.fn((video: { id: string; updatedAt: string }) => `/api/videos/${video.id}/stream`),
      getVideoHlsManifestUrl: vi.fn((video: { id: string; updatedAt: string }) => `/api/videos/${video.id}/hls/playlist.m3u8`),
    };

    TestBed.configureTestingModule({
      providers: [
        PlayerSessionService,
        {
          provide: ApiService,
          useValue: api,
        },
        {
          provide: NgZone,
          useFactory: () => new NgZone({ enableLongStackTrace: false }),
        },
        {
          provide: Router,
          useValue: {
            navigate: () => Promise.resolve(true),
          },
        },
      ],
    });

    service = TestBed.inject(PlayerSessionService);
  });

  const setProfileOrientation = (orientation: PlayerProfile['orientation']) => {
    service.profile.set({
      name: 'Device 1',
      slug: 'device-1',
      orientation,
      videos: [],
    });
  };

  const profile = (partial: Partial<PlayerProfile> = {}): PlayerProfile => ({
    name: 'Device 1',
    slug: 'device-1',
    orientation: 'landscape',
    videos: [
      {
        createdAt: '2026-07-01T00:00:00.000Z',
        filename: 'video.mp4',
        id: 'video-1',
        mediaType: 'video',
        originalName: 'Video.mp4',
        processingStatus: 'ready',
        sourceFilename: 'video.mp4',
        sourceSize: 100,
        size: 100,
        storageProvider: 'local',
        streamVariant: 'original',
        updatedAt: '2026-07-01T00:00:00.000Z',
        uploadedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    ...partial,
  });

  it('maps landscape to rotate(0deg)', () => {
    setProfileOrientation('landscape');

    expect(service.getRotationDegrees()).toBe(0);
    expect(service.getMediaWrapperTransform()).toBe('rotate(0deg)');
    expect(service.getRotationDegrees()).toBe(0);
  });

  it('maps rotate90 to rotate(90deg)', () => {
    setProfileOrientation('rotate90');

    expect(service.getRotationDegrees()).toBe(90);
    expect(service.getMediaWrapperTransform()).toBe('rotate(90deg)');
  });

  it('swaps wrapper dimensions for quarter-turn orientations', () => {
    setProfileOrientation('landscape');
    expect(service.getMediaWrapperWidth()).toBe('100%');
    expect(service.getMediaWrapperHeight()).toBe('100%');

    setProfileOrientation('rotate90');
    expect(service.getMediaWrapperWidth()).toBe('100vh');
    expect(service.getMediaWrapperHeight()).toBe('100vw');

    setProfileOrientation('rotate270');
    expect(service.getMediaWrapperWidth()).toBe('100vh');
    expect(service.getMediaWrapperHeight()).toBe('100vw');

    setProfileOrientation('rotate180');
    expect(service.getMediaWrapperWidth()).toBe('100%');
    expect(service.getMediaWrapperHeight()).toBe('100%');
  });

  it('reloads playback when a synced device profile changes orientation', () => {
    const switchPlaybackSpy = vi
      .spyOn(service as unknown as { switchPlaybackToProfile: (profile: PlayerProfile) => void }, 'switchPlaybackToProfile')
      .mockImplementation(() => undefined);

    (service as unknown as {
      applyProfileUpdate: (updatedProfile: PlayerProfile, activeProfile: PlayerProfile) => void;
    }).applyProfileUpdate(profile({ orientation: 'rotate270' }), profile({ orientation: 'landscape' }));

    expect(switchPlaybackSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads playback when a synced device video keeps its id but has a newer version', () => {
    const switchPlaybackSpy = vi
      .spyOn(service as unknown as { switchPlaybackToProfile: (profile: PlayerProfile) => void }, 'switchPlaybackToProfile')
      .mockImplementation(() => undefined);

    (service as unknown as {
      applyProfileUpdate: (updatedProfile: PlayerProfile, activeProfile: PlayerProfile) => void;
    }).applyProfileUpdate(
      profile({
        videos: [
          {
            ...profile().videos[0],
            updatedAt: '2026-07-01T01:00:00.000Z',
          },
        ],
      }),
      profile(),
    );

    expect(switchPlaybackSpy).toHaveBeenCalledTimes(1);
  });

  describe('hls-only playback', () => {
    beforeEach(() => {
      api.getMediaStreamUrl.mockClear();
      api.getVideoHlsManifestUrl.mockClear();
    });

    const hlsOnlyVideo = (): Video => ({
      createdAt: '2026-07-01T00:00:00.000Z',
      filename: 'hls-only.mp4',
      hlsManifestPath: 'processed/hls/v1/playlist.m3u8',
      id: 'hls-only-1',
      mediaType: 'video',
      originalName: 'HlsOnly.mp4',
      processingStatus: 'ready',
      sourceFilename: 'hls-only.mp4',
      sourceSize: 100,
      size: 100,
      storageProvider: 'local',
      streamVariant: 'hls-only',
      updatedAt: '2026-07-01T00:00:00.000Z',
      uploadedAt: '2026-07-01T00:00:00.000Z',
    });

    const loadAndPlayMedia = (video: Video) =>
      (service as unknown as { loadAndPlayMedia: (index: number) => Promise<void> }).loadAndPlayMedia(0);

    it('does not create or fetch the MP4 stream URL for a ready hls-only video', async () => {
      service.profile.set({ ...profile(), videos: [hlsOnlyVideo()] });
      const fallbackSpy = vi.spyOn(service as unknown as { fallbackToMp4: (playback: unknown) => Promise<void> }, 'fallbackToMp4');

      await loadAndPlayMedia(hlsOnlyVideo());

      expect(api.getMediaStreamUrl).not.toHaveBeenCalledWith(hlsOnlyVideo());
      expect(fallbackSpy).not.toHaveBeenCalled();
    });

    it('uses the HLS manifest URL for a ready hls-only video', async () => {
      service.profile.set({ ...profile(), videos: [hlsOnlyVideo()] });

      await loadAndPlayMedia(hlsOnlyVideo());

      expect(api.getVideoHlsManifestUrl).toHaveBeenCalledWith(hlsOnlyVideo());
    });

    it('does not fall back to MP4 when HLS fails for an hls-only video', () => {
      service.profile.set({ ...profile(), videos: [hlsOnlyVideo()] });
      const fallbackSpy = vi.spyOn(service as unknown as { fallbackToMp4: (playback: unknown) => Promise<void> }, 'fallbackToMp4');
      const onVideoEndedSpy = vi.spyOn(service, 'onVideoEnded').mockImplementation(() => undefined);
      const serviceRef = service as unknown as {
        activePlaybackMode: 'hls' | 'mp4' | null;
        activePlayback: PlaybackSourceLike | null;
        hasTriedMp4Fallback: boolean;
      };

      serviceRef.activePlaybackMode = 'hls';
      serviceRef.activePlayback = {
        hlsUrl: '/api/videos/hls-only-1/hls/playlist.m3u8',
        loadToken: 1,
        mediaType: 'video',
        posterUrl: '',
        sourceUrl: '',
      };
      serviceRef.hasTriedMp4Fallback = false;

      service.onVideoError();

      expect(fallbackSpy).not.toHaveBeenCalled();
      expect(onVideoEndedSpy).toHaveBeenCalledTimes(1);
    });

    it('still allows the MP4 fallback when the source URL is present', () => {
      service.profile.set({ ...profile(), videos: [hlsOnlyVideo()] });
      const fallbackSpy = vi.spyOn(service as unknown as { fallbackToMp4: (playback: unknown) => Promise<void> }, 'fallbackToMp4');
      const onVideoEndedSpy = vi.spyOn(service, 'onVideoEnded').mockImplementation(() => undefined);
      const serviceRef = service as unknown as {
        activePlaybackMode: 'hls' | 'mp4' | null;
        activePlayback: PlaybackSourceLike | null;
        hasTriedMp4Fallback: boolean;
      };

      serviceRef.activePlaybackMode = 'hls';
      serviceRef.activePlayback = {
        hlsUrl: '/api/videos/video-1/hls/playlist.m3u8',
        loadToken: 1,
        mediaType: 'video',
        posterUrl: '',
        sourceUrl: '/api/videos/video-1/stream',
      };
      serviceRef.hasTriedMp4Fallback = false;

      service.onVideoError();

      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      expect(onVideoEndedSpy).not.toHaveBeenCalled();
    });

    it('does not fall back to MP4 when the hls.js fatal error handler fires for an hls-only video', async () => {
      const video = hlsOnlyVideo();
      service.profile.set({ ...profile(), videos: [video] });
      const fallbackSpy = vi.spyOn(service as unknown as { fallbackToMp4: (playback: unknown) => Promise<void> }, 'fallbackToMp4');
      const onVideoEndedSpy = vi.spyOn(service, 'onVideoEnded').mockImplementation(() => undefined);
      const instances: MockHlsInstance[] = [];
      const handlers = new Map<string, (event: unknown, data: { fatal?: boolean }) => void>();
      const mockHls = vi
        .spyOn(
          service as unknown as { loadHlsLibrary: () => Promise<unknown> },
          'loadHlsLibrary',
        )
        .mockResolvedValue(createMockHlsClass(instances, handlers));

      service.attachVideoElement(document.createElement('video'));
      await loadAndPlayMedia(video);

      expect(instances).toHaveLength(1);
      const errorHandler = handlers.get('hlsError');
      expect(errorHandler).toBeDefined();
      errorHandler?.('hlsError', { fatal: true });

      expect(mockHls).toHaveBeenCalledTimes(1);
      expect(fallbackSpy).not.toHaveBeenCalled();
      expect(onVideoEndedSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to MP4 when the hls.js fatal error handler fires for a legacy video with a stream URL', async () => {
      const legacyVideo: Video = {
        ...profile().videos[0],
        hlsManifestPath: 'processed/hls/v1/playlist.m3u8',
      };
      service.profile.set({ ...profile(), videos: [legacyVideo] });
      const fallbackSpy = vi.spyOn(service as unknown as { fallbackToMp4: (playback: unknown) => Promise<void> }, 'fallbackToMp4');
      const onVideoEndedSpy = vi.spyOn(service, 'onVideoEnded').mockImplementation(() => undefined);
      const instances: MockHlsInstance[] = [];
      const handlers = new Map<string, (event: unknown, data: { fatal?: boolean }) => void>();
      vi.spyOn(
        service as unknown as { loadHlsLibrary: () => Promise<unknown> },
        'loadHlsLibrary',
      ).mockResolvedValue(createMockHlsClass(instances, handlers));

      service.attachVideoElement(document.createElement('video'));
      await loadAndPlayMedia(legacyVideo);

      expect(instances).toHaveLength(1);
      const errorHandler = handlers.get('hlsError');
      expect(errorHandler).toBeDefined();
      errorHandler?.('hlsError', { fatal: true });

      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      expect(onVideoEndedSpy).not.toHaveBeenCalled();
    });
  });

  describe('shouldCacheVideo', () => {    const serviceRef = () =>
      service as unknown as { shouldCacheVideo: (video: Video) => boolean };

    it('returns false for a ready hls-only video within size limits', () => {
      const video: Video = {
        ...profile().videos[0],
        hlsManifestPath: 'processed/hls/v1/playlist.m3u8',
        streamVariant: 'hls-only',
      };

      expect(serviceRef().shouldCacheVideo(video)).toBe(false);
    });

    it('returns true for a ready legacy video within size limits', () => {
      expect(serviceRef().shouldCacheVideo(profile().videos[0])).toBe(true);
    });
  });
});
