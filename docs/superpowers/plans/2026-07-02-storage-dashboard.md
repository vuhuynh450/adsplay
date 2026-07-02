# Storage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local VPS storage visibility to the existing System tab.

**Architecture:** Extend the existing authenticated `GET /api/system/status` endpoint with a defensive `storage` object, then carry that shape through the Angular API service, dashboard store, and System tab template. Keep this as observability only: no upload blocking, cleanup actions, delete-flow changes, or auth rate limiting.

**Tech Stack:** Express 5, TypeScript, Node filesystem APIs, SQLite local files, Angular 21, RxJS, Tailwind utility classes, Node test runner, Vitest/Angular test utilities.

## Global Constraints

- Scope is only Storage dashboard in System tab.
- Do not add new backend endpoints; extend `GET /api/system/status`.
- Do not add new runtime dependencies.
- Do not block uploads, clean sessions, change video deletion, or add login rate limiting in this plan.
- Storage stats must not make `/api/system/status` fail if one path cannot be read.
- Keep current System tab visual language: rounded cards, slate text, brand primary accent, responsive grid.
- Do not commit unless the user explicitly asks for a commit.

---

## File Structure

- Modify `backend/src/services/system.service.ts`: compute disk stats, directory sizes, SQLite file sizes, and return them inside `storage`.
- Modify `backend/test/api.test.js`: assert authenticated system status contains storage details and auth behavior remains unchanged.
- Modify `frontend/src/app/services/api.service.ts`: add `StorageStatus`/`SystemStatus` interfaces and update `getSystemStatus()` typing.
- Modify `frontend/src/app/features/dashboard/dashboard.store.ts`: preserve the full system status object including storage.
- Modify `frontend/src/app/features/dashboard/dashboard.store.spec.ts`: verify store keeps storage info from polling response.
- Modify `frontend/src/app/features/dashboard/admin.ts`: add byte/status formatting helpers for the System tab.
- Modify `frontend/src/app/features/dashboard/admin.html`: add the Storage dashboard card.
- Modify `frontend/src/app/features/dashboard/admin.spec.ts`: verify storage UI renders values and fallback text.

---

### Task 1: Backend Storage Status

**Files:**
- Modify: `backend/src/services/system.service.ts`
- Modify: `backend/test/api.test.js`

**Interfaces:**
- Consumes: `getConfig()` from `backend/src/config.ts`
- Produces: `getSystemStatus(): Promise<SystemStatus>` where `SystemStatus.storage` has `disk`, `directories`, and `database`

- [ ] **Step 1: Add a failing API test for storage status**

Add this test after the existing `auth and system status flow works` test in `backend/test/api.test.js`:

```js
test('system status includes local storage usage details', async () => {
  const { authHeader } = await loginAsAdmin();

  const sourceFilePath = path.join(process.env.UPLOADS_DIR, 'source-test.mp4');
  const processedFilePath = path.join(process.env.UPLOADS_DIR, 'processed', 'hls', 'segment-000.ts');
  const sessionFilePath = path.join(process.env.UPLOADS_DIR, '.sessions', '11111111-1111-4111-8111-111111111111', 'chunks', '000000.part');

  await fs.outputFile(sourceFilePath, Buffer.alloc(10));
  await fs.outputFile(processedFilePath, Buffer.alloc(20));
  await fs.outputFile(sessionFilePath, Buffer.alloc(30));

  const response = await request(app)
    .get('/api/system/status')
    .set(authHeader);

  assert.equal(response.status, 200);
  assert.ok(response.body.storage);
  assert.ok(response.body.storage.disk === null || typeof response.body.storage.disk.totalBytes === 'number');
  assert.equal(typeof response.body.storage.directories.uploadsRootBytes, 'number');
  assert.equal(typeof response.body.storage.directories.sourceFilesBytes, 'number');
  assert.equal(typeof response.body.storage.directories.processedBytes, 'number');
  assert.equal(typeof response.body.storage.directories.sessionsBytes, 'number');
  assert.equal(response.body.storage.directories.sourceFilesBytes, 10);
  assert.ok(response.body.storage.directories.processedBytes >= 20);
  assert.ok(response.body.storage.directories.sessionsBytes >= 30);
  assert.equal(response.body.storage.database.path, process.env.DB_FILE);
  assert.equal(typeof response.body.storage.database.totalBytes, 'number');
});
```

