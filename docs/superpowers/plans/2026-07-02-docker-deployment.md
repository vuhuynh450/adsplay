# Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-container Docker Compose deployment path for AdPlay on VPS port `3000:3000`.

**Architecture:** Use a multi-stage Dockerfile to build Angular frontend and TypeScript backend, then run only the compiled backend in a Debian-based Node runtime image. Persist SQLite and uploaded media under a host `./data` bind mount mapped to `/app/data`.

**Tech Stack:** Docker multi-stage build, Docker Compose, Node 24 bookworm slim, Angular 21 build output, Express static serving, SQLite via `better-sqlite3`, `ffmpeg-static` / `ffprobe-static`.

## Global Constraints

- Use one Docker container for the AdPlay app.
- Host port mapping is exactly `3000:3000`.
- Persistent data mount is exactly `./data:/app/data`.
- SQLite file path inside the container is `/app/data/db.sqlite`.
- Uploads directory inside the container is `/app/data/uploads`.
- Frontend build path inside the container is `/app/frontend/dist/frontend`.
- Backend runtime entrypoint is `node /app/backend/dist/server.js`.
- Use a Debian-based Node image, not Alpine.
- Recommended base image is `node:24-bookworm-slim`.
- Do not add nginx, HTTPS/Certbot, Docker Swarm/Kubernetes, multiple replicas, MySQL/Postgres/Redis, object storage, automated backup scheduler, or CI image publishing.
- `.env.docker` must not be committed.
- Do not commit unless the user explicitly asks for a commit.

---

## File Structure

- Create `Dockerfile`: multi-stage build for frontend, backend, and production runtime.
- Create `.dockerignore`: excludes git metadata, node_modules, build outputs, runtime uploads/db/data, and local tool scratch.
- Create `docker-compose.yml`: one `adplay` service with port `3000:3000`, `.env.docker`, `./data:/app/data`, `restart: unless-stopped`.
- Create `.env.docker.example`: production-oriented Docker env template.
- Modify `.gitignore`: ignore `.env.docker` and `data/`.
- Create `docs/deployment/docker.md`: deployment/start/stop/update/log/backup/restore docs.

---

### Task 1: Docker Runtime Files

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `.env.docker.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: backend `npm run build`, frontend `npm run build`, backend `npm start:prod` runtime equivalent.
- Produces: Docker image that runs `node /app/backend/dist/server.js`, listens on container port `3000`, reads data from `/app/data`.

- [ ] **Step 1: Add Dockerfile**

Create `Dockerfile` at repo root:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-bookworm-slim AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev --no-fund --no-audit

WORKDIR /app
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data/uploads

EXPOSE 3000
CMD ["node", "/app/backend/dist/server.js"]
```

- [ ] **Step 2: Add `.dockerignore`**

Create `.dockerignore` at repo root:

```text
.git
.opencode
.superpowers
node_modules
backend/node_modules
frontend/node_modules
backend/dist
frontend/dist
backend/uploads
backend/db.sqlite*
data
*.log
AdPlay Access.txt
```

- [ ] **Step 3: Add Docker Compose file**

Create `docker-compose.yml` at repo root:

```yaml
services:
  adplay:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env.docker
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

- [ ] **Step 4: Add Docker env example**

Create `.env.docker.example` at repo root:

```env
PORT=3000
DB_FILE=/app/data/db.sqlite
UPLOADS_DIR=/app/data/uploads
FRONTEND_DIST_DIR=/app/frontend/dist/frontend
JWT_SECRET=change-this-to-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
MAX_UPLOAD_SIZE_MB=4096
MEDIA_TRANSCODE_ENABLED=true
RESUMABLE_CHUNK_SIZE_MB=8
NODE_ENV=production
```

- [ ] **Step 5: Update `.gitignore`**

Append these lines to `.gitignore` if they are not already present:

```text
.env.docker
data/
```

- [ ] **Step 6: Validate Docker Compose config fails only because env file is missing**

Run:

```bash
docker compose config
```

Workdir: repo root.

Expected before copying `.env.docker`: Docker reports `.env.docker` missing. This is acceptable because `.env.docker` must be user-created and uncommitted.

---

### Task 2: Docker Deployment Documentation

**Files:**
- Create: `docs/deployment/docker.md`

**Interfaces:**
- Consumes: Docker files from Task 1.
- Produces: user-facing deploy instructions for `docker compose up -d --build`, logs, stop, update, backup, restore, and health check.

- [ ] **Step 1: Add Docker deployment docs**

Create `docs/deployment/docker.md`:

```markdown
# Docker Deployment

