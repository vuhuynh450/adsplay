# Staff Account & Page Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm quản lý tài khoản nhân viên + phân quyền theo page (UI + route/API guard), gồm first-login đổi mật khẩu và khóa/mở tài khoản.

**Architecture:** Mở rộng user model dùng chung admin/staff (`role`, `isActive`, `mustChangePassword`, `allowedPages`), trả metadata user ngay sau login, và áp guard 2 lớp: frontend route/menu guard + backend middleware `requirePageAccess`. Admin route được tách thành từng path `/admin/<page>` để map quyền rõ ràng.

**Tech Stack:** Express 5 + TypeScript, JWT, Angular standalone + router guards, node:test + supertest, Angular test runner.

---

## File Structure & Responsibilities

### Backend

- Modify: `backend/src/types.ts`
  - Bổ sung type quyền trang + shape user account mới.
- Modify: `backend/src/db.ts`
  - Normalize user mới, CRUD user phục vụ employee service.
- Create: `backend/src/constants/page-access.ts`
  - Shared page key enum/constants cho backend.
- Modify: `backend/src/services/auth.service.ts`
  - Login response metadata, token payload mới, verify logic.
- Modify: `backend/src/middleware/auth.ts`
  - Gắn user đầy đủ vào request thay vì username-only.
- Create: `backend/src/middleware/page-access.ts`
  - `requirePageAccess(pageKey)` + `requireAdminOnly`.
- Create: `backend/src/services/employee.service.ts`
  - Logic danh sách/tạo/cập nhật quyền/khóa/mở/reset first-login.
- Create: `backend/src/routes/employees.routes.ts`
  - REST API `/api/employees/*` admin-only.
- Modify: `backend/src/routes/auth.routes.ts`
  - Login trả `{ token, user }`; thêm endpoint first-login password.
- Modify: `backend/src/routes/video.routes.ts`
- Modify: `backend/src/routes/profile.routes.ts`
- Modify: `backend/src/routes/device.routes.ts`
- Modify: `backend/src/routes/system.routes.ts`
  - Áp `requirePageAccess(...)`.
- Modify: `backend/src/app.ts`
  - Mount `employeesRouter`.
- Modify: `backend/src/utils/validation.ts`
  - Validate `allowedPages`.
- Modify: `backend/test/api.test.js`
  - Integration test auth/permission/employee flows.

### Frontend

- Create: `frontend/src/app/constants/page-access.ts`
  - Page keys + helper mapping.
- Modify: `frontend/src/app/services/api.service.ts`
  - Types + API methods employees + first-login password.
- Modify: `frontend/src/app/services/auth.service.ts`
  - Session state mới (`role`, `allowedPages`, `mustChangePassword`).
- Modify: `frontend/src/app/services/auth.guard.ts`
  - Chỉ làm guard đăng nhập cơ bản.
- Create: `frontend/src/app/services/page-access.guard.ts`
  - Guard theo `data.pageKey`.
- Create: `frontend/src/app/services/admin-only.guard.ts`
  - Guard trang `/admin/employees`.
- Create: `frontend/src/app/services/first-login.guard.ts`
  - Ép vào đổi mật khẩu nếu `mustChangePassword=true`.
- Create: `frontend/src/app/features/auth/first-login-password/first-login-password.ts`
  - Form đổi mật khẩu lần đầu.
- Create: `frontend/src/app/features/dashboard/employees/employees.ts`
  - Màn quản lý nhân viên.
- Modify: `frontend/src/app/features/dashboard/admin.ts`
- Modify: `frontend/src/app/features/dashboard/admin.html`
  - Sidebar + nội dung theo quyền.
- Modify: `frontend/src/app/app.routes.ts`
  - Tách `/admin/videos|profiles|devices|system|employees`.
- Modify: `frontend/src/app/features/auth/login/login.ts`
  - Điều hướng theo `mustChangePassword`.
- Create: `frontend/src/app/services/guards.spec.ts`
  - Guard tests.
- Create: `frontend/src/app/features/auth/first-login-password/first-login-password.spec.ts`
  - First-login flow tests.

---

### Task 1: Bổ sung domain model account + page constants (backend)

