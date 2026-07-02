# Docker Deployment Design

## Goal

Add a simple Docker deployment path for AdPlay so the app can be deployed on a VPS with one repeatable command.

The Docker deployment should keep the current product architecture:

- one Express backend process serves API routes
- the same Express process serves Angular static files
- the same Express process serves `/uploads`
- SQLite remains the metadata store
- uploaded media remains local filesystem storage

## Recommended Approach

Use a single Docker container for the AdPlay app, managed by Docker Compose.

The container listens on port `3000`, and the host maps `3000:3000`.

Persist application data with a bind mount:

```text
./data:/app/data
```

Inside the container:

- SQLite file: `/app/data/db.sqlite`
- uploads directory: `/app/data/uploads`
- frontend build: `/app/frontend/dist/frontend`
- backend runtime: `/app/backend/dist/server.js`

This is the lowest-complexity production deployment for the current VPS scale. It avoids adding nginx, MySQL, Postgres, Redis, or object storage.

## Current Project Fit

The backend already supports this model:

- `backend/src/app.ts` serves Angular static files using `config.frontendDistDir`
- `backend/src/app.ts` serves `/uploads` using `config.uploadsDir`
- `backend/src/config.ts` supports env overrides for `PORT`, `DB_FILE`, `UPLOADS_DIR`, and `FRONTEND_DIST_DIR`
- `backend/src/server.ts` starts a single Express HTTP server

## Docker Image Design

Use a multi-stage Dockerfile.

### Base Image

Use a Debian-based Node image, not Alpine.

Recommended:

```text
node:24-bookworm-slim
```

Rationale:

- the current runtime environment uses Node 24
- `better-sqlite3` is a native module and is safer on Debian-based images than Alpine
- `ffmpeg-static` / `ffprobe-static` binaries should be tested on the final image

### Stages

`frontend-build`:

- workdir: `/app/frontend`
- install dependencies with `npm ci`
- build Angular with `npm run build`

`backend-build`:

- workdir: `/app/backend`
- install dependencies with `npm ci`
- build TypeScript with `npm run build`

`runtime`:

- workdir: `/app`
- install backend production dependencies only
- copy backend `dist`
- copy frontend `dist`
- create `/app/data/uploads`
- expose port `3000`
- start with `node /app/backend/dist/server.js`

## Compose Design

Add `docker-compose.yml` with one service:

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

The compose file should not include a database service because SQLite is embedded.

## Environment Design

Add `.env.docker.example` for users to copy to `.env.docker`.

Required values:

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

`.env.docker` should be ignored by git.

## Persistent Data

The Docker deployment persists only `./data`.

Expected layout after runtime:

```text
data/
  db.sqlite
  db.sqlite-wal
  db.sqlite-shm
  uploads/
    processed/
    .sessions/
```

Backup guidance should tell the user to back up the entire `data/` directory while the app is stopped, or use SQLite-safe backup steps if the app remains running.

## .dockerignore

Add `.dockerignore` to keep image build context small and avoid copying runtime data.

Ignore at minimum:

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
```

Do not ignore package lock files.

## Documentation

Add `docs/deployment/docker.md` covering:

- copy `.env.docker.example` to `.env.docker`
- change `JWT_SECRET` and `ADMIN_PASSWORD`
- start: `docker compose up -d --build`
- check logs: `docker compose logs -f adplay`
- stop: `docker compose down`
- update: `git pull && docker compose up -d --build`
- backup: copy `data/` after stopping the container
- restore: copy `data/` back before starting the container
- app URL: `http://<server-ip>:3000/admin`

## Validation

Implementation should verify:

- Docker image builds successfully
- container starts successfully
- `GET /api/health` returns `{ ok: true, status: 'healthy' }`
- data directory is created on host
- backend tests still pass outside Docker

## Out Of Scope

This spec does not include:

- nginx reverse proxy
- HTTPS/Certbot
- Docker Swarm or Kubernetes
- multiple app replicas
- MySQL/Postgres/Redis
- object storage
- automated backup scheduler
- CI image publishing

These can be added later if deployment requirements grow.

## Acceptance Criteria

- `docker compose up -d --build` starts AdPlay on host port `3000`.
- App is reachable at `http://localhost:3000/admin` on the VPS.
- `/api/health` works from the host.
- SQLite and uploads persist under `./data`.
- `.env.docker` is not committed.
- Docker documentation explains start, stop, update, backup, and restore.
