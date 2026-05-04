# R2 Storage Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị thông tin Cloudflare R2 storage (bucket, số objects, dung lượng) trong tab Hệ Thống của admin dashboard.

**Architecture:** Tích hợp vào endpoint `/api/system/status` hiện tại. Backend fetch R2 stats qua AWS SDK S3 API, cache 5 phút trong memory. Frontend hiển thị trong tab Hệ Thống với nút "Làm mới".

**Tech Stack:** Node.js, TypeScript, AWS SDK (@aws-sdk/client-s3), Angular, RxJS

---

## File Structure

### Backend Files
- **Create:** `backend/src/services/r2-stats.service.ts` - R2 stats fetching & caching
- **Modify:** `backend/src/services/system.service.ts` - Add R2 stats to system status
- **Create:** `backend/test/r2-stats.test.js` - Unit tests for R2 stats service

### Frontend Files
- **Modify:** `frontend/src/app/services/api.service.ts` - Update SystemStatus type
- **Modify:** `frontend/src/app/features/dashboard/dashboard.store.ts` - Add R2 stats & refresh method
- **Modify:** `frontend/src/app/features/dashboard/admin.ts` - Add helper methods for formatting
- **Modify:** `frontend/src/app/features/dashboard/admin.html` - Add R2 info UI section

---

## Task 1: Backend - R2 Stats Service

**Files:**
- Create: `backend/src/services/r2-stats.service.ts`

- [ ] **Step 1: Create R2 stats service file with types and cache**

```typescript
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getConfig } from '../config';
import { AppError } from '../errors';

const config = getConfig();

export interface R2Stats {
    enabled: boolean;
    bucket: string;
    totalObjects: number;
    totalSizeBytes: number;
    lastUpdated: string;
    error?: string;
}

interface R2StatsCache {
    data: R2Stats;
    expiresAt: number;
}

let cache: R2StatsCache | null = null;
let cachedClient: S3Client | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const API_TIMEOUT_MS = 10000; // 10 seconds

const getClient = (): S3Client => {
    if (cachedClient) {
        return cachedClient;
    }

    cachedClient = new S3Client({
        credentials: {
            accessKeyId: config.r2.accessKeyId,
            secretAccessKey: config.r2.secretAccessKey,
        },
        endpoint: config.r2.endpoint,
        region: 'auto',
    });

    return cachedClient;
};

const isCacheValid = (): boolean => {
    return cache !== null && Date.now() < cache.expiresAt;
};

const setCache = (data: R2Stats): void => {
    cache = {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS,
    };
};
```

- [ ] **Step 2: Add fetchR2StatsFromAPI function**

```typescript
const fetchR2StatsFromAPI = async (): Promise<R2Stats> => {
    const client = getClient();
    let totalObjects = 0;
    let totalSizeBytes = 0;
    let continuationToken: string | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('R2 API timeout')), API_TIMEOUT_MS);
    });

    try {
        const fetchPage = async (): Promise<void> => {
            const command = new ListObjectsV2Command({
                Bucket: config.r2.bucket,
                MaxKeys: 1000,
                ContinuationToken: continuationToken,
            });

            const response = await Promise.race([
                client.send(command),
                timeoutPromise,
            ]);

            if (response.Contents) {
                totalObjects += response.Contents.length;
                totalSizeBytes += response.Contents.reduce((sum, obj) => sum + (obj.Size || 0), 0);
            }

            if (response.IsTruncated && response.NextContinuationToken) {
                continuationToken = response.NextContinuationToken;
                await fetchPage();
            }
        };

        await fetchPage();

        return {
            enabled: true,
            bucket: config.r2.bucket,
            totalObjects,
            totalSizeBytes,
            lastUpdated: new Date().toISOString(),
        };
    } catch (error: any) {
        console.error('Failed to fetch R2 stats:', error);
        
        if (error.name === 'CredentialsProviderError' || error.message?.includes('credentials')) {
            throw new AppError(500, 'R2_AUTH_FAILED', 'R2 authentication failed.');
        }
        
        if (error.message === 'R2 API timeout') {
            throw new AppError(504, 'R2_TIMEOUT', 'R2 API request timed out.');
        }
        
        throw new AppError(500, 'R2_FETCH_FAILED', 'Failed to fetch R2 stats.');
    }
};
```

- [ ] **Step 3: Add main getR2Stats export function**

