# Device Binding TV Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ràng buộc mỗi TV vào đúng một profile để TV chỉ phát nội dung được admin gán, không còn nhập nhầm slug thủ công.

**Architecture:** Backend bổ sung thực thể `Device` và mapping `assignedProfileId`; player route mới `/player/device` lấy dữ liệu theo `deviceId + token`; admin có API và UI quản lý thiết bị/gán profile. Luồng cũ `/player/:profileName` giữ lại để tương thích trong quá trình chuyển đổi.

**Tech Stack:** Express 5 + TypeScript (backend), Angular 21 signals/components (frontend), node:test + supertest (backend tests), Vitest/Jasmine-style specs (frontend unit specs).

---

## File structure và trách nhiệm

### Backend
- Modify: `backend/src/types.ts` — thêm kiểu `Device`, `AdminDevice`, `PlayerDeviceBinding` và mở rộng `DatabaseSchema`.
- Modify: `backend/src/db.ts` — normalize/persist `devices`, CRUD thiết bị, assign/unassign profile, touch heartbeat.
- Modify: `backend/src/services/auth.service.ts` — tạo/verify token thiết bị (`device-token`).
- Create: `backend/src/services/device.service.ts` — business logic register/list/assign/get-by-device/heartbeat.
- Create: `backend/src/routes/device.routes.ts` — route admin quản lý thiết bị.
- Create: `backend/src/routes/player-device.routes.ts` — route public player theo thiết bị.
- Modify: `backend/src/app.ts` — mount routes mới.
- Test: `backend/test/api.test.js` — bổ sung end-to-end cho flow device binding.

### Frontend
- Modify: `frontend/src/app/services/api.service.ts` — model Device + API methods register/get binding/heartbeat/admin manage.
- Modify: `frontend/src/app/app.routes.ts` — thêm route `/player/device`.
- Modify: `frontend/src/app/features/player/player.ts` — đọc params/query cho mode device.
- Modify: `frontend/src/app/features/player/player-session.service.ts` — nhánh load profile theo device + heartbeat theo device.
- Modify: `frontend/src/app/features/player/player.html` — trạng thái chờ gán thiết bị.
- Modify: `frontend/src/app/features/dashboard/admin.ts` — state tab thiết bị.
- Modify: `frontend/src/app/features/dashboard/admin.html` — thêm tab “Thiết bị TV”.
- Create: `frontend/src/app/features/dashboard/components/device-manager/device-manager.ts` — component quản lý thiết bị.
- Create: `frontend/src/app/features/dashboard/components/device-manager/device-manager.html` — UI bảng thiết bị + assign.
- Create: `frontend/src/app/features/dashboard/components/device-manager/device-manager.spec.ts` — unit test URL/emit/action cơ bản.

---

### Task 1: Backend types + repository support cho devices

