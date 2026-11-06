import { Algorithm, hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with parameters aligned with OWASP's recommended minimum
 * (19 MiB memory, 2 iterations, 1 lane).
 */
const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, { algorithm: Algorithm.Argon2id });
  } catch {
    return false;
  }
}

/**
 * Constant-work dummy verification used when an account does not exist, so that
 * response timing does not reveal whether an email is registered.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$YXNkZmFzZGZhc2RmYXNkZmFzZGZhc2RmYXNkZmFzZGZhc2RmYXNr";

export async function burnPasswordTime(): Promise<void> {
  try {
    await verify(DUMMY_HASH, "dummy-password", { algorithm: Algorithm.Argon2id });
  } catch {
    /* the dummy hash is intentionally invalid; the work is what matters */
  }
}