**Files:**
- Create: `backend/src/constants/page-access.ts`
- Modify: `backend/src/types.ts`
- Modify: `backend/src/db.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test thất bại cho shape user mới**

```js
test('login response includes user role + page metadata', async () => {
  const response = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'admin',
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.user);
  assert.equal(response.body.user.role, 'admin');
  assert.ok(Array.isArray(response.body.user.allowedPages));
});
```

- [ ] **Step 2: Run test để xác nhận FAIL**

Run: `cd backend && npm test -- --test-name-pattern="login response includes user role + page metadata"`  
Expected: FAIL vì response hiện tại chưa có `user`.

- [ ] **Step 3: Thêm page key constants + type**

```ts
// backend/src/constants/page-access.ts
export const PAGE_KEYS = ['videos', 'profiles', 'devices', 'system', 'employees'] as const;
export type PageKey = typeof PAGE_KEYS[number];
```

```ts
// backend/src/types.ts (thêm)
export type UserRole = 'admin' | 'staff';
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  allowedPages: PageKey[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Normalize user data cũ trong db.ts**

```ts
const normalizeUser = (user: Partial<User>): User => {
  const now = user.updatedAt || user.createdAt || new Date().toISOString();
  return {
    id: user.id || createEntityId(),
    username: user.username || '',
    passwordHash: user.passwordHash || '',
    role: user.role === 'staff' ? 'staff' : 'admin',
    isActive: user.isActive !== false,
    mustChangePassword: Boolean(user.mustChangePassword),
    allowedPages: Array.isArray(user.allowedPages) ? [...new Set(user.allowedPages)] : ['videos', 'profiles', 'devices', 'system', 'employees'],
    createdAt: user.createdAt || now,
    updatedAt: user.updatedAt || now,
  };
};
```

- [ ] **Step 5: Run test toàn backend**

Run: `cd backend && npm test`  
Expected: PASS (không vỡ behavior cũ, test mới có thể còn fail do auth chưa xong ở task sau).

- [ ] **Step 6: Commit**

```bash
git add backend/src/constants/page-access.ts backend/src/types.ts backend/src/db.ts backend/test/api.test.js
git commit -m "feat: extend user model with staff page access metadata"
```

---

### Task 2: Nâng cấp auth service + middleware + login response

**Files:**
- Modify: `backend/src/services/auth.service.ts`
- Modify: `backend/src/middleware/auth.ts`
- Modify: `backend/src/routes/auth.routes.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test login response + inactive account**

```js
test('inactive staff login returns ACCOUNT_INACTIVE', async () => {
  // chuẩn bị user inactive trong dbRepository (seed helper trong test)
  const response = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive',
    password: '123456',
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ACCOUNT_INACTIVE');
});
```

- [ ] **Step 2: Run test để FAIL**

Run: `cd backend && npm test -- --test-name-pattern="inactive staff login returns ACCOUNT_INACTIVE"`  
Expected: FAIL.

- [ ] **Step 3: Đổi `login()` trả `{ token, user }`**

```ts
export interface AdminAuthUserView {
  id: string;
  username: string;
  role: 'admin' | 'staff';
  allowedPages: PageKey[];
  mustChangePassword: boolean;
}

export const login = async (username: string, password: string) => {
  // validate credentials + isActive
  // if inactive -> throw AppError(403,'ACCOUNT_INACTIVE',...)
  // return { token, user }
};
```

- [ ] **Step 4: Cập nhật token payload + verify**

```ts
export interface AdminTokenPayload extends jwt.JwtPayload {
  tokenType: 'admin';
  userId: string;
  username: string;
  role: 'admin' | 'staff';
}
```

- [ ] **Step 5: Cập nhật middleware auth gắn request user đầy đủ**

```ts
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: 'admin' | 'staff';
    isActive: boolean;
    mustChangePassword: boolean;
    allowedPages: PageKey[];
  };
}
```

- [ ] **Step 6: Cập nhật route login**

```ts
const result = await login(username, password);
res.json(result); // { token, user }
```

- [ ] **Step 7: Run backend tests**

Run: `cd backend && npm test`  
Expected: PASS cho test auth mới.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/auth.service.ts backend/src/middleware/auth.ts backend/src/routes/auth.routes.ts backend/test/api.test.js
git commit -m "feat: return auth user metadata and enforce inactive-account login block"
```

---

### Task 3: Thêm endpoint đổi mật khẩu first-login

