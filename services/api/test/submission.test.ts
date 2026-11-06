import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApkFixture } from "@aplora/apk/testing";
import {
  authHeaders,
  createDeveloperApp,
  createTestApp,
  loginAdmin,
  loginDeveloper,
  prisma,
  resetDatabase,
  runPipeline,
  seedCategories,
  uploadApk,
} from "./helpers";
import { getConfig } from "../src/env";
import { LocalStorageAdapter } from "@aplora/storage";
import { buildApp } from "../src/app";
import { TestQueue } from "./helpers";

let app: FastifyInstance;
let productivityId: string;

beforeEach(async () => {
  await resetDatabase();
  ({ app } = await createTestApp());
  ({ productivityId } = await seedCategories());
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function developerWithApp() {
  const { session } = await loginDeveloper(app);
  const fixture = await createDeveloperApp(session.userId, productivityId);
  return { session, fixture };
}

describe("application listings", () => {
  it("creates an application with a unique package name", async () => {
    const { session } = await developerWithApp();
    const payload = {
      name: "Second App",
      packageName: "com.aplora.second",
      categoryId: productivityId,
      shortDescription: "A second application for the same developer.",
      fullDescription: "A second application for the same developer, used to verify uniqueness constraints.",
    };

    const first = await app.inject({ method: "POST", url: "/api/v1/developer/apps", headers: authHeaders(session), payload });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({ method: "POST", url: "/api/v1/developer/apps", headers: authHeaders(session), payload });
    expect(duplicate.statusCode).toBe(409);
    expect(JSON.parse(duplicate.body).error.code).toBe("package_name_taken");
  });
});

describe("APK upload validation", () => {
  it("stores a valid APK in quarantine and never in the public area", async () => {
    const { session, fixture } = await developerWithApp();
    const { response, fixture: apk } = await uploadApk(app, session, fixture.appId);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("UPLOADED");
    expect(body.sha256).toHaveLength(64);

    const stored = await app.prisma.appFile.findUniqueOrThrow({ where: { versionId: body.id } });
    expect(stored.quarantineKey).toContain("quarantine/");
    expect(stored.storageKey).toContain("quarantine/");
    expect(await app.storage.exists(stored.storageKey)).toBe(true);
    expect(apk.buffer.length).toBeGreaterThan(0);
  });

  it("rejects a non-APK payload", async () => {
    const { session, fixture } = await developerWithApp();
    const { response } = await uploadApk(app, session, fixture.appId, { rawBody: Buffer.from("not a zip at all") });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an oversized upload before storing it", async () => {
    const { session, fixture } = await developerWithApp();
    const queue = new TestQueue();
    const smallApp = await buildApp({
      config: { ...getConfig(), maxApkBytes: 1024 },
      storage: new LocalStorageAdapter(process.env.STORAGE_LOCAL_ROOT!),
      queue,
      logger: false,
    });
    await smallApp.ready();

    const { response } = await uploadApk(smallApp, session, fixture.appId);
    expect(response.statusCode).toBe(413);
    expect(await smallApp.prisma.appVersion.count({ where: { appId: fixture.appId } })).toBe(0);
    await smallApp.close();
  });

  it("rejects a duplicate version code", async () => {
    const { session, fixture } = await developerWithApp();
    await uploadApk(app, session, fixture.appId, { versionCode: 5 });
    const { response } = await uploadApk(app, session, fixture.appId, { versionCode: 5 });
    expect(response.statusCode).toBe(409);
  });
});

describe("publishing lifecycle", () => {
  it("runs upload → validate → scan → review → publish → download", async () => {
    const { session, fixture } = await developerWithApp();
    const upload = await uploadApk(app, session, fixture.appId, { versionCode: 3, versionName: "1.0.3" });
    const versionId = JSON.parse(upload.response.body).id as string;

    const submit = await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });
    expect(submit.statusCode).toBe(202);

    const queued = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(queued.status).toBe("VALIDATING");
    expect(queued.submittedAt).not.toBeNull();

    // Nothing is public yet.
    const beforeApproval = await app.inject({ method: "GET", url: `/api/v1/apps/${fixture.slug}` });
    expect(beforeApproval.statusCode).toBe(404);

    const outcome = await runPipeline(app, versionId);
    expect(outcome).toEqual({ validation: "VALID", scan: "CLEAN" });

    const pending = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: versionId }, include: { file: true } });
    expect(pending.status).toBe("PENDING_REVIEW");
    expect(pending.file?.scanStatus).toBe("CLEAN");
    expect(pending.signingCertSha256).toHaveLength(64);

    const { session: adminSession } = await loginAdmin(app);
    const queue = await app.inject({
      method: "GET",
      url: "/api/v1/admin/submissions",
      headers: authHeaders(adminSession),
    });
    expect(JSON.parse(queue.body).items).toHaveLength(1);

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/admin/submissions/${versionId}/approve`,
      headers: authHeaders(adminSession),
      payload: {},
    });
    expect(approve.statusCode).toBe(200);

    const published = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: versionId }, include: { file: true } });
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).not.toBeNull();
    expect(published.file?.quarantineKey).toBeNull();
    expect(published.file?.storageKey).toContain("published/");
    expect(await app.storage.exists(published.file!.storageKey)).toBe(true);

    const detail = await app.inject({ method: "GET", url: `/api/v1/apps/${fixture.slug}` });
    expect(detail.statusCode).toBe(200);
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.latestVersion.versionCode).toBe(3);
    expect(detailBody.downloadCount).toBe(0);

    const download = await app.inject({ method: "POST", url: `/api/v1/apps/${fixture.slug}/download` });
    expect(download.statusCode).toBe(201);
    const ticket = JSON.parse(download.body);
    expect(ticket.sha256).toBe(published.file!.sha256);

    const file = await app.inject({ method: "GET", url: new URL(ticket.url).pathname });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("application/vnd.android.package-archive");
    expect(file.headers["x-checksum-sha256"]).toBe(published.file!.sha256);
    expect(Buffer.from(file.rawPayload).equals(Buffer.from(upload.fixture.buffer))).toBe(true);

    const events = await app.prisma.downloadEvent.count({ where: { appId: fixture.appId } });
    expect(events).toBe(1);
  });

  it("quarantines an APK whose package name does not match the listing", async () => {
    const { session, fixture } = await developerWithApp();
    const { response } = await uploadApk(app, session, fixture.appId, {
      fixture: { packageName: "com.someone.else" },
    });
    const versionId = JSON.parse(response.body).id as string;

    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });

    const outcome = await runPipeline(app, versionId);
    expect(outcome.validation).toBe("QUARANTINED");

    const stored = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(stored.status).toBe("QUARANTINED");
    expect(stored.rejectionReason).toContain("does not match");
  });

  it("quarantines an APK whose versionCode differs from the submission", async () => {
    const { session, fixture } = await developerWithApp();
    const { response } = await uploadApk(app, session, fixture.appId, {
      versionCode: 2,
      fixture: { versionCode: 99 },
    });
    const versionId = JSON.parse(response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });

    const outcome = await runPipeline(app, versionId);
    expect(outcome.validation).toBe("QUARANTINED");
    const stored = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(stored.rejectionReason).toContain("versionCode 99");
  });

  it("quarantines an unsigned APK", async () => {
    const { session, fixture } = await developerWithApp();
    const { response } = await uploadApk(app, session, fixture.appId, { fixture: { signed: false } });
    const versionId = JSON.parse(response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });

    const outcome = await runPipeline(app, versionId);
    expect(outcome.validation).toBe("QUARANTINED");
    const stored = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(stored.rejectionReason).toContain("not signed");
  });

  it("quarantines an APK without a manifest", async () => {
    const { session, fixture } = await developerWithApp();
    const { response } = await uploadApk(app, session, fixture.appId, { fixture: { includeManifest: false } });
    const versionId = JSON.parse(response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });

    const outcome = await runPipeline(app, versionId);
    expect(outcome.validation).toBe("QUARANTINED");
  });

  it("quarantines a release signed with a different certificate", async () => {
    const { session, fixture } = await developerWithApp();

    const first = await uploadApk(app, session, fixture.appId, { versionCode: 1, versionName: "1.0.0" });
    const firstId = JSON.parse(first.response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${firstId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });
    await runPipeline(app, firstId);

    const { session: adminSession } = await loginAdmin(app);
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/submissions/${firstId}/approve`,
      headers: authHeaders(adminSession),
      payload: {},
    });

    // A different key pair means a different certificate fingerprint.
    const second = await uploadApk(app, session, fixture.appId, { versionCode: 2, versionName: "1.1.0" });
    const secondId = JSON.parse(second.response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${secondId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });

    const outcome = await runPipeline(app, secondId);
    expect(outcome.validation).toBe("QUARANTINED");
    const stored = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: secondId } });
    expect(stored.rejectionReason).toContain("Signing certificate does not match");
  });
});

