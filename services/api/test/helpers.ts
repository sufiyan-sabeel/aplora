import { hashPassword, hashToken, generateTotpSecret, totpCode } from "@aplora/auth";
import { prisma, type PrismaClient } from "@aplora/database";
import { LocalStorageAdapter } from "@aplora/storage";
import { buildApkFixture } from "@aplora/apk/testing";
import { scanVersionFile, validateVersionUpload, type PublishingContext } from "@aplora/publishing";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { getConfig } from "../src/env";
import type { QueueClient, QueueName } from "../src/lib/queue";

export class TestQueue implements QueueClient {
  readonly sent: Array<{ name: QueueName; data: object }> = [];
  async send(name: QueueName, data: object): Promise<void> {
    this.sent.push({ name, data });
  }
  async stop(): Promise<void> {
    /* nothing to close */
  }
}

export const TEST_STORAGE_ROOT = process.env.STORAGE_LOCAL_ROOT ?? "/scratch/work/aplora/.storage-test";

export async function createTestApp(): Promise<{ app: FastifyInstance; queue: TestQueue }> {
  const queue = new TestQueue();
  const app = await buildApp({
    config: getConfig(),
    storage: new LocalStorageAdapter(TEST_STORAGE_ROOT),
    queue,
    logger: false,
  });
  await app.ready();
  return { app, queue };
}

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs, submission_history, download_events, reports, reviews, app_assets,
      app_files, app_versions, collection_apps, collections, apps, developer_profiles,
      sessions, email_verification_tokens, password_reset_tokens, users, categories, settings
    RESTART IDENTITY CASCADE;
  `);
}

export async function seedCategories(): Promise<{ productivityId: string; toolsId: string }> {
  const productivity = await prisma.category.create({
    data: { name: "Productivity", slug: "productivity", sortOrder: 1 },
  });
  const tools = await prisma.category.create({ data: { name: "Tools", slug: "tools", sortOrder: 2 } });
  return { productivityId: productivity.id, toolsId: tools.id };
}

export interface SessionCookie {
  cookie: string;
  csrfToken: string;
  userId: string;
}

export function extractSession(response: { headers: Record<string, unknown>; body: string }): SessionCookie {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : [String(raw ?? "")];
  const session = cookies.find((value) => value.startsWith("aplora_session="));
  const csrf = cookies.find((value) => value.startsWith("aplora_csrf="));
  if (!session || !csrf) throw new Error(`No session cookie in response: ${response.body}`);
  const body = JSON.parse(response.body) as { csrfToken?: string; user?: { id: string } };
  return {
    cookie: session.split(";")[0]!,
    csrfToken: body.csrfToken ?? csrf.split(";")[0]!.split("=")[1]!,
    userId: body.user?.id ?? "",
  };
}

export interface CreateUserOptions {
  email: string;
  password?: string;
  role?: "USER" | "DEVELOPER" | "ADMIN" | "SUPER_ADMIN";
  verified?: boolean;
  mfa?: boolean;
  developerName?: string;
}

/** Creates an account directly in the database (fast, deterministic). */
export async function createUser(options: CreateUserOptions) {
  const password = options.password ?? "Password12345";
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: options.email,
      passwordHash,
      displayName: options.email.split("@")[0]!,
      role: options.role ?? "USER",
      emailVerifiedAt: options.verified === false ? null : new Date(),
      mfaEnabled: options.mfa ?? false,
      mfaSecret: options.mfa ? generateTotpSecret() : null,
    },
  });

  if (options.role === "DEVELOPER" || options.developerName) {
    await prisma.developerProfile.create({
      data: {
        userId: user.id,
        displayName: options.developerName ?? `${user.displayName} Studio`,
        slug: `${user.displayName}-studio-${user.id.slice(0, 4)}`,
        supportEmail: options.email,
      },
    });
  }

  return { user, password, mfaSecret: user.mfaSecret };
}

export async function login(
  app: FastifyInstance,
  email: string,
  password = "Password12345",
  totp?: string,
): Promise<SessionCookie> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password, totp },
  });
  if (response.statusCode >= 300) throw new Error(`Login failed: ${response.statusCode} ${response.body}`);
  const session = extractSession(response);
  session.userId = (JSON.parse(response.body) as { user?: { id: string } }).user?.id ?? session.userId;
  return session;
}

export function authHeaders(session: SessionCookie, csrf = true): Record<string, string> {
  return {
    cookie: session.cookie,
    ...(csrf ? { "x-csrf-token": session.csrfToken } : {}),
  };
}

export interface AppFixture {
  appId: string;
  slug: string;
  packageName: string;
  developerId: string;
  categoryId: string;
}

export async function createDeveloperApp(
  developerUserId: string,
  categoryId: string,
  overrides: Partial<{ name: string; packageName: string; slug: string }> = {},
): Promise<AppFixture> {
  const developer = await prisma.developerProfile.findUniqueOrThrow({ where: { userId: developerUserId } });
  const suffix = Math.random().toString(36).slice(2, 8);
  const app = await prisma.app.create({
    data: {
      developerId: developer.id,
      categoryId,
      slug: overrides.slug ?? `fixture-app-${suffix}`,
      packageName: overrides.packageName ?? `com.aplora.fixture${suffix}`,
      name: overrides.name ?? `Fixture App ${suffix}`,
      shortDescription: "A fixture application used by the automated test suite.",
      fullDescription:
        "A fixture application used by the automated test suite to exercise the publishing pipeline end to end.",
    },
  });
  return {
    appId: app.id,
    slug: app.slug,
    packageName: app.packageName,
    developerId: developer.id,
    categoryId,
  };
}

/** Uploads an APK through the real developer endpoint. */
export async function uploadApk(
  app: FastifyInstance,
  session: SessionCookie,
  appId: string,
  options: {
    versionName?: string;
    versionCode?: number;
    fixture?: Parameters<typeof buildApkFixture>[0];
    rawBody?: Buffer;
  } = {},
) {
  const versionName = options.versionName ?? "1.0.0";
  const versionCode = options.versionCode ?? 1;
  // The manifest must carry the listing's package name, exactly as a real build
  // of that application would.
  const listing = await prisma.app.findUniqueOrThrow({ where: { id: appId }, select: { packageName: true } });
  const fixture = buildApkFixture({
    versionName,
    versionCode,
    ...options.fixture,
    packageName: options.fixture?.packageName ?? listing.packageName,
  });
  const apk = options.rawBody ?? fixture.buffer;

  const boundary = `----aplora${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  const field = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };
  field("versionName", versionName);
  field("versionCode", String(versionCode));
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="apk"; filename="app.apk"\r\nContent-Type: application/vnd.android.package-archive\r\n\r\n`,
    ),
  );
  parts.push(apk);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const response = await app.inject({
    method: "POST",
    url: `/api/v1/developer/apps/${appId}/versions`,
    headers: {
      ...authHeaders(session),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat(parts),
  });

  return { response, fixture, versionName, versionCode };
}

export function publishingContext(app: FastifyInstance): PublishingContext {
  return {
    prisma: app.prisma as PrismaClient,
    storage: app.storage,
    maxApkBytes: 200 * 1024 * 1024,
    scanner: { driver: "local", clamavHost: "127.0.0.1", clamavPort: 3310 },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
}

/** Runs the worker pipeline synchronously, exactly as the worker process does. */
export async function runPipeline(app: FastifyInstance, versionId: string): Promise<{ validation: string; scan?: string }> {
  const context = publishingContext(app);
  const validation = await validateVersionUpload(context, versionId);
  if (validation.status !== "VALID") return { validation: validation.status };
  const scan = await scanVersionFile(context, versionId);
  return { validation: validation.status, scan: scan.status };
}

export { prisma, totpCode, generateTotpSecret, hashToken };

/** Creates an administrator with MFA enrolled and returns a fully authenticated session. */
export async function loginAdmin(app: FastifyInstance, email = "admin@example.com", role: "ADMIN" | "SUPER_ADMIN" = "SUPER_ADMIN") {
  const { user, mfaSecret } = await createUser({ email, role, mfa: true });
  const session = await login(app, email, "Password12345", totpCode(mfaSecret!));
  return { session, user };
}

export async function loginDeveloper(app: FastifyInstance, email = "dev@example.com") {
  const { user } = await createUser({ email, role: "DEVELOPER", developerName: "Test Studio" });
  const session = await login(app, email);
  return { session, user };
}

/** Takes an application all the way through review so it is publicly visible. */
export async function createPublishedApp(
  app: FastifyInstance,
  developerSession: SessionCookie,
  categoryId: string,
  options: { name?: string; packageName?: string; versionCode?: number; versionName?: string; rating?: never } = {},
) {
  const fixture = await createDeveloperApp(developerSession.userId, categoryId, {
    name: options.name,
    packageName: options.packageName,
  });
  const upload = await uploadApk(app, developerSession, fixture.appId, {
    versionCode: options.versionCode ?? 1,
    versionName: options.versionName ?? "1.0.0",
  });
  const versionId = JSON.parse(upload.response.body).id as string;

  await app.inject({
    method: "POST",
    url: `/api/v1/developer/versions/${versionId}/submit`,
    headers: authHeaders(developerSession),
    payload: {},
  });
  await runPipeline(app, versionId);

  const { session: adminSession } = await loginAdmin(app, `admin-${Math.random().toString(36).slice(2, 10)}@example.com`);
  const approve = await app.inject({
    method: "POST",
    url: `/api/v1/admin/submissions/${versionId}/approve`,
    headers: authHeaders(adminSession),
    payload: {},
  });
  if (approve.statusCode !== 200) throw new Error(`Approval failed: ${approve.body}`);

  return { fixture, versionId, adminSession };
}