- [ ] **Step 2: Run the failing backend test**

Run:

```bash
npm test -- --test-name-pattern="system status includes local storage usage details"
```

Workdir: `backend`

Expected: fail because `response.body.storage` is missing.

- [ ] **Step 3: Implement storage status in `system.service.ts`**

Replace `backend/src/services/system.service.ts` with this implementation:

```ts
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../config';

type StorageHealthStatus = 'ok' | 'warning' | 'critical';

interface DiskStatus {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    status: StorageHealthStatus;
}

interface StorageStatus {
    database: {
        path: string;
        mainBytes: number | null;
        shmBytes: number | null;
        totalBytes: number | null;
        walBytes: number | null;
    };
    directories: {
        processedBytes: number | null;
        sessionsBytes: number | null;
        sourceFilesBytes: number | null;
        uploadsRootBytes: number | null;
    };
    disk: DiskStatus | null;
}

interface SystemStatus {
    localIps: string[];
    online: boolean;
    storage: StorageStatus;
    uptime: number;
}

const getStorageHealthStatus = (freeBytes: number, totalBytes: number): StorageHealthStatus => {
    if (totalBytes <= 0) {
        return 'critical';
    }

    const freePercent = (freeBytes / totalBytes) * 100;
    if (freePercent < 10) {
        return 'critical';
    }

    if (freePercent < 20) {
        return 'warning';
    }

    return 'ok';
};

const safeStatSize = async (filePath: string) => {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile() ? stats.size : null;
    } catch {
        return null;
    }
};

const getDirectorySize = async (directoryPath: string): Promise<number | null> => {
    try {
        if (!(await fs.pathExists(directoryPath))) {
            return null;
        }

        let totalBytes = 0;
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(directoryPath, entry.name);

            if (entry.isSymbolicLink()) {
                continue;
            }

            if (entry.isDirectory()) {
                const childSize = await getDirectorySize(entryPath);
                totalBytes += childSize ?? 0;
                continue;
            }

            if (entry.isFile()) {
                const size = await safeStatSize(entryPath);
                totalBytes += size ?? 0;
            }
        }

        return totalBytes;
    } catch {
        return null;
    }
};

const getDirectFileSize = async (directoryPath: string): Promise<number | null> => {
    try {
        if (!(await fs.pathExists(directoryPath))) {
            return null;
        }

        let totalBytes = 0;
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }

            const size = await safeStatSize(path.join(directoryPath, entry.name));
            totalBytes += size ?? 0;
        }

        return totalBytes;
    } catch {
        return null;
    }
};

const getDiskStatus = async (targetPath: string): Promise<DiskStatus | null> => {
    try {
        const stats = await fs.statfs(targetPath);
        const totalBytes = stats.blocks * stats.bsize;
        const freeBytes = stats.bavail * stats.bsize;
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 100;

        return {
            freeBytes,
            path: targetPath,
            status: getStorageHealthStatus(freeBytes, totalBytes),
            totalBytes,
            usedBytes,
            usedPercent,
        };
    } catch {
        return null;
    }
};

const getDatabaseStatus = async (dbFile: string): Promise<StorageStatus['database']> => {
    const [mainBytes, walBytes, shmBytes] = await Promise.all([
        safeStatSize(dbFile),
        safeStatSize(`${dbFile}-wal`),
        safeStatSize(`${dbFile}-shm`),
    ]);

    const availableSizes = [mainBytes, walBytes, shmBytes].filter((value): value is number => value !== null);

    return {
        mainBytes,
        path: dbFile,
        shmBytes: shmBytes ?? 0,
        totalBytes: availableSizes.length ? availableSizes.reduce((total, value) => total + value, 0) : null,
        walBytes: walBytes ?? 0,
    };
};

const getStorageStatus = async (): Promise<StorageStatus> => {
    const config = getConfig();
    const [disk, uploadsRootBytes, sourceFilesBytes, processedBytes, sessionsBytes, database] = await Promise.all([
        getDiskStatus(config.uploadsDir),
        getDirectorySize(config.uploadsDir),
        getDirectFileSize(config.uploadsDir),
        getDirectorySize(config.processedUploadsDir),
        getDirectorySize(config.uploadSessionsDir),
        getDatabaseStatus(config.dbFile),
    ]);

    return {
        database,
        directories: {
            processedBytes,
            sessionsBytes,
            sourceFilesBytes,
            uploadsRootBytes,
        },
        disk,
    };
};

export const getSystemStatus = async (): Promise<SystemStatus> => {
    const nets = os.networkInterfaces();
    const localIps: string[] = [];

    for (const interfaces of Object.values(nets)) {
        for (const network of interfaces || []) {
            if (network.family === 'IPv4' && !network.internal) {
                localIps.push(network.address);
            }
        }
    }

    return {
        localIps,
        online: true,
        storage: await getStorageStatus(),
        uptime: process.uptime(),
    };
};
```

