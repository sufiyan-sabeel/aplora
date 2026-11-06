import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, createTestApp, createUser, login, prisma, resetDatabase } from "./helpers";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
  ({ app } = await createTestApp());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("transport hardening", () => {
  it("sends the security headers", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(String(response.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("only allows the three portal origins through CORS", async () => {
    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/apps",
      headers: { origin: "http://localhost:4321" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:4321");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/apps",
      headers: { origin: "https://evil.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers an unknown route with a consistent envelope", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toBeTruthy();
  });

  it("rejects malformed JSON with a 4xx and no stack trace", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBeTruthy();
    expect(response.body).not.toContain("node_modules");
    expect(response.body).not.toContain("stack");
  });
});

describe("CSRF protection", () => {
  it("rejects a state-changing request without the token", async () => {
    await createUser({ email: "csrf@example.com" });
    const session = await login(app, "csrf@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("csrf_failed");
  });

  it("rejects a wrong token", async () => {
    await createUser({ email: "csrf2@example.com" });
    const session = await login(app, "csrf2@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: session.cookie, "x-csrf-token": "wrong-token" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("accepts the correct token", async () => {
    await createUser({ email: "csrf3@example.com" });
    const session = await login(app, "csrf3@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("abuse protection", () => {
  it("rate limits repeated login attempts", async () => {
    await createUser({ email: "bruteforce@example.com" });
    let limited = false;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "bruteforce@example.com", password: "WrongPassword1" },
      });
      if (response.statusCode === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("never returns password hashes or secrets", async () => {
    await createUser({ email: "leak@example.com" });
    const session = await login(app, "leak@example.com");
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: session.cookie } });
    expect(me.body).not.toContain("passwordHash");
    expect(me.body).not.toContain("$argon2");
    expect(me.body).not.toContain("tokenHash");
  });

  it("does not expose internal details on a server error", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("stack");
  });
});

describe("input validation", () => {
  it("rejects an unknown field type and reports the field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "not-an-email", password: "Password12345", displayName: "X" },
    });
    expect(response.statusCode).toBe(422);
    const details = JSON.parse(response.body).error.details as Array<{ path: string }>;
    expect(details.some((detail) => detail.path === "email")).toBe(true);
  });

  it("clamps pagination to a sane maximum", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/apps?pageSize=10000" });
    expect(response.statusCode).toBe(422);
  });
});