**Files:**
- Modify: `backend/src/routes/auth.routes.ts`
- Modify: `backend/src/services/auth.service.ts`
- Modify: `backend/src/db.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test ép đổi mật khẩu lần đầu**

```js
test('first login password change clears mustChangePassword flag', async () => {
  // login staff mustChangePassword=true -> 200 with user.mustChangePassword=true
  // POST /api/auth/change-password-first-login with token + newPassword
  // login lại với mật khẩu mới -> user.mustChangePassword=false
});
```

- [ ] **Step 2: Run test để FAIL**

Run: `cd backend && npm test -- --test-name-pattern="first login password change clears mustChangePassword flag"`  
Expected: FAIL vì endpoint chưa có.

- [ ] **Step 3: Implement service change-password-first-login**

```ts
export const changePasswordFirstLogin = async (userId: string, newPassword: string) => {
  // chỉ cho user mustChangePassword=true
  // hash password mới
  // update mustChangePassword=false
};
```

- [ ] **Step 4: Add route**

```ts
authRouter.post('/change-password-first-login', authenticateToken, asyncHandler(async (req,res)=>{ ... }));
```

- [ ] **Step 5: Run backend tests**

Run: `cd backend && npm test`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.routes.ts backend/src/services/auth.service.ts backend/src/db.ts backend/test/api.test.js
git commit -m "feat: add first-login password change endpoint for staff accounts"
```

---

### Task 4: Thêm middleware `requirePageAccess` và gắn vào admin APIs

**Files:**
- Create: `backend/src/middleware/page-access.ts`
- Modify: `backend/src/routes/video.routes.ts`
- Modify: `backend/src/routes/profile.routes.ts`
- Modify: `backend/src/routes/device.routes.ts`
- Modify: `backend/src/routes/system.routes.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test staff thiếu quyền bị 403**

```js
test('staff without profiles page permission cannot access /api/profiles', async () => {
  const { token } = await loginAsStaffWithoutProfilesPermission();
  const response = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'PAGE_FORBIDDEN');
});
```

- [ ] **Step 2: Run test để FAIL**

Run: `cd backend && npm test -- --test-name-pattern="without profiles page permission"`  
Expected: FAIL.

- [ ] **Step 3: Implement middleware page access**

```ts
export const requirePageAccess = (pageKey: PageKey) => (req, _res, next) => {
  if (!req.user) return next(new AppError(401,'AUTH_REQUIRED','Authentication is required.'));
  if (req.user.role === 'admin') return next();
  if (!req.user.isActive) return next(new AppError(403,'ACCOUNT_INACTIVE','Account is inactive.'));
  if (!req.user.allowedPages.includes(pageKey)) return next(new AppError(403,'PAGE_FORBIDDEN','Page access denied.'));
  next();
};
```

- [ ] **Step 4: Gắn middleware vào route admin**

```ts
videoRouter.get('/', authenticateToken, requirePageAccess('videos'), ...);
profileRouter.post('/', authenticateToken, requirePageAccess('profiles'), ...);
deviceRouter.get('/', authenticateToken, requirePageAccess('devices'), ...);
systemRouter.get('/status', authenticateToken, requirePageAccess('system'), ...);
```

- [ ] **Step 5: Run backend tests**

Run: `cd backend && npm test`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/page-access.ts backend/src/routes/video.routes.ts backend/src/routes/profile.routes.ts backend/src/routes/device.routes.ts backend/src/routes/system.routes.ts backend/test/api.test.js
git commit -m "feat: enforce page-level authorization on admin APIs"
```

---

### Task 5: Xây module employees (admin-only)

**Files:**
- Create: `backend/src/services/employee.service.ts`
- Create: `backend/src/routes/employees.routes.ts`
- Modify: `backend/src/db.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/utils/validation.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test employees API admin-only**

```js
test('staff cannot access employees endpoints', async () => {
  const { token } = await loginAsStaffWithAnyPermission();
  const response = await request(app).get('/api/employees').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ADMIN_ONLY');
});
```

- [ ] **Step 2: Run test để FAIL**

Run: `cd backend && npm test -- --test-name-pattern="staff cannot access employees endpoints"`  
Expected: FAIL.

- [ ] **Step 3: Implement service + validations**

```ts
// employee.service.ts
export const createEmployee = async (input:{username:string;password:string;allowedPages:PageKey[]}) => { ...mustChangePassword:true... };
export const updateEmployeeAllowedPages = async (...) => { ... };
export const updateEmployeeActiveStatus = async (...) => { ... };
export const resetEmployeeFirstPassword = async (...) => { ... };
```

- [ ] **Step 4: Implement routes**

```ts
employeesRouter.get('/', authenticateToken, requireAdminOnly, ...);
employeesRouter.post('/', authenticateToken, requireAdminOnly, ...);
employeesRouter.patch('/:id/pages', authenticateToken, requireAdminOnly, ...);
employeesRouter.patch('/:id/active', authenticateToken, requireAdminOnly, ...);
employeesRouter.patch('/:id/reset-first-password', authenticateToken, requireAdminOnly, ...);
```

- [ ] **Step 5: Mount router**

```ts
app.use('/api/employees', employeesRouter);
```

- [ ] **Step 6: Run backend tests**

Run: `cd backend && npm test`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/employee.service.ts backend/src/routes/employees.routes.ts backend/src/db.ts backend/src/app.ts backend/src/utils/validation.ts backend/test/api.test.js
git commit -m "feat: add admin-only employee management APIs"
```