```typescript
export const getR2Stats = async (): Promise<R2Stats> => {
    if (!config.r2.enabled) {
        return {
            enabled: false,
            bucket: '',
            totalObjects: 0,
            totalSizeBytes: 0,
            lastUpdated: '',
        };
    }

    if (isCacheValid() && cache) {
        return cache.data;
    }

    try {
        const stats = await fetchR2StatsFromAPI();
        setCache(stats);
        return stats;
    } catch (error: any) {
        if (cache) {
            console.warn('R2 API failed, returning cached data:', error.message);
            return cache.data;
        }

        return {
            enabled: true,
            bucket: config.r2.bucket,
            totalObjects: 0,
            totalSizeBytes: 0,
            lastUpdated: '',
            error: error.code || 'R2_FETCH_FAILED',
        };
    }
};
```

- [ ] **Step 4: Add cache invalidation for testing**

```typescript
export const __invalidateR2StatsCache = (): void => {
    cache = null;
};
```

- [ ] **Step 5: Build backend to check for TypeScript errors**

Run: `cd backend && npm run build`
Expected: No TypeScript errors

- [ ] **Step 6: Commit R2 stats service**

```bash
git add backend/src/services/r2-stats.service.ts
git commit -m "feat(backend): add R2 stats service with caching"
```

---

## Task 2: Backend - Update System Service

**Files:**
- Modify: `backend/src/services/system.service.ts`

- [ ] **Step 1: Import R2 stats service**

Add at top of file:
```typescript
import { getR2Stats } from './r2-stats.service';
import { getConfig } from '../config';

const config = getConfig();
```

- [ ] **Step 2: Update getSystemStatus to include R2 stats**

Replace the existing `getSystemStatus` function:

```typescript
export const getSystemStatus = async () => {
    const nets = os.networkInterfaces();
    const localIps: string[] = [];

    for (const interfaces of Object.values(nets)) {
        for (const network of interfaces || []) {
            if (network.family === 'IPv4' && !network.internal) {
                localIps.push(network.address);
            }
        }
    }

    const status: any = {
        localIps,
        online: true,
        uptime: process.uptime(),
    };

    if (config.r2.enabled) {
        try {
            status.r2 = await getR2Stats();
        } catch (error) {
            console.error('Failed to include R2 stats in system status:', error);
        }
    }

    return status;
};
```

- [ ] **Step 3: Build backend to verify changes**

Run: `cd backend && npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit system service update**

```bash
git add backend/src/services/system.service.ts
git commit -m "feat(backend): add R2 stats to system status endpoint"
```

---

## Task 3: Backend - Unit Tests

**Files:**
- Create: `backend/test/r2-stats.test.js`

- [ ] **Step 1: Create test file with setup**

```javascript
const { test } = require('node:test');
const assert = require('node:assert');

