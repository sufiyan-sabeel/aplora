import { Prisma } from "@aplora/database";
import {
  appListQuerySchema,
  paginationSchema,
  reportCreateSchema,
  reviewCreateSchema,
  reviewUpdateSchema,
  searchQuerySchema,
} from "@aplora/validation";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors";
import { pageMeta, skipTake } from "../lib/pagination";
import { getCollection, getPublicApp, listCategories, listCollections, listPublicApps, resolveApp, searchPublicApps } from "../services/catalog";
import { loadAggregates } from "../services/catalog";
import { toReviewDto, toVersionDto } from "../services/serializers";

const appParamsSchema = z.object({ slug: z.string().min(1).max(120) });
const reviewParamsSchema = z.object({ id: z.string().uuid() });

export default async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/apps", async (request) => {
    const query = appListQuerySchema.parse(request.query);
    return listPublicApps(app.prisma, {
      page: query.page,
      pageSize: query.pageSize,
      category: query.category,
      developer: query.developer,
      sort: query.sort,
      featured: (request.query as { featured?: string }).featured === "true",
    });
  });

  app.get("/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    return searchPublicApps(app.prisma, {
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
      category: query.category,
      sort: query.sort,
    });
  });

  app.get("/apps/:slug", async (request) => {
    const { slug } = appParamsSchema.parse(request.params);
    return getPublicApp(app.prisma, slug);
  });

  app.get("/apps/:slug/versions", async (request) => {
    const { slug } = appParamsSchema.parse(request.params);
    const resolved = await resolveApp(app.prisma, slug);
    const versions = await app.prisma.appVersion.findMany({
      where: { appId: resolved.id, status: "PUBLISHED" },
      orderBy: { versionCode: "desc" },
      include: { file: true },
    });
    return { items: versions.map(toVersionDto) };
  });

  app.get("/apps/:slug/reviews", async (request) => {
    const { slug } = appParamsSchema.parse(request.params);
    const { page, pageSize } = paginationSchema.parse(request.query);
    const resolved = await resolveApp(app.prisma, slug);

    const where: Prisma.ReviewWhereInput = { appId: resolved.id, status: "VISIBLE" };
    const [total, reviews] = await Promise.all([
      app.prisma.review.count({ where }),
      app.prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, displayName: true } } },
        ...skipTake({ page, pageSize }),
      }),
    ]);

    const viewerId = request.auth?.user.id ?? null;
    return {
      items: reviews.map((review) => toReviewDto(review, viewerId)),
      pagination: pageMeta({ page, pageSize }, total),
    };
  });

  app.get("/categories", async () => ({ items: await listCategories(app.prisma) }));

  app.get("/categories/:slug/apps", async (request) => {
    const { slug } = appParamsSchema.parse(request.params);
    const query = appListQuerySchema.parse(request.query);
    const category = await app.prisma.category.findFirst({ where: { slug, isActive: true } });
    if (!category) throw new NotFoundError("Category not found");
    return listPublicApps(app.prisma, {
      page: query.page,
      pageSize: query.pageSize,
      category: slug,
      sort: query.sort === "relevance" ? "popular" : query.sort,
    });
  });

  app.get("/collections", async () => ({ items: await listCollections(app.prisma) }));

  app.get("/collections/:slug", async (request) => {
    const { slug } = appParamsSchema.parse(request.params);
    return getCollection(app.prisma, slug);
  });

  app.post("/apps/:slug/reviews", { preHandler: app.authenticate }, async (request, reply) => {
    const { slug } = appParamsSchema.parse(request.params);
    const input = reviewCreateSchema.parse(request.body);
    const user = request.auth!.user;
    if (!user.emailVerifiedAt) {
      throw new ForbiddenError("Confirm your email address before posting a review", "email_unverified");
    }
    const resolved = await resolveApp(app.prisma, slug);

    const existing = await app.prisma.review.findUnique({
      where: { appId_userId: { appId: resolved.id, userId: user.id } },
    });
    if (existing) throw new ConflictError("You have already reviewed this application", "review_exists");

    const review = await app.prisma.review.create({
      data: { appId: resolved.id, userId: user.id, rating: input.rating, title: input.title ?? null, body: input.body },
      include: { user: { select: { id: true, displayName: true } } },
    });
    return reply.status(201).send(toReviewDto(review, user.id));
  });

  app.patch("/reviews/:id", { preHandler: app.authenticate }, async (request) => {
    const { id } = reviewParamsSchema.parse(request.params);
    const input = reviewUpdateSchema.parse(request.body);
    const review = await app.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundError("Review not found");
    if (review.userId !== request.auth!.user.id) throw new NotFoundError("Review not found");
    if (review.status === "REMOVED") throw new ForbiddenError("This review has been removed by moderation");

    const updated = await app.prisma.review.update({
      where: { id },
      data: { rating: input.rating ?? undefined, title: input.title ?? undefined, body: input.body ?? undefined },
      include: { user: { select: { id: true, displayName: true } } },
    });
    return toReviewDto(updated, request.auth!.user.id);
  });

  app.delete("/reviews/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = reviewParamsSchema.parse(request.params);
    const review = await app.prisma.review.findUnique({ where: { id } });
    if (!review || review.userId !== request.auth!.user.id) throw new NotFoundError("Review not found");
    await app.prisma.review.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.post("/apps/:slug/reports", { preHandler: app.authenticate }, async (request, reply) => {
    const { slug } = appParamsSchema.parse(request.params);
    const input = reportCreateSchema.parse(request.body);
    const user = request.auth!.user;
    if (!user.emailVerifiedAt) {
      throw new ForbiddenError("Confirm your email address before reporting an application", "email_unverified");
    }
    const resolved = await resolveApp(app.prisma, slug);

    const open = await app.prisma.report.findFirst({
      where: { appId: resolved.id, reporterUserId: user.id, status: "OPEN" },
    });
    if (open) throw new ConflictError("You already have an open report for this application");

    const report = await app.prisma.report.create({
      data: {
        appId: resolved.id,
        reporterUserId: user.id,
        reason: input.reason,
        details: input.details ?? null,
      },
    });
    return reply.status(201).send({ id: report.id, status: report.status, createdAt: report.createdAt.toISOString() });
  });

  /** Public asset delivery (icons and screenshots). */
  app.get("/assets/:id/file", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const asset = await app.prisma.appAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundError("Asset not found");

    const exists = await app.storage.exists(asset.storageKey);
    if (!exists) throw new NotFoundError("Asset file is missing");

    const body = await app.storage.get(asset.storageKey);
    return reply
      .header("Content-Type", asset.mimeType)
      .header("Cache-Control", "public, max-age=3600")
      .header("Content-Length", String(body.length))
      .send(body);
  });
}
