# Design: Thêm Thông Tin R2 Storage Vào Hệ Thống

**Date:** 2026-05-04  
**Status:** Approved  
**Author:** AI Assistant

## Tổng Quan

Thêm thông tin về Cloudflare R2 storage vào tab "Hệ Thống" trong admin dashboard, bao gồm: trạng thái kết nối, bucket name, số lượng objects, tổng dung lượng sử dụng.

## Mục Tiêu

- Hiển thị thông tin R2 storage real-time từ Cloudflare R2 API
- Cache kết quả 5 phút để giảm API calls
- Cho phép admin refresh thủ công khi cần
- Xử lý gracefully khi R2 disabled hoặc có lỗi

## Requirements

### Functional Requirements

1. **Hiển thị thông tin R2:**
   - Trạng thái: Enabled/Disabled
   - Bucket name
   - Tổng số objects (files)
   - Tổng dung lượng (bytes → format GB/MB)
   - Thời gian cập nhật cuối

2. **Cache & Refresh:**
   - Cache kết quả trong memory với TTL 5 phút
   - Nút "Làm mới" để force refresh
   - Auto-refresh mỗi 30 giây (theo system status polling hiện tại)

3. **Error Handling:**
   - Hiển thị error state khi R2 API fail
   - Không crash server khi R2 không available
   - Fallback về cached data nếu có

### Non-Functional Requirements

- **Performance:** R2 API call timeout 10 giây
- **Reliability:** Không ảnh hưởng system status nếu R2 fail
- **Maintainability:** Code tách biệt, dễ test

## Architecture

### Approach: Tích hợp vào `/api/system/status`

Mở rộng endpoint hiện tại thay vì tạo endpoint mới.

**Lý do:**
- Tận dụng polling 30 giây đã có
- Một endpoint duy nhất cho tất cả system info
- Đơn giản, dễ maintain

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Angular)                    │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Dashboard Store                                    │ │
│  │  - Poll /api/system/status every 30s               │ │
│  │  - refreshSystemStatus() for manual refresh        │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Admin UI (admin.html)                             │ │
│  │  - Display R2 info section                         │ │
│  │  - "Làm mới" button                                │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                            │
                            │ HTTP GET /api/system/status
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Backend (Node.js)                     │
│  ┌────────────────────────────────────────────────────┐ │
│  │  system.service.ts                                  │ │
│  │  - getSystemStatus()                                │ │
│  │  - Calls getR2Stats() if R2 enabled                │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │  r2-stats.service.ts (NEW)                         │ │
│  │  - getR2Stats()                                     │ │
│  │  - In-memory cache (TTL 5 min)                     │ │
│  │  - Calls R2 API via AWS SDK                        │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                            │
                            │ ListObjectsV2Command
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare R2 (S3-compatible)               │
└─────────────────────────────────────────────────────────┘
```

## Data Structures

### Backend Types

```typescript
// backend/src/services/r2-stats.service.ts
interface R2Stats {
    enabled: boolean;
    bucket: string;
    totalObjects: number;
    totalSizeBytes: number;
    lastUpdated: string;  // ISO timestamp
    error?: string;       // Error code if failed
}

interface R2StatsCache {
    data: R2Stats;
    expiresAt: number;    // Unix timestamp
}
```

### API Response

```typescript
// GET /api/system/status response
interface SystemStatus {
    online: boolean;
    uptime: number;
    localIps: string[];
    r2?: R2Stats;  // Optional, only if R2 enabled
}
```

## Implementation Details

### 1. Backend: R2 Stats Service

**File:** `backend/src/services/r2-stats.service.ts`

**Functions:**

```typescript
export const getR2Stats = async (): Promise<R2Stats>
```

**Logic:**
1. Check if R2 enabled via `config.r2.enabled`
   - If disabled → return `{ enabled: false, bucket: '', totalObjects: 0, totalSizeBytes: 0, lastUpdated: '' }`
2. Check cache:
   - If cache valid (not expired) → return cached data
3. Fetch from R2:
   - Use `ListObjectsV2Command` with pagination
   - Loop through all pages (max 1000 objects/page)
   - Count objects and sum sizes
   - Timeout: 10 seconds
4. Cache result with TTL 5 minutes
5. Return stats

**Error Handling:**
- R2 API timeout → Return cached data if available, else error state
- Auth failed → Return error state with `error: 'AUTH_FAILED'`
- Network error → Return cached data if available, else error state

**Cache Implementation:**
```typescript
let cache: R2StatsCache | null = null;

const isCacheValid = () => {
    return cache && Date.now() < cache.expiresAt;
};

const setCache = (data: R2Stats) => {
    cache = {
        data,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    };
};
```

### 2. Backend: System Service Update

**File:** `backend/src/services/system.service.ts`

**Changes:**

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

    // Add R2 stats if enabled
    if (config.r2.enabled) {
        try {
            status.r2 = await getR2Stats();
        } catch (error) {
            // Log error but don't fail the request
            console.error('Failed to fetch R2 stats:', error);
        }
    }

    return status;
};
```

