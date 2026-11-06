import { Prisma, type PrismaClient } from "@aplora/database";
import type { AppSummary, CollectionSummary, CategorySummary } from "@aplora/shared-types";
import type { PaginatedResult, PageRequest } from "../lib/pagination";
import { pageMeta } from "../lib/pagination";
import { NotFoundError } from "../lib/errors";
import { toAppDetail, toAppSummary, type AppAggregates, type AppWithRelations } from "./serializers";

export type AppSort = "relevance" | "popular" | "rating" | "recent" | "name";

export interface AppQuery extends PageRequest {
  category?: string;
  developer?: string;
  sort: AppSort;
  featured?: boolean;
}

const EMPTY: AppAggregates = { rating: 0, reviewCount: 0, downloadCount: 0, latestVersionName: null };

function buildWhere(query: Pick<AppQuery, "category" | "developer" | "featured">): Prisma.AppWhereInput {
  return {
    status: "PUBLISHED",
    ...(query.featured ? { isFeatured: true } : {}),
    ...(query.category ? { category: { slug: query.category, isActive: true } } : {}),
    ...(query.developer ? { developer: { slug: query.developer } } : {}),
  };
}

/** Ratings and download counts for a page of apps, in two queries instead of N. */
export async function loadAggregates(
  prisma: PrismaClient,
  appIds: string[],
): Promise<Map<string, AppAggregates>> {
  const result = new Map<string, AppAggregates>();
  if (appIds.length === 0) return result;
  for (const id of appIds) result.set(id, { ...EMPTY });

  const [reviews, downloads, versions] = await Promise.all([
    prisma.review.groupBy({
      by: ["appId"],
      where: { appId: { in: appIds }, status: "VISIBLE" },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.downloadEvent.groupBy({
      by: ["appId"],
      where: { appId: { in: appIds } },
      _count: { _all: true },
    }),
    prisma.appVersion.findMany({
      where: { appId: { in: appIds }, status: "PUBLISHED" },
      orderBy: { versionCode: "desc" },
      select: { appId: true, versionName: true, versionCode: true },
    }),
  ]);

  for (const row of reviews) {
    const entry = result.get(row.appId);
    if (!entry) continue;
    entry.rating = row._avg.rating ? Math.round(row._avg.rating * 10) / 10 : 0;
    entry.reviewCount = row._count._all;
  }
  for (const row of downloads) {
    const entry = result.get(row.appId);
    if (entry) entry.downloadCount = row._count._all;
  }
  for (const version of versions) {
    const entry = result.get(version.appId);
    if (entry && !entry.latestVersionName) entry.latestVersionName = version.versionName;
  }
  return result;
}

async function orderedIds(prisma: PrismaClient, query: AppQuery): Promise<string[]> {
  const { skip, take } = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };

  if (query.sort === "rating") {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a.id
      FROM apps a
      LEFT JOIN reviews r ON r.app_id = a.id AND r.status = 'VISIBLE'
      WHERE a.status = 'PUBLISHED'
        ${query.featured ? Prisma.sql`AND a.is_featured = true` : Prisma.empty}
        ${query.category ? Prisma.sql`AND a.category_id = (SELECT id FROM categories WHERE slug = ${query.category})` : Prisma.empty}
        ${query.developer ? Prisma.sql`AND a.developer_id = (SELECT id FROM developer_profiles WHERE slug = ${query.developer})` : Prisma.empty}
      GROUP BY a.id
      ORDER BY COALESCE(AVG(r.rating), 0) DESC, COUNT(r.id) DESC, a.name ASC
      LIMIT ${take} OFFSET ${skip}
    `);
    return rows.map((row) => row.id);
  }

  const orderBy: Prisma.AppOrderByWithRelationInput =
    query.sort === "popular"
      ? { downloadEvents: { _count: "desc" } }
      : query.sort === "name"
        ? { name: "asc" }
        : { publishedAt: "desc" };

  const apps = await prisma.app.findMany({
    where: buildWhere(query),
    orderBy,
    skip,
    take,
    select: { id: true },
  });
  return apps.map((app) => app.id);
}

async function fetchSummaries(prisma: PrismaClient, ids: string[]): Promise<AppSummary[]> {
  if (ids.length === 0) return [];
  const [apps, aggregates] = await Promise.all([
    prisma.app.findMany({ where: { id: { in: ids } }, include: { category: true, developer: true } }),
    loadAggregates(prisma, ids),
  ]);
  const byId = new Map(apps.map((app) => [app.id, app as AppWithRelations]));
  return ids
    .map((id) => {
      const app = byId.get(id);
      return app ? toAppSummary(app, aggregates.get(id) ?? EMPTY) : null;
    })
    .filter((value): value is AppSummary => value !== null);
}

export async function listPublicApps(prisma: PrismaClient, query: AppQuery): Promise<PaginatedResult<AppSummary>> {
  const [total, ids] = await Promise.all([
    prisma.app.count({ where: buildWhere(query) }),
    orderedIds(prisma, query),
  ]);
  return { items: await fetchSummaries(prisma, ids), pagination: pageMeta(query, total) };
}

export interface SearchQuery extends AppQuery {
  q?: string;
}

/**
 * PostgreSQL full-text search over name, descriptions, package name and
 * developer name, with an ILIKE fallback for partial words and package names.
 */
export async function searchPublicApps(prisma: PrismaClient, query: SearchQuery): Promise<PaginatedResult<AppSummary>> {
  const term = (query.q ?? "").trim();
  if (!term) return listPublicApps(prisma, query);

  const like = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;

  const matchClause = Prisma.sql`(
    to_tsvector('english', coalesce(a.name, '') || ' ' || coalesce(a.short_description, '') || ' ' || coalesce(a.full_description, '') || ' ' || a.package_name)
      @@ websearch_to_tsquery('english', ${term})
    OR a.name ILIKE ${like}
    OR a.package_name ILIKE ${like}
    OR d.display_name ILIKE ${like}
    OR c.name ILIKE ${like}
  )`;

  const categoryClause = query.category
    ? Prisma.sql`AND a.category_id = (SELECT id FROM categories WHERE slug = ${query.category})`
    : Prisma.empty;

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM apps a
      JOIN developer_profiles d ON d.id = a.developer_id
      JOIN categories c ON c.id = a.category_id
      WHERE a.status = 'PUBLISHED' AND ${matchClause} ${categoryClause}
    `),
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a.id
      FROM apps a
      JOIN developer_profiles d ON d.id = a.developer_id
      JOIN categories c ON c.id = a.category_id
      WHERE a.status = 'PUBLISHED' AND ${matchClause} ${categoryClause}
      ORDER BY
        ts_rank(
          to_tsvector('english', coalesce(a.name, '') || ' ' || coalesce(a.short_description, '') || ' ' || coalesce(a.full_description, '') || ' ' || a.package_name),
          websearch_to_tsquery('english', ${term})
        ) DESC,
        a.name ASC
      LIMIT ${take} OFFSET ${skip}
    `),
  ]);

  const total = Number(countRows[0]?.count ?? 0);
  return { items: await fetchSummaries(prisma, idRows.map((row) => row.id)), pagination: pageMeta(query, total) };
}

/** Resolves an app by slug or UUID. Published-only unless asked otherwise. */
export async function resolveApp(
  prisma: PrismaClient,
  identifier: string,
  options: { publishedOnly?: boolean } = {},
) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  const app = await prisma.app.findFirst({
    where: {
      ...(isUuid ? { id: identifier } : { slug: identifier }),
      ...(options.publishedOnly === false ? {} : { status: "PUBLISHED" }),
    },
    include: { category: true, developer: true },
  });
  if (!app) throw new NotFoundError("Application not found");
  return app as AppWithRelations;
}

export async function getPublicApp(prisma: PrismaClient, identifier: string) {
  const app = await resolveApp(prisma, identifier);
  const [aggregates, assets, versions] = await Promise.all([
    loadAggregates(prisma, [app.id]),
    prisma.appAsset.findMany({ where: { appId: app.id }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    prisma.appVersion.findMany({
      where: { appId: app.id, status: "PUBLISHED" },
      orderBy: { versionCode: "desc" },
      include: { file: true },
    }),
  ]);
  return toAppDetail(app, aggregates.get(app.id) ?? EMPTY, assets, versions);
}

export async function listCategories(prisma: PrismaClient): Promise<CategorySummary[]> {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { apps: { where: { status: "PUBLISHED" } } } } },
  });
  return categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    icon: category.icon,
    appCount: category._count.apps,
  }));
}

export async function listCollections(prisma: PrismaClient): Promise<CollectionSummary[]> {
  const collections = await prisma.collection.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: {
      _count: { select: { apps: { where: { app: { status: "PUBLISHED" } } } } },
    },
  });
  return collections.map((collection) => ({
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description,
    appCount: collection._count.apps,
  }));
}

export async function getCollection(prisma: PrismaClient, slug: string) {
  const collection = await prisma.collection.findFirst({
    where: { slug, isActive: true },
    include: {
      apps: {
        where: { app: { status: "PUBLISHED" } },
        orderBy: { sortOrder: "asc" },
        include: { app: { include: { category: true, developer: true } } },
      },
    },
  });
  if (!collection) throw new NotFoundError("Collection not found");

  const apps = collection.apps.map((entry) => entry.app as AppWithRelations);
  const aggregates = await loadAggregates(prisma, apps.map((app) => app.id));
  return {
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description,
    apps: apps.map((app) => toAppSummary(app, aggregates.get(app.id) ?? EMPTY)),
  };
}
