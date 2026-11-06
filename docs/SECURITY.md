# Security

This document describes what is implemented, how it is tested, and — deliberately
— what is not implemented. A marketplace that overstates its security is worse
than one that documents its limits.

## Authentication

- **Passwords** are hashed with Argon2id (`m=19456 KiB, t=2, p=1`) from
  `@node-rs/argon2`. The plaintext is never logged or stored.
- **Sessions** are server-side rows. The cookie holds a 32-byte random token; the
  database stores only `sha256(token)`, so a database leak cannot be replayed.
  Cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when
  `COOKIE_SECURE=true` (the API refuses to start in production with it off).
- **Sessions expire** after `SESSION_TTL_HOURS` (168 by default). Logout, password
  change and password reset revoke sessions; suspension revokes all of them.
- **Account enumeration** is avoided: login returns the same message for an
  unknown email and a wrong password, and does the same Argon2 work either way.
  Password reset always answers identically.
- **Email verification** uses a 32-byte token, stored hashed, single use, valid for
  24 hours. Password reset tokens are valid for one hour.
- **Two-factor** is RFC 6238 TOTP (SHA-1, 6 digits, 30-second step, ±1 step of
  drift). Administrators must enable it before the admin API answers; disabling it
  is refused for administrator roles.
- **Rate limits**: 600/min per IP globally, 10/min on login, 8/hour on
  registration, 5/15 min on password reset requests.

## Authorisation

- Role checks happen on the server (`requireRole`, `requireAdmin`); the frontends
  only hide controls, they never decide access.
- Developer endpoints derive the developer profile from the session and answer
  **404** for another developer's resources rather than 403, so the API does not
  confirm that a listing exists.
- Admin endpoints require a role *and* an enabled second factor *and* a session
  that has completed the second factor.
- Ownership is re-checked on every write: listing fields, assets, versions,
  submissions, reviews.

## CSRF

Every mutating request authenticated by a cookie must carry `x-csrf-token` matching
the token stored on the session row. The static portals obtain that token from the
`/auth/me` response body and keep it in memory — never `localStorage`, never a
cookie JavaScript can read — then send it as a header. A cross-site attacker can
make the browser send the cookie but cannot read the token, so the write fails.
`services/api/test/security.test.ts` asserts the 403.

Because the frontends are static, the API must also be reachable cross-origin.
CORS is an allowlist of the three configured portal origins with
`credentials: true`; any other origin gets no `Access-Control-Allow-Origin`.

## Cookies and cross-site hosting

- `COOKIE_SAMESITE=lax` (default) for same-site deployments.
- `COOKIE_SAMESITE=none` for a frontend on another site, such as GitHub Pages. The
  API refuses to start with `none` unless `COOKIE_SECURE=true`, because browsers
  reject that combination.
- A `SameSite=None` cookie is a third-party cookie. Some browsers block those; see
  `BACKEND-DEPLOYMENT.md` for the same-site alternative. This is a real limitation
  of hosting the frontend and API on unrelated domains.

## Uploads and distribution

- Uploads are validated on the bytes: size cap, ZIP signature, central-directory
  integrity, bounded inflate (decompression-bomb guard), duplicate-entry detection,
  path traversal detection, `AndroidManifest.xml` presence and parse, package name
  pattern, version code, DEX presence.
- The manifest is authoritative. A submission whose APK disagrees with the declared
  version name or code is quarantined.
- The **signing certificate** is read from the APK Signing Block (scheme v2/v3) or
  the JAR signature (v1), and its SHA-256 is pinned: a new release signed with a
  different certificate is quarantined.
- Uploaded APKs are stored under `quarantine/` and are not reachable by any route.
  Only after approval is the file copied to `published/` and the version made
  downloadable. The published object is immutable.
- Download URLs are HMAC-signed, single-purpose and expire after two minutes. The
  download route re-checks application status, version status and scan status at
  delivery time, so suspension invalidates links already issued.
- Filenames and browser-supplied MIME types are never trusted.

## Data protection

- The API returns 404/401/403 envelopes without stack traces; unexpected errors
  are logged server-side with the request id only.
- Prisma parameterises all queries. The one raw SQL path (full-text search) uses
  `Prisma.sql` tagged templates with bound parameters, and a test submits a SQL
  injection payload to confirm the table survives.
- Cookies and CSRF headers are redacted from logs.
- Administrative actions are written to `audit_logs`, which a database trigger makes
  append-only.
- Secrets live in `.env` (never committed) and are validated at startup; production
  refuses the example secret and insecure cookies.

## What is NOT implemented

Be aware of these before relying on the platform in a high-risk setting:

1. **APK signature cryptography is not re-verified.** The certificate is extracted
   and its fingerprint pinned across releases, which catches a changed signing key
   — but a forged signature block carrying a stolen certificate would not be
   detected by this code. Full APK Signature Scheme v2 verification (digest
   computation over the archive, signature check against the certificate's public
   key) is the next step. Treat "signed" here as "signed by a consistent
   certificate", not "cryptographically proven".
2. **Malware scanning is heuristic.** Static analysis looks at permissions,
   duplicate entries, compression ratio, native libraries and certificate validity,
   and can additionally call a local ClamAV daemon. ClamAV catches known signatures
   only. A clean scan never proves an application is safe, which is why listings can
   be suspended and downloads can be revoked.
3. **Rate limiting is in-process.** With more than one API instance each keeps its
   own counters; use the Redis store for `@fastify/rate-limit` when scaling out.
4. **No recovery codes for TOTP.** A lost authenticator means an administrator must
   reset the account directly in the database.
5. **Uploads are buffered in memory** (bounded by `MAX_APK_SIZE_MB`, default 200).
   Concurrent large uploads are memory-bound; stream to storage at scale.
6. **No virus-total-style multi-engine scanning**, no reputation service, no
   content moderation of screenshots or descriptions beyond human review.
7. **Email delivery depends on your SMTP provider.** The default console transport
   prints messages to the log; Mailpit is provided for local development.

## Tests that back these claims

`services/api/test/` runs 62 integration tests against a real PostgreSQL database:

- `auth.test.ts` — hashing, sessions, logout, revocation, reset, verification, TOTP
- `authorization.test.ts` — unauthenticated access, role separation, MFA requirement
  for admins, cross-developer access, audit-log immutability
- `security.test.ts` — headers, CORS allowlist, CSRF enforcement, rate limiting, no
  secret leakage, SQL injection survival, validation errors
- `infrastructure/scripts/verify-pages.mjs` — scans the published artifact for
  session secrets, database URLs, storage keys and private keys before deployment
- `submission.test.ts` — quarantine, package/version/certificate mismatches,
  unsigned APKs, oversized uploads, approval, rejection, suspension, audit records
- `catalog.test.ts` — unpublished apps hidden, search, pagination, reviews, reports
- `queue.test.ts` — a real pg-boss job appears in PostgreSQL on submission
