import type { AdminDashboard } from "@aplora/shared-types";
import { alert, api, esc, formatNumber, isAdmin, loadSession, pageHref, stat, url } from "@aplora/client";

export async function renderDashboard(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3><p>This account is not an administrator.</p><a class="btn btn--ghost" href="${esc(url(""))}">Back to the marketplace</a></div>`;
    return;
  }

  let dashboard: AdminDashboard;
  try {
    dashboard = await api.get<AdminDashboard>("/admin/dashboard");
  } catch (error) {
    const message = (error as Error).message;
    const needsMfa = message.toLowerCase().includes("two-factor");
    root.innerHTML = `
      <p class="eyebrow">Aplora Admin</p>
      <h1>Dashboard</h1>
      ${alert("warning", esc(message), "Access restricted")}
      ${needsMfa ? `<p style="margin-top:var(--space-3);"><a class="btn btn--primary" href="${esc(url("mfa-setup/"))}">Set up two-factor authentication</a></p>` : ""}
    `;
    return;
  }

  root.innerHTML = `
    <p class="eyebrow">Aplora Admin</p>
    <h1>Dashboard</h1>
    <div class="grid grid-4" style="margin-top:var(--space-4);">
      ${stat("Users", formatNumber(dashboard.users.total), `${dashboard.users.newLast7Days} new this week`)}
      ${stat("Developers", formatNumber(dashboard.developers.total), `${dashboard.developers.verified} verified`)}
      ${stat("Published apps", formatNumber(dashboard.apps.published), `${dashboard.apps.total} listings in total`)}
      ${stat("Downloads", formatNumber(dashboard.downloads.total), `${dashboard.downloads.last7Days} in the last 7 days`)}
    </div>
    <div class="grid grid-3" style="margin-top:var(--space-4);">
      <a class="card card--link" href="${esc(pageHref("submissions/"))}">
        <h3>Review queue</h3>
        <p class="stat__value" style="font-size:2rem;">${dashboard.submissions.pending}</p>
        <p class="small muted" style="margin:0;">${dashboard.submissions.approvedLast7Days} approved and ${dashboard.submissions.rejectedLast7Days} rejected this week</p>
      </a>
      <a class="card card--link" href="${esc(pageHref("reports/"))}">
        <h3>Open reports</h3>
        <p class="stat__value" style="font-size:2rem;">${dashboard.reports.open}</p>
        <p class="small muted" style="margin:0;">Reports from users awaiting a decision</p>
      </a>
      <a class="card card--link" href="${esc(pageHref("apps/", { status: "SUSPENDED" }))}">
        <h3>Suspended apps</h3>
        <p class="stat__value" style="font-size:2rem;">${dashboard.apps.suspended}</p>
        <p class="small muted" style="margin:0;">Not downloadable while suspended</p>
      </a>
    </div>
  `;
}
