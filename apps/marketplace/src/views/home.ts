import type { AppSummary, CategorySummary, CollectionSummary, Paginated } from "@aplora/shared-types";
import { api, appGrid, esc, getOr, pageHref, url } from "@aplora/client";

const empty: Paginated<AppSummary> = { items: [], pagination: { page: 1, pageSize: 6, total: 0, totalPages: 1 } };

export async function renderHome(root: HTMLElement): Promise<void> {
  const [featured, popular, recent, topRated, categories, collections] = await Promise.all([
    getOr("/apps?featured=true&pageSize=6&sort=recent", empty),
    getOr("/apps?pageSize=6&sort=popular", empty),
    getOr("/apps?pageSize=6&sort=recent", empty),
    getOr("/apps?pageSize=6&sort=rating", empty),
    getOr<{ items: CategorySummary[] }>("/categories", { items: [] }),
    getOr<{ items: CollectionSummary[] }>("/collections", { items: [] }),
  ]);

  const rated = (topRated as Paginated<AppSummary>).items.filter((app) => app.rating > 0);
  const hasApps = (recent as Paginated<AppSummary>).pagination.total > 0;

  const section = (title: string, items: AppSummary[], link?: string, note?: string) =>
    items.length === 0
      ? ""
      : `<section class="section">
          <div class="section-head">
            <h2>${esc(title)}</h2>
            ${link ? `<a class="small" href="${esc(link)}">${esc(note ?? "See all")}</a>` : note ? `<p>${esc(note)}</p>` : ""}
          </div>
          ${appGrid(items)}
        </section>`;

  const categoriesBlock =
    categories.items.length === 0
      ? ""
      : `<section class="section">
          <div class="section-head"><h2>Browse by category</h2></div>
          <div class="grid grid-4">${categories.items
            .map(
              (category) =>
                `<a class="card card--link card--tight" href="${esc(pageHref("category/", { slug: category.slug }))}">
                  <p style="margin:0;font-weight:600;">${esc(category.name)}</p>
                  <p class="small muted" style="margin:4px 0 0;">${category.appCount} ${category.appCount === 1 ? "app" : "apps"}</p>
                </a>`,
            )
            .join("")}</div>
        </section>`;

  const collectionsBlock =
    collections.items.length === 0
      ? ""
      : `<section class="section">
          <div class="section-head"><h2>Editorial collections</h2></div>
          <div class="grid grid-2">${collections.items
            .map(
              (collection) =>
                `<a class="card card--link" href="${esc(pageHref("collection/", { slug: collection.slug }))}">
                  <h3 style="margin-bottom:6px;">${esc(collection.title)}</h3>
                  <p class="small muted" style="margin:0;">${esc(collection.description ?? "")}</p>
                  <p class="small faint" style="margin:8px 0 0;">${collection.appCount} ${collection.appCount === 1 ? "application" : "applications"}</p>
                </a>`,
            )
            .join("")}</div>
        </section>`;

  root.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Independent Android marketplace</p>
      <h1>Applications worth installing, from developers worth trusting.</h1>
      <p>
        Every listing is uploaded by its developer, checked automatically and reviewed by a person before it becomes
        available. No sponsored rankings, no inflated download counts.
      </p>
      <form class="searchbar" role="search" data-search-form>
        <label class="sr-only" for="hero-search">Search applications</label>
        <input id="hero-search" type="search" name="q" placeholder="Search by app, developer or package name" />
        <button class="btn btn--primary" type="submit">Search</button>
      </form>
    </section>

    ${
      hasApps
        ? ""
        : `<section class="section">${emptyStateNoApps()}</section>`
    }
    ${section("Featured", (featured as Paginated<AppSummary>).items, pageHref("apps/"), "Chosen by the editorial team")}
    ${section("Popular", (popular as Paginated<AppSummary>).items, pageHref("apps/", { sort: "popular" }), "Ranked by recorded downloads")}
    ${section("Recently added", (recent as Paginated<AppSummary>).items, pageHref("apps/"), "See all applications")}
    ${rated.length > 0 ? section("Top rated", rated, pageHref("apps/", { sort: "rating" }), "See all ratings") : ""}
    ${categoriesBlock}
    ${collectionsBlock}
  `;

  root.querySelector<HTMLFormElement>("[data-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget as HTMLFormElement).get("q");
    window.location.href = pageHref("search/", { q: String(value ?? "") });
  });
}

function emptyStateNoApps(): string {
  return `<div class="empty">
    <h3>No applications published yet</h3>
    <p>Aplora only shows applications that have passed review. Nothing has been published so far.</p>
    <a class="btn btn--primary" href="${esc(url("developer/"))}">Open the developer portal</a>
  </div>`;
}
