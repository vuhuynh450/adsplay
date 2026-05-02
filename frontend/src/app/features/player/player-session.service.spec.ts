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
});
