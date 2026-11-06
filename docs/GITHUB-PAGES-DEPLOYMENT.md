# GitHub Pages deployment

Three portals, one static artifact, published at
`https://sufiyan-sabeel.github.io/aplora/`.

| Portal | URL | Source app |
| --- | --- | --- |
| Marketplace | https://sufiyan-sabeel.github.io/aplora/ | `apps/marketplace` |
| Developer portal | https://sufiyan-sabeel.github.io/aplora/developer/ | `apps/developer` |
| Admin portal | https://sufiyan-sabeel.github.io/aplora/admin/ | `apps/admin` |

## Why the frontends are static

GitHub Pages serves files. It cannot run Fastify, PostgreSQL, a worker or any
server-side rendering. So the three Astro apps build to static HTML and fetch
their data from the API **in the browser**. The backend in `services/api` is
unchanged and is deployed separately — see `BACKEND-DEPLOYMENT.md`.

## Build arrangement

Each app is built with its own `base`:

| App | `base` | Result |
| --- | --- | --- |
| marketplace | `/aplora/` | `dist/index.html`, `dist/apps/index.html`, … |
| developer | `/aplora/developer/` | `dist/developer/index.html`, … |
| admin | `/aplora/admin/` | `dist/admin/index.html`, … |

`npm run build:pages` builds all three and copies them into a single `dist/`:

```
dist/
├── .nojekyll                 keeps Jekyll from dropping _astro/
├── index.html                marketplace home
├── 404.html                  GitHub Pages error page
├── apps/index.html           catalogue
├── app/index.html            application detail  (?slug=)
├── search/index.html         search             (?q=)
├── categories/index.html     categories
├── category/index.html       category listing   (?slug=)
├── login/, register/, profile/, mfa-setup/, …
├── _astro/                   hashed CSS and JS
├── developer/                developer portal (own _astro/)
└── admin/                    admin portal (own _astro/)
```

### Routing without a server

GitHub Pages has no rewrite rules, so **every route is a real file**. Anything
that would need a dynamic path segment uses a query parameter instead:

| Intent | URL |
| --- | --- |
| Application detail | `/aplora/app/?slug=nimbus-notes` |
| Category | `/aplora/category/?slug=productivity` |
| Collection | `/aplora/collection/?slug=editors-picks` |
| Search | `/aplora/search/?q=notes` |
| Developer: manage app | `/aplora/developer/app/?id=<uuid>` |
| Admin: review submission | `/aplora/admin/submission/?id=<uuid>` |

Every one of those URLs is a pre-built HTML file, so direct navigation, refresh
and shared links all work. Unknown paths get `404.html`.

## Workflow

`.github/workflows/deploy.yml` runs on pushes to `main` and on manual dispatch:

1. Check out, install Node 20, `npm ci`.
2. `prisma generate`, then `npm run typecheck` (TypeScript and `astro check`).
3. Build the API and worker bundles (they are part of the repository, even though
   Pages does not host them).
4. `npm run build:pages` with `PUBLIC_API_BASE_URL` from repository variables.
5. `node infrastructure/scripts/verify-pages.mjs` — checks that every portal entry
   point exists, that every internal link and asset resolves, and that no secret
   leaked into the artifact.
6. `actions/upload-pages-artifact@v3`, then `actions/deploy-pages@v4`.

Permissions are `contents: read`, `pages: write`, `id-token: write`; the `pages`
concurrency group cancels superseded runs.

## One-time repository setting

Pages must be told to deploy from Actions:

**Repository → Settings → Pages → Build and deployment → Source → GitHub Actions**

If the connected GitHub integration cannot change repository settings, this is the
only manual step left. Without it the workflow still builds and uploads the
artifact, but no deployment happens.

## Configuration variable

Set the API address once, as a repository variable (not a secret — it ships in the
browser bundle):

**Settings → Secrets and variables → Actions → Variables → New repository variable**

```
PUBLIC_API_BASE_URL = https://api.example.com/api/v1
```

Then re-run the workflow. With no variable set, the build still succeeds and every
portal shows a clear "the API is not configured" panel instead of inventing data.

## Local verification

```bash
npm run build:pages
node infrastructure/scripts/verify-pages.mjs
npm run serve:pages          # http://localhost:8080/aplora/
```

`serve-pages.mjs` mimics GitHub Pages: it serves only under `/aplora/`, resolves
directory indexes, and returns `404.html` for unknown paths — no SPA fallback.

To point a local build at a local API:

```bash
PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 npm run build:pages
npm run serve:pages
```

## What was verified here

- `npm run build:pages` produces 97 files and 18 hashed assets; every HTML page,
  internal link and asset reference resolves (44 HTML files, 70 references).
- The artifact contains no secrets (scanned for session secrets, database URLs,
  storage keys, private keys and the seeded development password).
- Every built JavaScript file parses.
- All three portals serve and render their shells from `/aplora/`,
  `/aplora/developer/` and `/aplora/admin/`, and unknown paths return `404.html`.
- The API contract the portals use is exercised end to end by `npm run smoke`
  (CORS preflight, cookie session, CSRF header, upload, worker, approval,
  download with checksum).

Not verified: rendering inside a real browser, because no browser is available in
this environment. The pages are static shells whose behaviour lives in the bundled
JavaScript; that code is type-checked, parsed and driven at the HTTP level, but a
human should open the deployed URLs once.
