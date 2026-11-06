import { alert, api, bindForm, esc, field, isAdmin, loadSession, pageHref } from "@aplora/client";

export async function renderCategories(root: HTMLElement): Promise<void> {
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
    items: Array<{ id: string; slug: string; name: string; description: string | null; sortOrder: number; isActive: boolean; appCount: number }>;
  }>("/admin/categories");

  root.innerHTML = `
    <h1>Categories</h1>
    <div data-status></div>
    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <section class="card">
        <h2>Existing categories</h2>
        <div class="stack-sm">
          ${items
            .map(
              (row) => `<div class="row-between" style="border-bottom:1px solid var(--surface-border);padding-bottom:8px;">
                <div>
                  <p style="margin:0;font-weight:600;">${esc(row.name)}</p>
                  <p class="small faint" style="margin:2px 0 0;">${esc(row.slug)} · ${row.appCount} apps · order ${row.sortOrder}</p>
                </div>
                <div class="row">
                  <span class="badge${row.isActive ? " badge--success" : ""}">${row.isActive ? "Active" : "Hidden"}</span>
                  <button class="btn btn--ghost btn--sm" type="button" data-toggle="${esc(row.id)}" data-next="${row.isActive ? "false" : "true"}">${row.isActive ? "Hide" : "Show"}</button>
                </div>
              </div>`,
            )
            .join("")}
        </div>
      </section>
      <section class="card">
        <h2>Add a category</h2>
        <form class="form" data-create-form>
          ${field({ label: "Name", name: "name", required: true, max: 60 })}
          ${field({ label: "Slug (optional)", name: "slug", placeholder: "productivity" })}
          ${field({ label: "Description", name: "description", max: 500 })}
          ${field({ label: "Sort order", name: "sortOrder", type: "number", value: 0, min: 0, max: 999 })}
          <button class="btn btn--primary" type="submit">Create category</button>
        </form>
        <p class="small faint" style="margin-top:var(--space-4);">Collections are managed on the <a href="${esc(pageHref("collections/"))}">collections page</a>.</p>
      </section>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  root.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api.patch(`/admin/categories/${encodeURIComponent(button.dataset.toggle ?? "")}`, {
          isActive: button.dataset.next === "true",
        });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });

  const createForm = root.querySelector<HTMLFormElement>("[data-create-form]");
  if (createForm) {
    bindForm(
      createForm,
      async (values) => {
        await api.post("/admin/categories", {
          name: values.name,
          slug: values.slug || undefined,
          description: values.description || undefined,
          sortOrder: Number(values.sortOrder || 0),
        });
        window.location.reload();
      },
      status,
    );
  }
}

export async function renderCollections(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const [{ items: collections }, { items: apps }] = await Promise.all([
    api.get<{ items: Array<{ id: string; slug: string; title: string; description: string | null; isActive: boolean; appCount: number }> }>(
      "/admin/collections",
    ),
    api.get<{ items: Array<{ id: string; name: string; status: string }> }>("/admin/apps?status=PUBLISHED&pageSize=50"),
  ]);

  root.innerHTML = `
    <h1>Collections</h1>
    <p class="muted">Editorial groupings shown on the marketplace home page.</p>
    <div data-status></div>
    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <section class="card">
        <h2>Existing collections</h2>
        ${
          collections.length === 0
            ? `<p class="muted">No collections yet.</p>`
            : `<div class="stack-sm">${collections
                .map(
                  (row) => `<div class="row-between" style="border-bottom:1px solid var(--surface-border);padding-bottom:8px;">
                    <div>
                      <p style="margin:0;font-weight:600;">${esc(row.title)}</p>
                      <p class="small faint" style="margin:2px 0 0;">${esc(row.slug)} · ${row.appCount} apps</p>
                    </div>
                    <div class="row">
                      <span class="badge${row.isActive ? " badge--success" : ""}">${row.isActive ? "Active" : "Hidden"}</span>
                      <button class="btn btn--ghost btn--sm" type="button" data-toggle="${esc(row.id)}" data-next="${row.isActive ? "false" : "true"}">${row.isActive ? "Hide" : "Show"}</button>
                    </div>
                  </div>`,
                )
                .join("")}</div>`
        }
      </section>
      <section class="card">
        <h2>Create a collection</h2>
        <form class="form" data-create-form>
          ${field({ label: "Title", name: "title", required: true, max: 80 })}
          ${field({ label: "Description", name: "description", max: 500 })}
          <div class="field">
            <label for="collection-apps">Applications</label>
            <select id="collection-apps" name="appIds" multiple size="8">
              ${apps.map((app) => `<option value="${esc(app.id)}">${esc(app.name)}</option>`).join("")}
            </select>
            <span class="hint">Hold Ctrl or Cmd to select more than one.</span>
          </div>
          <button class="btn btn--primary" type="submit">Create collection</button>
        </form>
        ${apps.length === 0 ? `<p class="small faint" style="margin-top:var(--space-3);">Publish an application before creating a collection.</p>` : ""}
      </section>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  root.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api.patch(`/admin/collections/${encodeURIComponent(button.dataset.toggle ?? "")}`, {
          isActive: button.dataset.next === "true",
        });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });

  const createForm = root.querySelector<HTMLFormElement>("[data-create-form]");
  if (createForm) {
    bindForm(
      createForm,
      async (_values, form) => {
        const selected = [...(form.querySelector<HTMLSelectElement>("#collection-apps")?.selectedOptions ?? [])].map(
          (option) => option.value,
        );
        const data = new FormData(form);
        await api.post("/admin/collections", {
          title: String(data.get("title") ?? ""),
          description: String(data.get("description") ?? "") || undefined,
          appIds: selected,
        });
        window.location.reload();
      },
      status,
    );
  }
}
