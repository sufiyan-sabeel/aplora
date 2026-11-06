import { CSRF_COOKIE, SESSION_COOKIE, createToken, hashToken } from "@aplora/auth";
import type { PrismaClient, Session, User } from "@aplora/database";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../env";

export interface CreatedSession {
  token: string;
  session: Session;
}

export async function createSession(
  prisma: PrismaClient,
  config: AppConfig,
  input: { userId: string; ip?: string; userAgent?: string; mfaPending?: boolean },
): Promise<CreatedSession> {
  const token = createToken(32);
  const csrfToken = createToken(24);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      csrfToken,
      mfaPending: input.mfaPending ?? false,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    },
  });

  return { token, session };
}

export function setSessionCookies(reply: FastifyReply, config: AppConfig, token: string, csrfToken: string): void {
  const maxAge = config.SESSION_TTL_HOURS * 60 * 60;
  const base = cookieBase(config);
  reply.setCookie(SESSION_COOKIE, token, { ...base, httpOnly: true, maxAge });
  // The CSRF cookie is readable by the portal (double-submit pattern); the
  // session cookie itself never is.
  reply.setCookie(CSRF_COOKIE, csrfToken, { ...base, httpOnly: false, maxAge });
}

/**
 * Cookie attributes. A static frontend on another site (GitHub Pages) needs
 * SameSite=None with Secure so the browser sends the session cookie on
 * cross-site fetches; same-site deployments should keep Lax.
 */
function cookieBase(config: AppConfig) {
  return {
    path: "/",
    sameSite: config.COOKIE_SAMESITE,
    secure: config.COOKIE_SECURE,
    domain: config.COOKIE_DOMAIN || undefined,
  };
}

export function clearSessionCookies(reply: FastifyReply, config: AppConfig): void {
  const base = cookieBase(config);
  reply.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
  reply.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}

export async function revokeSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Used on password reset and account suspension. */
export async function revokeAllSessions(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export interface AuthContext {
  user: User;
  session: Session;
}
