import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  authHeaders,
  createDeveloperApp,
  createPublishedApp,
  createTestApp,
  createUser,
  login,
  loginDeveloper,
  prisma,
  resetDatabase,
  seedCategories,
} from "./helpers";

let app: FastifyInstance;
let categoryId: string;

beforeEach(async () => {
  await resetDatabase();
  ({ app } = await createTestApp());
  ({ productivityId: categoryId } = await seedCategories());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("public catalogue", () => {
  it("never exposes an application that has not been published", async () => {
    const { session } = await loginDeveloper(app);
    const draft = await createDeveloperApp(session.userId, categoryId, { name: "Hidden Draft" });

    const list = await app.inject({ method: "GET", url: "/api/v1/apps" });
    expect(JSON.parse(list.body).items).toHaveLength(0);

    const detail = await app.inject({ method: "GET", url: `/api/v1/apps/${draft.slug}` });
    expect(detail.statusCode).toBe(404);
  });

  it("lists a published application with real aggregates", async () => {
    const { session } = await loginDeveloper(app);
    const { fixture } = await createPublishedApp(app, session, categoryId, { name: "Visible App" });

    const list = await app.inject({ method: "GET", url: "/api/v1/apps" });
    const body = JSON.parse(list.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Visible App");
    expect(body.items[0].rating).toBe(0);
    expect(body.items[0].reviewCount).toBe(0);
    expect(body.items[0].latestVersionName).toBe("1.0.0");

    const detail = await app.inject({ method: "GET", url: `/api/v1/apps/${fixture.slug}` });
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.versions).toHaveLength(1);
    expect(detailBody.latestVersion.minSdk).toBe(24);
    expect(detailBody.latestVersion.sha256).toHaveLength(64);
  });

  it("searches by name, package name and developer", async () => {
    const { session } = await loginDeveloper(app);
    await createPublishedApp(app, session, categoryId, { name: "Nimbus Notes", packageName: "com.nimbus.notes" });

    for (const term of ["Nimbus", "nimbus notes", "com.nimbus", "Test Studio"]) {
      const response = await app.inject({ method: "GET", url: `/api/v1/search?q=${encodeURIComponent(term)}` });
      expect(response.statusCode, term).toBe(200);
      expect(JSON.parse(response.body).items.length, term).toBeGreaterThan(0);
    }

    const miss = await app.inject({ method: "GET", url: "/api/v1/search?q=zzzznotathing" });
    expect(JSON.parse(miss.body).items).toHaveLength(0);
    expect(JSON.parse(miss.body).pagination.total).toBe(0);
  });

  it("survives a SQL injection attempt in the search term", async () => {
    const { session } = await loginDeveloper(app);
    await createPublishedApp(app, session, categoryId, { name: "Target App" });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/search?q=${encodeURIComponent("'; DROP TABLE apps; --")}`,
    });
    expect(response.statusCode).toBe(200);
    expect(await prisma.app.count()).toBe(1);
  });

  it("filters by category and reports real counts", async () => {
    const { session } = await loginDeveloper(app);
    await createPublishedApp(app, session, categoryId, { name: "Category App" });

    const categories = await app.inject({ method: "GET", url: "/api/v1/categories" });
    const items = JSON.parse(categories.body).items as Array<{ slug: string; appCount: number }>;
    expect(items.find((entry) => entry.slug === "productivity")?.appCount).toBe(1);
    expect(items.find((entry) => entry.slug === "tools")?.appCount).toBe(0);

    const filtered = await app.inject({ method: "GET", url: "/api/v1/categories/productivity/apps" });
    expect(JSON.parse(filtered.body).items).toHaveLength(1);

    const empty = await app.inject({ method: "GET", url: "/api/v1/categories/tools/apps" });
    expect(JSON.parse(empty.body).items).toHaveLength(0);
  });

  it("paginates", async () => {
    const { session } = await loginDeveloper(app);
    for (const index of [1, 2, 3]) {
      await createPublishedApp(app, session, categoryId, {
        name: `Paged App ${index}`,
        packageName: `com.aplora.paged${index}`,
        versionCode: index,
      });
    }

    const page = await app.inject({ method: "GET", url: "/api/v1/apps?page=1&pageSize=2" });
    const body = JSON.parse(page.body);
    expect(body.items).toHaveLength(2);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.totalPages).toBe(2);

    const second = await app.inject({ method: "GET", url: "/api/v1/apps?page=2&pageSize=2" });
    expect(JSON.parse(second.body).items).toHaveLength(1);
  });
});

describe("collections", () => {
  it("returns only published applications inside a collection", async () => {
    const { session } = await loginDeveloper(app);
    const published = await createPublishedApp(app, session, categoryId, { name: "Collected App" });
    const draft = await createDeveloperApp(session.userId, categoryId, { name: "Draft In Collection" });

    const { session: adminSession } = await loginAdminHelper(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/collections",
      headers: authHeaders(adminSession),
      payload: {
        title: "Editors Choice",
        description: "Hand picked applications.",
        appIds: [published.fixture.appId, draft.appId],
      },
    });
    expect(created.statusCode).toBe(201);
    const slug = JSON.parse(created.body).slug as string;

    const collection = await app.inject({ method: "GET", url: `/api/v1/collections/${slug}` });
    const body = JSON.parse(collection.body);
    expect(body.apps).toHaveLength(1);
    expect(body.apps[0].name).toBe("Collected App");
  });
});

describe("reviews", () => {
  it("accepts a review from a verified user and reflects it in the rating", async () => {
    const { session: developer } = await loginDeveloper(app);
    const { fixture } = await createPublishedApp(app, developer, categoryId);

    await createUser({ email: "reviewer@example.com" });
    const reviewer = await login(app, "reviewer@example.com");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/apps/${fixture.slug}/reviews`,
      headers: authHeaders(reviewer),
      payload: { rating: 4, title: "Solid", body: "Works exactly as described." },
    });
    expect(created.statusCode).toBe(201);

    const detail = await app.inject({ method: "GET", url: `/api/v1/apps/${fixture.slug}` });
    const body = JSON.parse(detail.body);
    expect(body.rating).toBe(4);
    expect(body.reviewCount).toBe(1);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/apps/${fixture.slug}/reviews`,
      headers: authHeaders(reviewer),
      payload: { rating: 5, body: "Second review attempt." },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("refuses reviews from unverified accounts", async () => {
    const { session: developer } = await loginDeveloper(app);
    const { fixture } = await createPublishedApp(app, developer, categoryId);
    await createUser({ email: "unverified@example.com", verified: false });
    const unverified = await login(app, "unverified@example.com");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/apps/${fixture.slug}/reviews`,
      headers: authHeaders(unverified),
      payload: { rating: 5, body: "Should not be allowed." },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("email_unverified");
  });

  it("lets an author edit and delete their own review, and nobody else's", async () => {
    const { session: developer } = await loginDeveloper(app);
    const { fixture } = await createPublishedApp(app, developer, categoryId);

    await createUser({ email: "author@example.com" });
    await createUser({ email: "stranger@example.com" });
    const author = await login(app, "author@example.com");
    const stranger = await login(app, "stranger@example.com");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/apps/${fixture.slug}/reviews`,
      headers: authHeaders(author),
      payload: { rating: 3, body: "It is fine." },
    });
    const reviewId = JSON.parse(created.body).id as string;

    const editByStranger = await app.inject({
      method: "PATCH",
      url: `/api/v1/reviews/${reviewId}`,
      headers: authHeaders(stranger),
      payload: { rating: 1 },
    });
    expect(editByStranger.statusCode).toBe(404);

    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/reviews/${reviewId}`,
      headers: authHeaders(author),
      payload: { rating: 5, body: "Changed my mind, this is excellent." },
    });
    expect(edit.statusCode).toBe(200);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/reviews/${reviewId}`,
      headers: authHeaders(author),
    });
    expect(remove.statusCode).toBe(204);
    expect(await prisma.review.count()).toBe(0);
  });
});

describe("reports", () => {
  it("accepts a report from a signed-in user", async () => {
    const { session: developer } = await loginDeveloper(app);
    const { fixture } = await createPublishedApp(app, developer, categoryId);

    await createUser({ email: "reporter@example.com" });
    const reporter = await login(app, "reporter@example.com");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/apps/${fixture.slug}/reports`,
      headers: authHeaders(reporter),
      payload: { reason: "MISLEADING", details: "The description does not match the app." },
    });
    expect(created.statusCode).toBe(201);

    const { session: adminSession } = await loginAdminHelper(app);
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/reports", headers: authHeaders(adminSession) });
    expect(JSON.parse(list.body).items).toHaveLength(1);

    const anonymous = await app.inject({
      method: "POST",
      url: `/api/v1/apps/${fixture.slug}/reports`,
      payload: { reason: "SPAM" },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

async function loginAdminHelper(target: FastifyInstance) {
  const { loginAdmin } = await import("./helpers");
  return loginAdmin(target, "catalog-admin@example.com");
}
