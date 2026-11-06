import { alert, api, bindForm, esc, field, loadSession, mount, pageHref, url } from "@aplora/client";

export async function renderMfaSetup(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }

  if (session.user.mfaEnabled) {
    root.innerHTML = `<div class="card form--narrow" style="margin:0 auto;"><h1>Two-factor authentication</h1>${alert("success", "Two-factor authentication is already enabled on this account.")}<p style="margin-top:var(--space-4);"><a class="btn btn--ghost" href="${esc(url("profile/"))}">Back to profile</a></p></div>`;
    return;
  }

  const setup = await api.post<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup");

  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <h1>Two-factor authentication</h1>
      <p class="muted">Add this secret to your authenticator app, then enter the six-digit code it shows.</p>
      <div class="card card--flat">
        <p class="small faint" style="margin:0 0 4px;">Secret</p>
        <p class="mono" style="word-break:break-all;margin:0;">${esc(setup.secret)}</p>
      </div>
      <div class="card card--flat" style="margin-top:var(--space-3);">
        <p class="small faint" style="margin:0 0 4px;">Setup link</p>
        <p class="mono small" style="word-break:break-all;margin:0;">${esc(setup.otpauthUrl)}</p>
      </div>
      <div data-status style="margin-top:var(--space-4);"></div>
      <form class="form" data-enable-form style="margin-top:var(--space-3);">
        ${field({ label: "Code from your app", name: "code", required: true, autocomplete: "one-time-code" })}
        <button class="btn btn--primary btn--block" type="submit">Enable two-factor</button>
      </form>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("[data-enable-form]");
  if (!form) return;
  bindForm(
    form,
    async (values) => {
      await api.post("/auth/mfa/enable", { secret: setup.secret, code: values.code });
      window.location.href = url("profile/");
    },
    root.querySelector<HTMLElement>("[data-status]"),
  );
}

export function mfaPage(): void {
  mount(renderMfaSetup, { loadingMessage: "Starting two-factor setup…" });
}
