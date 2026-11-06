# Database

PostgreSQL 16 with Prisma. Migrations are checked into
`packages/database/prisma/migrations` and applied with `prisma migrate deploy`.

## Models

| Model | Purpose |
| --- | --- |
| `User` | Accounts for all three roles, plus administrators |
| `DeveloperProfile` | Public developer identity, one per developer account |
| `Session` | Server-side sessions; the token is stored only as a SHA-256 hash |
| `EmailVerificationToken` / `PasswordResetToken` | Single-use, hashed, time-limited |
| `Category` | Catalogue taxonomy |
| `App` | A listing: slug, package name, descriptions, status |
| `AppVersion` | One release: version name/code, SDK levels, checksum, certificate, state |
| `AppFile` | The stored APK for a version: storage key, size, SHA-256, scan result |
| `AppAsset` | Icon, screenshots and feature graphics |
| `Review` | One review per user per app, 1–5 stars, moderatable |
| `Collection` / `CollectionApp` | Editorial groupings |
| `DownloadEvent` | One row per real download; the only source of download statistics |
| `Report` | User reports against a listing |
| `SubmissionHistory` | Append-only version transitions with actor and note |
| `AuditLog` | Append-only administrative actions |
| `Setting` | Small key/value platform configuration |

## Rules the schema enforces

- UUID primary keys everywhere; UTC timestamps everywhere.
- Unique `App.packageName`, `App.slug`, `DeveloperProfile.slug`, `Category.slug`,
  `Collection.slug`, `User.email`.
- Unique `(appId, versionCode)` — a version code can exist once per application.
- Unique `(appId, userId)` on reviews — one review per user per app.
- `Review.rating` is constrained to 1–5 by a check constraint.
- `AppVersion.versionCode > 0` and `AppFile.size > 0` by check constraints.
- A trigger refuses any `UPDATE` or `DELETE` on `audit_logs`, so administrative
  history cannot be rewritten even with direct SQL access.
- A trigger refuses a `download_events` row whose version does not belong to the
  app it names.
- Deleting a user cascades to their sessions and tokens; deleting a developer
  cascades to their listings; deleting a listing cascades to its versions, files,
  assets, reviews and download events.

## Indexes

Beyond the foreign-key indexes Prisma creates:

- `apps(status, published_at)` and `apps(category_id, status)` for the catalogue
- `apps` GIN index over `to_tsvector('english', name || short_description ||
  full_description || package_name)` for full-text search
- `users(lower(email))` for case-insensitive login lookups
- `reviews(app_id, status)` for public review lists
- `download_events(app_id, created_at)` for analytics windows
- `sessions(expires_at)` for expiry sweeps

## Migrations

```
packages/database/prisma/migrations/
  20261106153357_init/                 tables, enums, indexes, foreign keys
  20261106154000_constraints_indexes/  check constraints, triggers, search index
```

```bash
npm run db:migrate     # create and apply a new migration while developing
npm run db:deploy      # apply existing migrations (CI, production)
npm run db:reset       # drop, recreate, migrate and seed
```

The second migration contains SQL Prisma's schema language cannot express
(triggers, check constraints, the functional GIN index). When you add a model,
`prisma migrate dev` will not try to drop them, but review the generated SQL before
committing it.

## Transactions and integrity

Anything that changes several rows together runs in a transaction: publishing a
version (state, file key, app status), password reset (password, token use,
session revocation), collection reordering. A version's APK is never replaced in
place: a new build is a new `AppVersion` row with its own `AppFile`.
