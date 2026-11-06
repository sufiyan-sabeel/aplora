import type { CurrentUser } from "@aplora/shared-types";
import { config, url } from "./config";
import { loadSession, logout } from "./session";
import { esc } from "./ui";

/**
 * Fills the header's account area after the session is known. The static HTML
 * ships a signed-out state, which is replaced as soon as /auth/me answers.
 */
export async function mountHeader(options: {
  portal: "marketplace" | "developer" | "admin";
  loginPath?: string;
  registerPath?: string;
}): Promise<CurrentUser | null> {
  const area = document.querySelector<HTMLElement>("[data-auth-area]");
  const session = await loadSession(true);
  const user = session.user;

  if (!area) return user;

  const otherPortals =
    options.portal === "marketplace"
      ? `<a class="btn btn--ghost btn--sm" href="${esc(url("developer/"))}">Developer portal</a>`
      : `<a class="btn btn--ghost btn--sm" href="${esc(url(""))}">Marketplace</a>`;

  const links: string[] = [otherPortals];

  if (user) {
    if (options.portal === "admin" || user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      if (options.portal !== "admin") {
        links.push(`<a class="btn btn--ghost btn--sm" href="${esc(url("admin/"))}">Admin</a>`);
      }
    }
    if (options.portal !== "developer" && (user.developerId || user.role !== "USER")) {
      links.push(`<a class="btn btn--ghost btn--sm" href="${esc(url("developer/"))}">Developer</a>`);
    }
    if (options.portal === "marketplace") {
      links.push(`<a class="btn btn--ghost btn--sm" href="${esc(url("profile/"))}">${esc(user.displayName)}</a>`);
    }
    links.push(`<button class="btn btn--ghost btn--sm" type="button" data-sign-out>Sign out</button>`);
  } else {
    links.push(
      `<a class="btn btn--ghost btn--sm" href="${esc(url(options.loginPath ?? "login/"))}">Sign in</a>`,
      `<a class="btn btn--primary btn--sm" href="${esc(url(options.registerPath ?? "register/"))}">Create account</a>`,
    );
  }

  area.innerHTML = links.join("");

  area.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
    await logout();
    window.location.href = url("");
  });

  if (!config.isConfigured) {
    const banner = document.createElement("div");
    banner.className = "alert alert--warning";
    banner.style.margin = "12px 0 0";
    banner.innerHTML =
      "This deployment has no API configured, so live data is unavailable. Set <code>PUBLIC_API_BASE_URL</code> and rebuild.";
    document.querySelector("main .container")?.prepend(banner);
  }

  return user;
}
