import { createHmac, timingSafeEqual } from "node:crypto";

export interface DownloadTicketPayload {
  versionId: string;
  appId: string;
  exp: number;
  nonce: string;
}

/**
 * Short-lived, HMAC-signed download token. The token carries no secret and is
 * useless after it expires, so a shared download link cannot be replayed later.
 */
export function signDownloadToken(payload: DownloadTicketPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyDownloadToken(token: string, secret: string): DownloadTicketPayload {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("Malformed download token");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid download token signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DownloadTicketPayload;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) throw new Error("Download token has expired");
  return payload;
}
