import { alert, api, bindForm, esc, field, isAdmin, loadSession, pageHref } from "@aplora/client";

export async function renderSettings(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const { items } = await api.get<{ items: Array<{ key: string; value: unknown; updatedAt: string }> }>("/admin/settings");

  root.innerHTML = `
    <h1>Platform settings</h1>
    <p class="muted">Small key/value configuration read by the platform.</p>
    <div data-status></div>
    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <section class="card">
        <h2>Current settings</h2>
        ${
          items.length === 0
            ? `<p class="muted">No settings stored yet.</p>`
            : `<div class="stack-sm">${items
                .map(
                  (row) => `<div style="border-bottom:1px solid var(--surface-border);padding-bottom:8px;">
                    <p style="margin:0;font-weight:600;" class="mono">${esc(row.key)}</p>
                    <p class="small faint mono" style="margin:2px 0 0;">${esc(JSON.stringify(row.value))}</p>
                  </div>`,
                )
                .join("")}</div>`
        }
      </section>
      <section class="card">
        <h2>Set a value</h2>
        <form class="form" data-setting-form>
          ${field({ label: "Key", name: "key", required: true, max: 60, placeholder: "marketplace.announcement" })}
          ${field({
            label: "Value (JSON or plain text)",
            name: "value",
            type: "textarea",
            required: true,
            rows: 4,
            placeholder: '"Scheduled maintenance on Sunday"',
            hint: "Valid JSON is stored as-is; anything else is stored as a string.",
          })}
          <button class="btn btn--primary" type="submit">Save setting</button>
        </form>
      </section>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("[data-setting-form]");
  if (!form) return;
  bindForm(
    form,
    async (values) => {
      let parsed: unknown = values.value;
      try {
        parsed = JSON.parse(values.value ?? "");
      } catch {
        parsed = values.value;
      }
      await api.put("/admin/settings", { key: values.key, value: parsed });
      const status = root.querySelector<HTMLElement>("[data-status]");
      if (status) status.innerHTML = alert("success", "Setting saved.");
      window.setTimeout(() => window.location.reload(), 800);
    },
    root.querySelector<HTMLElement>("[data-status]"),
  );
}
