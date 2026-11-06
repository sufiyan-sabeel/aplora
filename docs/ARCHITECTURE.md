# Architecture

## Shape

```
GitHub Pages (static)                     Your server
  ├─ /aplora/            marketplace  ─┐
  ├─ /aplora/developer/  developer    ─┼─ fetch + cookies ──► API (Fastify) ──► PostgreSQL
  └─ /aplora/admin/      admin        ─┘                         │
                                                                ├─► storage (S3 or volume)
                                                                └─► pg-boss queue
                                                                        │
                                                                 worker process
                                                                 (validate → scan)
```

The three portals are Astro applications built with static output. Each page is
pre-rendered HTML with a bundled script that fetches its data from the API in the
browser. GitHub Pages only serves files, so there is no server-side rendering, no
rewrite rule and no fallback: every route is a real file, and dynamic entities are
addressed by query parameter.

## Request flow for a form

1. The page renders a static shell and the view module mounts into `#view`.
2. On load, `loadSession()` calls `/auth/me` with `credentials: "include"`; the
   response body carries the CSRF token, which is kept in memory.
3. Submitting a form calls the API directly with `fetch`, sending the session
   cookie (browser-managed, HttpOnly) and `x-csrf-token`.
4. The API validates, performs the change and answers with `Set-Cookie` when the
   session changes. The browser stores it; page JavaScript never sees it.
5. The view re-renders from the API response, or shows the API's error message.

Uploads use `FormData` with the same credentials and header. Nothing is proxied:
the static frontend talks to the API itself, which is why CORS and the cookie
`SameSite` policy matter (see `BACKEND-DEPLOYMENT.md`).

## Packages

| Package | Responsibility |
| --- | --- |
| `@aplora/database` | Prisma schema, migrations, a single client instance |
| `@aplora/auth` | Argon2id hashing, token generation and hashing, TOTP |
| `@aplora/storage` | `StorageAdapter` interface, local and S3 implementations, key namespaces |
| `@aplora/apk` | ZIP reader, binary XML parser, manifest reader, signing certificate extraction, scanner |
| `@aplora/publishing` | Version state machine, validation, scanning, publishing |
| `@aplora/validation` | Zod schemas shared by API and portals |
| `@aplora/shared-types` | API contract types used by both sides |
| `@aplora/ui` | Design system CSS, Astro components, formatting helpers, API client |

Workspace packages export TypeScript source. Astro/Vite and `tsx` consume it
directly; the API and worker are bundled with `tsup` for production, so no
separate package build step exists.

## Publishing pipeline

```
DRAFT ──upload──► UPLOADED ──submit──► VALIDATING ──validate──► SCANNING
                                                                   │
                                            scan clean ────────────┤
                                                                   ▼
                                                            PENDING_REVIEW
                                                              │         │
                                                     approve  │         │ reject
                                                              ▼         ▼
                                                          APPROVED    REJECTED
                                                              │            │
                                                          PUBLISHED    (resubmit)
```

Invalid archives, package mismatches, version mismatches, duplicate version codes
and certificate changes go to `QUARANTINED` with a readable reason. A failed or
infected scan goes to `FLAGGED` (infected) or `QUARANTINED` (scanner error).

Every transition is written to `submission_history` with the actor, so the review
timeline on the admin page is real history rather than reconstructed state.

The state machine lives in `packages/publishing/src/transitions.ts` and rejects any
move that is not in the table, so a version can never jump from `DRAFT` to
`PUBLISHED`.

## Why the worker is separate

APK validation and scanning are CPU-bound and slow (up to 200 MB of archive work).
Doing that inside the HTTP request would tie up the API and time out. The API only
enqueues a job; `services/worker` claims it from pg-boss and does the work. Jobs
survive restarts because they live in PostgreSQL — no Redis is needed.

## Storage layout

```
quarantine/<versionId>/<package>.apk     uploaded, not yet approved
published/<appId>/<versionId>/<package>-<versionCode>.apk   approved and served
assets/<appId>/<assetId>-<icon|screenshot>.png              public images
```

Quarantined objects are never served by any route. `POST /apps/:slug/download`
issues a signed URL valid for two minutes; the download route re-checks the app
and version state at delivery time, so suspending an application invalidates links
that were already handed out.

## Frontend structure

- `packages/client` — the browser runtime shared by all three portals: API client
  (credentials + CSRF), session helpers, formatters, UI components as HTML
  strings, and `mount()` which renders loading, error and empty states.
- `packages/ui` — the design system CSS and the `SiteShell` layout.
- `apps/*/src/views/*.ts` — one module per screen; each fetches, renders and wires
  its own controls.
- `apps/*/src/pages/*.astro` — thin static shells: layout plus a script that calls
  `bootstrap(view)`.

Every data view goes through `mount()`, so loading, empty and error behaviour is
consistent, and an unreachable or unconfigured API produces a readable panel
rather than a blank page.
