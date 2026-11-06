# Frontend environment

The portals are static builds. Everything they know about the backend is baked in
at build time, so there is exactly one setting and it is public.

## Variables

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `PUBLIC_API_BASE_URL` | yes (otherwise no data) | `https://api.example.com/api/v1` | Absolute base URL of the API, including `/api/v1` |
| `PUBLIC_BUILD_TIME` | no | ISO timestamp | Displayed in build notes if you want it |

Astro only inlines variables prefixed with `PUBLIC_` into browser code. Everything
here ends up in the JavaScript bundle and is readable by anyone who visits the
site. Treat it as public.

## What must never appear in a frontend variable

- `SESSION_SECRET`, `DATABASE_URL`, any PostgreSQL credential
- `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, S3 credentials
- SMTP credentials, API keys, administrator passwords

The API reads those from its own environment. `infrastructure/scripts/verify-pages.mjs`
scans the built artifact for these patterns and fails the workflow if one appears.

## Setting it

GitHub Actions, from a repository variable:

```
Settings → Secrets and variables → Actions → Variables → PUBLIC_API_BASE_URL
```

The workflow passes `vars.PUBLIC_API_BASE_URL` into `npm run build:pages`. Because
it is a variable rather than a secret, it is visible in the workflow file and the
build logs — which is correct for a public URL.

Locally:

```bash
cp .env.example .env                     # optional, for the API side
PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 npm run build:pages
npm run serve:pages                      # http://localhost:8080/aplora/
```

`.env` values are not used by the frontend build; pass the variable inline or
export it. (Astro does read `.env` files for `PUBLIC_*` values, so putting it there
also works.)

## When it is missing

`config.isConfigured` is false, the header shows a warning banner, and every data
view renders:

> **The API is not configured** — This build was published without
> PUBLIC_API_BASE_URL, so there is no backend to talk to.

No placeholder applications, reviews or statistics are ever shown.

## Session and CSRF across origins

The API sets an HttpOnly session cookie on its own origin. The portals call it with
`credentials: "include"`, so the browser sends that cookie on cross-site requests.
Two consequences:

1. The API must allow the Pages origin in CORS, with credentials. It reads
   `PUBLIC_MARKETPLACE_URL`, `PUBLIC_DEVELOPER_URL` and `PUBLIC_ADMIN_URL` for
   that allowlist.
2. JavaScript cannot read the HttpOnly cookie, so the CSRF token is taken from the
   `/auth/me` response body and held in memory — never `localStorage`, never a
   cookie the page can read. It is sent as `x-csrf-token` on every write.

If the frontend and API are on different sites (github.io and your API domain),
the cookie needs `SameSite=None; Secure`. See `BACKEND-DEPLOYMENT.md`; browsers
that block third-party cookies will refuse the session in that arrangement, which
is a deployment constraint, not something the frontend can work around.

## Termux

```bash
pkg update && pkg install nodejs-lts git
git clone https://github.com/sufiyan-sabeel/aplora
cd aplora
npm install
npm run typecheck
PUBLIC_API_BASE_URL=https://api.example.com/api/v1 npm run build:pages
node infrastructure/scripts/verify-pages.mjs
node infrastructure/scripts/serve-pages.mjs   # http://localhost:8080/aplora/
```
