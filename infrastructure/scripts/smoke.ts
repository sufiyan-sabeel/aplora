/**
 * End-to-end check of the API contract the static portals rely on.
 *
 * The portals run in the browser on GitHub Pages and talk to the API directly,
 * so this script behaves like that browser: it sends an Origin header, keeps a
 * cookie jar, reads the CSRF token from /auth/me and sends it back on writes.
 *
 * It starts the API and the worker, then walks the whole publishing journey:
 * developer registers → creates a listing → uploads an APK → submits → the worker
 * validates and scans → administrator approves with TOTP → the app is public and
 * downloadable, and the downloaded bytes match the published checksum.
 *
 *   npm run smoke
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { buildApkFixture } from "@aplora/apk/testing";
import { generateTotpSecret, hashPassword, totpCode } from "@aplora/auth";
import { config as loadDotenv } from "dotenv";
import { prisma } from "@aplora/database";

loadDotenv();

const ROOT = process.cwd();
const API = "http://localhost:4000";
const API_BASE = `${API}/api/v1`;
const PAGES_ORIGIN = "http://localhost:8080";

const children: ChildProcess[] = [];
const log = (message: string) => console.log(`  ${message}`);
const fail = (message: string): never => {
  throw new Error(message);
};

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function start(name: string, command: string, args: string[], cwd: string): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (/error/i.test(text)) process.stderr.write(`[${name}] ${text}`);
  });
  children.push(child);
  return child;
}

async function waitFor(url: string, label: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await delay(400);
  }
  fail(`${label} did not start within ${timeoutMs}ms`);
}

/** Cookie jar with the semantics a browser applies to Set-Cookie. */
class Jar {
  private cookies = new Map<string, string>();