- [ ] **Step 4: Run the targeted backend test again**

Run:

```bash
npm test -- --test-name-pattern="system status includes local storage usage details"
```

Workdir: `backend`

Expected: PASS.

- [ ] **Step 5: Run full backend tests**

Run:

```bash
npm test
```

Workdir: `backend`

Expected: all backend tests pass.

---

### Task 2: Frontend API And Store Storage Shape

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`
- Modify: `frontend/src/app/features/dashboard/dashboard.store.ts`
- Modify: `frontend/src/app/features/dashboard/dashboard.store.spec.ts`

**Interfaces:**
- Consumes: backend `SystemStatus.storage`
- Produces: frontend `SystemStatus` and `StorageStatus` interfaces; `DashboardStore.systemInfo()` returns `SystemStatus | null`

- [ ] **Step 1: Add a failing DashboardStore test**

In `frontend/src/app/features/dashboard/dashboard.store.spec.ts`, update the default `getSystemStatus` mock to include storage:

```ts
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
```

Then add this test before the closing `});`:

```ts
it('preserves storage status from system polling', () => {
  store.initialize();

  expect(store.systemInfo()?.storage?.disk?.status).toBe('ok');
  expect(store.systemInfo()?.storage?.directories.sourceFilesBytes).toBe(10);
  expect(store.systemInfo()?.storage?.database.totalBytes).toBe(100);
});
```

- [ ] **Step 2: Run the failing frontend test**

Run:

```bash
npm run test:ci -- --runInBand=false
```

Workdir: `frontend`

Expected: TypeScript or test failure because frontend types/store do not preserve `storage` yet.

- [ ] **Step 3: Add SystemStatus and StorageStatus interfaces**

In `frontend/src/app/services/api.service.ts`, add these interfaces after `VideoPolicy`:

```ts
export type StorageHealthStatus = 'ok' | 'warning' | 'critical';

export interface StorageStatus {
    database: {
        mainBytes: number | null;
        path: string;
        shmBytes: number | null;
        totalBytes: number | null;
        walBytes: number | null;
    };
    directories: {
        processedBytes: number | null;
        sessionsBytes: number | null;
        sourceFilesBytes: number | null;
        uploadsRootBytes: number | null;
    };
    disk: {
        freeBytes: number;
        path: string;
        status: StorageHealthStatus;
        totalBytes: number;
        usedBytes: number;
        usedPercent: number;
    } | null;
}

