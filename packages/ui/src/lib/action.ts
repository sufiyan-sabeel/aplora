import { ApiError, ApiClient, cookieHeaderFrom, readCookie, readApiConfig } from "./api";

const SAFE_PATH = /^\/[a-zA-Z0-9\-._~%/]+$/;

/**
 * Shared handler for the portals' form posts. It forwards the submission to the
 * API with the visitor's cookies and CSRF token, copies any Set-Cookie header
 * back to the browser and redirects with a readable status message.
 */
export async function handleFormAction(request: Request): Promise<Response> {
  // Cross-site form protection. The browser tells us where the request came
  // from; if that is not this origin, the submission is refused before it is
  // forwarded to the API.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return new Response("Cross-site form submissions are not allowed", { status: 403 });
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return new Response("Cross-site form submissions are not allowed", { status: 403 });
  }

  const config = readApiConfig(process.env);
  const client = new ApiClient(config.baseUrl, cookieHeaderFrom(request), readCookie(request, "aplora_csrf"));
  const contentType = request.headers.get("content-type") ?? "";

  let action = "";
  let redirectTo = "/";
  let body: BodyInit | undefined;
  let asJson = false;
  let okMessage = "Saved";
  let method = "POST";

  try {
    const form = await request.formData();
    action = String(form.get("_action") ?? "");
    redirectTo = String(form.get("_redirect") ?? "/");
    okMessage = String(form.get("_ok") ?? "Saved");
    const override = String(form.get("_method") ?? "POST").toUpperCase();
    if (["POST", "PATCH", "PUT", "DELETE"].includes(override)) method = override;
    if (!SAFE_PATH.test(action)) throw new Error("Invalid action");

    const hasFile = [...form.values()].some((value) => typeof value !== "string");

    if (contentType.includes("multipart/form-data") && hasFile) {
      // Only a real file upload stays multipart; everything else is sent as
      // JSON so the API's schema validation sees a normal object.
      const forwarded = new FormData();
      for (const [key, value] of form.entries()) {
        if (["_action", "_redirect", "_ok", "_method"].includes(key)) continue;
        forwarded.append(key, value);
      }
      body = forwarded;
    } else {
      const payload: Record<string, unknown> = {};
      for (const [rawKey, value] of form.entries()) {
        if (["_action", "_redirect", "_ok", "_method"].includes(rawKey)) continue;
        if (typeof value !== "string") continue;
        const key = rawKey.endsWith("[]") ? rawKey.slice(0, -2) : rawKey;
        const existing = payload[key];
        // A repeated field (a multi-select) becomes an array for the API.
        if (existing === undefined) payload[key] = value === "" ? undefined : value;
        else if (Array.isArray(existing)) existing.push(value);
        else payload[key] = [existing as string, value];
      }
      body = JSON.stringify(payload);
      asJson = true;
    }
  } catch {
    return redirectWith(redirectTo, "error=That+submission+could+not+be+read", new Headers());
  }

  try {
    const response = await client.raw(action, {
      method,
      body,
      ...(asJson ? { headers: { "content-type": "application/json" } } : {}),
    });

    const headers = new Headers();
    for (const cookie of setCookies(response.headers)) headers.append("set-cookie", cookie);

    if (!response.ok) {
      let message = "That did not work. Please check the form and try again.";
      let code = "";
      try {
        const payload = (await response.json()) as { error?: { message?: string; code?: string } };
        message = payload.error?.message ?? message;
        code = payload.error?.code ?? "";
      } catch {
        /* keep the generic message */
      }
      const params = new URLSearchParams({ error: message });
      if (code) params.set("errorCode", code);
      return redirectWith(redirectTo, params.toString(), headers);
    }

    return redirectWith(redirectTo, `ok=${encodeURIComponent(okMessage)}`, headers);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "The service is unavailable right now.";
    return redirectWith(redirectTo, `error=${encodeURIComponent(message)}`, new Headers());
  }
}

function setCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") return withGetter.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

export function redirectWith(path: string, query: string, headers: Headers): Response {
  const url = new URL(path, "http://localhost");
  const target = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  headers.set("Location", target);
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 303, headers });
}
