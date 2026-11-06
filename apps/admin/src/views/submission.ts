import {
  alert,
  api,
  bindForm,
  esc,
  field,
  formatBytes,
  formatDateTime,
  isAdmin,
  kv,
  loadSession,
  pageHref,
  param,
  statusBadge,
} from "@aplora/client";

interface SubmissionDetail {
  id: string;
  versionName: string;
  versionCode: number;
  status: string;
  minSdk: number | null;
  targetSdk: number | null;
  fileSize: number | null;
  sha256: string | null;
  signingCertSha256: string | null;
  releaseNotes: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  scanReport: unknown;
  app: {
    id: string;
    name: string;
    packageName: string;
    status: string;
    shortDescription: string;
    fullDescription: string;
    category: string;
    developer: { id: string; displayName: string; supportEmail: string; isVerified: boolean };
    screenshots: string[];
  };
  history: Array<{ from: string; to: string; note: string | null; at: string }>;
}

export async function renderSubmission(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isAdmin(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Administrator access required</h3></div>`;
    return;
  }

  const id = param("id");
  if (!id) {
    root.innerHTML = `<div class="empty"><h3>No submission selected</h3><a class="btn btn--primary" href="${esc(pageHref("submissions/"))}">Back to the queue</a></div>`;
    return;
  }

  const detail = await api.get<SubmissionDetail>(`/admin/submissions/${encodeURIComponent(id)}`);
  const decidable = ["PENDING_REVIEW", "FLAGGED", "QUARANTINED"].includes(detail.status);

  root.innerHTML = `
    <p class="small faint"><a href="${esc(pageHref("submissions/"))}">Submissions</a> / ${esc(detail.app.name)} ${esc(detail.versionName)}</p>
    <div class="row-between">
      <div>
        <h1 style="margin-bottom:4px;">${esc(detail.app.name)} <span class="muted">v${esc(detail.versionName)}</span></h1>
        <p class="muted" style="margin:0;">${esc(detail.app.developer.displayName)} · <span class="mono">${esc(detail.app.packageName)}</span> · ${esc(detail.app.category)}</p>
      </div>
      ${statusBadge(detail.status)}
    </div>
    <div data-status style="margin-top:var(--space-4);"></div>

    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <section class="card">
        <h2>Build details</h2>
        ${kv([
          ["Version code", String(detail.versionCode)],
          ["Minimum SDK", esc(detail.minSdk ?? "—")],
          ["Target SDK", esc(detail.targetSdk ?? "—")],
          ["File size", esc(formatBytes(detail.fileSize))],
          ["SHA-256", `<span class="mono" style="word-break:break-all;">${esc(detail.sha256 ?? "—")}</span>`],
          ["Signing certificate", `<span class="mono" style="word-break:break-all;">${esc(detail.signingCertSha256 ?? "—")}</span>`],
          ["Submitted", esc(detail.submittedAt ? formatDateTime(detail.submittedAt) : "—")],
        ])}
        ${detail.releaseNotes ? `<h3 style="margin-top:var(--space-4);">Release notes</h3><p class="small" style="white-space:pre-line;">${esc(detail.releaseNotes)}</p>` : ""}
      </section>

      <section class="card">
        <h2>Decision</h2>
        ${
          decidable
            ? `<div data-approve-status></div>
               <p class="small muted">Approving publishes this version immediately and makes it downloadable. The APK moves out of quarantine.</p>
               <button class="btn btn--primary" type="button" data-approve>Approve and publish</button>
               <hr />
               <div data-reject-status></div>
               <form class="form" data-reject-form>
                 ${field({ label: "Rejection reason (shown to the developer)", name: "reason", type: "textarea", required: true, rows: 3 })}
                 <button class="btn btn--danger" type="submit">Reject submission</button>
               </form>`
            : alert("info", `This submission is already ${detail.status.replaceAll("_", " ").toLowerCase()}.`)
        }
      </section>

      <section class="card">
        <h2>Listing</h2>
        <p class="muted">${esc(detail.app.shortDescription)}</p>
        <p class="small" style="white-space:pre-line;">${esc(detail.app.fullDescription)}</p>
        ${
          detail.app.screenshots.length > 0
            ? `<div class="screenshot-strip" style="margin-top:var(--space-3);">${detail.app.screenshots
                .map((url) => `<img src="${esc(url)}" alt="Screenshot" style="height:200px;width:auto;" />`)
                .join("")}</div>`
            : `<p class="small faint">No screenshots uploaded.</p>`
        }
      </section>

      <section class="card">
        <h2>History</h2>
        <div class="stack-sm">
          ${detail.history
            .map(
              (entry) => `<div class="row-between" style="border-bottom:1px solid var(--surface-border);padding-bottom:8px;">
                <div>
                  <p style="margin:0;font-size:0.9rem;">${esc(entry.from)} → <strong>${esc(entry.to)}</strong></p>
                  ${entry.note ? `<p class="small faint" style="margin:2px 0 0;">${esc(entry.note)}</p>` : ""}
                </div>
                <span class="small faint nowrap">${esc(formatDateTime(entry.at))}</span>
              </div>`,
            )
            .join("")}
        </div>
        <h3 style="margin-top:var(--space-4);">Scan report</h3>
        <pre class="small">${esc(JSON.stringify(detail.scanReport, null, 2))}</pre>
      </section>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");
  const approveButton = root.querySelector<HTMLButtonElement>("[data-approve]");
  approveButton?.addEventListener("click", async () => {
    approveButton.disabled = true;
    approveButton.textContent = "Publishing…";
    try {
      await api.post(`/admin/submissions/${encodeURIComponent(id)}/approve`, {});
      if (status) status.innerHTML = alert("success", "Approved and published.");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      approveButton.disabled = false;
      approveButton.textContent = "Approve and publish";
      if (status) status.innerHTML = alert("error", esc((error as Error).message));
    }
  });

  const rejectForm = root.querySelector<HTMLFormElement>("[data-reject-form]");
  if (rejectForm) {
    bindForm(
      rejectForm,
      async (values) => {
        await api.post(`/admin/submissions/${encodeURIComponent(id)}/reject`, { reason: values.reason });
        if (status) status.innerHTML = alert("success", "Submission rejected.");
        window.setTimeout(() => window.location.reload(), 1200);
      },
      root.querySelector<HTMLElement>("[data-reject-status]"),
    );
  }
}
