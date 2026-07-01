# Remove profile card slug and status badges - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline.

**Goal:** Remove the profile slug badge and the online/offline status badge from profile cards in the dashboard, keeping only the content-count badge.

**Architecture:** Delete the two `<span>` elements from `profile-manager.html`. Preserve the `isOnline()` helper in the component because it is still used by `deletingProfileIsOnline` for the delete confirmation modal. Add/update the regression test in `profile-manager.spec.ts` to assert the rendered card no longer contains the slug or online/offline text.

**Tech Stack:** Angular 21, Tailwind CSS, Vitest, TypeScript.

## Global Constraints

- Minimal change: only remove the two badge spans from the profile card template.
- Do not delete `isOnline()` in `profile-manager.ts`; it is still used elsewhere.
- Keep the `{{ profile.videoIds.length }} nội dung` badge.
- All frontend tests and build must pass.

---

### Task 1: Update profile card template

**Files:**
- Modify: `frontend/src/app/features/dashboard/components/profile-manager/profile-manager.html:32-49`
- Test: `frontend/src/app/features/dashboard/components/profile-manager/profile-manager.spec.ts`

**Interfaces:**
- Consumes: existing `Profile` inputs with `slug` and `lastSeen` fields.
- Produces: rendered card containing only the content-count badge.

- [ ] **Step 1: Write the failing test**

Add a test that renders `ProfileManager` with a profile and asserts the compiled HTML does not contain the slug text and does not contain the words "online" or "offline".

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { ProfileManager } from './profile-manager';
import { Profile, Video } from '../../../../services/api.service';

describe('ProfileManager card badges', () => {
  let component: ProfileManager;
  let fixture: ComponentFixture<ProfileManager>;

  const profile = (partial: Partial<Profile> = {}): Profile => ({
    createdAt: '2026-07-01T00:00:00.000Z',
    id: 'profile-1',
    name: 'tivi',
    orientation: 'landscape',
    playerAccessToken: 'token',
    slug: 'tivi',
    updatedAt: '2026-07-01T00:00:00.000Z',
    videoIds: ['video-1'],
    ...partial,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, ProfileManager],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileManager);
    component = fixture.componentInstance;
    component.profiles = [profile({ lastSeen: new Date().toISOString() })];
    component.videos = [];
    fixture.detectChanges();
  });

  it('renders only the content count badge, not slug or online/offline badges', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.textContent?.toLowerCase() ?? '';

    expect(text).toContain('1 nội dung');
    expect(text).not.toContain('tivi');
    expect(text).not.toContain('online');
    expect(text).not.toContain('offline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm run test:ci -- --include src/app/features/dashboard/components/profile-manager/profile-manager.spec.ts
```

Expected: FAIL because `tivi`, `online`, and `offline` are still rendered.

- [ ] **Step 3: Remove the two badge spans from the template**

In `frontend/src/app/features/dashboard/components/profile-manager/profile-manager.html`, keep only the content-count badge and remove the slug badge and the online/offline badge.

Change lines 32-49 from:

```html
<div class="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
  <span class="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
    {{ profile.videoIds.length }} nội dung
  </span>
  <span class="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-500 dark:bg-white/10 dark:text-slate-400">
    {{ profile.slug }}
  </span>
  <span
    class="rounded-full px-2 py-1 font-bold"
    [class.bg-emerald-100]="isOnline(profile.lastSeen)"
    [class.text-emerald-700]="isOnline(profile.lastSeen)"
    [class.bg-slate-100]="!isOnline(profile.lastSeen)"
    [class.text-slate-500]="!isOnline(profile.lastSeen)"
    [class.dark:bg-white/10]="!isOnline(profile.lastSeen)"
    [class.dark:text-slate-400]="!isOnline(profile.lastSeen)">
    {{ isOnline(profile.lastSeen) ? 'online' : 'offline' }}
  </span>
</div>
```

to:

```html
<div class="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
  <span class="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
    {{ profile.videoIds.length }} nội dung
  </span>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command from Step 2. Expected: PASS.

- [ ] **Step 5: Run full frontend test suite and build**

Run:

```bash
cd frontend
npm run test:ci
npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/features/dashboard/components/profile-manager/profile-manager.html
# also stage the updated spec file if it changed, and the test file
git commit -m "fix(profile-manager): remove slug and online/offline badges from profile card"
```

---

## Self-review

- **Spec coverage:** The only requirement is removing two badges while keeping the content-count badge. Task 1 covers this.
- **Placeholder scan:** No placeholders.
- **Type consistency:** Uses existing `Profile` and `Video` types; no new signatures introduced.
