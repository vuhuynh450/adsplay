import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlayerProfile } from '../../services/api.service';
import { ApiService } from '../../services/api.service';
import { PlayerSessionService } from './player-session.service';

describe('PlayerSessionService orientation mapping', () => {
  let service: PlayerSessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PlayerSessionService,
        {
          provide: ApiService,
          useValue: {},
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
});
