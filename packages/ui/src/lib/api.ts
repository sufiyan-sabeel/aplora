/**
 * Server-side API client used by the three Astro portals. The browser never
 * talks to the API directly for writes: the portal forwards the request with the
 * visitor's session cookie and CSRF token, and copies any Set-Cookie header back.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiResult<T> {
  data: T;
  headers: Headers;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly cookie: string | null = null,
    private readonly csrfToken: string | null = null,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.csrfToken && init.method && !["GET", "HEAD"].includes(init.method)) {
      headers.set("x-csrf-token", this.csrfToken);
    }

    const response = await fetch(`${this.baseUrl}/api/v1${path}`, { ...init, headers, redirect: "manual" });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw new ApiError(
        response.status,
        envelope?.error?.code ?? "request_failed",
        envelope?.error?.message ?? "The request could not be completed",
        envelope?.error?.details,
      );
    }

    return { data: payload as T, headers: response.headers };
  }

  get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  }

  patch<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });
  }

  put<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
  }

  delete<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "DELETE" });
  }

  /** Multipart pass-through for APK and image uploads. */
  upload<T>(path: string, body: BodyInit, contentType: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "POST", body, headers: { "content-type": contentType } });
  }

  /** Low-level pass-through used by the form action handler. */
  raw(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (this.csrfToken) headers.set("x-csrf-token", this.csrfToken);
    return fetch(`${this.baseUrl}/api/v1${path}`, { ...init, headers, redirect: "manual" });
  }

  /** Safe read that returns a fallback instead of throwing (used on landing pages). */
  async getOr<T>(path: string, fallback: T): Promise<T> {
    try {
      const { data } = await this.get<T>(path);
      return data;
    } catch {
      return fallback;
    }
  }
}

export interface ApiConfig {
  baseUrl: string;
  marketplaceUrl: string;
  developerUrl: string;
  adminUrl: string;
}

export function readApiConfig(env: Record<string, string | undefined>): ApiConfig {
  return {
    baseUrl: env.API_URL ?? env.API_PUBLIC_URL ?? "http://localhost:4000",
    marketplaceUrl: env.PUBLIC_MARKETPLACE_URL ?? "http://localhost:4321",
    developerUrl: env.PUBLIC_DEVELOPER_URL ?? "http://localhost:4322",
    adminUrl: env.PUBLIC_ADMIN_URL ?? "http://localhost:4323",
  };
}

export function cookieHeaderFrom(request: Request): string | null {
  return request.headers.get("cookie");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function clientFor(request: Request, config: ApiConfig): ApiClient {
  return new ApiClient(config.baseUrl, cookieHeaderFrom(request), readCookie(request, "aplora_csrf"));
}