describe("moderation", () => {
  it("records a rejection reason and blocks publication", async () => {
    const { session, fixture } = await developerWithApp();
    const upload = await uploadApk(app, session, fixture.appId, { versionCode: 4 });
    const versionId = JSON.parse(upload.response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });
    await runPipeline(app, versionId);

    const { session: adminSession } = await loginAdmin(app);
    const reject = await app.inject({
      method: "POST",
      url: `/api/v1/admin/submissions/${versionId}/reject`,
      headers: authHeaders(adminSession),
      payload: { reason: "The screenshots do not match the application." },
    });
    expect(reject.statusCode).toBe(200);

    const stored = await app.prisma.appVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(stored.status).toBe("REJECTED");
    expect(stored.rejectionReason).toContain("screenshots");

    const appRecord = await app.prisma.app.findUniqueOrThrow({ where: { id: fixture.appId } });
    expect(appRecord.status).toBe("REJECTED");

    const download = await app.inject({ method: "POST", url: `/api/v1/apps/${fixture.slug}/download` });
    expect(download.statusCode).toBe(404);

    // The developer can correct and resubmit the same version.
    const resubmit = await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: { releaseNotes: "Fixed the screenshots." },
    });
    expect(resubmit.statusCode).toBe(202);
  });

  it("writes an audit record for moderation actions", async () => {
    const { session, fixture } = await developerWithApp();
    const upload = await uploadApk(app, session, fixture.appId, { versionCode: 6 });
    const versionId = JSON.parse(upload.response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });
    await runPipeline(app, versionId);

    const { session: adminSession } = await loginAdmin(app);
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/submissions/${versionId}/approve`,
      headers: authHeaders(adminSession),
      payload: {},
    });

    const logs = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-logs",
      headers: authHeaders(adminSession),
    });
    const items = JSON.parse(logs.body).items as Array<{ action: string }>;
    expect(items.some((item) => item.action === "submission.approve")).toBe(true);

    const history = await prisma.submissionHistory.findMany({ where: { versionId }, orderBy: { createdAt: "asc" } });
    expect(history.map((entry) => entry.toStatus)).toEqual([
      "VALIDATING",
      "SCANNING",
      "PENDING_REVIEW",
      "APPROVED",
      "PUBLISHED",
    ]);
  });
});

describe("suspension", () => {
  it("stops downloads immediately when an application is suspended", async () => {
    const { session, fixture } = await developerWithApp();
    const upload = await uploadApk(app, session, fixture.appId, { versionCode: 7 });
    const versionId = JSON.parse(upload.response.body).id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });
    await runPipeline(app, versionId);

    const { session: adminSession } = await loginAdmin(app);
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/submissions/${versionId}/approve`,
      headers: authHeaders(adminSession),
      payload: {},
    });

    const ticket = await app.inject({ method: "POST", url: `/api/v1/apps/${fixture.slug}/download` });
    expect(ticket.statusCode).toBe(201);
    const ticketUrl = new URL(JSON.parse(ticket.body).url).pathname;

    const suspend = await app.inject({
      method: "POST",
      url: `/api/v1/admin/apps/${fixture.appId}/suspend`,
      headers: authHeaders(adminSession),
      payload: { reason: "Reports of malicious behaviour." },
    });
    expect(suspend.statusCode).toBe(200);

    // The link that was already issued no longer works.
    const file = await app.inject({ method: "GET", url: ticketUrl });
    expect(file.statusCode).toBe(404);

    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/apps/${fixture.slug}` });
    expect(publicDetail.statusCode).toBe(404);

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/admin/apps/${fixture.appId}/restore`,
      headers: authHeaders(adminSession),
      payload: {},
    });
    expect(JSON.parse(restore.body).status).toBe("PUBLISHED");
  });
});
