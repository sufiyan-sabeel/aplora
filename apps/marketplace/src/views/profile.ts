import {
  alert,
  api,
  bindForm,
  esc,
  field,
  formatDate,
  formatDateTime,
  kv,
  loadSession,
  mount,
  pageHref,
  table,
  url,
} from "@aplora/client";

interface SessionRow {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
}

export async function renderProfile(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  const user = session.user;
  const sessions = await api.get<{ items: SessionRow[] }>("/auth/sessions").catch(() => ({ items: [] }));

  root.innerHTML = `
    <h1>Your profile</h1>
    <div data-status></div>
    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <section class="card">
        <h2>Account</h2>
        ${kv([
          ["Name", esc(user.displayName)],
          ["Email", esc(user.email)],
          ["Email confirmed", user.emailVerified ? "Yes" : "No"],
          ["Role", esc(user.role)],
          ["Two-factor", user.mfaEnabled ? "Enabled" : "Not enabled"],
        ])}
        ${
          user.emailVerified
            ? ""
            : `<button class="btn btn--ghost btn--sm" type="button" data-resend style="margin-top:var(--space-4);">Resend confirmation email</button>`
        }
        ${
          user.developerSlug
            ? `<p class="small muted" style="margin-top:var(--space-4);">You have a developer account: <a href="${esc(url("developer/"))}">open the developer portal</a>.</p>`
            : ""
        }
      </section>

      <section class="card">
        <h2>Change password</h2>
        <div data-password-status></div>
        <form class="form" data-password-form>
          ${field({ label: "Current password", name: "currentPassword", type: "password", required: true, autocomplete: "current-password" })}
          ${field({ label: "New password", name: "newPassword", type: "password", required: true, autocomplete: "new-password" })}
          <button class="btn btn--primary" type="submit">Update password</button>
        </form>
      </section>

      <section class="card">
        <h2>Two-factor authentication</h2>
        <p class="muted">${
          user.mfaEnabled
            ? "Your account is protected by an authenticator app."
            : "Add a second factor to protect your account even if your password is exposed."
        }</p>
        ${
          user.mfaEnabled
            ? ""
            : `<a class="btn btn--ghost" href="${esc(url("mfa-setup/"))}">Set up two-factor authentication</a>`
        }
      </section>

      <section class="card">
        <h2>Active sessions</h2>
        ${table(
          ["Device", "Signed in", "Last used", ""],
          sessions.items.map(
            (row) => `<tr>
              <td><span class="truncate" style="display:inline-block;max-width:220px;">${esc(row.userAgent ?? "Unknown device")}</span>
                ${row.current ? `<span class="badge badge--accent" style="margin-left:6px;">This device</span>` : ""}</td>
              <td>${esc(formatDate(row.createdAt))}</td>
              <td>${esc(formatDateTime(row.lastUsedAt))}</td>
              <td>${row.current ? "" : `<button class="btn btn--danger btn--sm" type="button" data-revoke="${esc(row.id)}">Sign out</button>`}</td>
            </tr>`,
          ),
          "No active sessions",
        )}
      </section>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  root.querySelector("[data-resend]")?.addEventListener("click", async () => {
    try {
      const result = await api.post<{ verificationUrl?: string }>("/auth/verify-email/resend");
      if (status) {
        status.innerHTML =
          alert("success", "Confirmation email sent.") +
          (result.verificationUrl
            ? `<p class="small" style="margin-top:8px;">Confirmation link (development only): <a href="${esc(result.verificationUrl)}">confirm now</a></p>`
            : "");
      }
    } catch (error) {
      if (status) status.innerHTML = alert("error", esc((error as Error).message));
    }
  });

  const passwordForm = root.querySelector<HTMLFormElement>("[data-password-form]");
  if (passwordForm) {
    bindForm(
      passwordForm,
      async (values) => {
        await api.post("/auth/password/change", {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });
        passwordForm.reset();
        const target = root.querySelector<HTMLElement>("[data-password-status]");
        if (target) target.innerHTML = alert("success", "Password changed. Other sessions were signed out.");
      },
      root.querySelector<HTMLElement>("[data-password-status]"),
    );
  }

  root.querySelectorAll<HTMLButtonElement>("[data-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api.delete(`/auth/sessions/${encodeURIComponent(button.dataset.revoke ?? "")}`);
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });
}

export function profilePage(): void {
  mount(renderProfile, { loadingMessage: "Loading your profile…" });
}
