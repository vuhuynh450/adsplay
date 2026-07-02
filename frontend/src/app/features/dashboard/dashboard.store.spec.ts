import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService, AdminDevice, AuthLoginUser } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../shared/services/toast.service';
import { DashboardStore } from './dashboard.store';
import { ResumableUploadService } from './resumable-upload.service';

const adminUser: AuthLoginUser = {
  allowedPages: [],
  id: 'admin-1',
  mustChangePassword: false,
  role: 'admin',
  username: 'admin',
};

const staffWithoutDevicesAccess: AuthLoginUser = {
  allowedPages: ['videos'],
  id: 'staff-1',
  mustChangePassword: false,
  role: 'staff',
  username: 'staff',
};

const device = (lastSeen: string): AdminDevice => ({
  createdAt: '2026-07-01T00:00:00.000Z',
  deviceCode: 'F17637',
  id: 'device-1',
  lastSeen,
  name: 'TV Device',
  updatedAt: lastSeen,
});

describe('DashboardStore', () => {
  let store: DashboardStore;
  let currentUser: AuthLoginUser;
  let api: {
    getDevices: ReturnType<typeof vi.fn>;
    getPendingDeviceRegistrations: ReturnType<typeof vi.fn>;
    getProfiles: ReturnType<typeof vi.fn>;
    getSystemStatus: ReturnType<typeof vi.fn>;
    getVideos: ReturnType<typeof vi.fn>;
    getVideoPolicy: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    currentUser = adminUser;

    api = {
      getDevices: vi
        .fn()
        .mockReturnValueOnce(of([device('2026-07-01T09:22:21.000Z')]))
        .mockReturnValueOnce(of([device('2026-07-01T09:24:21.000Z')])),
      getPendingDeviceRegistrations: vi.fn().mockReturnValue(of([])),
      getProfiles: vi.fn().mockReturnValue(of([])),
      getSystemStatus: vi.fn().mockReturnValue(of({
        localIps: [],
        online: true,
        storage: {
          database: {
            mainBytes: 100,
            path: '/tmp/db.sqlite',
            shmBytes: 0,
            totalBytes: 100,
            walBytes: 0,
          },
          directories: {
            processedBytes: 20,
            sessionsBytes: 30,
            sourceFilesBytes: 10,
            uploadsRootBytes: 60,
          },
          disk: {
            freeBytes: 900,
            path: '/tmp/uploads',
            status: 'ok',
            totalBytes: 1000,
            usedBytes: 100,
            usedPercent: 10,
          },
        },
        uptime: 1,
      })),
      getVideos: vi.fn().mockReturnValue(of([])),
      getVideoPolicy: vi.fn().mockReturnValue(of({
        allowedMimeTypes: [],
        maxUploadSizeBytes: 1,
        mediaProcessingEnabled: true,
        resumableChunkSizeBytes: 1,
        storageTargets: ['local'],
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        DashboardStore,
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => currentUser } },
        { provide: ToastService, useValue: { show: vi.fn() } },
        { provide: ResumableUploadService, useValue: {} },
      ],
    });

    store = TestBed.inject(DashboardStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('refreshes device presence during system polling so online status does not go stale', () => {
    store.initialize();

    expect(store.devices()[0].lastSeen).toBe('2026-07-01T09:22:21.000Z');

    vi.advanceTimersByTime(30000);

    expect(api.getDevices).toHaveBeenCalledTimes(2);
    expect(store.devices()[0].lastSeen).toBe('2026-07-01T09:24:21.000Z');
  });

  it('does not poll devices when the current user cannot access the devices page', () => {
    currentUser = staffWithoutDevicesAccess;

    store.initialize();
    vi.advanceTimersByTime(30000);

    expect(api.getDevices).not.toHaveBeenCalled();
  });

  it('preserves storage status from system polling', () => {
    store.initialize();

    expect(store.systemInfo()?.storage?.disk?.status).toBe('ok');
    expect(store.systemInfo()?.storage?.directories.sourceFilesBytes).toBe(10);
    expect(store.systemInfo()?.storage?.database.totalBytes).toBe(100);
  });
});
