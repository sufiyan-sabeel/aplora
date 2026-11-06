import type { AppDetail, Paginated, ReviewDto } from "@aplora/shared-types";
import { REPORT_REASON_LABELS } from "@aplora/shared-types";
import {
  alert,
  api,
  bindForm,
  esc,
  field,
  formatBytes,
  formatDate,
  formatNumber,
  getOr,
  kv,
  loadSession,
  pageHref,
  pagination,
  param,
  stars,
  statusBadge,
  table,
  url,
} from "@aplora/client";

const reasons = Object.entries(REPORT_REASON_LABELS);

export async function renderAppDetail(root: HTMLElement): Promise<void> {
  const slug = param("slug");
  if (!slug) {
    root.innerHTML = `<div class="empty"><h3>No application selected</h3><p>Choose an application from the catalogue.</p><a class="btn btn--primary" href="${esc(pageHref("apps/"))}">Browse applications</a></div>`;
    return;
  }

  const page = Math.max(1, Number(param("page")) || 1);
  const [app, session] = await Promise.all([api.get<AppDetail>(`/apps/${encodeURIComponent(slug)}`), loadSession()]);
  const reviews = await getOr<Paginated<ReviewDto>>(`/apps/${encodeURIComponent(slug)}/reviews?page=${page}&pageSize=10`, {
    items: [],
    pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
  });

  const latest = app.latestVersion;
  const signedIn = Boolean(session.user);

  root.innerHTML = `
    <article>
      <div class="card" style="display:flex;gap:var(--space-5);align-items:flex-start;flex-wrap:wrap;">
        ${
          app.iconUrl
            ? `<img src="${esc(app.iconUrl)}" alt="" width="96" height="96" style="width:96px;height:96px;border-radius:22px;border:1px solid var(--surface-border);object-fit:cover;" />`
            : `<div class="app-card__icon app-card__icon--placeholder" style="width:96px;height:96px;border-radius:22px;font-size:2rem;" aria-hidden="true">${esc(app.name.slice(0, 1))}</div>`
        }
        <div style="flex:1;min-width:260px;">
          <h1 style="margin-bottom:4px;">${esc(app.name)}</h1>
          <p class="muted" style="margin:0 0 6px;">${esc(app.developer.displayName)} · ${esc(app.category.name)}</p>
          <div class="row" style="margin-bottom:var(--space-3);">
            ${stars(app.rating, app.reviewCount)}
            <span class="small faint">${esc(formatNumber(app.downloadCount))} downloads</span>
            ${latest ? `<span class="small faint">v${esc(latest.versionName)}</span>` : ""}
          </div>
          <p style="margin-bottom:var(--space-4);">${esc(app.shortDescription)}</p>
          <div class="btn-row">
            ${
              latest
                ? `<button class="btn btn--primary" type="button" data-download>Download APK</button>`
                : `<button class="btn" type="button" disabled>No published version</button>`
            }
            <a class="btn btn--ghost" href="${esc(pageHref("search/", { q: app.packageName }))}">Related apps</a>
          </div>
          <div data-download-status style="margin-top:var(--space-3);" aria-live="polite"></div>
          ${
            latest
              ? `<p class="small faint" style="margin:var(--space-3) 0 0;">
                  ${esc(formatBytes(latest.fileSize))} · Android ${esc(latest.minSdk ?? "?")}+ · SHA-256
                  <span class="mono">${esc((latest.sha256 ?? "").slice(0, 16))}…</span>
                </p>`
              : ""
          }
        </div>
      </div>

      <section class="section" style="margin-top:var(--space-5);">
        <h2>About this application</h2>
        <p style="white-space:pre-line;">${esc(app.fullDescription)}</p>
      </section>

      ${
        app.screenshots.length > 0
          ? `<section class="section"><h2>Screenshots</h2><div class="screenshot-strip">${app.screenshots
              .map((shot) => `<img src="${esc(shot.url)}" alt="${esc(app.name)} screenshot" loading="lazy" />`)
              .join("")}</div></section>`
          : ""
      }

      <section class="section">
        <h2>Release information</h2>
        ${kv([
          ["Version", `${esc(latest?.versionName ?? "—")} (code ${esc(latest?.versionCode ?? "—")})`],
          ["Minimum Android", esc(latest?.minSdk ?? "—")],
          ["Target Android", esc(latest?.targetSdk ?? "—")],
          ["File size", esc(formatBytes(latest?.fileSize ?? null))],
          ["Last updated", esc(formatDate(latest?.publishedAt ?? app.updatedAt))],
          ["Package", `<span class="mono">${esc(app.packageName)}</span>`],
          [
            "Signature",
            `<span class="mono">${esc(latest?.signingCertSha256 ? `${latest.signingCertSha256.slice(0, 32)}…` : "—")}</span>`,
          ],
          ["Scan status", latest?.scanStatus ? statusBadge(latest.scanStatus) : "—"],
        ])}
        <p class="small faint" style="margin-top:var(--space-3);">
          Files are scanned before publication and served with their SHA-256 checksum. A clean scan is not a guarantee
          of safety — report anything suspicious.
        </p>
      </section>

      <section class="section">
        <div class="section-head"><h2>Reviews (${reviews.pagination.total})</h2></div>
        ${
          signedIn
            ? `<form class="card form" data-review-form style="margin-bottom:var(--space-4);">
                <div data-review-status></div>
                ${field({
                  label: "Rating",
                  name: "rating",
                  type: "select",
                  options: [5, 4, 3, 2, 1].map((value) => ({ value: String(value), label: `${value} star${value === 1 ? "" : "s"}` })),
                })}
                ${field({ label: "Headline (optional)", name: "title", max: 120 })}
                ${field({ label: "Your review", name: "body", type: "textarea", required: true, rows: 4 })}
                <button class="btn btn--primary" type="submit">Post review</button>
              </form>`
            : alert("info", `Sign in to leave a review. <a href="${esc(url("login/"))}">Sign in</a>`)
        }
        ${
          reviews.items.length === 0
            ? `<div class="empty"><h3>No reviews yet</h3><p>Be the first to describe how this application works for you.</p></div>`
            : `<div class="stack">${reviews.items.map((review) => reviewMarkup(review, signedIn)).join("")}</div>
               ${pagination(reviews.pagination, (target) => pageHref("app/", { slug, page: target }))}`
        }
      </section>

      <section class="section">
        <details class="card card--tight">
          <summary style="cursor:pointer;font-weight:600;">Report this application</summary>
          ${
            signedIn
              ? `<form class="form" data-report-form style="margin-top:var(--space-4);">
                  <div data-report-status></div>
                  ${field({
                    label: "Reason",
                    name: "reason",
                    type: "select",
                    required: true,
                    options: reasons.map(([value, text]) => ({ value, label: text })),
                  })}
                  ${field({ label: "What happened? (optional)", name: "details", type: "textarea", rows: 3 })}
                  <button class="btn btn--danger" type="submit">Send report</button>
                </form>`
              : `<p class="small muted" style="margin-top:var(--space-3);"><a href="${esc(url("login/"))}">Sign in</a> to report an application.</p>`
          }
        </details>
      </section>
    </article>
  `;

  root.querySelector("[data-download]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const status = root.querySelector<HTMLElement>("[data-download-status]");
    button.disabled = true;
    button.textContent = "Preparing…";
    try {
      const ticket = await api.post<{ url: string; sha256: string; fileName: string }>(
        `/apps/${encodeURIComponent(slug)}/download`,
      );
      if (status) {
        status.innerHTML = alert(
          "success",
          `Download starting: <span class="mono">${esc(ticket.fileName)}</span><br />SHA-256 <span class="mono">${esc(ticket.sha256)}</span>`,
        );
      }
      window.location.href = ticket.url;
    } catch (error) {
      if (status) status.innerHTML = alert("error", esc((error as Error).message));
    } finally {
      button.disabled = false;
      button.textContent = "Download APK";
    }
  });

  const reviewForm = root.querySelector<HTMLFormElement>("[data-review-form]");
  if (reviewForm) {
    bindForm(
      reviewForm,
      async (values) => {
        await api.post(`/apps/${encodeURIComponent(slug)}/reviews`, {
          rating: Number(values.rating),
          title: values.title || undefined,
          body: values.body,
        });
        window.location.reload();
      },
      root.querySelector<HTMLElement>("[data-review-status]"),
    );
  }

  const reportForm = root.querySelector<HTMLFormElement>("[data-report-form]");
  if (reportForm) {
    bindForm(
      reportForm,
      async (values) => {
        await api.post(`/apps/${encodeURIComponent(slug)}/reports`, {
          reason: values.reason,
          details: values.details || undefined,
        });
        const status = root.querySelector<HTMLElement>("[data-report-status]");
        if (status) status.innerHTML = alert("success", "Report submitted for review. Thank you.");
        reportForm.reset();
      },
      root.querySelector<HTMLElement>("[data-report-status]"),
    );
  }

  root.querySelectorAll<HTMLButtonElement>("[data-delete-review]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.deleteReview;
      if (!id) return;
      button.disabled = true;
      try {
        await api.delete(`/reviews/${encodeURIComponent(id)}`);
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        const status = root.querySelector<HTMLElement>("[data-review-status]");
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });
}

function reviewMarkup(review: ReviewDto, signedIn: boolean): string {
  return `<article class="card card--tight">
    <div class="row-between">
      <div>
        <p style="margin:0;font-weight:600;">${esc(review.title ?? "Review")}</p>
        <p class="small faint" style="margin:2px 0 0;">${esc(review.author.displayName)} · ${esc(formatDate(review.createdAt))}</p>
      </div>
      ${stars(review.rating, 0, false)}
    </div>
    <p style="margin:var(--space-3) 0 0;white-space:pre-line;">${esc(review.body)}</p>
    ${
      review.mine && signedIn
        ? `<div style="margin-top:var(--space-3);"><button class="btn btn--danger btn--sm" type="button" data-delete-review="${esc(review.id)}">Delete my review</button></div>`
        : ""
    }
  </article>`;
}

void table;
