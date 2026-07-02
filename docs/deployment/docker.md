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