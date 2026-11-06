import { beforeEach, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, createTestApp, createUser, extractSession, generateTotpSecret, login, prisma, resetDatabase, totpCode } from "./helpers";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
  ({ app } = await createTestApp());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("registration", () => {
  it("creates an account, a session and a verification email", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "New.User@Example.com", password: "Password12345", displayName: "New User" },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.user.email).toBe("new.user@example.com");
    expect(body.user.emailVerified).toBe(false);
    expect(body.verificationUrl).toContain("/verify-email?token=");

    const session = extractSession(response);
    expect(session.cookie).toContain("aplora_session=");

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: "new.user@example.com" } });
    expect(stored.passwordHash).not.toContain("Password12345");
    expect(stored.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("rejects a duplicate email", async () => {
    await createUser({ email: "taken@example.com" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "taken@example.com", password: "Password12345", displayName: "Copy" },
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("conflict");
  });

  it("creates a developer profile for developer sign-ups", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "studio@example.com",
        password: "Password12345",
        displayName: "Studio Owner",
        accountType: "DEVELOPER",
        developerName: "Studio Nine",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.user.role).toBe("DEVELOPER");
    expect(body.user.developerSlug).toBeTruthy();
  });

  it("rejects a weak password", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "weak@example.com", password: "short", displayName: "Weak" },
    });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error.code).toBe("validation_failed");
  });
});

describe("email verification", () => {
  it("marks the account verified once the token is used", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "verify@example.com", password: "Password12345", displayName: "Verify" },
    });
    const token = new URL(JSON.parse(register.body).verificationUrl).searchParams.get("token");

    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "verify@example.com" } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const reused = await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
    expect(reused.statusCode).toBe(403);
  });
});

describe("login", () => {
  it("rejects a wrong password with a generic message", async () => {
    await createUser({ email: "person@example.com" });
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "person@example.com", password: "WrongPassword1" },
    });
    const unknownUser = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "ghost@example.com", password: "WrongPassword1" },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(JSON.parse(wrongPassword.body).error.message).toBe(JSON.parse(unknownUser.body).error.message);
  });

  it("sets an HttpOnly session cookie", async () => {
    await createUser({ email: "cookie@example.com" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "cookie@example.com", password: "Password12345" },
    });
    const cookies = ([] as string[]).concat(response.headers["set-cookie"] as string[]);
    const sessionCookie = cookies.find((value) => value.startsWith("aplora_session="))!;
    const csrfCookie = cookies.find((value) => value.startsWith("aplora_csrf="))!;
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(csrfCookie).not.toContain("HttpOnly");
  });

  it("refuses a suspended account", async () => {
    const { user } = await createUser({ email: "suspended@example.com" });
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "suspended@example.com", password: "Password12345" },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("account_suspended");
  });
});

describe("sessions", () => {
  it("returns the current user", async () => {
    await createUser({ email: "me@example.com" });
    const session = await login(app, "me@example.com");
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: session.cookie } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).user.email).toBe("me@example.com");
  });

  it("revokes the session on logout", async () => {
    await createUser({ email: "logout@example.com" });
    const session = await login(app, "logout@example.com");

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: authHeaders(session),
    });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: session.cookie } });
    expect(JSON.parse(me.body).user).toBeNull();
  });

  it("invalidates every other session when the password changes", async () => {
    await createUser({ email: "rotate@example.com" });
    const first = await login(app, "rotate@example.com");
    const second = await login(app, "rotate@example.com");

    const change = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/change",
      headers: authHeaders(second),
      payload: { currentPassword: "Password12345", newPassword: "NewPassword12345" },
    });
    expect(change.statusCode).toBe(200);

    const stale = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: first.cookie } });
    expect(JSON.parse(stale.body).user).toBeNull();

    const stillValid = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: second.cookie } });
    expect(JSON.parse(stillValid.body).user.email).toBe("rotate@example.com");
  });
});

describe("password reset", () => {
  it("resets the password and revokes existing sessions", async () => {
    await createUser({ email: "forgot@example.com" });
    const session = await login(app, "forgot@example.com");

    const forgot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "forgot@example.com" },
    });
    expect(forgot.statusCode).toBe(200);
    const resetUrl = JSON.parse(forgot.body).resetUrl as string;
    const token = new URL(resetUrl).searchParams.get("token");

    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: "BrandNewPass123" },
    });
    expect(reset.statusCode).toBe(200);

    const stale = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: session.cookie } });
    expect(JSON.parse(stale.body).user).toBeNull();

    await login(app, "forgot@example.com", "BrandNewPass123");
  });

  it("does not reveal whether an account exists", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "nobody@example.com" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).message).toContain("If that email is registered");
  });
});

describe("two-factor authentication", () => {
  it("requires the authenticator code when MFA is enabled", async () => {
    const secret = generateTotpSecret();
    const { user } = await createUser({ email: "mfa@example.com", role: "ADMIN", mfa: true });
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret } });

    const withoutCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "mfa@example.com", password: "Password12345" },
    });
    expect(withoutCode.statusCode).toBe(202);
    expect(JSON.parse(withoutCode.body).mfaRequired).toBe(true);

    const pendingCookie = ([] as string[])
      .concat(withoutCode.headers["set-cookie"] as string[])
      .find((value) => value.startsWith("aplora_session="))!
      .split(";")[0]!;

    const mePending = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: pendingCookie } });
    expect(JSON.parse(mePending.body).mfaRequired).toBe(true);

    const wrongCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/mfa",
      headers: { cookie: pendingCookie },
      payload: { code: "000000" },
    });
    expect(wrongCode.statusCode).toBe(401);

    const correctCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/mfa",
      headers: { cookie: pendingCookie },
      payload: { code: totpCode(secret) },
    });
    expect(correctCode.statusCode).toBe(200);

    // The pending session is upgraded in place, so the same cookie now has full access.
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: pendingCookie } });
    expect(JSON.parse(me.body).user.email).toBe("mfa@example.com");
    expect(JSON.parse(me.body).mfaRequired).toBe(false);
  });

  it("enrols a new authenticator secret", async () => {
    await createUser({ email: "enrol@example.com" });
    const session = await login(app, "enrol@example.com");

    const setup = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup", headers: authHeaders(session) });
    expect(setup.statusCode).toBe(200);
    const { secret } = JSON.parse(setup.body) as { secret: string };

    const enable = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enable",
      headers: authHeaders(session),
      payload: { secret, code: totpCode(secret) },
    });
    expect(enable.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "enrol@example.com" } });
    expect(user.mfaEnabled).toBe(true);
  });
});