export interface SystemStatus {
    localIps: string[];
    online: boolean;
    storage?: StorageStatus;
    uptime: number;
}
```

Then change `getSystemStatus()` to:

```ts
getSystemStatus(): Observable<SystemStatus> {
    return this.http.get<SystemStatus>(`${this.apiUrl}/system/status`);
}
```

- [ ] **Step 4: Preserve full system status in DashboardStore**

In `frontend/src/app/features/dashboard/dashboard.store.ts`, update imports from `api.service` to include `SystemStatus`:

```ts
import {
  AdminDevice,
  ApiService,
  PendingDeviceRegistration,
  Profile,
  ProfileOrientation,
  SystemStatus,
  Video,
} from '../../services/api.service';
```

Change the signal declaration:

```ts
readonly systemInfo = signal<SystemStatus | null>(null);
```

In both `startSystemPolling()` and `refreshSystemStatus()`, replace:

```ts
this.systemInfo.set({ localIps: status.localIps, uptime: status.uptime });
```

with:

```ts
this.systemInfo.set(status);
```

- [ ] **Step 5: Run DashboardStore tests**

Run:

```bash
npm run test:ci -- dashboard.store.spec.ts
```

Workdir: `frontend`

Expected: PASS.

- [ ] **Step 6: Run frontend build**

Run:

```bash
npm run build
```

Workdir: `frontend`

Expected: build succeeds with no TypeScript errors.

---

### Task 3: System Tab Storage Dashboard UI

**Files:**
- Modify: `frontend/src/app/features/dashboard/admin.ts`
- Modify: `frontend/src/app/features/dashboard/admin.html`
- Modify: `frontend/src/app/features/dashboard/admin.spec.ts`

**Interfaces:**
- Consumes: `store.systemInfo()?.storage` from Task 2
- Produces: rendered “Dung Lượng Lưu Trữ” card and helper methods `formatBytes`, `getStorageStatusLabel`, `getStorageStatusBadgeClasses`, `getStorageUsageBarClasses`

- [ ] **Step 1: Add failing Admin UI tests**

In `frontend/src/app/features/dashboard/admin.spec.ts`, update the import line:

```ts
import { ApiService, SystemStatus, Video } from '../../services/api.service';
```

Add this constant above `describe`:

```ts
const systemStatusWithStorage: SystemStatus = {
  localIps: ['192.168.1.10'],
  online: true,
  storage: {
    database: {
      mainBytes: 1024,
      path: '/tmp/db.sqlite',
      shmBytes: 0,
      totalBytes: 1024,
      walBytes: 0,
    },
    directories: {
      processedBytes: 2 * 1024 * 1024,
      sessionsBytes: null,
      sourceFilesBytes: 5 * 1024 * 1024,
      uploadsRootBytes: 7 * 1024 * 1024,
    },
    disk: {
      freeBytes: 40 * 1024 * 1024,
      path: '/tmp/uploads',
      status: 'warning',
      totalBytes: 100 * 1024 * 1024,
      usedBytes: 60 * 1024 * 1024,
      usedPercent: 60,
    },
  },
  uptime: 1,
};
```

Change `createStoreStub()` to accept an optional system status:

```ts
function createStoreStub(systemInfo: SystemStatus = { localIps: [], online: true, uptime: 1 }) {
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
    systemInfo: () => systemInfo,
    unassignDeviceProfile: vi.fn(),
    uploadMedia: vi.fn(),
    uploadProgress: () => 0,
    uploadStatusLabel: () => 'Sẵn sàng tải lên',
    videos: () => [],
  };
}
```

Add this test inside `describe`:

```ts
it('renders storage dashboard values and missing field fallback', async () => {
  TestBed.overrideComponent(Admin, {
    set: {
      providers: [{ provide: DashboardStore, useValue: createStoreStub(systemStatusWithStorage) }],
    },
  });

  const fixture = TestBed.createComponent(Admin);
  fixture.componentInstance.activeTab.set('system');
  fixture.detectChanges();

  const text = fixture.nativeElement.textContent as string;

  expect(text).toContain('Dung Lượng Lưu Trữ');
  expect(text).toContain('Cảnh báo');
  expect(text).toContain('60%');
  expect(text).toContain('5.0 MB');
  expect(text).toContain('2.0 MB');
  expect(text).toContain('Không đọc được');
  expect(text).toContain('1.0 KB');
});
```

- [ ] **Step 2: Run the failing Admin test**

Run:

```bash
npm run test:ci -- admin.spec.ts
```

Workdir: `frontend`

Expected: fail because helper methods/UI card do not exist yet.

- [ ] **Step 3: Add formatting helpers to Admin component**

In `frontend/src/app/features/dashboard/admin.ts`, update the import:

```ts
import { ApiService, StorageHealthStatus, Video } from '../../services/api.service';
```

Add these methods before `private fallbackCopyTextToClipboard(...)`:

```ts
  formatBytes(bytes?: number | null) {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
      return 'Không đọc được';
    }

    if (bytes === 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, unitIndex);

    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  getStorageStatusLabel(status?: StorageHealthStatus) {
    if (status === 'critical') {
      return 'Nguy cấp';
    }

    if (status === 'warning') {
      return 'Cảnh báo';
    }

    return 'Ổn định';
  }

  getStorageStatusBadgeClasses(status?: StorageHealthStatus) {
    if (status === 'critical') {
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    }

    if (status === 'warning') {
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    }

    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  }

  getStorageUsageBarClasses(status?: StorageHealthStatus) {
    if (status === 'critical') {
      return 'bg-red-500';
    }

    if (status === 'warning') {
      return 'bg-amber-500';
    }

    return 'bg-brand-primary';
  }
