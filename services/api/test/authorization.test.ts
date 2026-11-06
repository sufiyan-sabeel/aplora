import { beforeEach, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, createDeveloperApp, createTestApp, createUser, generateTotpSecret, login, prisma, resetDatabase, seedCategories, totpCode } from "./helpers";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
  ({ app } = await createTestApp());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("unauthenticated access", () => {
  it("blocks every developer endpoint", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/developer/profile"],
      ["GET", "/api/v1/developer/apps"],
      ["POST", "/api/v1/developer/apps"],
      ["GET", "/api/v1/developer/analytics"],
      ["GET", "/api/v1/developer/submissions"],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("blocks every admin endpoint", async () => {
    for (const url of [
      "/api/v1/admin/dashboard",
      "/api/v1/admin/users",
      "/api/v1/admin/submissions",
      "/api/v1/admin/audit-logs",
      "/api/v1/admin/reports",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it("does not let an invalid session through", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/developer/apps",
      headers: { cookie: "aplora_session=not-a-real-session" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("role checks", () => {
  it("keeps regular users out of the developer portal", async () => {
    await createUser({ email: "plain@example.com" });
    const session = await login(app, "plain@example.com");
    const response = await app.inject({ method: "GET", url: "/api/v1/developer/apps", headers: authHeaders(session) });
    expect(response.statusCode).toBe(403);
  });

  it("keeps developers out of the admin portal", async () => {
    await createUser({ email: "dev@example.com", role: "DEVELOPER", developerName: "Dev Studio" });
    const session = await login(app, "dev@example.com");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/dashboard", headers: authHeaders(session) });
    expect(response.statusCode).toBe(403);
  });

  it("requires MFA before an administrator can use the admin portal", async () => {
    await createUser({ email: "admin-nomfa@example.com", role: "ADMIN" });
    const session = await login(app, "admin-nomfa@example.com");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/dashboard", headers: authHeaders(session) });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("mfa_enrollment_required");
  });

  it("allows an administrator with MFA", async () => {
    const { user } = await createUser({ email: "admin@example.com", role: "SUPER_ADMIN", mfa: true });
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret } });

    const pending = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.com", password: "Password12345" },
    });
    const pendingCookie = ([] as string[])
      .concat(pending.headers["set-cookie"] as string[])
      .find((value) => value.startsWith("aplora_session="))!
      .split(";")[0]!;
    const completed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/mfa",
      headers: { cookie: pendingCookie },
      payload: { code: totpCode(secret) },
    });
    // The pending session is upgraded in place: the same cookie is reused.
    const cookie = pendingCookie;
    const csrfToken = JSON.parse(completed.body).csrfToken as string;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/dashboard",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).users.total).toBe(1);
  });
});

describe("resource ownership", () => {
  it("hides another developer's application", async () => {
    const { productivityId } = await seedCategories();
    await createUser({ email: "one@example.com", role: "DEVELOPER", developerName: "One Studio" });
    const other = await createUser({ email: "two@example.com", role: "DEVELOPER", developerName: "Two Studio" });

    const sessionOne = await login(app, "one@example.com");
    const sessionTwo = await login(app, "two@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/developer/apps",
      headers: authHeaders(sessionOne),
      payload: {
        name: "Owned App",
        packageName: "com.aplora.owned",
        categoryId: productivityId,
        shortDescription: "An application owned by the first developer.",
        fullDescription: "An application owned by the first developer, used to verify ownership checks.",
      },
    });
    expect(created.statusCode).toBe(201);
    const appId = JSON.parse(created.body).id as string;

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/developer/apps/${appId}`,
      headers: authHeaders(sessionTwo),
    });
    expect(read.statusCode).toBe(404);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/developer/apps/${appId}`,
      headers: authHeaders(sessionTwo),
      payload: { name: "Hijacked" },
    });
    expect(patch.statusCode).toBe(404);

    const stored = await prisma.app.findUniqueOrThrow({ where: { id: appId } });
    expect(stored.name).toBe("Owned App");
    expect(stored.developerId).not.toBe(
      (await prisma.developerProfile.findUniqueOrThrow({ where: { userId: other.user.id } })).id,
    );
  });
});

describe("audit log integrity", () => {
  it("cannot be updated or deleted, even with direct SQL", async () => {
    await prisma.auditLog.create({
      data: { action: "test.write", entityType: "test", entityId: "1", metadata: { ok: true } },
    });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'tampered'`),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
  });
});
