import { CSRF_HEADER, SESSION_COOKIE, hashToken } from "@aplora/auth";
import type { Role } from "@aplora/database";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";
import type { AuthContext } from "../services/sessions";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ADMIN_ROLES: Role[] = ["ADMIN", "SUPER_ADMIN"];

async function resolveAuth(request: FastifyRequest): Promise<AuthContext | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await request.server.prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  return { session, user: session.user };
}

/**
 * CSRF defence for cookie-authenticated requests: the portal echoes the token
 * from the readable csrf cookie in a header. An attacker's cross-site form
 * cannot read that cookie, so it cannot produce the header.
 */
function assertCsrf(request: FastifyRequest, context: AuthContext): void {
  if (SAFE_METHODS.has(request.method)) return;
  const header = request.headers[CSRF_HEADER];
  const provided = Array.isArray(header) ? header[0] : header;
  const bodyToken = (request.body as { _csrf?: string } | undefined)?._csrf;
  const candidate = provided ?? bodyToken ?? "";
  if (!candidate || candidate !== context.session.csrfToken) {
    throw new ForbiddenError("The security token is missing or invalid. Reload the page and try again.", "csrf_failed");
  }
}

export default fp(async (app) => {
  app.decorateRequest("auth", null);

  app.decorate("optionalAuth", async (request: FastifyRequest) => {
    request.auth = await resolveAuth(request);
  });

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    const context = await resolveAuth(request);
    if (!context) throw new UnauthorizedError();
    if (context.session.mfaPending) {
      throw new ForbiddenError("Finish signing in with your authenticator code", "mfa_pending");
    }
    assertCsrf(request, context);
    request.auth = context;
  });

  app.decorate("requireRole", (...roles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);
      const role = request.auth?.user.role;
      if (!role || !roles.includes(role)) {
        throw new ForbiddenError("Your account does not have access to this resource");
      }
    };
  });

  /**
   * Admin access requires an administrator role, a fully authenticated session
   * and a confirmed second factor. Without MFA enrolled, the account is told to
   * set it up rather than being silently allowed through.
   */
  app.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    const user = request.auth?.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenError("Your account does not have access to this resource");
    }
    if (!user.mfaEnabled) {
      throw new ForbiddenError(
        "Administrator accounts must enable two-factor authentication before using the admin portal",
        "mfa_enrollment_required",
      );
    }
  });
});
