import type { CurrentUser } from "@aplora/shared-types";
import { api, setCsrfToken } from "./api";

export interface SessionState {
  user: CurrentUser | null;
  mfaPending: boolean;
}

let cached: SessionState | null = null;

export async function loadSession(force = false): Promise<SessionState> {
  if (cached && !force) return cached;
  try {
    const data = await api.get<{ user: CurrentUser | null; csrfToken?: string; mfaRequired?: boolean }>("/auth/me");
    setCsrfToken(data.csrfToken ?? null);
    cached = { user: data.user ?? null, mfaPending: Boolean(data.mfaRequired) };
  } catch {
    cached = { user: null, mfaPending: false };
  }
  return cached;
}

export function currentUser(): CurrentUser | null {
  return cached?.user ?? null;
}

export function clearSession(): void {
  cached = null;
  setCsrfToken(null);
}

export async function login(email: string, password: string, totp?: string) {
  const data = await api.post<{ user?: CurrentUser; csrfToken?: string; mfaRequired?: boolean }>("/auth/login", {
    email,
    password,
    ...(totp ? { totp } : {}),
  });
  setCsrfToken(data.csrfToken ?? null);
  cached = null;
  return data;
}

export async function completeMfa(code: string) {
  const data = await api.post<{ user?: CurrentUser; csrfToken?: string }>("/auth/login/mfa", { code });
  setCsrfToken(data.csrfToken ?? null);
  cached = null;
  return data;
}

export async function register(payload: {
  email: string;
  password: string;
  displayName: string;
  accountType?: "USER" | "DEVELOPER";
  developerName?: string;
  supportEmail?: string;
}) {
  const data = await api.post<{ user?: CurrentUser; csrfToken?: string; verificationUrl?: string }>(
    "/auth/register",
    payload,
  );
  setCsrfToken(data.csrfToken ?? null);
  cached = null;
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } finally {
    clearSession();
  }
}

export function isAdmin(user: CurrentUser | null): boolean {
  return Boolean(user && (user.role === "ADMIN" || user.role === "SUPER_ADMIN"));
}

export function isDeveloper(user: CurrentUser | null): boolean {
  if (!user) return false;
  return Boolean(user.developerId) || ["DEVELOPER", "ADMIN", "SUPER_ADMIN"].includes(user.role);
}
