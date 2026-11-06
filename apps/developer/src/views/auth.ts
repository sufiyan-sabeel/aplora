import {
  alert,
  api,
  bindForm,
  completeMfa,
  esc,
  field,
  loadSession,
  login,
  pageHref,
  register,
  url,
} from "@aplora/client";

export async function renderLogin(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (session.user) {
    window.location.href = pageHref("");
    return;
  }
  const mfa = new URLSearchParams(window.location.search).get("mfa") === "1";

  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <p class="eyebrow">Aplora Developer</p>
      <h1>Sign in</h1>
      <p class="muted">Manage your listings, uploads and releases.</p>
      <div data-status></div>
      ${
        mfa
          ? `<form class="form" data-mfa-form style="margin-top:var(--space-4);">
              ${alert("info", "Enter the six-digit code from your authenticator app to finish signing in.")}
              ${field({ label: "Authenticator code", name: "code", required: true, inputmode: "numeric", autocomplete: "one-time-code" })}
              <button class="btn btn--primary btn--block" type="submit">Verify and continue</button>
            </form>`
          : `<form class="form" data-login-form style="margin-top:var(--space-4);">
              ${field({ label: "Email", name: "email", type: "email", required: true, autocomplete: "email" })}
              ${field({ label: "Password", name: "password", type: "password", required: true, autocomplete: "current-password" })}
              <button class="btn btn--primary btn--block" type="submit">Sign in</button>
            </form>`
      }
      <p class="small muted" style="margin-top:var(--space-4);">
        <a href="${esc(url("register/"))}">Create a developer account</a> ·
        <a href="${esc(url(""))}">Back to the marketplace</a>
      </p>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  const loginForm = root.querySelector<HTMLFormElement>("[data-login-form]");
  if (loginForm) {
    bindForm(
      loginForm,
      async (values) => {
        const result = await login(values.email ?? "", values.password ?? "");
        if (result.mfaRequired) {
          window.location.href = pageHref("login/", { mfa: 1 });
          return;
        }
        window.location.href = pageHref("");
      },
      status,
    );
  }
  const mfaForm = root.querySelector<HTMLFormElement>("[data-mfa-form]");
  if (mfaForm) {
    bindForm(
      mfaForm,
      async (values) => {
        await completeMfa(values.code ?? "");
        window.location.href = pageHref("");
      },
      status,
    );
  }
}

export async function renderRegister(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (session.user) {
    window.location.href = pageHref("");
    return;
  }

  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <p class="eyebrow">Aplora Developer</p>
      <h1>Create a developer account</h1>
      <p class="muted">Publish Android applications, manage releases and see real download statistics.</p>
      <div data-status></div>
      <form class="form" data-register-form style="margin-top:var(--space-4);">
        ${field({ label: "Your name", name: "displayName", required: true, autocomplete: "name", max: 60 })}
        ${field({ label: "Developer or studio name", name: "developerName", required: true, max: 60, hint: "Shown publicly on your listings." })}
        ${field({ label: "Support email", name: "supportEmail", type: "email", required: true })}
        ${field({ label: "Sign-in email", name: "email", type: "email", required: true, autocomplete: "email" })}
        ${field({
          label: "Password",
          name: "password",
          type: "password",
          required: true,
          autocomplete: "new-password",
          hint: "At least 10 characters, including a letter and a number.",
        })}
        <button class="btn btn--primary btn--block" type="submit">Create developer account</button>
      </form>
      <p class="small muted" style="margin-top:var(--space-4);">
        Just here to install apps? <a href="${esc(url("register/"))}">Create a normal account</a>.
      </p>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  const form = root.querySelector<HTMLFormElement>("[data-register-form]");
  if (!form) return;

  bindForm(
    form,
    async (values) => {
      const result = await register({
        email: values.email ?? "",
        password: values.password ?? "",
        displayName: values.displayName ?? "",
        accountType: "DEVELOPER",
        developerName: values.developerName,
        supportEmail: values.supportEmail,
      });
      if (status) {
        status.innerHTML =
          alert("success", "Developer account created. Confirm your email to unlock everything.") +
          (result.verificationUrl
            ? `<p class="small" style="margin-top:10px;">Confirmation link (development only): <a href="${esc(result.verificationUrl)}">confirm now</a></p>`
            : "");
      }
      window.setTimeout(() => {
        window.location.href = pageHref("");
      }, 1500);
    },
    status,
  );
}

export async function renderMfaSetup(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (session.user.mfaEnabled) {
    root.innerHTML = `<div class="card form--narrow" style="margin:0 auto;"><h1>Two-factor authentication</h1>${alert("success", "Two-factor authentication is already enabled.")}<p style="margin-top:var(--space-4);"><a class="btn btn--ghost" href="${esc(url("profile/"))}">Back to profile</a></p></div>`;
    return;
  }

  const setup = await api.post<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup");
  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <h1>Two-factor authentication</h1>
      <p class="muted">Add this secret to your authenticator app, then confirm with a six-digit code.</p>
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
        ${field({ label: "Code from your app", name: "code", required: true, inputmode: "numeric", autocomplete: "one-time-code" })}
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
      window.location.href = pageHref("profile/");
    },
    root.querySelector<HTMLElement>("[data-status]"),
  );
}
