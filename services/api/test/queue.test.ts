import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "@aplora/storage";
import PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { getConfig } from "../src/env";
import { createQueue } from "../src/lib/queue";
import { authHeaders, createDeveloperApp, loginDeveloper, prisma, resetDatabase, seedCategories, uploadApk } from "./helpers";

const SCHEMA = "pgboss_test";
let app: FastifyInstance;
let boss: PgBoss;

beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: SCHEMA });
  boss.on("error", () => undefined);
  await boss.start();
  await boss.createQueue("apk.validate");
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  const config = { ...getConfig(), WORKER_QUEUE_SCHEMA: SCHEMA };
  app = await buildApp({
    config,
    storage: new LocalStorageAdapter(process.env.STORAGE_LOCAL_ROOT!),
    queue: await createQueue(config, { info: () => undefined, error: () => undefined }),
    logger: false,
  });
  await app.ready();
});

describe("background job delivery", () => {
  it("enqueues a validation job when a version is submitted", async () => {
    const { productivityId } = await seedCategories();
    const { session } = await loginDeveloper(app);
    const fixture = await createDeveloperApp(session.userId, productivityId);

    const upload = await uploadApk(app, session, fixture.appId, { versionCode: 11 });
    const versionId = JSON.parse(upload.response.body).id as string;

    const submit = await app.inject({
      method: "POST",
      url: `/api/v1/developer/versions/${versionId}/submit`,
      headers: authHeaders(session),
      payload: {},
    });
    expect(submit.statusCode).toBe(202);

    // The job must be waiting in PostgreSQL, which is what the worker polls.
    const fetched = await boss.fetch("apk.validate", { batchSize: 1 });
    const job = (Array.isArray(fetched) ? fetched[0] : fetched) as { data: { versionId: string } } | null;
    expect(job).not.toBeNull();
    expect(job!.data.versionId).toBe(versionId);

    await app.close();
  });
});
