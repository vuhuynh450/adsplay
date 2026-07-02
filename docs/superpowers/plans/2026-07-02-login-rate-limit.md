# Login Rate Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add failed-login rate limiting to `POST /api/auth/login`.

**Architecture:** Keep the limiter local to `backend/src/routes/auth.routes.ts`, mirroring the existing in-memory device registration limiter style. The route checks the IP + normalized username key before calling `login()`, records only `INVALID_CREDENTIALS` and `ACCOUNT_INACTIVE`, resets attempts on successful login, and returns `429 RATE_LIMITED` once the key already has too many failures in the active window.

**Tech Stack:** Express 5, TypeScript, in-memory `Map`, existing `AppError`, Node test runner, Supertest.

## Global Constraints

- Applies only to `POST /api/auth/login`.
- Default window is 10 minutes.
- Default max failures is 10 failed login attempts.
- Rate-limit key is `req.ip || 'unknown'` plus `username.trim().toLowerCase()`.
- Count only `INVALID_CREDENTIALS` and `ACCOUNT_INACTIVE` as failed attempts.
- Successful login clears the failure history for the same IP + username key.
- The attempt that reaches the threshold still returns the original login error; the next attempt inside the window returns `429 RATE_LIMITED`.
- Rate-limited response uses code `RATE_LIMITED` and message `Too many login attempts. Please try again later.`
- Existing successful login response shape stays unchanged.
- No frontend change is required.
- Do not add Redis, SQLite persistence, CAPTCHA, email alerts, account lock UI, first-login password-change rate limit, or device registration rate-limit changes.
- Do not add new runtime dependencies.
- Do not commit unless the user explicitly asks for a commit.

---

## File Structure

- Modify `backend/src/routes/auth.routes.ts`: add in-memory failed-login limiter helpers, test configuration helpers, and wrap the login route with limiter enforcement/record/reset behavior.
- Modify `backend/test/api.test.js`: import and reset login limiter test helpers; add tests for rate limit threshold, success reset, username scoping, and inactive-account counting.

---

### Task 1: Login Failed-Attempt Rate Limit

**Files:**
- Modify: `backend/src/routes/auth.routes.ts`
- Modify: `backend/test/api.test.js`

**Interfaces:**
- Consumes: `login(username: string, password: string)` from `backend/src/services/auth.service.ts`.
- Produces: `POST /api/auth/login` rate-limited behavior plus test helpers `__resetLoginRateLimitForTests()` and `__configureLoginRateLimitForTests({ windowMs, maxFailures })`.

- [ ] **Step 1: Add failing API tests**

In `backend/test/api.test.js`, update the auth route/service imports by adding:

```js
const {
  __configureLoginRateLimitForTests,
  __resetLoginRateLimitForTests,
} = require('../dist/routes/auth.routes');
```

Update `test.beforeEach` to reset the login limiter:

```js
test.beforeEach(() => {
  __resetRegisterRateLimitForTests();
  __resetDeviceCodeGeneratorForTests();
  __resetPendingDeviceRegistrationsForTests();
  __resetRemoveFileForTests();
  __resetLoginRateLimitForTests();
});
```

Add these tests after `login response includes user role + page metadata`:

```js
test('login rate limit blocks after repeated failed credentials for the same username', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });

  const firstFailure = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'wrong-password',
  });
  assert.equal(firstFailure.status, 401);
  assert.equal(firstFailure.body.error.code, 'INVALID_CREDENTIALS');

  const secondFailure = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'wrong-password',
  });
  assert.equal(secondFailure.status, 401);
  assert.equal(secondFailure.body.error.code, 'INVALID_CREDENTIALS');

  const limited = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'admin',
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  assert.equal(limited.body.error.message, 'Too many login attempts. Please try again later.');
});

test('successful login clears previous failed login attempts', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });

  const failure = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'wrong-password',
  });
  assert.equal(failure.status, 401);

  const success = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'admin',
  });
  assert.equal(success.status, 200);
  assert.ok(success.body.token);

  const nextFailure = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'wrong-password',
  });
  assert.equal(nextFailure.status, 401);

  const stillNotLimited = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'wrong-password',
  });
  assert.equal(stillNotLimited.status, 401);
  assert.equal(stillNotLimited.body.error.code, 'INVALID_CREDENTIALS');
});

test('login rate limit is scoped by normalized username', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });

  const firstFailure = await request(app).post('/api/auth/login').send({
    username: 'missing_user',
    password: 'wrong-password',
  });
  assert.equal(firstFailure.status, 401);

  const secondFailure = await request(app).post('/api/auth/login').send({
    username: 'MISSING_USER ',
    password: 'wrong-password',
  });
  assert.equal(secondFailure.status, 401);

  const limitedSameNormalizedUsername = await request(app).post('/api/auth/login').send({
    username: ' missing_user ',
    password: 'wrong-password',
  });
  assert.equal(limitedSameNormalizedUsername.status, 429);
  assert.equal(limitedSameNormalizedUsername.body.error.code, 'RATE_LIMITED');

  const otherUsername = await request(app).post('/api/auth/login').send({
    username: 'another_missing_user',
    password: 'wrong-password',
  });
  assert.equal(otherUsername.status, 401);
  assert.equal(otherUsername.body.error.code, 'INVALID_CREDENTIALS');
});

test('inactive account login attempts count toward login rate limit', async () => {
  __configureLoginRateLimitForTests({ windowMs: 60_000, maxFailures: 2 });
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('123456', 10);

  await dbRepository.createUser({
    username: 'staff_inactive_limited',
    passwordHash,
    role: 'staff',
    isActive: false,
    mustChangePassword: false,
    allowedPages: ['videos'],
  });

  const firstFailure = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive_limited',
    password: '123456',
  });
  assert.equal(firstFailure.status, 403);
  assert.equal(firstFailure.body.error.code, 'ACCOUNT_INACTIVE');

  const secondFailure = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive_limited',
    password: '123456',
  });
  assert.equal(secondFailure.status, 403);
  assert.equal(secondFailure.body.error.code, 'ACCOUNT_INACTIVE');

  const limited = await request(app).post('/api/auth/login').send({
    username: 'staff_inactive_limited',
    password: '123456',
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
});
```

