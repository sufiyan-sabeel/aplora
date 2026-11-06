import { alert, api, esc, formatDateTime, isAdmin, loadSession, pageHref, pagination, param, statusBadge, table } from "@aplora/client";

const tabs = ["PENDING_REVIEW", "FLAGGED", "QUARANTINED", "PUBLISHED", "REJECTED"];

export async function renderSubmissions(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const status = param("status") || "PENDING_REVIEW";
  const page = Math.max(1, Number(param("page")) || 1);
  const listing = await api.get<{
    items: Array<{
      id: string;
      versionName: string;
      versionCode: number;
      status: string;
      scanStatus: string | null;
      submittedAt: string | null;
      app: { id: string; name: string; status: string; developer: string };
    }>;
    pagination: { page: number; totalPages: number; total: number };
  }>(`/admin/submissions?status=${encodeURIComponent(status)}&page=${page}&pageSize=20`);

  root.innerHTML = `
    <h1>Submissions</h1>
    <p class="muted">${listing.pagination.total} in this state</p>
    <div class="btn-row" style="margin:var(--space-3) 0 var(--space-4);">
      ${tabs
        .map(
          (tab) =>
            `<a class="btn btn--sm ${tab === status ? "btn--primary" : "btn--ghost"}" href="${esc(pageHref("submissions/", { status: tab }))}">${tab.replaceAll("_", " ").toLowerCase()}</a>`,
        )
        .join("")}
    </div>
    ${table(
      ["Application", "Developer", "Version", "Scan", "Submitted", ""],
      listing.items.map(
        (row) => `<tr>
          <td><strong>${esc(row.app.name)}</strong><br /><span class="small faint">${esc(row.app.status.replaceAll("_", " ").toLowerCase())}</span></td>
          <td>${esc(row.app.developer)}</td>
          <td>${esc(row.versionName)} <span class="small faint">(${row.versionCode})</span><br />${statusBadge(row.status)}</td>
          <td>${row.scanStatus ? statusBadge(row.scanStatus) : "—"}</td>
          <td>${row.submittedAt ? esc(formatDateTime(row.submittedAt)) : "—"}</td>
          <td><a class="btn btn--ghost btn--sm" href="${esc(pageHref("submission/", { id: row.id }))}">Review</a></td>
        </tr>`,
      ),
      "Nothing in this state",
    )}
    ${pagination(listing.pagination as never, (target) => pageHref("submissions/", { status, page: target }))}
  `;
}
