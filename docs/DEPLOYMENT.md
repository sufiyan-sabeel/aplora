# Deployment (self-hosted, all-in-one)

> The published setup puts the frontends on GitHub Pages and the API elsewhere —
> see `GITHUB-PAGES-DEPLOYMENT.md` and `BACKEND-DEPLOYMENT.md`. This document
> covers running everything on one machine instead, which is simpler for a
> single-server install.

## Reference topology

```
Internet
   │  HTTPS
Reverse proxy (nginx or Caddy)
   ├── marketplace  → 127.0.0.1:4321
   ├── developer    → 127.0.0.1:4322
   ├── admin        → 127.0.0.1:4323
   └── /api         → 127.0.0.1:4000
                          │
                     Fastify API
                     ├── PostgreSQL
                     ├── object storage (local volume or MinIO/S3)
                     └── pg-boss queue → worker process
```

Serving all four on one hostname keeps the session cookie first-party. If you must
split hostnames, set `COOKIE_DOMAIN` to the shared parent domain and list each
origin in the API's CORS allowlist (it reads the three `PUBLIC_*_URL` values).

## Requirements

- Node.js 20.11+ (or Docker)
- PostgreSQL 16 with a dedicated database and user
- Persistent storage for APKs (a mounted volume, or S3/MinIO)
- A TLS certificate and a reverse proxy

## Steps

```bash
# 1. Code and dependencies
git clone <repository> /srv/aplora && cd /srv/aplora
npm install
npm run build

# 2. Configuration
cp .env.example .env
#    NODE_ENV=production
#    DATABASE_URL=postgresql://aplora:<password>@127.0.0.1:5432/aplora
#    SESSION_SECRET=$(openssl rand -hex 32)
#    COOKIE_SECURE=true
#    STORAGE_DRIVER=s3  (or local with STORAGE_LOCAL_ROOT=/var/lib/aplora/storage)
#    MAIL_TRANSPORT=smtp + SMTP_* values
#    PUBLIC_*_URL=https://your-domain

# 3. Database
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
npx tsx packages/database/prisma/seed.ts     # first administrator + taxonomy

# 4. Run the processes under a supervisor (systemd, pm2, Docker)
node services/api/dist/server.js
node services/worker/dist/index.js
node apps/marketplace/dist/server/entry.mjs   # PORT=4321
node apps/developer/dist/server/entry.mjs     # PORT=4322
node apps/admin/dist/server/entry.mjs         # PORT=4323
```

The API validates its environment at startup and refuses to run in production with
the example secret, insecure cookies, or an S3 driver without credentials.

## Docker Compose

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
docker compose --profile full up -d --build
docker compose exec api node -e "…"           # or run migrations from the host
docker compose logs -f worker
```

The `full` profile builds one image containing the whole monorepo and runs four
containers from it. PostgreSQL, MinIO and Mailpit come up alongside. Named volumes
keep database data, object storage and the local APK directory across restarts.

**Not verified in this repository's build environment:** Docker was unavailable
where this project was assembled, so the compose file and Dockerfile were written
and reviewed but not executed. The application itself was built and exercised
directly on Node 20 with PostgreSQL 16.

## systemd example

```ini
[Unit]
Description=Aplora API
After=network.target postgresql.service

[Service]
Type=simple
User=aplora
WorkingDirectory=/srv/aplora
EnvironmentFile=/srv/aplora/.env
ExecStart=/usr/bin/node services/api/dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Repeat for the worker and each portal with a different `ExecStart` and `PORT`.

## Health checks and monitoring

- `GET /health` — process is up (excluded from rate limiting)
- `GET /health/ready` — database reachable; returns `503` otherwise
- The worker logs one line per job; a stalled queue shows as versions stuck in
  `VALIDATING`. `SELECT count(*) FROM pgboss.job WHERE state = 'failed'` is the
  quickest check.
- Watch `submission_history` growth and the admin dashboard's pending count.

## Backups

```bash
./infrastructure/scripts/backup.sh /var/backups/aplora     # pg_dump | gzip, keeps 14
./infrastructure/scripts/restore.sh /var/backups/aplora/aplora-20260101T020000Z.sql.gz
```

Back up the database **and** the storage volume (or bucket) together — the database
records which object each version points at. Restore both before starting the API,
otherwise published versions will reference missing files (the download route
answers `404` rather than serving the wrong bytes).

Schedule the backup with cron:

```
15 2 * * * cd /srv/aplora && DATABASE_URL=... ./infrastructure/scripts/backup.sh /var/backups/aplora
```

## Upgrading

```bash
git pull
npm install
npm run build
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
systemctl restart aplora-api aplora-worker aplora-marketplace aplora-developer aplora-admin
```

Migrations are additive by design; take a backup first anyway.

## Costs

Nothing here requires a paid service. Running it in public does require hosting, a
domain, TLS and — for reliable email — an SMTP provider. Those are real costs and
are not free; keep them optional and separate from the application.
