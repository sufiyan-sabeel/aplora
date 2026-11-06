import type { AppSummary, CategorySummary, Paginated } from "@aplora/shared-types";
import { api, appGrid, esc, getOr, mount, pageHref, pagination, param } from "@aplora/client";

const pageSize = 12;

export async function renderBrowse(root: HTMLElement): Promise<void> {
  const page = Math.max(1, Number(param("page")) || 1);
  const sort = param("sort") || "recent";
  const category = param("category");

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
  if (category) query.set("category", category);

  const [listing, categories] = await Promise.all([
    api.get<Paginated<AppSummary>>(`/apps?${query.toString()}`),
    getOr<{ items: CategorySummary[] }>("/categories", { items: [] }),
  ]);

  const sortOptions = [
    ["recent", "Recently added"],
    ["popular", "Most downloaded"],
    ["rating", "Highest rated"],
    ["name", "Name (A–Z)"],
  ];

  root.innerHTML = `
    <div class="row-between" style="margin-bottom:var(--space-4);">
      <div>
        <h1 style="margin-bottom:4px;">All applications</h1>
        <p class="muted" style="margin:0;">${listing.pagination.total} published ${listing.pagination.total === 1 ? "application" : "applications"}</p>
      </div>
      <div class="row">
        <label class="small muted" for="filter-category">Category</label>
        <select id="filter-category" style="width:auto;">
          <option value="">All</option>
          ${categories.items
            .map((entry) => `<option value="${esc(entry.slug)}"${entry.slug === category ? " selected" : ""}>${esc(entry.name)}</option>`)
            .join("")}
        </select>
        <label class="small muted" for="filter-sort">Sort</label>
        <select id="filter-sort" style="width:auto;">
          ${sortOptions.map(([value, text]) => `<option value="${value}"${value === sort ? " selected" : ""}>${text}</option>`).join("")}
        </select>
      </div>
    </div>
    ${
      listing.items.length === 0
        ? `<div class="empty"><h3>Nothing here yet</h3><p>No published application matches this filter.</p><a class="btn btn--ghost" href="${esc(pageHref("apps/"))}">Clear filters</a></div>`
        : `${appGrid(listing.items)}${pagination(listing.pagination, (target) => pageHref("apps/", { page: target, sort, category }))}`
    }
  `;

  const apply = () => {
    const nextCategory = (root.querySelector<HTMLSelectElement>("#filter-category")?.value ?? "").trim();
    const nextSort = root.querySelector<HTMLSelectElement>("#filter-sort")?.value ?? "recent";
    window.location.href = pageHref("apps/", { sort: nextSort, category: nextCategory || undefined });
  };
  root.querySelector("#filter-category")?.addEventListener("change", apply);
  root.querySelector("#filter-sort")?.addEventListener("change", apply);
}

export function browsePage(): void {
  mount(renderBrowse, { loadingMessage: "Loading applications…" });
}
