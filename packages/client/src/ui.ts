import type { AppSummary, Pagination, ReviewDto } from "@aplora/shared-types";
import { ApiError } from "./api";
import { config, url } from "./config";

/* ------------------------------------------------------------------ escape */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Escapes a value for use inside an attribute. */
export function attr(value: unknown): string {
  return esc(value);
}

/* -------------------------------------------------------------- formatting */

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusTone(status: string): "accent" | "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "PUBLISHED":
    case "APPROVED":
    case "CLEAN":
    case "ACTIVE":
    case "VISIBLE":
    case "ACTIONED":
      return "success";
    case "PENDING_REVIEW":
    case "UPLOADED":
    case "VALIDATING":
    case "SCANNING":
    case "OPEN":
    case "REVIEWED":
      return "warning";
    case "REJECTED":
    case "SUSPENDED":
    case "FLAGGED":
    case "QUARANTINED":
    case "INFECTED":
    case "REMOVED":
      return "danger";
    case "DRAFT":
    case "HIDDEN":
    case "DISMISSED":
      return "neutral";
    default:
      return "accent";
  }
}

export function label(value: string): string {
  const readable = value.replaceAll("_", " ").toLowerCase();
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

/* -------------------------------------------------------------- components */

export function badge(text: string, tone: "neutral" | "accent" | "success" | "warning" | "danger" = "neutral"): string {
  return `<span class="badge${tone === "neutral" ? "" : ` badge--${tone}`}">${esc(text)}</span>`;
}

export function statusBadge(status: string): string {
  return badge(label(status), statusTone(status));
}

export function stars(rating: number, reviewCount = 0, showCount = true): string {
  const rounded = Math.round(rating);
  const svg = [1, 2, 3, 4, 5]
    .map(
      (star) =>
        `<svg viewBox="0 0 24 24" fill="${star <= rounded ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`,
    )
    .join("");
  const text = rating > 0 ? rating.toFixed(1) : "No ratings";
  const count = showCount && reviewCount > 0 ? ` (${reviewCount})` : "";
  return `<span class="rating" aria-label="Rated ${rating.toFixed(1)} out of 5 from ${reviewCount} reviews"><span class="rating__stars">${svg}</span><span>${esc(text)}${esc(count)}</span></span>`;
}

export function alert(tone: "info" | "success" | "warning" | "error", message: string, title?: string): string {
  return `<div class="alert alert--${tone}" role="${tone === "error" ? "alert" : "status"}">${
    title ? `<strong style="display:block;margin-bottom:4px;">${esc(title)}</strong>` : ""
  }${message}</div>`;
}

export function emptyState(title: string, description = "", actionHtml = ""): string {
  return `<div class="empty"><h3>${esc(title)}</h3>${description ? `<p>${esc(description)}</p>` : ""}${actionHtml}</div>`;
}

export function appCard(app: AppSummary): string {
  const icon = app.iconUrl
    ? `<img class="app-card__icon" src="${attr(app.iconUrl)}" alt="" width="56" height="56" loading="lazy" />`
    : `<span class="app-card__icon app-card__icon--placeholder" aria-hidden="true">${esc(app.name.slice(0, 2).toUpperCase())}</span>`;
  return `<a class="card card--link app-card" href="${attr(url(`app/?slug=${encodeURIComponent(app.slug)}`))}">
    <div class="app-card__head">${icon}
      <div style="min-width:0;">
        <h3 class="app-card__title">${esc(app.name)}</h3>
        <p class="app-card__dev">${esc(app.developer.displayName)}</p>
        <p class="app-card__dev" style="color:var(--text-faint);">${esc(app.category.name)}</p>
      </div>
    </div>
    <p class="app-card__desc">${esc(app.shortDescription)}</p>
    <div class="app-card__meta">${stars(app.rating, app.reviewCount)}<span>${esc(formatNumber(app.downloadCount))} downloads</span></div>
  </a>`;
}

export function appGrid(apps: AppSummary[]): string {
  return `<div class="grid grid-3">${apps.map(appCard).join("")}</div>`;
}

export function stat(labelText: string, value: string, hint = ""): string {
  return `<div class="stat"><p class="stat__label">${esc(labelText)}</p><p class="stat__value">${esc(value)}</p>${
    hint ? `<p class="stat__hint">${esc(hint)}</p>` : ""
  }</div>`;
}

export function kv(rows: Array<[string, string]>): string {
  return `<dl class="kv">${rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

export function table(headers: string[], rows: string[], emptyMessage = "Nothing to show"): string {
  if (rows.length === 0) return emptyState(emptyMessage);
  return `<div class="table-wrap"><table class="data"><thead><tr>${headers
    .map((header) => `<th>${esc(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

export function pagination(page: Pagination, hrefFor: (page: number) => string): string {
  if (page.totalPages <= 1) return "";
  const window: number[] = [];
  for (let index = Math.max(1, page.page - 2); index <= Math.min(page.totalPages, page.page + 2); index += 1) {
    window.push(index);
  }
  const link = (target: number, text: string) =>
    target === page.page
      ? `<span aria-current="page">${esc(text)}</span>`
      : `<a href="${attr(hrefFor(target))}">${esc(text)}</a>`;
  return `<nav class="pagination" aria-label="Pagination">
    ${page.page > 1 ? link(page.page - 1, "Previous") : `<span class="is-disabled">Previous</span>`}
    ${window[0]! > 1 ? link(1, "1") : ""}
    ${window[0]! > 2 ? `<span class="is-disabled">…</span>` : ""}
    ${window.map((number) => link(number, String(number))).join("")}
    ${window[window.length - 1]! < page.totalPages ? link(page.totalPages, String(page.totalPages)) : ""}
    ${page.page < page.totalPages ? link(page.page + 1, "Next") : `<span class="is-disabled">Next</span>`}
  </nav>`;
}

export function reviewCard(review: ReviewDto, canManage: boolean, onDelete?: string): string {
  return `<article class="card card--tight">
    <div class="row-between">
      <div>
        <p style="margin:0;font-weight:600;">${esc(review.title ?? "Review")}</p>
        <p class="small faint" style="margin:2px 0 0;">${esc(review.author.displayName)} · ${esc(formatDate(review.createdAt))}</p>
      </div>
      ${stars(review.rating, 0, false)}
    </div>
    <p style="margin:var(--space-3) 0 0;white-space:pre-line;">${esc(review.body)}</p>
    ${canManage && onDelete ? `<div style="margin-top:var(--space-3);"><button class="btn btn--danger btn--sm" type="button" data-action="${attr(onDelete)}">Delete my review</button></div>` : ""}
  </article>`;
}

export function field(options: {
  label: string;
  name: string;
  type?: string;
  value?: string | number | null;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  autocomplete?: string;
  min?: number | string;
  max?: number | string;
  rows?: number;
  pattern?: string;
  accept?: string;
  options?: Array<{ value: string; label: string; selected?: boolean }>;
  multiple?: boolean;
  size?: number;
  step?: number | string;
  inputmode?: "text" | "numeric" | "email" | "tel" | "url";
}): string {
  const id = `field-${options.name}`;
  const common = `id="${attr(id)}" name="${attr(options.name)}"${options.required ? " required" : ""}${
    options.hint ? ` aria-describedby="${attr(id)}-hint"` : ""
  }`;
  let control: string;

  if (options.type === "textarea") {
    control = `<textarea ${common} rows="${options.rows ?? 5}" maxlength="8000" placeholder="${attr(options.placeholder ?? "")}">${esc(options.value ?? "")}</textarea>`;
  } else if (options.type === "select") {
    control = `<select ${common}>${(options.options ?? [])
      .map(
        (option) =>
          `<option value="${attr(option.value)}"${option.selected ? " selected" : ""}>${esc(option.label)}</option>`,
      )
      .join("")}</select>`;
  } else {
    control = `<input ${common} type="${attr(options.type ?? "text")}" value="${attr(options.value ?? "")}"${
      options.placeholder ? ` placeholder="${attr(options.placeholder)}"` : ""
    }${options.autocomplete ? ` autocomplete="${attr(options.autocomplete)}"` : ""}${
      options.min !== undefined ? ` min="${attr(options.min)}"` : ""
    }${options.max !== undefined ? ` max="${attr(options.max)}"` : ""}${
      options.step !== undefined ? ` step="${attr(options.step)}"` : ""
    }${options.pattern ? ` pattern="${attr(options.pattern)}"` : ""}${
      options.inputmode ? ` inputmode="${attr(options.inputmode)}"` : ""
    }${
      options.accept ? ` accept="${attr(options.accept)}"` : ""
    }${options.multiple ? " multiple" : ""}${options.size ? ` size="${options.size}"` : ""} />`;
  }

  return `<div class="field"><label for="${attr(id)}">${esc(options.label)}${options.required ? " *" : ""}</label>${control}${
    options.hint ? `<span class="hint" id="${attr(id)}-hint">${esc(options.hint)}</span>` : ""
  }</div>`;
}

/* --------------------------------------------------------------- mounting */

export function loadingState(message = "Loading…"): string {
  return `<div class="stack" aria-busy="true" aria-live="polite">
    <div class="skeleton" style="height:28px;width:40%;">.</div>
    <div class="skeleton" style="height:120px;">.</div>
    <div class="skeleton" style="height:120px;">.</div>
    <p class="small faint">${esc(message)}</p>
  </div>`;
}

/** A readable explanation for any failure, never a stack trace. */
export function errorMarkup(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "api_unconfigured") {
      return emptyState(
        "The API is not configured",
        "This build was published without PUBLIC_API_BASE_URL, so there is no backend to talk to. Set it to your API's base URL and rebuild.",
      );
    }
    if (error.isNetworkError) {
      return emptyState(
        "Cannot reach the Aplora API",
        "The marketplace backend did not answer. It may be offline, or this deployment may point at the wrong address.",
        `<button class="btn btn--ghost" type="button" data-retry>Try again</button>`,
      );
    }
    if (error.status === 401) {
      return emptyState("Sign in to continue", "Your session has expired or you are not signed in.",
        `<a class="btn btn--primary" href="${attr(url("login/"))}">Sign in</a>`);
    }
    if (error.status === 403) {
      return emptyState("Not allowed", error.message);
    }
    if (error.status === 404) {
      return emptyState("Not found", error.message);
    }
    return `<div class="stack">${alert("error", esc(error.message))}</div>`;
  }
  return `<div class="stack">${alert("error", "Something went wrong while loading this page.")}</div>`;
}

export interface MountOptions {
  /** Where to render; defaults to #view */
  target?: string;
  loadingMessage?: string;
}

/**
 * Renders a page. Shows a loading state, then either the content or a readable
 * error, and wires up the retry button. Every portal page goes through here, so
 * loading, empty and error behaviour is consistent.
 */
export function mount(render: (root: HTMLElement) => Promise<void> | void, options: MountOptions = {}): void {
  const root = document.getElementById(options.target ?? "view");
  if (!root) return;

  const run = async () => {
    root.innerHTML = loadingState(options.loadingMessage);
    try {
      await render(root);
    } catch (error) {
      root.innerHTML = errorMarkup(error);
      root.querySelector("[data-retry]")?.addEventListener("click", () => void run());
    }
  };

  void run();
}

/** Serialises a form's fields into a plain object. */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const values: Record<string, string> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/**
 * Wires a form to an async handler: disables the button while working, shows the
 * API's error message inline and re-enables everything afterwards.
 */
export function bindForm(
  form: HTMLFormElement,
  handler: (values: Record<string, string>, form: HTMLFormElement) => Promise<void>,
  status: HTMLElement | null,
): void {
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  const original = button?.textContent ?? "Submit";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (status) status.innerHTML = "";
    if (button) {
      button.disabled = true;
      button.textContent = "Working…";
    }
    try {
      await handler(formValues(form), form);
    } catch (error) {
      if (status) status.innerHTML = errorMarkup(error);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  });
}

/** Reads a query parameter from the current URL. */
export function param(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

export function goTo(path: string): void {
  window.location.href = url(path);
}

/** Builds a link to this deployment with query parameters. */
export function pageHref(path: string, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return url(path) + (text ? `?${text}` : "");
}

export { config, url };
