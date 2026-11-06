# Aplora

**Discover. Explore. Install.** An independent Android application marketplace:
a public marketplace, a developer portal, an admin portal and one backend, all
connected to the same PostgreSQL database.

Created by Umaiz Sufiyan.

The three portals are **static** and deploy to GitHub Pages; the API is a separate
service you host yourself.

| Deployed | URL |
| --- | --- |
| Marketplace | https://sufiyan-sabeel.github.io/aplora/ |
| Developer portal | https://sufiyan-sabeel.github.io/aplora/developer/ |
| Admin portal | https://sufiyan-sabeel.github.io/aplora/admin/ |

```
apps/marketplace    http://localhost:4321   public catalogue, search, reviews, downloads
apps/developer      http://localhost:4322   listings, APK uploads, submissions, analytics
apps/admin          http://localhost:4323   moderation, users, taxonomy, audit log
services/api        http://localhost:4000   REST API (/api/v1), sessions, uploads
services/worker                             pg-boss worker: APK validation and scanning
packages/*                                  database, auth, storage, apk inspection, client runtime, UI
```

The portals have no server side: they are pre-rendered HTML that fetches from the
API in the browser. GitHub Pages serves files and nothing else, so anything that
would be a dynamic path segment is a query parameter instead
(`/aplora/app/?slug=northwind`).

## What it actually does

A developer registers, creates a listing, uploads a signed APK and submits it.
The upload lands in quarantine. A background worker inspects the archive
(manifest identity, package name, version, signing certificate, zip integrity),
runs a malware scan, and only a clean result moves the version into the review
queue. An administrator approves it, the file moves out of quarantine into the
published area, and the application becomes discoverable and downloadable.
Downloads are counted from real recorded events — nothing on the site is
fabricated.

## Technology

| Layer | Choice |
| --- | --- |
| Frontends | Astro 5 (static output), TypeScript, a shared CSS design system, Lucide icons |
| API | Node.js 20, Fastify 4, TypeScript, Zod validation |
| Database | PostgreSQL 16, Prisma 5 with SQL migrations |
| Auth | Self-hosted: Argon2id, server-side sessions in PostgreSQL, HttpOnly cookies, CSRF tokens, TOTP two-factor |
| Files | Local filesystem or any S3-compatible service (MinIO included), behind an adapter |
| Jobs | pg-boss (PostgreSQL-backed — no Redis required) |
| Tests | Vitest: 62 API integration tests, plus an end-to-end platform check |

No paid service is required to run any of it.

## Prerequisites

- Node.js 20.11 or newer
- PostgreSQL 16 (Docker Compose provides one)
- Optional: Docker, for PostgreSQL/MinIO/Mailpit

## Installation

```bash
git clone <your-repository> aplora
cd aplora
npm install                     # installs every workspace

cp .env.example .env            # then edit SESSION_SECRET and DATABASE_URL
openssl rand -hex 32            # paste the output into SESSION_SECRET
```

`SESSION_SECRET` signs sessions, CSRF tokens and download links. In production the
API refuses to start with the example value or with `COOKIE_SECURE=false`.

## Database

```bash
docker compose up -d postgres   # or point DATABASE_URL at your own server
npm run db:deploy               # apply migrations (use db:migrate while developing)
npm run db:seed                 # categories, collections, settings, first admin
```

The seed prints the administrator credentials it creates
(`admin@aplora.local` / `ChangeMe12345!` unless you set `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD`). Change the password after signing in. Administrator
accounts must enable two-factor authentication before the admin API answers.

## Running everything

```bash
npm run dev
```

That is the single documented command. It copies `.env.example` when needed,
brings up PostgreSQL/MinIO/Mailpit with Docker if `DATABASE_URL` is unset, applies
migrations, seeds reference data and runs the API, the worker and the three
portals together. Set `SKIP_DOCKER=1` to skip Docker entirely.

Fixed ports: marketplace 4321, developer 4322, admin 4323, API 4000, PostgreSQL 5432.

The portals call the API from the browser, so a local run needs
`PUBLIC_API_BASE_URL=http://localhost:4000/api/v1` at build time:

