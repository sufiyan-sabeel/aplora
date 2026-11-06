import { alert, api, esc, formatDateTime, isAdmin, loadSession, pageHref, statusBadge, table } from "@aplora/client";

export async function renderReviews(root: HTMLElement): Promise<void> {
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
      rating: number;
      title: string | null;
      body: string;
      status: string;
      author: string;
      app: { name: string };
      createdAt: string;
    }>;
  }>("/admin/reviews?pageSize=50");

  root.innerHTML = `
    <h1>Review moderation</h1>
    <div data-status></div>
    ${table(
      ["Application", "Author", "Rating", "Review", "Status", "Set status"],
      items.map(
        (row) => `<tr>
          <td>${esc(row.app.name)}</td>
          <td>${esc(row.author)}</td>
          <td>${row.rating}★</td>
          <td class="small" style="max-width:340px;">
            ${row.title ? `<strong>${esc(row.title)}<br /></strong>` : ""}
            <span>${esc(row.body.slice(0, 180))}${row.body.length > 180 ? "…" : ""}</span><br />
            <span class="faint">${esc(formatDateTime(row.createdAt))}</span>
          </td>
          <td>${statusBadge(row.status)}</td>
          <td>
            <select data-review-status="${esc(row.id)}" style="width:auto;">
              ${["VISIBLE", "HIDDEN", "REMOVED"].map((value) => `<option value="${value}"${value === row.status ? " selected" : ""}>${value.toLowerCase()}</option>`).join("")}
            </select>
            <button class="btn btn--ghost btn--sm" type="button" data-review-save="${esc(row.id)}">Set</button>
          </td>
        </tr>`,
      ),
      "No reviews yet",
    )}
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  root.querySelectorAll<HTMLButtonElement>("[data-review-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.reviewSave ?? "";
      const next = root.querySelector<HTMLSelectElement>(`[data-review-status="${id}"]`)?.value ?? "VISIBLE";
      button.disabled = true;
      try {
        await api.patch(`/admin/reviews/${encodeURIComponent(id)}`, { status: next });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });
}
