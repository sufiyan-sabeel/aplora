import type { AppSummary, Paginated } from "@aplora/shared-types";
import { api, appGrid, esc, mount, pageHref, pagination, param } from "@aplora/client";

export async function renderSearch(root: HTMLElement): Promise<void> {
  const q = param("q").trim();
  const page = Math.max(1, Number(param("page")) || 1);

  const form = `<form class="searchbar" role="search" data-search-form style="margin-bottom:var(--space-5);">
    <label class="sr-only" for="q">Search applications</label>
    <input id="q" type="search" name="q" value="${esc(q)}" placeholder="App name, developer or package" />
    <button class="btn btn--primary" type="submit">Search</button>
  </form>`;

  if (!q) {
    root.innerHTML = `<h1>Search</h1>${form}<p class="muted">Search by application name, developer name, package name or category.</p>`;
    wire(root);
    return;
  }

  const results = await api.get<Paginated<AppSummary>>(
    `/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=12`,
  );

  root.innerHTML = `
    <h1>Search</h1>
    ${form}
    ${
      results.items.length === 0
        ? `<div class="empty"><h3>No results for “${esc(q)}”</h3><p>Check the spelling, or try a developer or package name.</p><a class="btn btn--ghost" href="${esc(pageHref("apps/"))}">Browse all applications</a></div>`
        : `<p class="muted">${results.pagination.total} ${results.pagination.total === 1 ? "result" : "results"} for “${esc(q)}”</p>
           ${appGrid(results.items)}
           ${pagination(results.pagination, (target) => pageHref("search/", { q, page: target }))}`
    }
  `;
  wire(root);
}

function wire(root: HTMLElement): void {
  root.querySelector<HTMLFormElement>("[data-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget as HTMLFormElement).get("q");
    window.location.href = pageHref("search/", { q: String(value ?? "") });
  });
}

export function searchPage(): void {
  mount(renderSearch, { loadingMessage: "Searching…" });
}
