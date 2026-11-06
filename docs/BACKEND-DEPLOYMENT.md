# Backend deployment

The API is not hosted by GitHub Pages and this repository does not deploy it
anywhere. Until you host it, the portals have no data — they say so plainly rather
than showing invented content.

## What has to run

| Component | Requirement | Free option |
| --- | --- | --- |
| Fastify API | Node 20, one process, HTTPS | Fly.io, Railway, Render, Koyeb free tiers |
| Background worker | Node 20, one process | Same host as the API |
| PostgreSQL 16 | Persistent disk, `pg_dump` access | Neon, Supabase (database only), Railway |
| Object storage | S3-compatible, or a mounted volume | Cloudflare R2, Backblaze B2, MinIO on your own VM |
| SMTP | Real email delivery | Brevo, Resend free tiers; Mailpit locally |

Hosting, a domain and TLS are real costs. Nothing in the code requires a paid
service, but a public deployment is not free.

## Required environment

```bash
NODE_ENV=production
API_PORT=4000
API_PUBLIC_URL=https://api.example.com

DATABASE_URL=postgresql://user:password@host:5432/aplora
SESSION_SECRET=<openssl rand -hex 32>
SESSION_TTL_HOURS=168

# Cross-site cookies (frontend on github.io, API on your domain):
COOKIE_SECURE=true
COOKIE_SAMESITE=none
COOKIE_DOMAIN=

# Same-site deployment instead (example.com + api.example.com):
# COOKIE_SECURE=true
# COOKIE_SAMESITE=lax

STORAGE_DRIVER=s3
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
STORAGE_BUCKET=aplora-storage
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_REGION=auto

# The three portals, used for the CORS allowlist:
PUBLIC_MARKETPLACE_URL=https://sufiyan-sabeel.github.io
PUBLIC_DEVELOPER_URL=https://sufiyan-sabeel.github.io
PUBLIC_ADMIN_URL=https://sufiyan-sabeel.github.io

MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM="Aplora <no-reply@example.com>"
```

The API validates this at startup and refuses to run in production with the
example secret, insecure cookies, `SameSite=None` without `Secure`, or an S3
driver without credentials.

## Deploying

```bash
npm ci
npx prisma generate --schema packages/database/prisma/schema.prisma
npm run build --workspace @aplora/api
npm run build --workspace @aplora/worker
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
npx tsx packages/database/prisma/seed.ts        # first admin + taxonomy

node services/api/dist/server.js                # port 4000
node services/worker/dist/index.js              # no port, polls PostgreSQL
```

Put TLS in front of the API (a managed platform does this for you). The API already
sends HSTS-friendly headers, a strict CORS allowlist and `credentials: true`.

## CORS

The allowlist is exactly the three `PUBLIC_*_URL` values. With a single Pages
origin, all three point at the same host; the browser sends the full origin
(`https://sufiyan-sabeel.github.io`) and that is what must be listed — no path, no
trailing slash.

Verify from a terminal:

```bash
curl -i -X OPTIONS https://api.example.com/api/v1/auth/me \
  -H "Origin: https://sufiyan-sabeel.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token"
```

Expect `access-control-allow-origin: https://sufiyan-sabeel.github.io` and
`access-control-allow-credentials: true`.

## Cookies across sites — read this before choosing a domain

The session cookie is HttpOnly. For the browser to send it from
`https://sufiyan-sabeel.github.io` to `https://api.example.com`, the cookie must be
`SameSite=None; Secure`, which makes it a **third-party cookie**.

What that means in practice:

- Chrome and Firefox allow it today, with `SameSite=None; Secure`.
- Safari's tracking prevention and Chrome's third-party cookie changes can block
  it. If the session does not stick on iOS Safari, that is why.
- No amount of frontend code fixes a blocked cookie.

**The robust arrangement** is to put the API on a subdomain of the same
registrable domain as the site (`aplora.example.com` + `api.example.com`) and keep
`SameSite=Lax`. GitHub Pages cannot host that combination, so a custom domain on
another host (Netlify, Cloudflare Pages, Vercel) is the alternative if you need
first-party cookies.

## Health and operations

- `GET https://api.example.com/health` — process is up
- `GET https://api.example.com/health/ready` — database reachable
- `SELECT count(*) FROM pgboss.job WHERE state = 'failed';` — stuck jobs
- Versions stuck in `VALIDATING` mean the worker is not running

Backups: `./infrastructure/scripts/backup.sh` (database) plus your bucket's own
versioning. Restore the database and the storage together.

## After the API is live

1. Set the repository variable `PUBLIC_API_BASE_URL` to
   `https://api.example.com/api/v1`.
2. Re-run the deploy workflow.
3. Open the marketplace, register a developer, publish an application and confirm
   the admin portal sees it. `npm run smoke` exercises the same path locally.
