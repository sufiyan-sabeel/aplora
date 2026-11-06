/**
 * Build-time configuration for the static portals.
 *
 * Everything here is public: it ships in the JavaScript bundle, so it must never
 * contain a secret. Only `PUBLIC_*` variables are exposed by the bundler.
 */
const rawApiBase = (import.meta.env.PUBLIC_API_BASE_URL ?? "").trim();

export const config = {
  /** Absolute API base, for example https://api.example.com/api/v1 */
  apiBaseUrl: rawApiBase.replace(/\/+$/, ""),
  /** Path prefix of this deployment, for example "/aplora/" */
  base: import.meta.env.BASE_URL || "/",
  isConfigured: rawApiBase.length > 0,
  buildTime: import.meta.env.PUBLIC_BUILD_TIME ?? "",
} as const;

/** Joins the deployment base with a route, keeping one trailing slash. */
export function url(path: string): string {
  const base = config.base.endsWith("/") ? config.base : `${config.base}/`;
  const clean = path.replace(/^\/+/, "");
  return `${base}${clean}`;
}

/**
 * Base path of the marketplace, even from inside the developer or admin build:
 * "/aplora/developer/" → "/aplora/". The footer links to marketplace pages that
 * only exist in the root build.
 */
export const marketplaceBase = config.base.replace(/(?:developer|admin)\/$/, "");

export function marketplaceUrl(path: string): string {
  const base = marketplaceBase.endsWith("/") ? marketplaceBase : `${marketplaceBase}/`;
  return `${base}${path.replace(/^\/+/, "")}`;
}

/** Absolute URL of a page in this deployment. */
export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return url(path);
  return new URL(url(path), window.location.origin).toString();
}