```bash
PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 npm run build:pages
npm run serve:pages          # http://localhost:8080/aplora/
```

## Deploying the frontends

```bash
npm run build:pages          # builds all three portals into dist/
node infrastructure/scripts/verify-pages.mjs
```

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds, verifies and
deploys `dist/` to GitHub Pages. The only repository setting required is
**Settings → Pages → Source → GitHub Actions**. Details:
`docs/GITHUB-PAGES-DEPLOYMENT.md`.

## Deploying the backend

The API, worker, PostgreSQL and storage are not hosted by Pages. See
`docs/BACKEND-DEPLOYMENT.md` for the required environment, CORS and cookie
configuration (including why a cross-site deployment needs
`COOKIE_SAMESITE=none` and what that costs in browser support).

## Trying the full journey

```bash
npx tsx infrastructure/scripts/make-demo-apk.ts com.example.demo 1.0.0 1
```

That writes a structurally valid, self-signed APK. Then, in a browser:

1. Developer portal → create an account → create a listing → upload the APK →
   submit it.
2. Admin portal → sign in → set up two-factor when prompted → review the
   submission → approve.
3. Marketplace → the application is listed, searchable and downloadable.

Or run the whole sequence unattended:

```bash
npm run smoke
```

## Tests

```bash
npm test          # 62 API integration tests (needs a PostgreSQL database)
npm run verify    # typecheck every package, build everything, run the tests
npm run smoke     # end-to-end contract check: API + worker, browser-style requests
```

The test suite uses `TEST_DATABASE_URL` (default
`postgresql://aplora@127.0.0.1:5432/aplora_test`); create and migrate it with:

```bash
createdb aplora_test
DATABASE_URL=postgresql://aplora@127.0.0.1:5432/aplora_test npm run db:deploy
```

## Production build

```bash
npm run build     # API and worker bundles, plus the three Astro servers
npm start         # or: node services/api/dist/server.js
```

Each app has its own `dist/`; run them under a process manager or with
`docker compose --profile full up -d --build`. See `docs/DEPLOYMENT.md`.

## Documentation

- `docs/GITHUB-PAGES-DEPLOYMENT.md` — the static build, artifact and workflow
- `docs/FRONTEND-ENVIRONMENT.md` — the one public variable, and what must never leak
- `docs/BACKEND-DEPLOYMENT.md` — hosting the API, CORS and cookie requirements
- `docs/ARCHITECTURE.md` — how the pieces fit together
- `docs/DATABASE.md` — models, constraints, migrations
- `docs/API.md` — every endpoint
- `docs/SECURITY.md` — controls, threat model, and what is *not* implemented
- `docs/DEPLOYMENT.md` — running it for real, backups, reverse proxy

## Known limitations

Stated plainly, because the alternative is a marketplace that lies about itself:

- **No backend is deployed.** The Pages build has no API URL until you set the
  `PUBLIC_API_BASE_URL` repository variable and host the API. Until then every
  portal shows an "API is not configured" panel — no invented data.
- **Cross-site cookies.** With the frontend on `github.io` and the API elsewhere,
  the session cookie is a third-party cookie (`SameSite=None; Secure`). Some
  browsers block those; a same-site subdomain pair avoids it.
- **GitHub Pages routing.** There is no server-side fallback, so dynamic entities
  are addressed by query parameter rather than a path segment.

- APK **signature identity** is verified (the certificate is read and pinned
  across releases); the cryptographic signature over the archive is **not**
  re-verified. See `docs/SECURITY.md`.
- Malware scanning is static analysis plus an optional ClamAV daemon. A clean
  result is evidence, not proof, which is why applications can be suspended.
- Uploads are buffered in memory, bounded by `MAX_APK_SIZE_MB`. Streaming is the
  right move at scale.
- ZIP64 archives are rejected; APKs are far below that limit.
- Rate limiting is per-process memory. Multiple API instances need a shared store.
- TOTP two-factor has no recovery codes yet; an administrator must reset the
  account.