---

### Task 6: Mở rộng frontend auth state + API client

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`
- Modify: `frontend/src/app/services/auth.service.ts`
- Modify: `frontend/src/app/features/auth/login/login.ts`
- Test: `frontend/src/app/app.spec.ts`
- Create: `frontend/src/app/services/auth.service.spec.ts`

- [ ] **Step 1: Viết test session metadata**

```ts
it('stores role and allowedPages after login', () => {
  // mock /api/auth/login trả token+user
  // expect authService.currentUser()?.role === 'staff'
});
```

- [ ] **Step 2: Run frontend test để FAIL**

Run: `cd frontend && npm run test:ci -- --include src/app/services/auth.service.spec.ts`  
Expected: FAIL.

- [ ] **Step 3: Cập nhật type và login response**

```ts
export interface AuthLoginUser {
  username: string;
  role: 'admin' | 'staff';
  allowedPages: PageKey[];
  mustChangePassword: boolean;
}
```

```ts
login(...) {
  return this.http.post<{token:string; user: AuthLoginUser}>('/api/auth/login', ...).pipe(
    tap((res) => this.setSession(res.token, res.user))
  );
}
```

- [ ] **Step 4: Login component điều hướng first-login**

```ts
next: (res) => {
  if (res.user.mustChangePassword) {
    this.router.navigate(['/auth/change-password-first-login']);
    return;
  }
  this.router.navigate(['/admin']);
}
```

- [ ] **Step 5: Run frontend tests**

Run: `cd frontend && npm run test:ci`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/services/api.service.ts frontend/src/app/services/auth.service.ts frontend/src/app/features/auth/login/login.ts frontend/src/app/services/auth.service.spec.ts frontend/src/app/app.spec.ts
git commit -m "feat: persist auth role/page metadata and first-login redirect"
```

---

### Task 7: Tách route admin theo page + guard nhiều lớp

**Files:**
- Modify: `frontend/src/app/app.routes.ts`
- Modify: `frontend/src/app/services/auth.guard.ts`
- Create: `frontend/src/app/services/page-access.guard.ts`
- Create: `frontend/src/app/services/admin-only.guard.ts`
- Create: `frontend/src/app/services/first-login.guard.ts`
- Create: `frontend/src/app/constants/page-access.ts`
- Test: `frontend/src/app/services/guards.spec.ts`

- [ ] **Step 1: Viết guard tests (unauthenticated / thiếu quyền / admin-only)**

```ts
it('redirects to /login when not authenticated', ...);
it('redirects to first allowed admin page when staff lacks requested page', ...);
it('blocks /admin/employees for staff', ...);
```

- [ ] **Step 2: Run test để FAIL**

Run: `cd frontend && npm run test:ci -- --include src/app/services/guards.spec.ts`  
Expected: FAIL.

- [ ] **Step 3: Tạo page constants và helper chọn fallback route**

```ts
export const ADMIN_PAGE_ROUTE_MAP = { videos:'/admin/videos', profiles:'/admin/profiles', ... } as const;
```

- [ ] **Step 4: Implement guards**

```ts
export const pageAccessGuard: CanActivateFn = (route) => { ... };
export const adminOnlyGuard: CanActivateFn = () => { ... };
export const firstLoginGuard: CanActivateFn = () => { ... };
```

- [ ] **Step 5: Refactor routes**

```ts
{ path:'admin/videos', component: Admin, canActivate:[authGuard, firstLoginGuard, pageAccessGuard], data:{ pageKey:'videos' } }
...
{ path:'admin/employees', component: Employees, canActivate:[authGuard, firstLoginGuard, adminOnlyGuard], data:{ pageKey:'employees' } }
```

- [ ] **Step 6: Run frontend tests**

