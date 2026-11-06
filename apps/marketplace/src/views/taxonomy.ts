import type { AppSummary, CategorySummary, Paginated } from "@aplora/shared-types";
import { api, appGrid, esc, mount, pageHref, pagination, param } from "@aplora/client";

export async function renderCategories(root: HTMLElement): Promise<void> {
  const { items } = await api.get<{ items: CategorySummary[] }>("/categories");
  root.innerHTML = `
    <h1>Categories</h1>
    ${
      items.length === 0
        ? `<div class="empty"><h3>No categories yet</h3><p>An administrator can add categories from the admin portal.</p></div>`
        : `<div class="grid grid-3">${items
            .map(
              (category) =>
                `<a class="card card--link" href="${esc(pageHref("category/", { slug: category.slug }))}">
                  <h3 style="margin-bottom:4px;">${esc(category.name)}</h3>
                  <p class="small muted" style="margin:0;">${esc(category.description ?? "Browse applications in this category.")}</p>
                  <p class="small faint" style="margin:8px 0 0;">${category.appCount} ${category.appCount === 1 ? "application" : "applications"}</p>
                </a>`,
            )
            .join("")}</div>`
    }
  `;
}

export async function renderCategory(root: HTMLElement): Promise<void> {
  const slug = param("slug");
  if (!slug) {
    root.innerHTML = `<div class="empty"><h3>No category selected</h3><a class="btn btn--primary" href="${esc(pageHref("categories/"))}">Browse categories</a></div>`;
    return;
  }
  const page = Math.max(1, Number(param("page")) || 1);
  const [{ items: categories }, listing] = await Promise.all([
    api.get<{ items: CategorySummary[] }>("/categories"),
    api.get<Paginated<AppSummary>>(`/categories/${encodeURIComponent(slug)}/apps?page=${page}&pageSize=12`),
  ]);
  const category = categories.find((entry) => entry.slug === slug);

  root.innerHTML = `
    <p class="small faint" style="margin-bottom:4px;"><a href="${esc(pageHref("categories/"))}">Categories</a> / ${esc(category?.name ?? slug)}</p>
    <h1>${esc(category?.name ?? "Category")}</h1>
    <p class="muted">${esc(category?.description ?? "")}</p>
    ${
      listing.items.length === 0
        ? `<div class="empty"><h3>No applications yet</h3><p>Nothing has been published in this category so far.</p></div>`
        : `${appGrid(listing.items)}${pagination(listing.pagination, (target) => pageHref("category/", { slug, page: target }))}`
    }
  `;
}

export async function renderCollection(root: HTMLElement): Promise<void> {
  const slug = param("slug");
  if (!slug) {
    root.innerHTML = `<div class="empty"><h3>No collection selected</h3><a class="btn btn--primary" href="${esc(pageHref(""))}">Back to the marketplace</a></div>`;
    return;
  }
  const collection = await api.get<{ title: string; description: string | null; apps: AppSummary[] }>(
    `/collections/${encodeURIComponent(slug)}`,
  );
  root.innerHTML = `
    <p class="eyebrow">Collection</p>
    <h1>${esc(collection.title)}</h1>
    <p class="muted">${esc(collection.description ?? "")}</p>
    ${collection.apps.length === 0 ? `<div class="empty"><h3>Nothing published here yet</h3></div>` : appGrid(collection.apps)}
  `;
}

export function categoriesPage(): void {
  mount(renderCategories, { loadingMessage: "Loading categories…" });
}

export function categoryPage(): void {
  mount(renderCategory, { loadingMessage: "Loading category…" });
}

export function collectionPage(): void {
  mount(renderCollection, { loadingMessage: "Loading collection…" });
}
