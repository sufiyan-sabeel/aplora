import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe random token (default 32 bytes of entropy). */
export function createToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Tokens are stored hashed so a database leak cannot be replayed. Only the
 * holder of the original token can produce the matching hash.
 */
export function hashToken(token: string): string {
  return sha256Hex(`aplora.token.${token}`);
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Deterministic, non-reversible pseudonym for an IP address (analytics only). */
export function hashIp(ip: string | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${secret}:${ip}`).digest("hex").slice(0, 32);
}
