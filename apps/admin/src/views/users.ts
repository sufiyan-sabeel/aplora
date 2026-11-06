import { alert, api, esc, formatDate, isAdmin, loadSession, pageHref, pagination, param, statusBadge, table } from "@aplora/client";

export async function renderUsers(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const search = param("search");
  const page = Math.max(1, Number(param("page")) || 1);
  const listing = await api.get<{
    items: Array<{
      id: string;
      email: string;
      displayName: string;
      role: string;
      status: string;
      emailVerified: boolean;
      mfaEnabled: boolean;
      createdAt: string;
    }>;
    pagination: { page: number; totalPages: number; total: number };
  }>(`/admin/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=20`);

  root.innerHTML = `
    <h1>Users</h1>
    <div data-status></div>
    <form class="searchbar" data-search-form style="margin:var(--space-3) 0 var(--space-4);">
      <input type="search" name="search" value="${esc(search)}" placeholder="Search by email or name" />
      <button class="btn btn--ghost" type="submit">Search</button>
    </form>
    ${table(
      ["Account", "Role", "Status", "Verified", "MFA", "Joined", "Actions"],
      listing.items.map(
        (row) => `<tr>
          <td><strong>${esc(row.displayName)}</strong><br /><span class="small faint">${esc(row.email)}</span></td>
          <td>${esc(row.role)}</td>
          <td>${statusBadge(row.status)}</td>
          <td>${row.emailVerified ? "Yes" : "No"}</td>
          <td>${row.mfaEnabled ? "On" : "Off"}</td>
          <td>${esc(formatDate(row.createdAt))}</td>
          <td>${
            row.status === "ACTIVE"
              ? `<button class="btn btn--danger btn--sm" type="button" data-user="${esc(row.id)}" data-next="SUSPENDED">Suspend</button>`
              : `<button class="btn btn--ghost btn--sm" type="button" data-user="${esc(row.id)}" data-next="ACTIVE">Restore</button>`
          }</td>
        </tr>`,
      ),
      "No accounts match",
    )}
    ${pagination(listing.pagination as never, (target) => pageHref("users/", { search, page: target }))}
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  root.querySelector<HTMLFormElement>("[data-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget as HTMLFormElement).get("search");
    window.location.href = pageHref("users/", { search: String(value ?? "") });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api.patch(`/admin/users/${encodeURIComponent(button.dataset.user ?? "")}`, { status: button.dataset.next });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });
}
