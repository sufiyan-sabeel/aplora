import { api, esc, formatDate, isAdmin, loadSession, pageHref, table } from "@aplora/client";

export async function renderDevelopers(root: HTMLElement): Promise<void> {
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
      displayName: string;
      slug: string;
      supportEmail: string;
      isVerified: boolean;
      accountStatus: string;
      appCount: number;
      createdAt: string;
    }>;
  }>("/admin/developers?pageSize=50");

  root.innerHTML = `
    <h1>Developers</h1>
    <p class="muted">Every developer profile on the platform.</p>
    ${table(
      ["Developer", "Support email", "Account", "Verified", "Apps", "Joined"],
      items.map(
        (row) => `<tr>
          <td><strong>${esc(row.displayName)}</strong><br /><span class="small faint mono">${esc(row.slug)}</span></td>
          <td class="small">${esc(row.supportEmail)}</td>
          <td>${esc(row.accountStatus)}</td>
          <td>${row.isVerified ? "Yes" : "No"}</td>
          <td>${row.appCount}</td>
          <td>${esc(formatDate(row.createdAt))}</td>
        </tr>`,
      ),
      "No developer accounts",
    )}
  `;
}
