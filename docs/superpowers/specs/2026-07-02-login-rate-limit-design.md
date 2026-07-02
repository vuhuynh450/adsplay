# Login Rate Limit Design

## Goal

Protect the admin/staff login endpoint from brute-force password attempts while keeping the app simple for single-VPS deployment.

The rate limit applies only to `POST /api/auth/login` and only counts failed login attempts.

## Current State

`backend/src/routes/auth.routes.ts` currently validates username/password and directly calls `login(username, password)`:

```ts
authRouter.post(
    '/login',
    asyncHandler(async (req, res) => {
        const username = requireNonEmptyString(req.body?.username, 'username');
        const password = requireNonEmptyString(req.body?.password, 'password');
        const result = await login(username, password);
        res.json(result);
    }),
);
```

`backend/src/routes/device.routes.ts` already has a simple in-memory rate limit for public device registration. The login rate limit should follow that style instead of adding a new dependency.

## Recommended Approach

Use an in-memory failed-login rate limit keyed by IP address plus normalized username.

Default policy:

- window: 10 minutes
- max failures: 10 failed login attempts
- key: `ip + username.toLowerCase().trim()`
- exceeded response: HTTP `429`, code `RATE_LIMITED`

This fits the current deployment model:

- single VPS
- single backend process
- low admin/staff user count
- no need for Redis or database-backed throttling

## Backend Design

### Scope

Apply the limiter only to:

- `POST /api/auth/login`

Do not apply it to:

- token verification
- profile/player heartbeat tokens
- device token verification
- first-login password change
- device registration

### Failure Counting

Count these as failed login attempts:

- `INVALID_CREDENTIALS`
- `ACCOUNT_INACTIVE`

Do not count unrelated validation/runtime errors.

Successful login clears the failure history for the same IP + username key.

### Rate Limit Behavior

Before calling `login(username, password)`, check the current failure history for the key.

If the key already has 10 failures inside the active 10-minute window, throw:

```ts
new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Please try again later.')
```

If login fails with `INVALID_CREDENTIALS` or `ACCOUNT_INACTIVE`, record the failed attempt and throw the original error.

If login succeeds, clear the attempts for that key and return the normal login response.

The attempt that reaches the threshold should still return the original login error. The next attempt inside the window should return `RATE_LIMITED`.

### State And Helpers

Keep the implementation local to `backend/src/routes/auth.routes.ts`.

Use:

```ts
let loginRateLimitWindowMs = 10 * 60_000;
let loginRateLimitMaxFailures = 10;
const failedLoginAttemptsByKey = new Map<string, number[]>();
```

Add helpers:

- `getLoginRateLimitKey(ip: string, username: string)`
- `enforceLoginRateLimit(ip: string, username: string)`
- `recordFailedLoginAttempt(ip: string, username: string)`
- `resetLoginRateLimit(ip: string, username: string)`

Normalize username with `username.trim().toLowerCase()` for the key. Preserve the original username when calling `login()`.

Use `req.ip || 'unknown'` for the IP component, matching the style in `device.routes.ts`.

### Test Helpers

Export test-only helpers from `backend/src/routes/auth.routes.ts`:

```ts
export const __resetLoginRateLimitForTests = () => { ... };
export const __configureLoginRateLimitForTests = (input: { windowMs: number; maxFailures: number }) => { ... };
```

These helpers mirror the existing device registration rate-limit test helpers and are reset in `backend/test/api.test.js` `beforeEach`.

## Frontend Design

No frontend code change is required.

The existing login component already displays backend error messages through `getErrorMessage()`. The `RATE_LIMITED` response message should show in the same error box.

## Out Of Scope

This spec does not include:

- persistent lockout in SQLite
- Redis or distributed rate limiting
- CAPTCHA
- email alerts
- account lock/unlock UI
- first-login password change rate limit
- device registration rate-limit changes
- frontend copy/layout changes

## Test Design

Backend tests should cover:

- repeated bad passwords for the same username hit `RATE_LIMITED` after the configured max failure count
- a successful login clears previous failures for the same IP + username key
- failed attempts are scoped by username so one username does not block another username from the same IP
- `ACCOUNT_INACTIVE` counts as a failed login attempt

Use a small test configuration such as `{ windowMs: 60_000, maxFailures: 2 }` to keep tests fast.

## Acceptance Criteria

- `POST /api/auth/login` returns `429 RATE_LIMITED` after too many failed attempts for the same IP + username.
- Successful login resets the limiter for that IP + username.
- Failed attempts for one username do not block another username from the same IP.
- Inactive account login attempts count toward the limit.
- Existing successful login behavior and response shape stay unchanged.
- Backend tests pass.
