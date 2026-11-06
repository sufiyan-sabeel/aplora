import { alert, api, bindForm, esc, field, isDeveloper, loadSession, pageHref, url } from "@aplora/client";

export async function renderAppNew(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isDeveloper(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Developer access required</h3></div>`;
    return;
  }

  const { items: categories } = await api.get<{ items: Array<{ id: string; name: string }> }>("/categories");

  if (categories.length === 0) {
    root.innerHTML = `<h1>Create a listing</h1>${alert("warning", "No categories exist yet. An administrator must create one before you can publish.")}`;
    return;
  }

  root.innerHTML = `
    <p class="small faint"><a href="${esc(pageHref("apps/"))}">Applications</a> / New</p>
    <h1>Create a listing</h1>
    <p class="muted">The package name must match the APK you upload later. It cannot be changed after creation.</p>
    <div data-status style="margin-top:var(--space-3);"></div>
    <form class="card form" data-app-form style="margin-top:var(--space-4);max-width:720px;">
      ${field({ label: "Application name", name: "name", required: true, max: 80 })}
      ${field({
        label: "Package name",
        name: "packageName",
        required: true,
        placeholder: "com.example.app",
        pattern: "[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+",
        hint: "Reverse-DNS form, exactly as it appears in AndroidManifest.xml.",
      })}
      ${field({
        label: "Category",
        name: "categoryId",
        type: "select",
        required: true,
        options: categories.map((category) => ({ value: category.id, label: category.name })),
      })}
      ${field({ label: "Short description", name: "shortDescription", required: true, max: 120, hint: "Up to 120 characters, shown on cards." })}
      ${field({ label: "Full description", name: "fullDescription", type: "textarea", required: true, rows: 8 })}
      <button class="btn btn--primary" type="submit">Create listing</button>
    </form>
  `;

  const form = root.querySelector<HTMLFormElement>("[data-app-form]");
  if (!form) return;
  bindForm(
    form,
    async (values) => {
      const created = await api.post<{ id: string }>("/developer/apps", {
        name: values.name,
        packageName: values.packageName,
        categoryId: values.categoryId,
        shortDescription: values.shortDescription,
        fullDescription: values.fullDescription,
      });
      window.location.href = pageHref("app/", { id: created.id });
    },
    root.querySelector<HTMLElement>("[data-status]"),
  );
  void url;
}