**Files:**
- Modify: `backend/src/types.ts`
- Modify: `backend/src/db.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test fail cho dữ liệu device persistence**

```js
// backend/test/api.test.js (thêm case mới)
test('device repository persists and lists device records', async () => {
  const { dbRepository } = require('../dist/db');

  const created = await dbRepository.createDevice({
    name: 'TV Lobby',
    secretHash: 'hash-1',
  });

  assert.ok(created.id);
  assert.equal(created.name, 'TV Lobby');

  const listed = await dbRepository.listDevices();
  assert.equal(listed.length >= 1, true);
  assert.equal(listed.some((d) => d.id === created.id), true);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm --prefix backend run test`
Expected: FAIL với lỗi `dbRepository.createDevice is not a function`.

- [ ] **Step 3: Viết implementation tối thiểu cho type + db repository**

```ts
// backend/src/types.ts
export interface Device {
  assignedProfileId?: string;
  createdAt: string;
  deviceCode: string;
  id: string;
  lastSeen?: string;
  name: string;
  secretHash: string;
  updatedAt: string;
}

export interface DatabaseSchema {
  devices: Device[];
  profiles: Profile[];
  users: User[];
  videos: Video[];
}
```

```ts
// backend/src/db.ts (bổ sung normalize + repository methods)
const normalizeDevice = (device: Partial<Device>): Device => {
  const timestamp = device.updatedAt || device.createdAt || new Date().toISOString();
  return {
    assignedProfileId: device.assignedProfileId,
    createdAt: device.createdAt || timestamp,
    deviceCode: device.deviceCode || `TV-${createEntityId().slice(0, 8).toUpperCase()}`,
    id: device.id || createEntityId(),
    lastSeen: device.lastSeen,
    name: device.name || 'TV Device',
    secretHash: device.secretHash || '',
    updatedAt: device.updatedAt || timestamp,
  };
};

async createDevice(input: { name: string; secretHash: string }) { /* ... */ }
async listDevices() { /* ... */ }
async findDeviceById(id: string) { /* ... */ }
async updateDeviceName(id: string, name: string) { /* ... */ }
async assignProfileToDevice(deviceId: string, profileId?: string) { /* ... */ }
async touchDevice(id: string, heartbeatAt: string) { /* ... */ }
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm --prefix backend run test`
Expected: PASS cho case repository device mới.

- [ ] **Step 5: Commit**

```bash
git add backend/src/types.ts backend/src/db.ts backend/test/api.test.js
git commit -m "feat: add device persistence primitives"
```

---

### Task 2: Device token auth + device services

**Files:**
- Modify: `backend/src/services/auth.service.ts`
- Create: `backend/src/services/device.service.ts`
- Modify: `backend/src/types.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test fail cho register + verify token thiết bị**

```js
test('device registration returns device token and token can be verified', async () => {
  const { registerDeviceForPlayer } = require('../dist/services/device.service');
  const { verifyDeviceToken } = require('../dist/services/auth.service');

  const registration = await registerDeviceForPlayer('TV Floor 1');
  assert.ok(registration.deviceId);
  assert.ok(registration.deviceToken);

  const payload = verifyDeviceToken(registration.deviceToken, registration.deviceId);
  assert.equal(payload.deviceId, registration.deviceId);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm --prefix backend run test`
Expected: FAIL vì `registerDeviceForPlayer`/`verifyDeviceToken` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu auth + service**

```ts
// backend/src/services/auth.service.ts
export interface DeviceTokenPayload extends jwt.JwtPayload {
  deviceId: string;
  tokenType: 'device';
}

export const createDeviceToken = (device: { id: string }) =>
  jwt.sign({ deviceId: device.id, tokenType: 'device' }, config.jwtSecret);

export const verifyDeviceToken = (token: string, expectedDeviceId: string) => {
  const payload = verifySignedToken(token);
  if (typeof payload === 'string' || payload.tokenType !== 'device' || payload.deviceId !== expectedDeviceId) {
    throw new AppError(403, 'DEVICE_TOKEN_INVALID', 'Device token is invalid.');
  }
  return payload as DeviceTokenPayload;
};
```

```ts
// backend/src/services/device.service.ts
export const registerDeviceForPlayer = async (name?: string) => {
  const randomSecret = crypto.randomBytes(32).toString('hex');
  const secretHash = await bcrypt.hash(randomSecret, 10);
  const device = await dbRepository.createDevice({
    name: name?.trim() || 'TV Device',
    secretHash,
  });
  const deviceToken = createDeviceToken(device);
  return { deviceId: device.id, deviceCode: device.deviceCode, deviceToken };
};
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm --prefix backend run test`
Expected: PASS cho case register/verify token thiết bị.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/auth.service.ts backend/src/services/device.service.ts backend/src/types.ts backend/test/api.test.js
git commit -m "feat: add device token and registration service"
```

---

### Task 3: Expose API routes cho admin và player-by-device

**Files:**
- Create: `backend/src/routes/device.routes.ts`
- Create: `backend/src/routes/player-device.routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/services/device.service.ts`
- Test: `backend/test/api.test.js`

- [ ] **Step 1: Viết test fail cho API device binding flow**

```js
test('device-bound player returns assigned profile only', async () => {
  const { authHeader } = await loginAsAdmin();

  const video = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), { contentType: 'video/mp4', filename: 'd.mp4' });

  const profile = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({ name: 'Lobby Screen', videoIds: [video.body.id] });

  const device = await request(app)
    .post('/api/devices/register')
    .send({ name: 'TV Lobby' });

  const assign = await request(app)
    .post(`/api/devices/${device.body.deviceId}/assign-profile`)
    .set(authHeader)
    .send({ profileId: profile.body.id });
  assert.equal(assign.status, 200);

  const binding = await request(app)
    .get(`/api/player/device/${device.body.deviceId}`)
    .set('X-Device-Token', device.body.deviceToken);

  assert.equal(binding.status, 200);
  assert.equal(binding.body.profile.slug, 'lobby-screen');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm --prefix backend run test`
Expected: FAIL 404 cho `/api/devices/register` và `/api/player/device/:deviceId`.

- [ ] **Step 3: Viết implementation tối thiểu cho routes và service methods**

```ts
// backend/src/routes/device.routes.ts
router.post('/register', asyncHandler(async (req, res) => {
  const registration = await registerDeviceForPlayer(requireOptionalString(req.body?.name, 'name'));
  res.json(registration);
}));

router.get('/', authenticateToken, asyncHandler(async (_req, res) => {
  res.json(await listDevicesForAdmin());
}));

router.post('/:id/assign-profile', authenticateToken, asyncHandler(async (req, res) => {
  await assignDeviceToProfile(requireNonEmptyString(req.params.id, 'id'), requireNonEmptyString(req.body?.profileId, 'profileId'));
  res.json({ success: true });
}));
```

```ts
// backend/src/routes/player-device.routes.ts
router.get('/:deviceId', asyncHandler(async (req, res) => {
  const token = requireNonEmptyString(req.headers['x-device-token'] as string, 'x-device-token');
  const binding = await getPlayerBindingByDevice(requireNonEmptyString(req.params.deviceId, 'deviceId'), token);
  res.json(binding);
}));

router.post('/:deviceId/heartbeat', asyncHandler(async (req, res) => {
  const token = requireNonEmptyString(req.headers['x-device-token'] as string, 'x-device-token');
  await heartbeatDevice(requireNonEmptyString(req.params.deviceId, 'deviceId'), token);
  res.json({ success: true });
}));
```

```ts
// backend/src/app.ts
app.use('/api/devices', deviceRouter);
app.use('/api/player/device', playerDeviceRouter);
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm --prefix backend run test`
Expected: PASS cho flow register/assign/get binding/heartbeat.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/device.routes.ts backend/src/routes/player-device.routes.ts backend/src/services/device.service.ts backend/src/app.ts backend/test/api.test.js
git commit -m "feat: expose device binding APIs for admin and player"
```

---

### Task 4: Frontend API client + player route `/player/device`

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`
- Modify: `frontend/src/app/app.routes.ts`
- Modify: `frontend/src/app/features/player/player.ts`
- Modify: `frontend/src/app/features/player/player-session.service.ts`
- Modify: `frontend/src/app/features/player/player.html`

- [ ] **Step 1: Viết test fail cho parsing route mode device trong player session**

```ts
// thêm spec trong player-session.service.spec.ts (tạo mới nếu chưa có)
it('loads binding by device when route mode is device', async () => {
  session.handleRoute(undefined, null, 'device');
  expect(api.registerDevice).toHaveBeenCalled();
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm --prefix frontend run test:ci`
Expected: FAIL vì API/mode device chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu cho API + session**

```ts
// frontend/src/app/services/api.service.ts
registerDevice(name?: string) {
  return this.http.post<{ deviceId: string; deviceCode: string; deviceToken: string }>(`${this.apiUrl}/devices/register`, { name });
}

getPlayerBindingByDevice(deviceId: string, deviceToken: string) {
  return this.http.get<{ profile: PlayerProfile }>(`${this.apiUrl}/player/device/${deviceId}`, {
    context: this.createPublicRequestContext(),
    headers: { 'X-Device-Token': deviceToken },
  });
}

sendDeviceHeartbeat(deviceId: string, deviceToken: string) {
  return this.http.post(`${this.apiUrl}/player/device/${deviceId}/heartbeat`, {}, {
    context: this.createPublicRequestContext(),
    headers: { 'X-Device-Token': deviceToken },
  });
}
```

```ts
// frontend/src/app/app.routes.ts
{ path: 'player/device', component: Player },
```

```ts
// frontend/src/app/features/player/player.ts (subscribe route)
this.session.handleRoute(params['profileName'], queryParamMap.get('token'), this.route.snapshot.routeConfig?.path || '');
```

```ts
// frontend/src/app/features/player/player-session.service.ts
handleRoute(profileSlug?: string, playerAccessToken?: string | null, routePath?: string) {
  if (routePath === 'player/device') {
    this.initializeDeviceMode();
    return;
  }
  // giữ luồng cũ
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm --prefix frontend run test:ci`
Expected: PASS các spec mới và không vỡ spec hiện có.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/services/api.service.ts frontend/src/app/app.routes.ts frontend/src/app/features/player/player.ts frontend/src/app/features/player/player-session.service.ts frontend/src/app/features/player/player.html
git commit -m "feat: add player device mode and device binding client APIs"
```

---

### Task 5: Admin UI quản lý thiết bị và gán profile

**Files:**
- Create: `frontend/src/app/features/dashboard/components/device-manager/device-manager.ts`
- Create: `frontend/src/app/features/dashboard/components/device-manager/device-manager.html`
- Create: `frontend/src/app/features/dashboard/components/device-manager/device-manager.spec.ts`
- Modify: `frontend/src/app/features/dashboard/admin.ts`
- Modify: `frontend/src/app/features/dashboard/admin.html`
- Modify: `frontend/src/app/services/api.service.ts`

- [ ] **Step 1: Viết test fail cho component device manager**

```ts
it('emits assign action with selected profileId', () => {
  const component = new DeviceManager();
  const emitted: unknown[] = [];
  component.assignProfile.subscribe((payload) => emitted.push(payload));

  component.emitAssign('device-1', 'profile-1');

  expect(emitted).toEqual([{ deviceId: 'device-1', profileId: 'profile-1' }]);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm --prefix frontend run test:ci`
Expected: FAIL vì `DeviceManager` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu UI + wiring admin**

```ts
// device-manager.ts
@Output() assignProfile = new EventEmitter<{ deviceId: string; profileId: string }>();
@Output() unassignProfile = new EventEmitter<{ deviceId: string }>();
@Output() renameDevice = new EventEmitter<{ deviceId: string; name: string }>();

emitAssign(deviceId: string, profileId: string) {
  if (!deviceId || !profileId) return;
  this.assignProfile.emit({ deviceId, profileId });
}
```

```html
<!-- device-manager.html -->
<tr *ngFor="let device of devices">
  <td>{{ device.name }}</td>
  <td>{{ device.deviceCode }}</td>
  <td>{{ device.assignedProfileName || 'Chưa gán' }}</td>
  <td>
    <select #profileSelect>
      <option *ngFor="let p of profiles" [value]="p.id">{{ p.name }}</option>
    </select>
    <button (click)="emitAssign(device.id, profileSelect.value)">Gán</button>
  </td>
</tr>
```

```ts
// admin.ts (bổ sung state)
activeTab: 'videos' | 'profiles' | 'devices' = 'videos';
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm --prefix frontend run test:ci`
Expected: PASS spec của DeviceManager và không vỡ tab cũ.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/dashboard/components/device-manager/device-manager.ts frontend/src/app/features/dashboard/components/device-manager/device-manager.html frontend/src/app/features/dashboard/components/device-manager/device-manager.spec.ts frontend/src/app/features/dashboard/admin.ts frontend/src/app/features/dashboard/admin.html frontend/src/app/services/api.service.ts
git commit -m "feat: add admin device manager for profile assignment"
```

---

### Task 6: End-to-end verification và hardening

**Files:**
- Modify: `backend/test/api.test.js`
- Modify: `frontend/src/app/features/player/player-session.service.ts`
- Modify: `frontend/src/app/features/dashboard/admin.html`

- [ ] **Step 1: Viết test fail cho trạng thái chưa gán thiết bị**

```js
test('unassigned device gets DEVICE_NOT_ASSIGNED response', async () => {
  const registered = await request(app).post('/api/devices/register').send({ name: 'TV Test' });
  const response = await request(app)
    .get(`/api/player/device/${registered.body.deviceId}`)
    .set('X-Device-Token', registered.body.deviceToken);

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'DEVICE_NOT_ASSIGNED');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm --prefix backend run test`
Expected: FAIL nếu service chưa trả code/lỗi đúng.

- [ ] **Step 3: Chỉnh implementation trả lỗi đúng + UI message rõ ràng**

```ts
// backend service
throw new AppError(409, 'DEVICE_NOT_ASSIGNED', 'Thiết bị chưa được gán màn hình.');
```

```ts
// frontend player-session.service.ts
if (error?.status === 409) {
  this.statusMessage.set('Thiết bị chưa được gán màn hình. Vui lòng gán trong trang quản trị.');
  this.profile.set(null);
  this.loading.set(false);
  return;
}
```

- [ ] **Step 4: Chạy full test/build để xác nhận pass**

Run: `npm --prefix backend run test && npm --prefix frontend run test:ci && npm --prefix frontend run build`
Expected: Tất cả PASS, build frontend thành công.

- [ ] **Step 5: Commit**

```bash
git add backend/test/api.test.js frontend/src/app/features/player/player-session.service.ts frontend/src/app/features/dashboard/admin.html
git commit -m "fix: handle unassigned device state in player flow"
```

---

## Self-review

### 1) Spec coverage
- Mapping thiết bị -> profile: covered (Task 1-3)
- Player route theo device + heartbeat: covered (Task 3-4)
- Admin quản lý thiết bị/gán profile: covered (Task 5)
- Trạng thái chưa gán + migration-safe behavior: covered (Task 6)

### 2) Placeholder scan
- Không có `TBD/TODO/implement later`.
- Mỗi task đều có test, command, expected output.

### 3) Type consistency
- Dùng nhất quán `deviceId`, `deviceToken`, `assignedProfileId`.
- Flow backend/frontend cùng dùng header `X-Device-Token`.
