import { alert, api, bindForm, esc, field, isDeveloper, loadSession, pageHref, url } from "@aplora/client";

export async function renderProfile(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isDeveloper(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Developer access required</h3></div>`;
    return;
  }

  const profile = await api.get<{
    id: string;
    displayName: string;
    slug: string;
    website: string | null;
    supportEmail: string;
    description: string | null;
    isVerified: boolean;
    appCount: number;
    downloadCount: number;
  }>("/developer/profile");

  root.innerHTML = `
    <h1>Developer profile</h1>
    <p class="muted">This information is shown on your public listings.</p>
    <div data-status style="margin-top:var(--space-3);"></div>
    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <section class="card">
        <form class="form" data-profile-form>
          ${field({ label: "Developer name", name: "displayName", value: profile.displayName, required: true, max: 60 })}
          ${field({ label: "Support email", name: "supportEmail", type: "email", value: profile.supportEmail, required: true })}
          ${field({ label: "Website", name: "website", type: "url", value: profile.website ?? "", placeholder: "https://example.com" })}
          ${field({ label: "About your studio", name: "description", type: "textarea", value: profile.description ?? "", rows: 5 })}
          <button class="btn btn--primary" type="submit">Save profile</button>
        </form>
      </section>
      <section class="card">
        <h2>Account</h2>
        <dl class="kv">
          <dt>Developer slug</dt><dd class="mono">${esc(profile.slug)}</dd>
          <dt>Verification</dt><dd>${profile.isVerified ? "Verified" : "Not verified"}</dd>
          <dt>Applications</dt><dd>${profile.appCount}</dd>
          <dt>Total downloads</dt><dd>${profile.downloadCount}</dd>
        </dl>
        <hr />
        <h3>Two-factor authentication</h3>
        <p class="muted small">${session.user.mfaEnabled ? "Enabled for this account." : "Not enabled. You can enable it here or from the marketplace profile."}</p>
        ${session.user.mfaEnabled ? "" : `<a class="btn btn--ghost btn--sm" href="${esc(url("mfa-setup/"))}">Set up two-factor</a>`}
      </section>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("[data-profile-form]");
  if (!form) return;
  bindForm(
    form,
    async (values) => {
      await api.patch("/developer/profile", {
        displayName: values.displayName,
        supportEmail: values.supportEmail,
        website: values.website || "",
        description: values.description,
      });
      const status = root.querySelector<HTMLElement>("[data-status]");
      if (status) status.innerHTML = alert("success", "Profile updated.");
    },
    root.querySelector<HTMLElement>("[data-status]"),
  );
}
