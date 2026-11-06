import { api, esc, formatNumber, isDeveloper, loadSession, pageHref, stat, statusBadge, table } from "@aplora/client";

export async function renderAnalytics(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isDeveloper(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Developer access required</h3></div>`;
    return;
  }

  const analytics = await api.get<{
    totalDownloads: number;
    downloadsLast30Days: number;
    apps: Array<{ appId: string; name: string; status: string; downloads: number; downloadsLast30Days: number }>;
    daily: Array<{ date: string; downloads: number }>;
  }>("/developer/analytics");

  const peak = Math.max(1, ...analytics.daily.map((row) => row.downloads));

  root.innerHTML = `
    <h1>Analytics</h1>
    <p class="muted">Figures come from recorded download events only — nothing is estimated or padded.</p>
    <div class="grid grid-3" style="margin-top:var(--space-4);">
      ${stat("Downloads, all time", formatNumber(analytics.totalDownloads))}
      ${stat("Downloads, last 30 days", formatNumber(analytics.downloadsLast30Days))}
      ${stat("Applications", String(analytics.apps.length))}
    </div>

    <section class="section" style="margin-top:var(--space-6);">
      <h2>Daily downloads (30 days)</h2>
      ${
        analytics.daily.length === 0
          ? `<p class="muted">No downloads recorded in this period.</p>`
          : `<div class="card">
              <div style="display:flex;align-items:flex-end;gap:6px;height:160px;">
                ${analytics.daily
                  .map(
                    (row) =>
                      `<div title="${esc(row.date)}: ${row.downloads}" style="flex:1;min-width:6px;height:${Math.max(4, Math.round((row.downloads / peak) * 150))}px;background:var(--accent);border-radius:3px 3px 0 0;opacity:.85;"></div>`,
                  )
                  .join("")}
              </div>
              <p class="small faint" style="margin:var(--space-3) 0 0;">Peak day: ${peak} downloads</p>
            </div>`
      }
    </section>

    <section class="section">
      <h2>Per application</h2>
      ${table(
        ["Application", "Status", "Downloads", "Last 30 days"],
        analytics.apps.map(
          (row) => `<tr>
            <td>${esc(row.name)}</td>
            <td>${statusBadge(row.status)}</td>
            <td>${esc(formatNumber(row.downloads))}</td>
            <td>${esc(formatNumber(row.downloadsLast30Days))}</td>
          </tr>`,
        ),
        "No applications yet",
      )}
    </section>
  `;
}
