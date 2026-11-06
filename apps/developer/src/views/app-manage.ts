import {
  alert,
  api,
  bindForm,
  esc,
  field,
  formatBytes,
  formatDateTime,
  isDeveloper,
  loadSession,
  pageHref,
  param,
  statusBadge,
  table,
} from "@aplora/client";

interface VersionRow {
  id: string;
  versionName: string;
  versionCode: number;
  status: string;
  fileSize: number | null;
  sha256: string | null;
  scanStatus: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
}

interface ManagedApp {
  id: string;
  slug: string;
  name: string;
  packageName: string;
  shortDescription: string;
  fullDescription: string;
  status: string;
  category: { id: string; name: string };
  downloadCount: number;
  assets: Array<{ id: string; kind: string; url: string }>;
  versions: VersionRow[];
}

const submittable = (status: string) => ["UPLOADED", "QUARANTINED", "REJECTED", "FLAGGED"].includes(status);

export async function renderAppManage(root: HTMLElement): Promise<void> {
  const session = await loadSession(true);
  if (!session.user) {
    window.location.href = pageHref("login/");
    return;
  }
  if (!isDeveloper(session.user)) {
    root.innerHTML = `<div class="empty"><h3>Developer access required</h3></div>`;
    return;
  }

  const id = param("id");
  if (!id) {
    root.innerHTML = `<div class="empty"><h3>No application selected</h3><a class="btn btn--primary" href="${esc(pageHref("apps/"))}">Back to applications</a></div>`;
    return;
  }

  const [app, categoriesResponse] = await Promise.all([
    api.get<ManagedApp>(`/developer/apps/${encodeURIComponent(id)}`),
    api.get<{ items: Array<{ id: string; name: string }> }>("/categories"),
  ]);
  const categories = categoriesResponse.items;
  const latest = app.versions[0] ?? null;

  root.innerHTML = `
    <p class="small faint"><a href="${esc(pageHref("apps/"))}">Applications</a> / ${esc(app.name)}</p>
    <div class="row-between">
      <div>
        <h1 style="margin-bottom:4px;">${esc(app.name)}</h1>
        <p class="muted" style="margin:0;"><span class="mono">${esc(app.packageName)}</span> · ${esc(app.category.name)} · ${statusBadge(app.status)}</p>
      </div>
      <a class="btn btn--ghost" href="${esc(pageHref("submissions/"))}">View submissions</a>
    </div>
    <div data-status style="margin-top:var(--space-4);"></div>
    ${latest?.rejectionReason ? `<div style="margin-top:var(--space-4);">${alert("error", esc(latest.rejectionReason), "Last review feedback")}</div>` : ""}

    <div class="grid grid-2" style="margin-top:var(--space-5);">
      <section class="card">
        <h2>Listing details</h2>
        <form class="form" data-listing-form>
          ${field({ label: "Name", name: "name", value: app.name, required: true, max: 80 })}
          ${field({
            label: "Category",
            name: "categoryId",
            type: "select",
            options: categories.map((category) => ({
              value: category.id,
              label: category.name,
              selected: category.id === app.category.id,
            })),
          })}
          ${field({ label: "Short description", name: "shortDescription", value: app.shortDescription, required: true, max: 120 })}
          ${field({ label: "Full description", name: "fullDescription", type: "textarea", value: app.fullDescription, rows: 8, required: true })}
          <button class="btn btn--primary" type="submit">Save changes</button>
        </form>
      </section>

      <section class="card">
        <h2>Upload an APK</h2>
        <p class="small muted">The archive is stored in quarantine. Nothing is public until it has been validated, scanned and approved.</p>
        <div data-upload-status></div>
        <form class="form" data-upload-form>
          ${field({ label: "Version name", name: "versionName", required: true, placeholder: "1.0.0" })}
          ${field({ label: "Version code", name: "versionCode", type: "number", required: true, min: 1, hint: "Must match versionCode inside the APK." })}
          ${field({ label: "Release notes (optional)", name: "releaseNotes", type: "textarea", rows: 3 })}
          ${field({ label: "APK file", name: "apk", type: "file", required: true, accept: ".apk,application/vnd.android.package-archive" })}
          <button class="btn btn--primary" type="submit">Upload APK</button>
        </form>

        <hr />
        <h3>Images</h3>
        <div data-image-status></div>
        <form class="form" data-image-form>
          ${field({
            label: "Image type",
            name: "kind",
            type: "select",
            options: [
              { value: "ICON", label: "Icon (512×512 max)" },
              { value: "SCREENSHOT", label: "Screenshot" },
              { value: "FEATURE_GRAPHIC", label: "Feature graphic" },
            ],
          })}
          ${field({ label: "PNG, JPEG or WebP", name: "image", type: "file", required: true, accept: "image/png,image/jpeg,image/webp" })}
          <button class="btn btn--ghost" type="submit">Upload image</button>
        </form>
        ${
          app.assets.length > 0
            ? `<div class="row" style="margin-top:var(--space-3);">${app.assets
                .map(
                  (asset) => `<div class="stack-sm" style="align-items:center;">
                    <img src="${esc(asset.url)}" alt="${esc(asset.kind)}" style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid var(--surface-border);" />
                    <button class="btn btn--danger btn--sm" type="button" data-remove-asset="${esc(asset.id)}">Remove</button>
                  </div>`,
                )
                .join("")}</div>`
            : ""
        }
      </section>
    </div>

    <section class="section" style="margin-top:var(--space-6);">
      <h2>Versions</h2>
      ${table(
        ["Version", "Status", "Scan", "Size", "SHA-256", "Submitted", ""],
        app.versions.map(
          (version) => `<tr>
            <td><strong>${esc(version.versionName)}</strong><br /><span class="small faint">code ${version.versionCode}</span></td>
            <td>${statusBadge(version.status)}</td>
            <td>${version.scanStatus ? statusBadge(version.scanStatus) : "—"}</td>
            <td>${esc(formatBytes(version.fileSize))}</td>
            <td class="mono small">${version.sha256 ? `${esc(version.sha256.slice(0, 12))}…` : "—"}</td>
            <td>${version.submittedAt ? esc(formatDateTime(version.submittedAt)) : "—"}</td>
            <td>${
              submittable(version.status)
                ? `<button class="btn btn--primary btn--sm" type="button" data-submit="${esc(version.id)}">Submit for review</button>`
                : version.rejectionReason
                  ? `<span class="small faint">${esc(version.rejectionReason.slice(0, 60))}…</span>`
                  : ""
            }</td>
          </tr>`,
        ),
        "No versions uploaded",
      )}
    </section>
  `;

  const status = root.querySelector<HTMLElement>("[data-status]");

  const listingForm = root.querySelector<HTMLFormElement>("[data-listing-form]");
  if (listingForm) {
    bindForm(
      listingForm,
      async (values) => {
        await api.patch(`/developer/apps/${encodeURIComponent(id)}`, {
          name: values.name,
          categoryId: values.categoryId,
          shortDescription: values.shortDescription,
          fullDescription: values.fullDescription,
        });
        if (status) status.innerHTML = alert("success", "Listing updated.");
      },
      status,
    );
  }

  const uploadForm = root.querySelector<HTMLFormElement>("[data-upload-form]");
  if (uploadForm) {
    bindForm(
      uploadForm,
      async (_values, form) => {
        const formData = new FormData(form);
        if (!(formData.get("apk") instanceof File) || (formData.get("apk") as File).size === 0) {
          throw new Error("Choose an APK file to upload.");
        }
        await api.upload(`/developer/apps/${encodeURIComponent(id)}/versions`, formData);
        const target = root.querySelector<HTMLElement>("[data-upload-status]");
        if (target) target.innerHTML = alert("success", "APK uploaded to quarantine. Submit it when you are ready.");
        form.reset();
        window.setTimeout(() => window.location.reload(), 1200);
      },
      root.querySelector<HTMLElement>("[data-upload-status]"),
    );
  }

  const imageForm = root.querySelector<HTMLFormElement>("[data-image-form]");
  if (imageForm) {
    bindForm(
      imageForm,
      async (_values, form) => {
        const formData = new FormData(form);
        if (!(formData.get("image") instanceof File) || (formData.get("image") as File).size === 0) {
          throw new Error("Choose an image to upload.");
        }
        await api.upload(`/developer/apps/${encodeURIComponent(id)}/assets`, formData);
        const target = root.querySelector<HTMLElement>("[data-image-status]");
        if (target) target.innerHTML = alert("success", "Image uploaded.");
        form.reset();
        window.setTimeout(() => window.location.reload(), 1000);
      },
      root.querySelector<HTMLElement>("[data-image-status]"),
    );
  }

  root.querySelectorAll<HTMLButtonElement>("[data-submit]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Submitting…";
      try {
        await api.post(`/developer/versions/${encodeURIComponent(button.dataset.submit ?? "")}/submit`, {});
        if (status) status.innerHTML = alert("success", "Submitted for validation and review.");
        window.setTimeout(() => window.location.reload(), 1200);
      } catch (error) {
        button.disabled = false;
        button.textContent = "Submit for review";
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-remove-asset]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api.delete(`/developer/apps/${encodeURIComponent(id)}/assets/${encodeURIComponent(button.dataset.removeAsset ?? "")}`);
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        if (status) status.innerHTML = alert("error", esc((error as Error).message));
      }
    });
  });
}