Run: `cd frontend && npm run test:ci`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/app.routes.ts frontend/src/app/services/auth.guard.ts frontend/src/app/services/page-access.guard.ts frontend/src/app/services/admin-only.guard.ts frontend/src/app/services/first-login.guard.ts frontend/src/app/constants/page-access.ts frontend/src/app/services/guards.spec.ts
git commit -m "feat: add route-level guards for page permissions and admin-only pages"
```

---

### Task 8: UI dashboard theo quyền + màn employees + first-login password screen

**Files:**
- Modify: `frontend/src/app/features/dashboard/admin.ts`
- Modify: `frontend/src/app/features/dashboard/admin.html`
- Create: `frontend/src/app/features/dashboard/employees/employees.ts`
- Create: `frontend/src/app/features/auth/first-login-password/first-login-password.ts`
- Test: `frontend/src/app/features/auth/first-login-password/first-login-password.spec.ts`
- Test: `frontend/src/app/features/dashboard/components/profile-manager/profile-manager.spec.ts` (hoặc test mới UI navigation)

- [ ] **Step 1: Viết UI tests cho sidebar theo allowedPages**

```ts
it('shows only permitted menu items for staff', ...);
it('shows employees menu only for admin', ...);
```

- [ ] **Step 2: Run test để FAIL**

Run: `cd frontend && npm run test:ci`  
Expected: FAIL trước khi implement.

- [ ] **Step 3: Refactor Admin component dùng route/pageKey thay vì activeTab thuần**

```ts
readonly allowedPages = computed(() => this.authService.currentUser()?.allowedPages ?? []);
readonly visibleMenus = computed(() => ...);
```

- [ ] **Step 4: Cập nhật `admin.html` render menu conditionally + routerLink**

```html
<a *ngFor="let item of visibleMenus()" [routerLink]="item.route">...</a>
```

- [ ] **Step 5: Tạo employees screen tối thiểu**

```ts
// load list, create staff, toggle active, update pages
```

- [ ] **Step 6: Tạo first-login password screen**

```ts
// gọi /api/auth/change-password-first-login rồi navigate /admin
```

- [ ] **Step 7: Run frontend tests**

Run: `cd frontend && npm run test:ci`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/features/dashboard/admin.ts frontend/src/app/features/dashboard/admin.html frontend/src/app/features/dashboard/employees/employees.ts frontend/src/app/features/auth/first-login-password/first-login-password.ts frontend/src/app/features/auth/first-login-password/first-login-password.spec.ts
git commit -m "feat: enforce page-based dashboard UI and first-login password flow"
```

---

### Task 9: End-to-end permission regression tests (backend + frontend smoke)

**Files:**
- Modify: `backend/test/api.test.js`
- Modify: `frontend/src/app/app.spec.ts` (thêm route smoke)
- Test: cả backend + frontend

- [ ] **Step 1: Thêm backend integration cases đầy đủ theo tiêu chí hoàn thành**

```js
test('staff with videos permission can access /api/videos but not /api/system', ...);
test('locked staff is blocked on next request even with valid token', ...);
test('employees endpoints are admin-only', ...);
```

- [ ] **Step 2: Run backend suite**

Run: `cd backend && npm test`  
Expected: PASS.

- [ ] **Step 3: Thêm frontend smoke test redirect fallback page hợp lệ**

```ts
it('redirects forbidden page request to first allowed admin page', ...);
```

- [ ] **Step 4: Run frontend suite**

Run: `cd frontend && npm run test:ci`  
Expected: PASS.

- [ ] **Step 5: Final full run**

Run: `cd backend && npm test && cd ../frontend && npm run test:ci`  
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add backend/test/api.test.js frontend/src/app/app.spec.ts
git commit -m "test: cover staff page authorization and first-login enforcement end-to-end"
```

---

## Self-Review Checklist (đã áp vào plan)

- Spec coverage:
  - ✅ Admin tạo nhân viên: Task 5 + Task 8
  - ✅ First login đổi mật khẩu: Task 3 + Task 6 + Task 8
  - ✅ Chặn URL/API trực tiếp: Task 4 + Task 7
  - ✅ Áp dụng cho toàn bộ trang: Task 4 + Task 7 + Task 8
  - ✅ Employees admin-only: Task 5 + Task 7 + Task 8
  - ✅ Khóa/mở tài khoản: Task 5 + Task 9
- Placeholder scan:
  - ✅ Không dùng TBD/TODO mơ hồ.
- Type consistency:
  - ✅ Dùng thống nhất page keys: `videos|profiles|devices|system|employees`.
  - ✅ Dùng thống nhất fields: `role|isActive|mustChangePassword|allowedPages`.

---