```

- [ ] **Step 4: Add the storage card to System tab**

In `frontend/src/app/features/dashboard/admin.html`, insert this block immediately after the closing `</div>` of the “Thông Tin Máy Chủ” card and before the existing blank line in the `activeTab() === 'system'` section:

```html
                    <div class="p-6 rounded-2xl bg-white dark:bg-brand-surface border border-slate-200 dark:border-white/10 shadow-sm">
                        <div class="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                                <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100">Dung Lượng Lưu Trữ</h3>
                                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    Theo dõi ổ đĩa VPS, thư mục uploads, HLS/poster, phiên upload tạm và SQLite.
                                </p>
                            </div>
                            <span class="w-fit rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
                                [ngClass]="getStorageStatusBadgeClasses(store.systemInfo()?.storage?.disk?.status)">
                                {{ getStorageStatusLabel(store.systemInfo()?.storage?.disk?.status) }}
                            </span>
                        </div>

                        @if (store.systemInfo()?.storage?.disk; as disk) {
                        <div class="mb-5">
                            <div class="mb-2 flex items-center justify-between text-sm">
                                <span class="font-medium text-slate-600 dark:text-slate-300">Đã dùng ổ đĩa</span>
                                <span class="font-mono font-semibold text-slate-700 dark:text-slate-200">
                                    {{ disk.usedPercent }}%
                                </span>
                            </div>
                            <div class="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                                <div class="h-full rounded-full transition-all"
                                    [ngClass]="getStorageUsageBarClasses(disk.status)"
                                    [style.width.%]="disk.usedPercent">
                                </div>
                            </div>
                            <div class="mt-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                                {{ disk.path }}
                            </div>
                        </div>

                        <div class="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div class="rounded-xl bg-slate-50 p-4 dark:bg-white/5">
                                <div class="text-xs font-bold uppercase tracking-wider text-slate-400">Tổng ổ đĩa</div>
                                <div class="mt-1 font-mono text-lg font-semibold text-slate-800 dark:text-slate-100">
                                    {{ formatBytes(disk.totalBytes) }}
                                </div>
                            </div>
                            <div class="rounded-xl bg-slate-50 p-4 dark:bg-white/5">
                                <div class="text-xs font-bold uppercase tracking-wider text-slate-400">Đã dùng</div>
                                <div class="mt-1 font-mono text-lg font-semibold text-slate-800 dark:text-slate-100">
                                    {{ formatBytes(disk.usedBytes) }}
                                </div>
                            </div>
                            <div class="rounded-xl bg-slate-50 p-4 dark:bg-white/5">
                                <div class="text-xs font-bold uppercase tracking-wider text-slate-400">Còn trống</div>
                                <div class="mt-1 font-mono text-lg font-semibold text-slate-800 dark:text-slate-100">
                                    {{ formatBytes(disk.freeBytes) }}
                                </div>
                            </div>
                        </div>
                        } @else {
                        <div class="mb-5 rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                            Không đọc được thông tin ổ đĩa.
                        </div>
                        }

                        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div class="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                                <div class="text-xs font-bold uppercase tracking-wider text-slate-400">File upload gốc</div>
                                <div class="mt-2 font-mono text-base font-semibold text-slate-800 dark:text-slate-100">
                                    {{ formatBytes(store.systemInfo()?.storage?.directories?.sourceFilesBytes) }}
                                </div>
                            </div>
                            <div class="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                                <div class="text-xs font-bold uppercase tracking-wider text-slate-400">HLS / Poster</div>
                                <div class="mt-2 font-mono text-base font-semibold text-slate-800 dark:text-slate-100">
                                    {{ formatBytes(store.systemInfo()?.storage?.directories?.processedBytes) }}
                                </div>
                            </div>
                            <div class="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                                <div class="text-xs font-bold uppercase tracking-wider text-slate-400">Phiên upload tạm</div>
                                <div class="mt-2 font-mono text-base font-semibold text-slate-800 dark:text-slate-100">
                                    {{ formatBytes(store.systemInfo()?.storage?.directories?.sessionsBytes) }}
                                </div>
                            </div>
                            <div class="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                                <div class="text-xs font-bold uppercase tracking-wider text-slate-400">SQLite database</div>
                                <div class="mt-2 font-mono text-base font-semibold text-slate-800 dark:text-slate-100">
                                    {{ formatBytes(store.systemInfo()?.storage?.database?.totalBytes) }}
                                </div>
                            </div>
                        </div>
                    </div>
