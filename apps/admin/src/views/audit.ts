import type { AuditLogDto } from "@aplora/shared-types";
import { api, esc, formatDateTime, isAdmin, loadSession, pageHref, pagination, param, table } from "@aplora/client";

export async function renderAudit(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const page = Math.max(1, Number(param("page")) || 1);
  const listing = await api.get<{ items: AuditLogDto[]; pagination: { page: number; totalPages: number; total: number } }>(
    `/admin/audit-logs?page=${page}&pageSize=30`,
  );

  root.innerHTML = `
    <h1>Audit log</h1>
    <p class="muted">Append-only history of administrative actions. Records cannot be edited or deleted, including with direct SQL access.</p>
    ${table(
      ["When", "Actor", "Action", "Entity", "Metadata"],
      listing.items.map(
        (row) => `<tr>
          <td class="nowrap">${esc(formatDateTime(row.createdAt))}</td>
          <td class="small">${esc(row.actor ? row.actor.email : "system")}</td>
          <td><span class="mono small">${esc(row.action)}</span></td>
          <td class="small">${esc(row.entityType)}${row.entityId ? ` · ${esc(row.entityId.slice(0, 8))}…` : ""}</td>
          <td class="small mono" style="max-width:320px;word-break:break-all;">${esc(JSON.stringify(row.metadata))}</td>
        </tr>`,
      ),
      "No entries yet",
    )}
    ${pagination(listing.pagination as never, (target) => pageHref("audit-logs/", { page: target }))}
  `;
}
