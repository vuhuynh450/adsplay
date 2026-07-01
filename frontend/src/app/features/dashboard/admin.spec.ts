import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { ApiService, Video } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { DashboardStore } from './dashboard.store';
import { Admin } from './admin';

const video = (partial: Partial<Video> = {}): Video => ({
  createdAt: '2026-07-01T00:00:00.000Z',
  filename: 'video.mp4',
  id: 'video-1',
  mediaType: 'video',
  originalName: 'video 15.mp4',
  processingStatus: 'ready',
  sourceFilename: 'video.mp4',
  sourceSize: 100,
  size: 100,
  storageProvider: 'local',
  streamVariant: 'original',
  updatedAt: '2026-07-01T00:00:00.000Z',
  uploadedAt: '2026-07-01T00:00:00.000Z',
  ...partial,
});

describe('Admin preview modal', () => {
  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });

    await TestBed.configureTestingModule({
      imports: [Admin],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { data: of({ pageKey: 'videos' }) },
        },
        {
          provide: ApiService,
          useValue: { getMediaStreamUrl: (item: Video) => `/api/videos/${item.id}/stream` },
        },
        {
          provide: AuthService,
          useValue: {
            hasPageAccess: () => true,
            logout: vi.fn(),
          },
        },
        {
          provide: DashboardStore,
          useValue: createStoreStub(),
        },
      ],
    })
      .overrideComponent(Admin, {
        set: {
          providers: [{ provide: DashboardStore, useValue: createStoreStub() }],
        },
      })
      .compileComponents();
  });

  it('keeps preview media constrained inside the modal viewport', () => {
    const fixture = TestBed.createComponent(Admin);
    const component = fixture.componentInstance;

    component.openPreview(video());
    fixture.detectChanges();

    const mediaArea = fixture.nativeElement.querySelector('[data-preview-media-area]') as HTMLElement;
    const mediaFrame = fixture.nativeElement.querySelector('[data-preview-media-frame]') as HTMLElement;
    const videoElement = fixture.nativeElement.querySelector('video') as HTMLVideoElement;

    expect(mediaArea.className).toContain('min-h-0');
    expect(mediaFrame.className).toContain('min-h-0');
    expect(videoElement.classList.contains('max-h-full')).toBe(true);
    expect(videoElement.classList.contains('h-full')).toBe(false);
  });
});

function createStoreStub() {
  return {
    activePlayerCount: () => 0,
    assignDeviceProfile: vi.fn(),
    confirmPendingDeviceRegistration: vi.fn(),
    deleteDevice: vi.fn(),
    deleteDevicesBulk: vi.fn(),
    deleteProfile: vi.fn(),
    deleteVideo: vi.fn(),
    devices: () => [],
    getVideoDeleteMessage: vi.fn(() => 'Xóa nội dung?'),
    initialize: vi.fn(),
    isSystemOnline: () => true,
    isUploading: () => false,
    loading: () => false,
    maxUploadSizeBytes: () => 1024,
    pendingDeviceRegistrations: () => [],
    profiles: () => [],
    renameDevice: vi.fn(),
    saveProfile: vi.fn(),
    refreshAll: vi.fn(),
    systemInfo: () => ({ localIps: [], uptime: 1 }),
    unassignDeviceProfile: vi.fn(),
    uploadMedia: vi.fn(),
    uploadProgress: () => 0,
    uploadStatusLabel: () => 'Sẵn sàng tải lên',
    videos: () => [],
  };
}
