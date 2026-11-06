import {
  api,
  esc,
  formatDateTime,
  isDeveloper,
  loadSession,
  pageHref,
  statusBadge,
  table,
} from "@aplora/client";

export async function renderSubmissions(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isDeveloper(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Developer access required</h3></div>`;
    return;
  }

  const { items } = await api.get<{
    items: Array<{
      id: string;
      versionName: string;
      versionCode: number;
      status: string;
      rejectionReason: string | null;
      submittedAt: string | null;
      app: { id: string; name: string };
    }>;
  }>("/developer/submissions");

  root.innerHTML = `
    <h1>Submissions</h1>
    <p class="muted">Every version that has entered review, with the current state and any feedback.</p>
    <div style="margin-top:var(--space-4);">
      ${table(
        ["Application", "Version", "Status", "Submitted", "Feedback"],
        items.map(
          (row) => `<tr>
            <td><a href="${esc(pageHref("app/", { id: row.app.id }))}">${esc(row.app.name)}</a></td>
            <td>${esc(row.versionName)} <span class="small faint">(${row.versionCode})</span></td>
            <td>${statusBadge(row.status)}</td>
            <td>${row.submittedAt ? esc(formatDateTime(row.submittedAt)) : "—"}</td>
            <td class="small">${esc(row.rejectionReason ?? "—")}</td>
          </tr>`,
        ),
        "No submissions yet",
      )}
    </div>
  `;
}
