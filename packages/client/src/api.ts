import { config } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetworkError(): boolean {
    return this.status === 0 && this.code !== "api_unconfigured";
  }
}

export class ApiNotConfiguredError extends ApiError {
  constructor() {
    super(
      0,
      "api_unconfigured",
      "This deployment has no API configured, so no data can be loaded.",
    );
    this.name = "ApiNotConfiguredError";
  }
}

/**
 * The CSRF token is held in memory only — never localStorage — and is refreshed
 * from /auth/me on every page load. It is the double-submit half of the API's
 * protection for cookie-authenticated writes.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token ?? null;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  /** Skip the JSON parse and return the raw Response (file downloads). */
  raw?: boolean;
};

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!config.isConfigured) throw new ApiNotConfiguredError();

  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;

  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (csrfToken && options.method && options.method !== "GET") {
    headers["x-csrf-token"] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      body,
      headers,
      // Required: the session cookie lives on the API origin, not on this one.
      credentials: "include",
      mode: "cors",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      0,
      "network_error",
      "Could not reach the Aplora API. Check your connection and try again.",
    );
  }

  if (options.raw) return response as unknown as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? `http_${response.status}`,
      envelope?.error?.message ?? "The request could not be completed.",
      envelope?.error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", form }),
};

/** Read that returns a fallback instead of throwing, for non-critical sections. */
export async function getOr<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api.get<T>(path);
  } catch {
    return fallback;
  }
}

/** Builds a query string, dropping empty values. */
export function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
