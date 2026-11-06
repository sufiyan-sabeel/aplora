import { CSRF_COOKIE, SESSION_COOKIE, burnPasswordTime, createToken, hashPassword, hashToken, otpauthUrl, verifyPassword, verifyTotp } from "@aplora/auth";
import { Prisma, type PrismaClient } from "@aplora/database";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@aplora/validation";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../env";
import { ConflictError, ForbiddenError, UnauthorizedError } from "../lib/errors";
import { passwordResetEmail, verificationEmail } from "../lib/mailer";
import { createSession, revokeAllSessions, revokeSession, setSessionCookies, clearSessionCookies } from "../services/sessions";
import { toCurrentUser } from "../services/serializers";

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "developer";
}

async function uniqueDeveloperSlug(prisma: PrismaClient, base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = createToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4);
    const candidate = `${base}-${suffix}`;
    const existing = await prisma.developerProfile.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const config = app.config as AppConfig;

  app.get("/auth/me", { preHandler: app.optionalAuth }, async (request, reply) => {
    if (!request.auth) {
      reply.clearCookie(CSRF_COOKIE, { path: "/" });
      return reply.send({ user: null });
    }
    const user = await app.prisma.user.findUnique({
      where: { id: request.auth.user.id },
      include: { developer: { select: { id: true, slug: true } } },
    });
    if (!user) return reply.send({ user: null });
    return reply.send({
      user: toCurrentUser(user),
      csrfToken: request.auth.session.csrfToken,
      mfaRequired: request.auth.session.mfaPending,
    });
  });

  app.post(
    "/auth/register",
    { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const input = registerSchema.parse(request.body);
      const passwordHash = await hashPassword(input.password);

      let user;
      try {
        user = await app.prisma.user.create({
          data: {
            email: input.email,
            passwordHash,
            displayName: input.displayName,
            role: input.accountType === "DEVELOPER" ? "DEVELOPER" : "USER",
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError("An account with this email already exists");
        }
        throw error;
      }

      if (input.accountType === "DEVELOPER") {
        const base = slugify(input.developerName ?? input.displayName);
        await app.prisma.developerProfile.create({
          data: {
            userId: user.id,
            displayName: input.developerName ?? input.displayName,
            slug: await uniqueDeveloperSlug(app.prisma, base),
            supportEmail: input.supportEmail ?? input.email,
          },
        });
      }

      const token = createToken(32);
      await app.prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
        },
      });
      const verificationUrl = `${config.PUBLIC_MARKETPLACE_URL}/verify-email?token=${encodeURIComponent(token)}`;
      await app.mailer.send({
        to: user.email,
        subject: "Confirm your Aplora email address",
        text: verificationEmail(verificationUrl),
      });

      const created = await createSession(app.prisma, config, {
        userId: user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      setSessionCookies(reply, config, created.token, created.session.csrfToken);

      const fresh = await app.prisma.user.findUnique({
        where: { id: user.id },
        include: { developer: { select: { id: true, slug: true } } },
      });

      return reply.status(201).send({
        user: fresh ? toCurrentUser(fresh) : null,
        csrfToken: created.session.csrfToken,
        // Development convenience only: Mailpit or the console transport holds
        // the real message, and production never returns this.
        ...(config.isProduction ? {} : { verificationUrl }),
      });
    },
  );

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const user = await app.prisma.user.findUnique({ where: { email: input.email } });

      if (!user) {
        await burnPasswordTime();
        throw new UnauthorizedError("Email or password is incorrect");
      }

      const valid = await verifyPassword(user.passwordHash, input.password);
      if (!valid) throw new UnauthorizedError("Email or password is incorrect");
      if (user.status === "SUSPENDED") throw new ForbiddenError("This account is suspended", "account_suspended");
      if (user.status === "DELETED") throw new UnauthorizedError("Email or password is incorrect");

      if (user.mfaEnabled) {
        if (!input.totp) {
          const pending = await createSession(app.prisma, config, {
            userId: user.id,
            ip: request.ip,
            userAgent: request.headers["user-agent"],
            mfaPending: true,
          });
          setSessionCookies(reply, config, pending.token, pending.session.csrfToken);
          return reply.status(202).send({ mfaRequired: true, csrfToken: pending.session.csrfToken });
        }
        if (!user.mfaSecret || !verifyTotp(user.mfaSecret, input.totp)) {
          throw new UnauthorizedError("That code is not valid. Try the next code from your authenticator.");
        }
      }

      await app.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const session = await createSession(app.prisma, config, {
        userId: user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      setSessionCookies(reply, config, session.token, session.session.csrfToken);

      const withDeveloper = await app.prisma.user.findUnique({
        where: { id: user.id },
        include: { developer: { select: { id: true, slug: true } } },
      });
      return reply.send({
        user: withDeveloper ? toCurrentUser(withDeveloper) : null,
        csrfToken: session.session.csrfToken,
      });
    },
  );

  /** Completes a login that stopped at the second factor. */
  app.post(
    "/auth/login/mfa",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { code } = mfaVerifySchema.parse(request.body);
      const token = request.cookies[SESSION_COOKIE];
      if (!token) throw new UnauthorizedError();

      const session = await app.prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
      });
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedError("Your sign-in attempt expired. Start again.");
      }
      if (!session.mfaPending) throw new ConflictError("Two-factor verification is not pending");
      if (!session.user.mfaSecret || !verifyTotp(session.user.mfaSecret, code)) {
        throw new UnauthorizedError("That code is not valid. Try the next code from your authenticator.");
      }

      await app.prisma.session.update({ where: { id: session.id }, data: { mfaPending: false } });
      await app.prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });

      const withDeveloper = await app.prisma.user.findUnique({
        where: { id: session.userId },
        include: { developer: { select: { id: true, slug: true } } },
      });
      return reply.send({
        user: withDeveloper ? toCurrentUser(withDeveloper) : null,
        csrfToken: session.csrfToken,
      });
    },
  );

  app.post("/auth/logout", { preHandler: app.authenticate }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(app.prisma, token);
    clearSessionCookies(reply, config);
    return reply.send({ ok: true });
  });

  app.post("/auth/verify-email", async (request, reply) => {
    const { token } = verifyEmailSchema.parse(request.body);
    const record = await app.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenError("This confirmation link is no longer valid. Request a new one.", "invalid_token");
    }
    await app.prisma.$transaction([
      app.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      app.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    return reply.send({ ok: true });
  });

  app.post("/auth/verify-email/resend", { preHandler: app.authenticate }, async (request, reply) => {
    const user = request.auth!.user;
    if (user.emailVerifiedAt) return reply.send({ ok: true, alreadyVerified: true });

    const token = createToken(32);
    await app.prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS) },
    });
    const verificationUrl = `${config.PUBLIC_MARKETPLACE_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await app.mailer.send({
      to: user.email,
      subject: "Confirm your Aplora email address",
      text: verificationEmail(verificationUrl),
    });
    return reply.send({ ok: true, ...(config.isProduction ? {} : { verificationUrl }) });
  });

  /** Always answers the same way, so the endpoint cannot be used to enumerate accounts. */
  app.post(
    "/auth/password/forgot",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const { email } = forgotPasswordSchema.parse(request.body);
      const user = await app.prisma.user.findUnique({ where: { email } });
      let resetUrl: string | undefined;
      if (user && user.status === "ACTIVE") {
        const token = createToken(32);
        await app.prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
        });
        resetUrl = `${config.PUBLIC_MARKETPLACE_URL}/reset-password?token=${encodeURIComponent(token)}`;
        await app.mailer.send({
          to: user.email,
          subject: "Reset your Aplora password",
          text: passwordResetEmail(resetUrl),
        });
      }
      return reply.send({
        ok: true,
        message: "If that email is registered, a reset link is on its way.",
        ...(config.isProduction || !resetUrl ? {} : { resetUrl }),
      });
    },
  );

  app.post(
    "/auth/password/reset",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const { token, password } = resetPasswordSchema.parse(request.body);
      const record = await app.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
        throw new ForbiddenError("This reset link is no longer valid. Request a new one.", "invalid_token");
      }
      const passwordHash = await hashPassword(password);
      await app.prisma.$transaction([
        app.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
        app.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      ]);
      await revokeAllSessions(app.prisma, record.userId);
      clearSessionCookies(reply, config);
      return reply.send({ ok: true });
    },
  );

  app.post("/auth/password/change", { preHandler: app.authenticate }, async (request, reply) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
    const user = request.auth!.user;
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    const passwordHash = await hashPassword(newPassword);
    await app.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await app.prisma.session.updateMany({
      where: { userId: user.id, id: { not: request.auth!.session.id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return reply.send({ ok: true });
  });

  app.get("/auth/sessions", { preHandler: app.authenticate }, async (request) => {
    const sessions = await app.prisma.session.findMany({
      where: { userId: request.auth!.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
    });
    return {
      items: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        current: session.id === request.auth!.session.id,
      })),
    };
  });

  app.delete("/auth/sessions/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await app.prisma.session.updateMany({
      where: { id, userId: request.auth!.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return reply.send({ ok: true });
  });

  /** Issues a fresh TOTP secret; it is not active until a code is confirmed. */
  app.post("/auth/mfa/setup", { preHandler: app.authenticate }, async (request, reply) => {
    const user = request.auth!.user;
    if (user.mfaEnabled) throw new ConflictError("Two-factor authentication is already enabled");
    const secret = createToken(20).replace(/[^A-Z2-7]/gi, "").toUpperCase().slice(0, 32);
    await app.prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret } });
    return reply.send({ secret, otpauthUrl: otpauthUrl(secret, user.email, config.MFA_ISSUER) });
  });

  app.post("/auth/mfa/enable", { preHandler: app.authenticate }, async (request, reply) => {
    const { secret, code } = mfaEnableSchema.parse(request.body);
    const user = request.auth!.user;
    if (user.mfaSecret !== secret) throw new ForbiddenError("This setup request is no longer valid");
    if (!verifyTotp(secret, code)) throw new UnauthorizedError("That code is not valid");
    await app.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    return reply.send({ ok: true });
  });

  app.post("/auth/mfa/disable", { preHandler: app.authenticate }, async (request, reply) => {
    const { password } = mfaDisableSchema.parse(request.body);
    const user = request.auth!.user;
    if (!(await verifyPassword(user.passwordHash, password))) throw new UnauthorizedError("Password is incorrect");
    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      throw new ForbiddenError(
        "Administrators cannot disable two-factor authentication. Ask a super administrator to remove the role first.",
        "mfa_required",
      );
    }
    await app.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
    return reply.send({ ok: true });
  });
}