- [ ] **Step 2: Run the targeted failing tests**

Run:

```bash
npm test -- --test-name-pattern="login rate limit|successful login clears|inactive account login attempts count"
```

Workdir: `backend`

Expected: fail because `__resetLoginRateLimitForTests` and `__configureLoginRateLimitForTests` are not exported yet.

- [ ] **Step 3: Implement limiter helpers and route behavior**

In `backend/src/routes/auth.routes.ts`, update the imports:

```ts
import { AppError, asyncHandler } from '../errors';
```

Add this after `export const authRouter = Router();`:

```ts
let loginRateLimitWindowMs = 10 * 60_000;
let loginRateLimitMaxFailures = 10;
const failedLoginAttemptsByKey = new Map<string, number[]>();

const getLoginRateLimitKey = (ip: string, username: string) =>
    `${ip}:${username.trim().toLowerCase()}`;

const getRecentFailedLoginAttempts = (ip: string, username: string) => {
    const now = Date.now();
    const key = getLoginRateLimitKey(ip, username);
    const attempts = failedLoginAttemptsByKey.get(key) || [];
    const recentAttempts = attempts.filter((timestamp) => now - timestamp < loginRateLimitWindowMs);
    failedLoginAttemptsByKey.set(key, recentAttempts);
    return { key, recentAttempts };
};

const enforceLoginRateLimit = (ip: string, username: string) => {
    const { recentAttempts } = getRecentFailedLoginAttempts(ip, username);
    if (recentAttempts.length >= loginRateLimitMaxFailures) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Please try again later.');
    }
};

const recordFailedLoginAttempt = (ip: string, username: string) => {
    const { key, recentAttempts } = getRecentFailedLoginAttempts(ip, username);
    recentAttempts.push(Date.now());
    failedLoginAttemptsByKey.set(key, recentAttempts);
};

const resetLoginRateLimit = (ip: string, username: string) => {
    failedLoginAttemptsByKey.delete(getLoginRateLimitKey(ip, username));
};

const shouldRecordFailedLogin = (error: unknown) =>
    error instanceof AppError && (error.code === 'INVALID_CREDENTIALS' || error.code === 'ACCOUNT_INACTIVE');

export const __resetLoginRateLimitForTests = () => {
    failedLoginAttemptsByKey.clear();
    loginRateLimitWindowMs = 10 * 60_000;
    loginRateLimitMaxFailures = 10;
};

export const __configureLoginRateLimitForTests = (input: { windowMs: number; maxFailures: number }) => {
    loginRateLimitWindowMs = input.windowMs;
    loginRateLimitMaxFailures = input.maxFailures;
};
```

Replace the existing login route handler with:

```ts
authRouter.post(
    '/login',
    asyncHandler(async (req, res) => {
        const username = requireNonEmptyString(req.body?.username, 'username');
        const password = requireNonEmptyString(req.body?.password, 'password');
        const ip = req.ip || 'unknown';

        enforceLoginRateLimit(ip, username);

        try {
            const result = await login(username, password);
            resetLoginRateLimit(ip, username);
            res.json(result);
        } catch (error) {
            if (shouldRecordFailedLogin(error)) {
                recordFailedLoginAttempt(ip, username);
            }

            throw error;
        }
    }),
);
```

- [ ] **Step 4: Run targeted tests again**

Run:

```bash
npm test -- --test-name-pattern="login rate limit|successful login clears|inactive account login attempts count"
```

Workdir: `backend`

Expected: targeted login rate-limit tests pass.

- [ ] **Step 5: Run full backend verification**

Run:

```bash
npm test
```

Workdir: `backend`

Expected: all backend tests pass.

---

## Final Verification

- [ ] Run backend tests:

```bash
npm test
```

Workdir: `backend`

- [ ] Inspect changed files:

```bash
git diff -- backend/src/routes/auth.routes.ts backend/test/api.test.js docs/superpowers/specs/2026-07-02-login-rate-limit-design.md docs/superpowers/plans/2026-07-02-login-rate-limit.md
```

Expected: diff only contains login rate-limit changes and the approved spec/plan docs.

## Self-Review Notes

- Spec coverage: route scope, 10 failures/10 minutes defaults, IP + normalized username key, count-only selected auth failures, success reset, 429 shape, no frontend changes, and no out-of-scope features are covered.
- Placeholder scan: no TBD/TODO/fill-in instructions.
- Type consistency: test helpers are `__resetLoginRateLimitForTests()` and `__configureLoginRateLimitForTests({ windowMs, maxFailures })`; implementation and tests use the same names.
- Commit steps are intentionally omitted because commits require explicit user approval in this workspace.
