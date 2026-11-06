import {
  alert,
  api,
  bindForm,
  completeMfa,
  esc,
  field,
  login,
  mount,
  pageHref,
  param,
  register,
  url,
} from "@aplora/client";

export async function renderLogin(root: HTMLElement): Promise<void> {
  const mfa = param("mfa") === "1";

  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <h1>Sign in</h1>
      <p class="muted">Use the account you registered on Aplora.</p>
      <div data-status></div>
      ${
        mfa
          ? `<form class="form" data-mfa-form style="margin-top:var(--space-4);">
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
        <a href="${esc(url("forgot-password/"))}">Forgot your password?</a> ·
        <a href="${esc(url("register/"))}">Create an account</a>
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
        window.location.href = url("profile/");
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
        window.location.href = url("profile/");
      },
      status,
    );
  }
}

export async function renderRegister(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <h1>Create your account</h1>
      <p class="muted">Download applications, post reviews and report problems.</p>
      <div data-status></div>
      <form class="form" data-register-form style="margin-top:var(--space-4);">
        ${field({ label: "Your name", name: "displayName", required: true, autocomplete: "name", max: 60 })}
        ${field({ label: "Email", name: "email", type: "email", required: true, autocomplete: "email" })}
        ${field({
          label: "Password",
          name: "password",
          type: "password",
          required: true,
          autocomplete: "new-password",
          hint: "At least 10 characters, including a letter and a number.",
        })}
        <button class="btn btn--primary btn--block" type="submit">Create account</button>
      </form>
      <p class="small muted" style="margin-top:var(--space-4);">
        Publishing applications? <a href="${esc(url("developer/register/"))}">Create a developer account</a>.
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
      });
      const note = result.verificationUrl
        ? `<p class="small" style="margin-top:12px;">Confirmation link (development only): <a href="${esc(result.verificationUrl)}">confirm now</a></p>`
        : "";
      if (status) {
        status.innerHTML =
          alert("success", "Account created. Check your email to confirm your address.") + note;
      }
      window.setTimeout(() => {
        window.location.href = url("profile/");
      }, 1500);
    },
    status,
  );
}

export async function renderForgot(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <h1>Reset your password</h1>
      <p class="muted">We will email you a link that stays valid for one hour.</p>
      <div data-status></div>
      <form class="form" data-forgot-form style="margin-top:var(--space-4);">
        ${field({ label: "Email", name: "email", type: "email", required: true, autocomplete: "email" })}
        <button class="btn btn--primary btn--block" type="submit">Send reset link</button>
      </form>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  const form = root.querySelector<HTMLFormElement>("[data-forgot-form]");
  if (!form) return;

  bindForm(
    form,
    async (values) => {
      const result = await api.post<{ message?: string; resetUrl?: string }>("/auth/password/forgot", {
        email: values.email,
      });
      if (status) {
        status.innerHTML =
          alert("success", esc(result.message ?? "If that email is registered, a reset link is on its way.")) +
          (result.resetUrl
            ? `<p class="small" style="margin-top:12px;">Reset link (development only): <a href="${esc(result.resetUrl)}">open</a></p>`
            : "");
      }
    },
    status,
  );
}

export async function renderReset(root: HTMLElement): Promise<void> {
  const token = param("token");
  root.innerHTML = `
    <div class="card form--narrow" style="margin:0 auto;">
      <h1>Choose a new password</h1>
      <div data-status>${token ? "" : alert("warning", `This page needs a reset token. <a href="${esc(url("forgot-password/"))}">Request a new link</a>.`)}</div>
      ${
        token
          ? `<form class="form" data-reset-form style="margin-top:var(--space-4);">
              ${field({ label: "New password", name: "password", type: "password", required: true, autocomplete: "new-password", hint: "At least 10 characters, including a letter and a number." })}
              <button class="btn btn--primary btn--block" type="submit">Update password</button>
            </form>`
          : ""
      }
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  const form = root.querySelector<HTMLFormElement>("[data-reset-form]");
  if (!form) return;

  bindForm(
    form,
    async (values) => {
      await api.post("/auth/password/reset", { token, password: values.password });
      if (status) status.innerHTML = alert("success", "Password updated. You can sign in now.");
      window.setTimeout(() => {
        window.location.href = url("login/");
      }, 1200);
    },
    status,
  );
}

export async function renderVerify(root: HTMLElement): Promise<void> {
  const token = param("token");
  root.innerHTML = `<div class="card form--narrow" style="margin:0 auto;"><h1>Confirm your email</h1><div data-status>${alert("info", "Checking your confirmation link…")}</div></div>`;
  const status = root.querySelector<HTMLElement>("[data-status]");
  if (!status) return;

  if (!token) {
    status.innerHTML = alert("warning", `This page needs a confirmation token. Open the link from your inbox.`);
    return;
  }

  try {
    await api.post("/auth/verify-email", { token });
    status.innerHTML =
      alert("success", "Your email address is confirmed. You can now post reviews and reports.") +
      `<p class="small" style="margin-top:12px;"><a href="${esc(url("profile/"))}">Go to your profile</a></p>`;
  } catch (error) {
    status.innerHTML = alert("error", esc((error as Error).message));
  }
}

export function loginPage(): void {
  mount(renderLogin, { loadingMessage: "Preparing sign-in…" });
}
export function registerPage(): void {
  mount(renderRegister);
}
export function forgotPage(): void {
  mount(renderForgot);
}
export function resetPage(): void {
  mount(renderReset);
}
export function verifyPage(): void {
  mount(renderVerify, { loadingMessage: "Confirming your email…" });
}
