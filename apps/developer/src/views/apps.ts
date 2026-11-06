import { api, esc, formatDate, isDeveloper, loadSession, pageHref, statusBadge, table } from "@aplora/client";

export async function renderApps(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isDeveloper(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Developer access required</h3><p>This account is not a developer account.</p></div>`;
    return;
  }

  const { items } = await api.get<{
    items: Array<{ id: string; name: string; packageName: string; status: string; updatedAt: string; versionCount: number }>;
  }>("/developer/apps");

  root.innerHTML = `
    <div class="row-between">
      <h1>Applications</h1>
      <a class="btn btn--primary" href="${esc(pageHref("app-new/"))}">New application</a>
    </div>
    <div style="margin-top:var(--space-4);">
      ${table(
        ["Name", "Package", "Status", "Versions", "Updated", ""],
        items.map(
          (entry) => `<tr>
            <td><strong>${esc(entry.name)}</strong></td>
            <td class="mono small">${esc(entry.packageName)}</td>
            <td>${statusBadge(entry.status)}</td>
            <td>${entry.versionCount}</td>
            <td>${esc(formatDate(entry.updatedAt))}</td>
            <td><a class="btn btn--ghost btn--sm" href="${esc(pageHref("app/", { id: entry.id }))}">Open</a></td>
          </tr>`,
        ),
        "Nothing here yet",
      )}
    </div>
  `;
}
