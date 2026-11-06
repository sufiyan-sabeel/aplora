import {
  api,
  esc,
  formatDate,
  formatNumber,
  isDeveloper,
  loadSession,
  pageHref,
  stat,
  statusBadge,
  table,
  url,
} from "@aplora/client";

interface DeveloperApp {
  id: string;
  slug: string;
  name: string;
  status: string;
  updatedAt: string;
  versionCount: number;
  latestVersion: { versionName: string; status: string } | null;
}

export async function renderDashboard(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isDeveloper(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Developer access required</h3><p>This account is not a developer account.</p><a class="btn btn--primary" href="${esc(url("register/"))}">Create a developer account</a></div>`;
    return;
  }

  const [profile, apps, analytics] = await Promise.all([
    api.get<{ displayName: string; isVerified: boolean; downloadCount: number }>("/developer/profile"),
    api.get<{ items: DeveloperApp[] }>("/developer/apps"),
    api.get<{ totalDownloads: number; downloadsLast30Days: number }>("/developer/analytics"),
  ]);

  root.innerHTML = `
    <div class="row-between">
      <div>
        <p class="eyebrow">Developer portal</p>
        <h1 style="margin-bottom:4px;">${esc(profile.displayName)}</h1>
        <p class="muted" style="margin:0;">
          ${profile.isVerified ? "Verified developer" : "Verification pending"} ·
          ${apps.items.length} ${apps.items.length === 1 ? "application" : "applications"}
        </p>
      </div>
      <a class="btn btn--primary" href="${esc(pageHref("app-new/"))}">New application</a>
    </div>

    <div class="grid grid-4" style="margin-top:var(--space-4);">
      ${stat("Total downloads", formatNumber(analytics.totalDownloads))}
      ${stat("Last 30 days", formatNumber(analytics.downloadsLast30Days))}
      ${stat("Published apps", String(apps.items.filter((entry) => entry.status === "PUBLISHED").length))}
      ${stat("Awaiting review", String(apps.items.filter((entry) => entry.status === "PENDING_REVIEW").length))}
    </div>

    <section class="section" style="margin-top:var(--space-6);">
      <div class="section-head"><h2>Your applications</h2><a class="small" href="${esc(pageHref("apps/"))}">Manage all</a></div>
      ${table(
        ["Application", "Status", "Latest version", "Updated", ""],
        apps.items.map(
          (entry) => `<tr>
            <td><strong>${esc(entry.name)}</strong><br /><span class="small faint mono">${esc(entry.slug)}</span></td>
            <td>${statusBadge(entry.status)}</td>
            <td>${entry.latestVersion ? `${esc(entry.latestVersion.versionName)} (${esc(entry.latestVersion.status.replaceAll("_", " ").toLowerCase())})` : "—"}</td>
            <td>${esc(formatDate(entry.updatedAt))}</td>
            <td><a class="btn btn--ghost btn--sm" href="${esc(pageHref("app/", { id: entry.id }))}">Open</a></td>
          </tr>`,
        ),
        "No applications yet",
      )}
      ${
        apps.items.length === 0
          ? `<p class="small muted" style="margin-top:var(--space-3);">Create a listing, then upload a signed APK to submit it for review.</p>`
          : ""
      }
    </section>
  `;
}