### 3. Frontend: API Service Update

**File:** `frontend/src/app/services/api.service.ts`

**Type Update:**

```typescript
export interface SystemStatus {
    online: boolean;
    uptime: number;
    localIps: string[];
    r2?: {
        enabled: boolean;
        bucket: string;
        totalObjects: number;
        totalSizeBytes: number;
        lastUpdated: string;
        error?: string;
    };
}
```

### 4. Frontend: Dashboard Store Update

**File:** `frontend/src/app/features/dashboard/dashboard.store.ts`

**Add method:**

```typescript
refreshSystemStatus() {
    // Force refresh by calling API immediately
    this.api.getSystemStatus().pipe(
        catchError(() => {
            this.isSystemOnline.set(false);
            return of(null);
        }),
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

**Update systemInfo signal:**

```typescript
readonly systemInfo = signal<{ 
    uptime: number; 
    localIps: string[];
    r2?: R2Stats;
} | null>(null);
```

### 5. Frontend: UI Update

**File:** `frontend/src/app/features/dashboard/admin.html`

**Add R2 section after "Thông Tin Máy Chủ":**

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

**Add helper methods in `admin.ts`:**

```typescript
formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

formatRelativeTime(isoString?: string): string {
    if (!isoString) return '—';
    const date = new Date(isoString);
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    return `${hours} giờ trước`;
}
```

## Error Handling

### Backend Errors

| Error | Handling |
|-------|----------|
| R2 disabled | Return `{ enabled: false }` |
| Auth failed | Return error state with `error: 'AUTH_FAILED'` |
| Network timeout (>10s) | Return cached data if available, else error state |
| Bucket not found | Return error state with `error: 'BUCKET_NOT_FOUND'` |
| Rate limit | Return cached data if available |

### Frontend Error Display

- Show error message in red box
- Keep "Làm mới" button visible for retry
- Don't crash the page

## Performance Considerations

### R2 API Performance

- **Pagination:** 1000 objects per page (R2 max)
- **Estimated time:**
  - 100 objects: ~1 second
  - 1,000 objects: ~2 seconds
  - 10,000 objects: ~10 seconds
- **Timeout:** 10 seconds to prevent blocking

### Cache Strategy

- **TTL:** 5 minutes (300 seconds)
- **Storage:** In-memory (lost on restart)
- **Invalidation:** Auto after TTL or manual via "Làm mới"

### Impact on System Status

- R2 fetch runs async, doesn't block other system info
- If R2 times out, system status still returns (without R2 field)

## Testing Strategy

### Backend Unit Tests

**File:** `backend/test/r2-stats.test.js`

Tests:
- ✅ `getR2Stats()` returns correct data when R2 enabled
- ✅ Cache works (doesn't call R2 API within 5 minutes)
- ✅ Returns `{ enabled: false }` when R2 disabled
- ✅ Handles R2 API timeout gracefully
- ✅ Handles auth errors
- ✅ Pagination works with multiple pages

### Backend Integration Tests

**File:** `backend/test/api.test.js`

Tests:
- ✅ `GET /api/system/status` includes R2 stats when enabled
- ✅ `GET /api/system/status` excludes R2 field when disabled
- ✅ `GET /api/system/status` still works when R2 API fails

### Frontend Tests

**Manual testing:**
- ✅ R2 section displays when enabled
- ✅ R2 section hidden when disabled
- ✅ "Làm mới" button refreshes data
- ✅ Error state displays correctly
- ✅ Bytes formatting works (B, KB, MB, GB)
- ✅ Relative time formatting works

## Security Considerations

- R2 credentials stored in environment variables (already implemented)
- Only admin users can access `/api/system/status` (already protected by `authenticateToken`)
- No sensitive R2 credentials exposed in API response

## Migration & Rollout

### Phase 1: Backend Implementation
1. Create `r2-stats.service.ts`
2. Update `system.service.ts`
3. Add tests

### Phase 2: Frontend Implementation
1. Update API types
2. Update dashboard store
3. Update UI

### Phase 3: Testing & Deployment
1. Test with R2 enabled
2. Test with R2 disabled
3. Test error scenarios
4. Deploy to production

### Rollback Plan

If issues occur:
- Backend: Remove R2 stats from `getSystemStatus()`
- Frontend: Hide R2 section with feature flag

## Future Enhancements

- Show breakdown by video vs image
- Historical usage charts
- Alerts when storage > threshold
- Cost estimation based on R2 pricing

## Open Questions

None - all requirements clarified.

## Approval

- [x] User approved design
- [ ] Implementation plan created
- [ ] Implementation completed
- [ ] Tests passing
- [ ] Deployed to production
