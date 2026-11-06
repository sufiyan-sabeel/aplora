# API

Base URL: `/api/v1` on port 4000. All responses are JSON. Errors use one envelope:

```json
{ "error": { "code": "validation_failed", "message": "Some fields need attention",
             "details": [{ "path": "email", "message": "Enter a valid email address" }],
             "requestId": "6f2a…" } }
```

Authentication is a session cookie (`aplora_session`, HttpOnly). Every state
changing request made with that cookie must also send `x-csrf-token`, whose value
is in the readable `aplora_csrf` cookie (double-submit pattern). Requests without
it are refused with `403 csrf_failed`.

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/apps` | `page`, `pageSize` (≤50), `sort` (`recent`/`popular`/`rating`/`name`), `category`, `developer`, `featured=true` |
| GET | `/apps/:slug` | Full detail, published versions only |
| GET | `/apps/:slug/versions` | Published versions with checksums |
| GET | `/apps/:slug/reviews` | Visible reviews, paginated |
| GET | `/search` | `q`, `category`, `page`, `pageSize`; PostgreSQL full-text with an ILIKE fallback |
| GET | `/categories` | Active categories with published app counts |
| GET | `/categories/:slug/apps` | Apps in a category |
| GET | `/collections` | Active collections |
| GET | `/collections/:slug` | Collection with its published apps |
| GET | `/assets/:id/file` | Icons and screenshots |
| POST | `/apps/:slug/download` | Records a download and returns a two-minute signed URL |
| GET | `/downloads/:token` | Streams the APK with `X-Checksum-Sha256` |

## Authentication

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `email`, `password`, `displayName`, optional `accountType: DEVELOPER` |
| POST | `/auth/login` | Returns `202 { mfaRequired: true }` when a second factor is needed |
| POST | `/auth/login/mfa` | Completes a pending sign-in with a TOTP code |
| POST | `/auth/logout` | Revokes the session |
| GET | `/auth/me` | Current user, CSRF token, `mfaRequired` |
| POST | `/auth/verify-email` | `token` from the email |
| POST | `/auth/verify-email/resend` | Sends a fresh link (authenticated) |
| POST | `/auth/password/forgot` | Always the same answer, to prevent account enumeration |
| POST | `/auth/password/reset` | `token`, `password`; revokes all sessions |
| POST | `/auth/password/change` | Requires the current password |
| GET | `/auth/sessions` | Active sessions for the current user |
| DELETE | `/auth/sessions/:id` | Revokes one session |
| POST | `/auth/mfa/setup` | Issues a TOTP secret (not active until confirmed) |
| POST | `/auth/mfa/enable` | `secret`, `code` |
| POST | `/auth/mfa/disable` | `password`; refused for administrators |

## Developer (role `DEVELOPER`, `ADMIN` or `SUPER_ADMIN`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/developer/profile` | Includes app and download totals |
| PATCH | `/developer/profile` | Display name, website, support email, description |
| GET | `/developer/apps` | The caller's listings only |
| POST | `/developer/apps` | Creates a listing; duplicate package names are `409` |
| GET | `/developer/apps/:id` | 404 when the app belongs to someone else |
| PATCH | `/developer/apps/:id` | Listing fields |
| POST | `/developer/apps/:id/assets` | `multipart/form-data` image upload |
| DELETE | `/developer/apps/:id/assets/:assetId` | Removes an image |
| POST | `/developer/apps/:id/versions` | `multipart/form-data` APK upload into quarantine |
| POST | `/developer/versions/:id/submit` | Queues validation and scanning; `202` |
| GET | `/developer/submissions` | Versions that entered review |
| GET | `/developer/analytics` | Totals, per-app and a 30-day daily series from real events |

## User

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/apps/:slug/reviews` | Verified email required; one review per app |
| PATCH | `/reviews/:id` | Author only |
| DELETE | `/reviews/:id` | Author only |
| POST | `/apps/:slug/reports` | Verified email required |

## Admin (role `ADMIN` or `SUPER_ADMIN`, MFA enabled)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/dashboard` | Counts computed from the database |
| GET | `/admin/users`, PATCH `/admin/users/:id` | Suspend, restore, change role |
| GET | `/admin/developers` | Developer accounts with app counts |
| GET | `/admin/apps` | Filter by status, search by name or package |
| POST | `/admin/apps/:id/suspend`, `/restore` | Suspension stops downloads immediately |
| GET | `/admin/submissions`, `/admin/submissions/:id` | Queue and full review detail |
| POST | `/admin/submissions/:id/approve` | Publishes; requires a clean scan |
| POST | `/admin/submissions/:id/reject` | Requires a reason |
| GET | `/admin/reports`, PATCH `/admin/reports/:id` | Resolve user reports |
| GET | `/admin/reviews`, PATCH `/admin/reviews/:id` | Visible, hidden, removed |
| GET/POST/PATCH | `/admin/categories` | Taxonomy management |
| GET/POST/PATCH | `/admin/collections` | Editorial collections |
| GET | `/admin/audit-logs` | Append-only administrative history |
| GET/PUT | `/admin/settings` | Key/value platform settings |

## Operational

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness; not rate limited |
| GET | `/health/ready` | Database check; `503` when the database is unreachable |

Every response carries `X-Request-Id`. Rate limits: 600 requests per minute per IP
globally, 10 per minute on login, 8 per hour on registration, 5 per 15 minutes on
password reset requests.
