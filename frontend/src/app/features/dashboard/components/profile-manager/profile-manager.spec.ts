import { TestBed } from '@angular/core/testing';
import { ProfileManager } from './profile-manager';
import { Profile, Video } from '../../../../services/api.service';

const video = (partial: Partial<Video>): Video => ({
  createdAt: '2026-03-10T00:00:00.000Z',
  filename: 'file.mp4',
  id: '1',
  mediaType: 'video',
  originalName: 'Promo.mp4',
  processingStatus: 'ready',
  sourceFilename: 'file.mp4',
  sourceSize: 100,
  size: 100,
  storageProvider: 'local',
  streamVariant: 'original',
  updatedAt: '2026-03-10T00:00:00.000Z',
  uploadedAt: '2026-03-10T00:00:00.000Z',
  ...partial,
});

const profile = (partial: Partial<Profile>): Profile => ({
  createdAt: '2026-03-10T00:00:00.000Z',
  id: 'profile-1',
  name: 'Lobby',
  playerAccessToken: 'player-token',
  slug: 'lobby',
  updatedAt: '2026-03-10T00:00:00.000Z',
  videoIds: ['1'],
  ...partial,
  orientation: partial.orientation ?? 'landscape',
});

describe('ProfileManager', () => {
  it('emits save payload for a valid playlist', () => {
    const component = new ProfileManager();
    const emitted: unknown[] = [];

    component.videos = [video({ id: 'video-1' })];
    component.saveProfile.subscribe((payload) => emitted.push(payload));
    component.openCreate();
    component.profileName = 'Main Lobby';
    component.addToPlaylist(component.videos[0]);

    component.save();

    expect(emitted).toEqual([
      {
        id: undefined,
        name: 'Main Lobby',
        orientation: 'landscape',
        videoIds: ['video-1'],
      },
    ]);
  });

  it('blocks duplicate slug collisions before emitting', () => {
    const component = new ProfileManager();

    component.profiles = [profile({ id: 'profile-1', name: 'Lobby Screen' })];
    component.videos = [video({ id: 'video-1' })];
    component.openCreate();
    component.profileName = 'Lobby   Screen';
    component.addToPlaylist(component.videos[0]);

    component.save();

    expect(component.formError).toContain('slug');
  });

  it('does not render old player link section on profile cards', () => {
    TestBed.configureTestingModule({
      imports: [ProfileManager],
    });

    const fixture = TestBed.createComponent(ProfileManager);
    const component = fixture.componentInstance;
    component.profiles = [profile({ id: 'profile-1', name: 'Main Screen', slug: 'main-screen' })];
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Player mới');
    expect(text).not.toContain('TV cũ');
  });

  it('shows settings and delete actions in card header without computer icon', () => {
    TestBed.configureTestingModule({
      imports: [ProfileManager],
    });

    const fixture = TestBed.createComponent(ProfileManager);
    const component = fixture.componentInstance;
    component.profiles = [profile({ id: 'profile-1', name: 'Main Screen', slug: 'main-screen' })];
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const monitorIcons = host.querySelectorAll('svg.h-6.w-6');
    const headerActionButtons = host.querySelectorAll('article .border-b button');
    const footerActionButtons = host.querySelectorAll('article .bg-slate-50 button');

    expect(monitorIcons.length).toBe(0);
    expect(headerActionButtons.length).toBe(2);
    expect(footerActionButtons.length).toBe(0);
  });

  it('does not render playback link label in profile config modal', () => {
    TestBed.configureTestingModule({
      imports: [ProfileManager],
    });

    const fixture = TestBed.createComponent(ProfileManager);
    const component = fixture.componentInstance;
    component.videos = [video({ id: 'video-1' })];
    component.openCreate();
    component.profileName = 'Main Screen';
    component.addToPlaylist(component.videos[0]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Link phát:');
  });

  it('renders only the content count badge on profile cards', () => {
    TestBed.configureTestingModule({
      imports: [ProfileManager],
    });

    const fixture = TestBed.createComponent(ProfileManager);
    const component = fixture.componentInstance;
    component.profiles = [profile({ id: 'profile-1', name: 'Lobby TV', slug: 'tivi', lastSeen: new Date().toISOString() })];
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('article') as HTMLElement;
    const badges = card.querySelectorAll('.mt-3 span');

    expect(badges.length).toBe(1);
    expect(badges[0].textContent?.trim()).toBe('1 nội dung');

    const badgeText = (card.querySelector('.mt-3')?.textContent ?? '').toLowerCase();
    expect(badgeText).not.toContain('tivi');
    expect(badgeText).not.toContain('online');
    expect(badgeText).not.toContain('offline');
  });

  it('builds a dedicated legacy player URL for old TVs', () => {
    const component = new ProfileManager();
    component.localIps = ['192.168.1.25'];

    const cleanUrl = new URL(component.getLegacyPlayerUrl(profile({
      name: 'Lobby Screen',
      playerAccessToken: 'legacy-token',
      slug: 'lobby-screen',
    })));
    const pairingUrl = new URL(component.getLegacyPlayerPairingUrl(profile({
      name: 'Lobby Screen',
      playerAccessToken: 'legacy-token',
      slug: 'lobby-screen',
    })));

    expect(cleanUrl.hostname).toBe('192.168.1.25');
    expect(cleanUrl.pathname).toBe('/player-legacy/lobby-screen');
    expect(cleanUrl.searchParams.get('token')).toBeNull();

    expect(pairingUrl.pathname).toBe('/player-legacy/lobby-screen');
    expect(pairingUrl.searchParams.get('token')).toBe('legacy-token');
  });
});