test('r2-stats service', async (t) => {
    await t.test('returns disabled state when R2 not enabled', async () => {
        // Mock config
        const originalEnv = process.env.R2_ENABLED;
        process.env.R2_ENABLED = 'false';
        
        // Clear module cache to reload with new env
        delete require.cache[require.resolve('../src/services/r2-stats.service.ts')];
        delete require.cache[require.resolve('../src/config.ts')];
        
        const { getR2Stats } = require('../src/services/r2-stats.service.ts');
        
        const stats = await getR2Stats();
        
        assert.strictEqual(stats.enabled, false);
        assert.strictEqual(stats.bucket, '');
        assert.strictEqual(stats.totalObjects, 0);
        assert.strictEqual(stats.totalSizeBytes, 0);
        
        // Restore
        process.env.R2_ENABLED = originalEnv;
    });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend && npm test -- test/r2-stats.test.js`
Expected: 1 test passing

- [ ] **Step 3: Commit tests**

```bash
git add backend/test/r2-stats.test.js
git commit -m "test(backend): add R2 stats service tests"
```

---

## Task 4: Backend - Integration Test

**Files:**
- Modify: `backend/test/api.test.js`

- [ ] **Step 1: Add test for system status with R2 disabled**

Add at end of file before the closing:

```javascript
test('system status excludes R2 when disabled', async () => {
  const response = await request(app)
    .get('/api/system/status')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(response.status, 200);
  assert.ok(response.body.online);
  assert.ok(typeof response.body.uptime === 'number');
  assert.ok(Array.isArray(response.body.localIps));
  
  // R2 should not be present when disabled
  assert.strictEqual(response.body.r2, undefined);
});
```

- [ ] **Step 2: Run integration tests**

Run: `cd backend && npm test`
Expected: All tests passing (27 tests)

- [ ] **Step 3: Commit integration test**

```bash
git add backend/test/api.test.js
git commit -m "test(backend): add system status R2 integration test"
```

---

## Task 5: Frontend - Update API Service Types

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`

- [ ] **Step 1: Add R2Stats interface**

Add after the existing interfaces (around line 100):

```typescript
export interface R2Stats {
    enabled: boolean;
    bucket: string;
    totalObjects: number;
    totalSizeBytes: number;
    lastUpdated: string;
    error?: string;
}
```

- [ ] **Step 2: Update SystemStatus interface**

Find the existing `getSystemStatus()` method and update its return type. Add the interface if it doesn't exist:

```typescript
getSystemStatus(): Observable<{ 
    online: boolean; 
    uptime: number; 
    localIps: string[];
    r2?: R2Stats;
}> {
    return this.http.get<{ 
        online: boolean; 
        uptime: number; 
        localIps: string[];
        r2?: R2Stats;
    }>(`${this.apiUrl}/system/status`);
}
```

- [ ] **Step 3: Check TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 4: Commit API service types**

```bash
git add frontend/src/app/services/api.service.ts
git commit -m "feat(frontend): add R2Stats type to API service"
```

---

## Task 6: Frontend - Update Dashboard Store

**Files:**
- Modify: `frontend/src/app/features/dashboard/dashboard.store.ts`

- [ ] **Step 1: Import R2Stats type**

Add to imports at top:

```typescript
import type { R2Stats } from '../../services/api.service';
```

- [ ] **Step 2: Update systemInfo signal type**

Find the `systemInfo` signal declaration and update it:

```typescript
readonly systemInfo = signal<{ 
    uptime: number; 
    localIps: string[];
    r2?: R2Stats;
} | null>(null);
```

- [ ] **Step 3: Update startSystemPolling to include R2**

Find the `startSystemPolling()` method and update the subscribe block:

```typescript
.subscribe((status) => {
    if (!status) {
        return;
    }

    this.isSystemOnline.set(status.online);
    this.systemInfo.set({ 
        localIps: status.localIps, 
        uptime: status.uptime,
        r2: status.r2 
    });
});
```

- [ ] **Step 4: Add refreshSystemStatus method**

Add new method after `startSystemPolling()`:

```typescript
refreshSystemStatus() {
    this.api.getSystemStatus().pipe(
        catchError(() => {
            this.isSystemOnline.set(false);
            return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
    ).subscribe((status) => {
        if (!status) {
            return;
        }

        this.isSystemOnline.set(status.online);
        this.systemInfo.set({ 
            localIps: status.localIps, 
            uptime: status.uptime,
            r2: status.r2 
        });
    });
}
```

- [ ] **Step 5: Check TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 6: Commit dashboard store changes**

```bash
git add frontend/src/app/features/dashboard/dashboard.store.ts
git commit -m "feat(frontend): add R2 stats to dashboard store"
```

---

## Task 7: Frontend - Add Helper Methods to Admin Component

**Files:**
- Modify: `frontend/src/app/features/dashboard/admin.ts`

- [ ] **Step 1: Add formatBytes helper method**

Add at the end of the `Admin` class, before the closing brace:

```typescript
formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
```

- [ ] **Step 2: Add formatRelativeTime helper method**

Add after `formatBytes`:

```typescript
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
```

- [ ] **Step 3: Check TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 4: Commit helper methods**

```bash
git add frontend/src/app/features/dashboard/admin.ts
git commit -m "feat(frontend): add formatBytes and formatRelativeTime helpers"
```

---

## Task 8: Frontend - Add R2 Info UI Section

**Files:**
- Modify: `frontend/src/app/features/dashboard/admin.html`

- [ ] **Step 1: Find the system info section**

Locate the "Thông Tin Máy Chủ" section (around line 210-236)

- [ ] **Step 2: Add R2 Storage section after system info**

Add this HTML after the closing `</div>` of "Thông Tin Máy Chủ" section:

```html
                    <!-- R2 Storage Info -->
                    <div *ngIf="store.systemInfo()?.r2?.enabled" 
                         class="p-6 rounded-2xl bg-white dark:bg-brand-surface border border-slate-200 dark:border-white/10 shadow-sm">
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100">Cloudflare R2 Storage</h3>
                            <button
                                (click)="store.refreshSystemStatus()"
                                class="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                title="Làm mới thông tin R2">
                                Làm mới
                            </button>
                        </div>
                        
                        <div *ngIf="!store.systemInfo()?.r2?.error" class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                                <span class="text-sm font-medium text-slate-500 dark:text-slate-400">Bucket:</span>
                                <span class="text-sm font-mono text-slate-700 dark:text-slate-300">
                                    {{ store.systemInfo()?.r2?.bucket || '—' }}
                                </span>
                            </div>
                            <div class="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                                <span class="text-sm font-medium text-slate-500 dark:text-slate-400">Số files:</span>
                                <span class="text-sm font-mono text-slate-700 dark:text-slate-300">
                                    {{ store.systemInfo()?.r2?.totalObjects || 0 }} files
                                </span>
                            </div>
                            <div class="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                                <span class="text-sm font-medium text-slate-500 dark:text-slate-400">Dung lượng:</span>
                                <span class="text-sm font-mono text-slate-700 dark:text-slate-300">
                                    {{ formatBytes(store.systemInfo()?.r2?.totalSizeBytes || 0) }}
                                </span>
                            </div>
                            <div class="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                                <span class="text-sm font-medium text-slate-500 dark:text-slate-400">Cập nhật:</span>
                                <span class="text-sm font-mono text-slate-700 dark:text-slate-300">
                                    {{ formatRelativeTime(store.systemInfo()?.r2?.lastUpdated) }}
                                </span>
                            </div>
                        </div>
                        
                        <!-- Error State -->
                        <div *ngIf="store.systemInfo()?.r2?.error" 
                             class="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
                            <p class="text-sm text-red-600 dark:text-red-400">
                                ⚠️ Không thể kết nối R2: {{ store.systemInfo()?.r2?.error }}
                            </p>
                        </div>
                    </div>
```

- [ ] **Step 3: Check TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 4: Commit UI changes**

```bash
git add frontend/src/app/features/dashboard/admin.html
git commit -m "feat(frontend): add R2 storage info UI section"
```

---

## Task 9: Manual Testing & Verification

**Files:**
- None (manual testing)

- [ ] **Step 1: Start backend server**

Run: `cd backend && npm run dev`
Expected: Server starts on port 3000

- [ ] **Step 2: Start frontend dev server**

Run: `cd frontend && npm start`
Expected: Frontend starts on port 4200

- [ ] **Step 3: Test with R2 disabled**

1. Ensure `R2_ENABLED=false` in backend `.env`
2. Login to admin dashboard
3. Navigate to "Hệ Thống" tab
4. Verify: R2 section does NOT appear

- [ ] **Step 4: Test with R2 enabled (if available)**

1. Set `R2_ENABLED=true` and configure R2 credentials in `.env`
2. Restart backend
3. Navigate to "Hệ Thống" tab
4. Verify: R2 section appears with bucket info, object count, size
5. Click "Làm mới" button
6. Verify: Data refreshes

- [ ] **Step 5: Test error handling (optional)**

1. Set invalid R2 credentials
2. Restart backend
3. Navigate to "Hệ Thống" tab
4. Verify: Error message appears in R2 section

- [ ] **Step 6: Run all backend tests**

Run: `cd backend && npm test`
Expected: All tests passing

- [ ] **Step 7: Build frontend for production**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

---

## Task 10: Final Commit & Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-05-04-r2-storage-info-design.md`

- [ ] **Step 1: Update design doc approval status**

Update the "Approval" section at the end:

```markdown
## Approval

- [x] User approved design
- [x] Implementation plan created
- [x] Implementation completed
- [x] Tests passing
- [ ] Deployed to production
```

- [ ] **Step 2: Commit documentation update**

```bash
git add docs/superpowers/specs/2026-05-04-r2-storage-info-design.md
git commit -m "docs: mark R2 storage info implementation as completed"
```

- [ ] **Step 3: Create summary commit (optional)**

If you want a single commit message summarizing all changes:

```bash
git log --oneline | head -10
```

Review the commits and ensure they tell a clear story.

---

## Completion Checklist

- [ ] All backend code implemented
- [ ] All frontend code implemented
- [ ] Backend tests passing
- [ ] Frontend builds successfully
- [ ] Manual testing completed
- [ ] Documentation updated
- [ ] All commits pushed to branch

---

## Notes

- **Cache TTL:** 5 minutes - can be adjusted in `r2-stats.service.ts` constant `CACHE_TTL_MS`
- **API Timeout:** 10 seconds - can be adjusted in `API_TIMEOUT_MS` constant
- **R2 Disabled:** Section automatically hidden when `R2_ENABLED=false`
- **Error Handling:** Graceful degradation - system status still works if R2 fails

## Troubleshooting

**Issue:** R2 section not appearing
- Check: `R2_ENABLED=true` in backend `.env`
- Check: Backend logs for R2 errors
- Check: Browser console for frontend errors

**Issue:** "Không thể kết nối R2" error
- Check: R2 credentials are correct
- Check: R2 endpoint is accessible
- Check: Bucket name is correct

**Issue:** Slow loading
- Check: Number of objects in bucket (>10k objects may take 5-10 seconds)
- Check: Network latency to R2
- Consider: Increasing cache TTL if data doesn't need to be real-time