This guide runs AdPlay as one Docker container on a VPS.

The container serves:

- Angular admin/player UI
- backend API routes
- uploaded media under `/uploads`

SQLite metadata and uploaded media are stored on the host under `./data`.

## Requirements

- Docker Engine
- Docker Compose plugin
- Port `3000` available on the host

## First-Time Setup

From the repository root:

```bash
cp .env.docker.example .env.docker
```

Edit `.env.docker` before starting production:

```env
JWT_SECRET=change-this-to-a-long-random-secret
ADMIN_PASSWORD=change-this-password
```

Use a long random `JWT_SECRET` and a non-default `ADMIN_PASSWORD`.

## Start

```bash
docker compose up -d --build
```

Open:

```text
http://<server-ip>:3000/admin
```

## Health Check

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{"ok":true,"status":"healthy"}
```

## Logs

```bash
docker compose logs -f adplay
```

## Stop

```bash
docker compose down
```

`docker compose down` stops the container but keeps `./data` on the host.

## Update

```bash
git pull
docker compose up -d --build
```

## Persistent Data

Docker stores app data here:

```text
data/
  db.sqlite
  db.sqlite-wal
  db.sqlite-shm
  uploads/
```

Do not delete `data/` unless you want to remove all app metadata and uploaded media.

## Backup

Safest backup flow:

```bash
docker compose down
tar -czf adplay-data-backup-$(date +%F).tar.gz data
docker compose up -d
```

## Restore

```bash
docker compose down
rm -rf data
tar -xzf adplay-data-backup-YYYY-MM-DD.tar.gz
docker compose up -d
```

## Notes

- This setup is designed for one app container.
- Do not run multiple AdPlay containers against the same SQLite database.
- If you put nginx or Cloudflare in front later, keep Docker port `3000` internal and proxy to it.
```

- [ ] **Step 2: Verify documentation references existing files**

Run:

```bash
test -f Dockerfile && test -f docker-compose.yml && test -f .env.docker.example && test -f docs/deployment/docker.md
```

Expected: command exits with status 0.

---

### Task 3: Docker Build And Runtime Verification

**Files:**
- No source changes expected unless verification exposes a Docker packaging issue.

**Interfaces:**
- Consumes: Docker files and docs from Tasks 1-2.
- Produces: verified local image/container that responds to `/api/health` on host port `3000`.

- [ ] **Step 1: Prepare local `.env.docker` for verification only**

Run:

```bash
cp .env.docker.example .env.docker
```

Then update `.env.docker` locally so it is valid for verification:

```env
JWT_SECRET=docker-local-test-secret-change-before-production
ADMIN_PASSWORD=admin
```

`.env.docker` must remain untracked.

- [ ] **Step 2: Build and start container**

Run:

```bash
docker compose up -d --build
```

Expected: image builds and service `adplay` starts.

- [ ] **Step 3: Verify health endpoint**

Run:

```bash
curl -fsS http://localhost:3000/api/health
```

Expected:

```json
{"ok":true,"status":"healthy"}
```

- [ ] **Step 4: Verify data directory exists on host**

Run:

```bash
test -d data && test -d data/uploads
```

Expected: command exits with status 0.

- [ ] **Step 5: Stop container after verification**

Run:

```bash
docker compose down
```

Expected: container stops; `data/` remains.

- [ ] **Step 6: Run backend tests outside Docker**

Run:

```bash
npm test
```

Workdir: `backend`.

Expected: all backend tests pass.

---

## Final Verification

- [ ] Confirm `.env.docker` is untracked/ignored:

```bash
git status --short .env.docker data
```

Expected: no output for `.env.docker`; `data/` ignored.

- [ ] Inspect changed files:

```bash
git diff -- Dockerfile .dockerignore docker-compose.yml .env.docker.example .gitignore docs/deployment/docker.md docs/superpowers/specs/2026-07-02-docker-deployment-design.md docs/superpowers/plans/2026-07-02-docker-deployment.md
```

Expected: only Docker deployment files, docs, and approved spec/plan are changed.

## Self-Review Notes

- Spec coverage: single-container deployment, port `3000:3000`, `./data:/app/data`, `/app/data/db.sqlite`, `/app/data/uploads`, `/app/frontend/dist/frontend`, multi-stage Dockerfile, `.env.docker.example`, `.dockerignore`, docs, and validation are covered.
- Placeholder scan: no TBD/TODO/fill-in instructions.
- Type consistency: all paths and port mappings match the approved spec.
- Commit steps are intentionally omitted because commits require explicit user approval in this workspace.
