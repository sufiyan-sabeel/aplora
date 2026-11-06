import { alert, api, esc, formatDate, formatNumber, isAdmin, loadSession, pageHref, param, statusBadge, table } from "@aplora/client";

export async function renderAdminApps(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const status = param("status");
  const search = param("search");
  const { items } = await api.get<{
    items: Array<{
      id: string;
      name: string;
      packageName: string;
      status: string;
      developer: string;
      category: string;
      versionCount: number;
      downloadCount: number;
      updatedAt: string;
      isFeatured: boolean;
    }>;
  }>(`/admin/apps?pageSize=50${status ? `&status=${encodeURIComponent(status)}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`);

  root.innerHTML = `
    <h1>Applications</h1>
    <div data-status></div>
    <form class="row" data-filter-form style="margin:var(--space-3) 0 var(--space-4);">
      <input type="search" name="search" value="${esc(search)}" placeholder="Search name or package" style="max-width:280px;" />
      <select name="status" style="width:auto;">
        <option value="">All states</option>
        ${["DRAFT", "PENDING_REVIEW", "PUBLISHED", "REJECTED", "SUSPENDED"]
          .map((value) => `<option value="${value}"${value === status ? " selected" : ""}>${value.replaceAll("_", " ").toLowerCase()}</option>`)
          .join("")}
      </select>
      <button class="btn btn--ghost btn--sm" type="submit">Filter</button>
    </form>
    ${table(
      ["Application", "Developer", "Category", "Status", "Featured", "Downloads", "Actions"],
      items.map(
        (row) => `<tr>
          <td><strong>${esc(row.name)}</strong><br /><span class="small faint mono">${esc(row.packageName)}</span></td>
          <td>${esc(row.developer)}</td>
          <td>${esc(row.category)}</td>
          <td>${statusBadge(row.status)}</td>
          <td><button class="btn btn--ghost btn--sm" type="button" data-feature="${esc(row.id)}" data-on="${row.isFeatured ? "0" : "1"}">${row.isFeatured ? "Unfeature" : "Feature"}</button></td>
          <td>${esc(formatNumber(row.downloadCount))}</td>
          <td>${
            row.status === "SUSPENDED"
              ? `<button class="btn btn--ghost btn--sm" type="button" data-app="${esc(row.id)}" data-op="restore">Restore</button>`
              : `<button class="btn btn--danger btn--sm" type="button" data-app="${esc(row.id)}" data-op="suspend">Suspend</button>`
          }</td>
        </tr>`,
      ),
      "No applications match",
    )}
    <p class="small faint" style="margin-top:var(--space-3);">Updated column omitted for space; ordering is most recently updated first.</p>
  `;

  const statusArea = root.querySelector<HTMLElement>("[data-status]");
  root.querySelector<HTMLFormElement>("[data-filter-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    window.location.href = pageHref("apps/", {
      search: String(values.get("search") ?? ""),
      status: String(values.get("status") ?? ""),
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-app]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.op === "suspend") {
          await api.post(`/admin/apps/${encodeURIComponent(button.dataset.app ?? "")}/suspend`, {
            reason: "Suspended by an administrator after review.",
          });
        } else {
          await api.post(`/admin/apps/${encodeURIComponent(button.dataset.app ?? "")}/restore`, {});
        }
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (statusArea) statusArea.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-feature]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const id = encodeURIComponent(button.dataset.feature ?? "");
        if (button.dataset.on === "1") await api.post(`/admin/apps/${id}/feature`, { rank: 0 });
        else await api.post(`/admin/apps/${id}/unfeature`, {});
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (statusArea) statusArea.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });

  void formatDate;
}