```

- [ ] **Step 5: Run Admin UI test**

Run:

```bash
npm run test:ci -- admin.spec.ts
```

Workdir: `frontend`

Expected: PASS.

- [ ] **Step 6: Run full frontend verification**

Run:

```bash
npm run build
```

Workdir: `frontend`

Expected: build succeeds.

Run:

```bash
npm run test:ci
```

Workdir: `frontend`

Expected: all frontend tests pass.

---

## Final Verification

- [ ] Run backend tests:

```bash
npm test
```

Workdir: `backend`

- [ ] Run frontend build:

```bash
npm run build
```

Workdir: `frontend`

- [ ] Run frontend tests:

```bash
npm run test:ci
```

Workdir: `frontend`

- [ ] Inspect changed files:

```bash
git diff -- backend/src/services/system.service.ts backend/test/api.test.js frontend/src/app/services/api.service.ts frontend/src/app/features/dashboard/dashboard.store.ts frontend/src/app/features/dashboard/dashboard.store.spec.ts frontend/src/app/features/dashboard/admin.ts frontend/src/app/features/dashboard/admin.html frontend/src/app/features/dashboard/admin.spec.ts docs/superpowers/specs/2026-07-02-storage-dashboard-design.md docs/superpowers/plans/2026-07-02-storage-dashboard.md
```

Expected: diff only contains Storage dashboard changes and the approved spec/plan docs.

## Self-Review Notes

- Spec coverage: backend response shape, directory sizes, SQLite sizes, defensive errors, frontend types/store/UI, and tests are covered by Tasks 1-3.
- Out-of-scope items are not included: no upload guard, cleanup, delete changes, login rate limit, backup, or manual cleanup UI.
- Type consistency: `StorageStatus`, `SystemStatus`, and `StorageHealthStatus` names are used consistently across frontend tasks.
- Commit steps are intentionally omitted because commits require explicit user approval in this workspace.