  absorb(headers: Record<string, string | string[] | undefined>): void {
    const raw = headers["set-cookie"];
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const entry of list) {
      const [pair] = entry.split(";");
      const index = pair!.indexOf("=");
      if (index <= 0) continue;
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

interface ApiResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Performs a request the way the browser does, with Origin and cookies. */
function call(
  path: string,
  options: {
    method?: string;
    json?: unknown;
    form?: { boundary: string; body: Buffer };
    jar?: Jar;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResponse> {
  const target = new URL(`${API_BASE}${path}`);
  const jar = options.jar;
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  let body: Buffer | undefined;

  if (options.json !== undefined) {
    body = Buffer.from(JSON.stringify(options.json));
    headers["content-type"] = "application/json";
  } else if (options.form) {
    body = options.form.body;
    headers["content-type"] = `multipart/form-data; boundary=${options.form.boundary}`;
  }
  if (body) headers["content-length"] = String(body.length);
  if (options.origin !== null) headers.origin = options.origin ?? PAGES_ORIGIN;
  if (jar) headers.cookie = jar.header();

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: options.method ?? "GET", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          jar?.absorb(response.headers);
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function multipart(fields: Record<string, string>, file?: { field: string; filename: string; contentType: string; bytes: Buffer }) {
  const boundary = `----aplora${Date.now().toString(16)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    parts.push(file.bytes);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

async function main(): Promise<void> {
  console.log("\nAplora static-frontend contract check\n");

  log("Starting the API and the worker…");
  start("api", "node", ["services/api/dist/server.js"], ROOT);
  start("worker", "npx", ["tsx", "src/index.ts"], `${ROOT}/services/worker`);
  await waitFor(`${API}/health`, "API");
  log("API is up");

  // ------------------------------------------------------ CORS contract
  const preflight = await call("/auth/me", {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-csrf-token",
    },
  });
  assert(preflight.status === 204 || preflight.status === 200, `preflight returned ${preflight.status}`);
  assert(
    preflight.headers["access-control-allow-origin"] === PAGES_ORIGIN,
    `preflight did not allow ${PAGES_ORIGIN}: ${String(preflight.headers["access-control-allow-origin"])}`,
  );
  assert(
    String(preflight.headers["access-control-allow-headers"] ?? "").includes("x-csrf-token"),
    "preflight does not allow the x-csrf-token header",
  );
  log(`CORS preflight allows ${PAGES_ORIGIN} with credentials and the CSRF header`);

  const anon = await call("/apps");
  assert(anon.status === 200, `/apps returned ${anon.status}`);
  assert(anon.headers["access-control-allow-origin"] === PAGES_ORIGIN, "GET /apps is missing the CORS origin header");
  log("Public catalogue is readable cross-origin");

  // ------------------------------------------------------------ developer
  const stamp = Date.now().toString(36);
  const devEmail = `dev-${stamp}@example.com`;
  const devPassword = "SmokePassword123";
  const devJar = new Jar();

  const registration = await call("/auth/register", {
    method: "POST",
    jar: devJar,
    json: {
      email: devEmail,
      password: devPassword,
      displayName: `Smoke Developer ${stamp}`,
      accountType: "DEVELOPER",
      developerName: `Smoke Studio ${stamp}`,
      supportEmail: devEmail,
    },
  });
  assert(registration.status === 201, `registration returned ${registration.status}: ${registration.body.slice(0, 200)}`);
  assert(devJar.header().includes("aplora_session"), "registration did not set a session cookie");

  const me = await call("/auth/me", { jar: devJar });
  const meBody = JSON.parse(me.body) as { user?: { id: string; role: string }; csrfToken?: string };
  assert(meBody.user?.role === "DEVELOPER", "the session did not survive the round trip");
  assert(meBody.csrfToken, "the API did not return a CSRF token");
  const csrf = meBody.csrfToken!;
  log("Developer registered and the session works cross-origin");

  // A write without the CSRF token must be refused, exactly as the frontend expects.
  const noCsrf = await call("/developer/apps", { method: "POST", jar: devJar, json: { name: "Nope" } });
  assert(noCsrf.status === 403, `a write without CSRF should be 403, got ${noCsrf.status}`);
  log("Cookie-authenticated writes are rejected without the CSRF token");

  await prisma.user.updateMany({ where: { email: devEmail }, data: { emailVerifiedAt: new Date() } });
  const category = await prisma.category.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  assert(category, "no category exists; run npm run db:seed first");

  const appName = `Smoke App ${stamp}`;
  const packageName = `com.aplora.smoke${stamp}`;
  const created = await call("/developer/apps", {
    method: "POST",
    jar: devJar,
    headers: { "x-csrf-token": csrf },
    json: {
      name: appName,
      packageName,
      categoryId: category!.id,
      shortDescription: "An application created by the end-to-end contract check.",
      fullDescription:
        "An application created by the end-to-end contract check, used to verify the complete publishing journey from upload to download.",
    },
  });
  assert(created.status === 201, `listing creation returned ${created.status}: ${created.body.slice(0, 200)}`);
  const appId = (JSON.parse(created.body) as { id: string }).id;
  log(`Listing created (${appName})`);

  const apk = buildApkFixture({ packageName, versionName: "1.0.0", versionCode: 1 });
  const upload = await call(`/developer/apps/${appId}/versions`, {
    method: "POST",
    jar: devJar,
    headers: { "x-csrf-token": csrf },
    form: multipart({ versionName: "1.0.0", versionCode: "1", releaseNotes: "First smoke release." }, {
      field: "apk",
      filename: "app.apk",
      contentType: "application/vnd.android.package-archive",
      bytes: apk.buffer,
    }),
  });
  assert(upload.status === 201, `APK upload returned ${upload.status}: ${upload.body.slice(0, 200)}`);
  const version = JSON.parse(upload.body) as { id: string; status: string; sha256: string };
  assert(version.status === "UPLOADED", `version should be UPLOADED, was ${version.status}`);
  log("APK uploaded into quarantine");

  const submit = await call(`/developer/versions/${version.id}/submit`, {
    method: "POST",
    jar: devJar,
    headers: { "x-csrf-token": csrf },
    json: {},
  });
  assert(submit.status === 202, `submission returned ${submit.status}`);
  log("Version submitted; waiting for the worker");

  let state = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await prisma.appVersion.findUniqueOrThrow({ where: { id: version.id } });
    state = current.status;
    if (["PENDING_REVIEW", "QUARANTINED", "FLAGGED"].includes(state)) break;
    await delay(500);
  }
  assert(state === "PENDING_REVIEW", `worker did not move the version into review (state: ${state})`);
  log("Worker validated and scanned the APK; the version is in the review queue");

  // ---------------------------------------------------------------- admin
  const adminEmail = `admin-${stamp}@example.com`;
  const adminPassword = "AdminPassword123";
  const secret = generateTotpSecret();
  await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      displayName: `Smoke Admin ${stamp}`,
      role: "SUPER_ADMIN",
      emailVerifiedAt: new Date(),
      mfaEnabled: true,
      mfaSecret: secret,
    },
  });

  const adminJar = new Jar();
  const adminLogin = await call("/auth/login", {
    method: "POST",
    jar: adminJar,
    json: { email: adminEmail, password: adminPassword, totp: totpCode(secret) },
  });
  assert(adminLogin.status === 200, `admin login returned ${adminLogin.status}: ${adminLogin.body.slice(0, 160)}`);
  const adminCsrf = (JSON.parse(adminLogin.body) as { csrfToken: string }).csrfToken;

  const dashboard = await call("/admin/dashboard", { jar: adminJar });
  assert(dashboard.status === 200, `admin dashboard returned ${dashboard.status}`);
  const metrics = JSON.parse(dashboard.body) as { users: { total: number }; submissions: { pending: number } };
  assert(metrics.users.total > 0, "the dashboard returned no metrics");
  assert(metrics.submissions.pending >= 1, "the submission queue does not show the new version");
  log("Administrator signed in with TOTP and the dashboard returns real metrics");

  const approve = await call(`/admin/submissions/${version.id}/approve`, {
    method: "POST",
    jar: adminJar,
    headers: { "x-csrf-token": adminCsrf },
    json: {},
  });
  assert(approve.status === 200, `approval returned ${approve.status}: ${approve.body.slice(0, 200)}`);

  const published = await prisma.appVersion.findUniqueOrThrow({ where: { id: version.id }, include: { file: true } });
  assert(published.status === "PUBLISHED", `version should be PUBLISHED, was ${published.status}`);
  assert(published.file?.storageKey.startsWith("published/"), "the APK was not moved out of quarantine");
  log("Submission approved and published");

  // ------------------------------------------------------------ public side
  const slug = (await prisma.app.findUniqueOrThrow({ where: { id: appId } })).slug;
  const detail = await call(`/apps/${slug}`);
  assert(detail.status === 200, `app detail returned ${detail.status}`);
  const detailBody = JSON.parse(detail.body) as { latestVersion: { versionCode: number }; downloadCount: number };
  assert(detailBody.latestVersion.versionCode === 1, "the public detail does not show the published version");
  log("Application is publicly readable");

  const search = await call(`/search?q=${encodeURIComponent("Smoke App")}`);
  assert(JSON.parse(search.body).items.length > 0, "search does not find the published application");
  log("Search finds the application");

  const ticket = await call(`/apps/${slug}/download`, { method: "POST" });
  assert(ticket.status === 201, `download ticket returned ${ticket.status}: ${ticket.body.slice(0, 160)}`);
  const ticketBody = JSON.parse(ticket.body) as { url: string; sha256: string };

  const file = await fetch(ticketBody.url);
  assert(file.status === 200, `file download returned ${file.status}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert(digest === published.file!.sha256, "the downloaded bytes do not match the published checksum");
  assert(file.headers.get("x-checksum-sha256") === published.file!.sha256, "checksum header mismatch");
  log(`Downloaded ${bytes.length} bytes; the SHA-256 matches the published checksum`);

  const events = await prisma.downloadEvent.count({ where: { appId } });
  assert(events === 1, `expected one recorded download event, found ${events}`);
  const afterDownload = JSON.parse((await call(`/apps/${slug}`)).body) as { downloadCount: number };
  assert(afterDownload.downloadCount === 1, "the public download count does not reflect the real event");
  log("Download event recorded and reflected in the public statistics");

  console.log("\nAll contract checks passed.\n");
}

main()
  .catch((error: unknown) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const child of children) {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await delay(400);
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
