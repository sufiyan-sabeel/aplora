import { alert, api, esc, formatDateTime, isAdmin, loadSession, pageHref, statusBadge } from "@aplora/client";

export async function renderReports(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const { items } = await api.get<{
    items: Array<{
      id: string;
      reason: string;
      details: string | null;
      status: string;
      app: { id: string; name: string; slug: string };
      reporter: { email: string; displayName: string } | null;
      createdAt: string;
    }>;
  }>("/admin/reports?pageSize=50");

  root.innerHTML = `
    <h1>Reports</h1>
    <p class="muted">Reports filed by users against published applications.</p>
    <div data-status></div>
    ${
      items.length === 0
        ? `<div class="empty"><h3>No reports</h3><p>Nothing has been reported yet.</p></div>`
        : `<div class="stack" style="margin-top:var(--space-4);">${items
            .map(
              (row) => `<article class="card card--tight">
                <div class="row-between">
                  <div>
                    <p style="margin:0;font-weight:600;">${esc(row.app.name)} · ${esc(row.reason.replaceAll("_", " ").toLowerCase())}</p>
                    <p class="small faint" style="margin:2px 0 0;">${esc(row.reporter ? `${row.reporter.displayName} (${row.reporter.email})` : "Unknown reporter")} · ${esc(formatDateTime(row.createdAt))}</p>
                  </div>
                  ${statusBadge(row.status)}
                </div>
                ${row.details ? `<p class="small" style="margin:var(--space-3) 0 0;">${esc(row.details)}</p>` : ""}
                <div class="row" style="margin-top:var(--space-3);">
                  <select data-report-status="${esc(row.id)}" style="width:auto;">
                    ${["REVIEWED", "ACTIONED", "DISMISSED"].map((value) => `<option value="${value}"${value === row.status ? " selected" : ""}>${value.toLowerCase()}</option>`).join("")}
                  </select>
                  <input data-report-note="${esc(row.id)}" placeholder="Resolution note" style="max-width:320px;" />
                  <button class="btn btn--ghost btn--sm" type="button" data-report-save="${esc(row.id)}">Save</button>
                </div>
              </article>`,
            )
            .join("")}</div>`
    }
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  root.querySelectorAll<HTMLButtonElement>("[data-report-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.reportSave ?? "";
      const nextStatus = root.querySelector<HTMLSelectElement>(`[data-report-status="${id}"]`)?.value ?? "REVIEWED";
      const note = root.querySelector<HTMLInputElement>(`[data-report-note="${id}"]`)?.value ?? "";
      button.disabled = true;
      try {
        await api.patch(`/admin/reports/${encodeURIComponent(id)}`, { status: nextStatus, note: note || undefined });
        if (status) status.innerHTML = alert("success", "Report updated.");
        window.setTimeout(() => window.location.reload(), 800);
      } catch (error) {
        button.disabled = false;
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });
}
