import { transitionVersion } from "@aplora/publishing";
import { publishVersion } from "@aplora/publishing";
import {
  adminUserUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  collectionCreateSchema,
  collectionUpdateSchema,
  paginationSchema,
  rejectSchema,
  reportUpdateSchema,
  settingUpdateSchema,
  suspendAppSchema,
} from "@aplora/validation";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordAudit } from "../lib/audit";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors";
import { pageMeta, skipTake } from "../lib/pagination";
import { toVersionDto } from "../services/serializers";

const idSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = paginationSchema.extend({ search: z.string().trim().max(120).optional() });

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: app.requireAdmin };

  app.get("/admin/dashboard", guard, async () => {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      suspendedUsers,
      newUsers,
      totalDevelopers,
      verifiedDevelopers,
      totalApps,
      publishedApps,
      suspendedApps,
      pendingSubmissions,
      approvedRecent,
      rejectedRecent,
      openReports,
      totalDownloads,
      recentDownloads,
    ] = await Promise.all([
      app.prisma.user.count(),
      app.prisma.user.count({ where: { status: "SUSPENDED" } }),
      app.prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      app.prisma.developerProfile.count(),
      app.prisma.developerProfile.count({ where: { isVerified: true } }),
      app.prisma.app.count(),
      app.prisma.app.count({ where: { status: "PUBLISHED" } }),
      app.prisma.app.count({ where: { status: "SUSPENDED" } }),
      app.prisma.appVersion.count({ where: { status: "PENDING_REVIEW" } }),
      app.prisma.appVersion.count({ where: { status: "PUBLISHED", reviewedAt: { gte: sevenDaysAgo } } }),
      app.prisma.appVersion.count({ where: { status: "REJECTED", reviewedAt: { gte: sevenDaysAgo } } }),
      app.prisma.report.count({ where: { status: "OPEN" } }),
      app.prisma.downloadEvent.count(),
      app.prisma.downloadEvent.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);

    return {
      users: { total: totalUsers, suspended: suspendedUsers, newLast7Days: newUsers },
      developers: { total: totalDevelopers, verified: verifiedDevelopers },
      apps: { total: totalApps, published: publishedApps, suspended: suspendedApps, pendingReview: pendingSubmissions },
      submissions: { pending: pendingSubmissions, approvedLast7Days: approvedRecent, rejectedLast7Days: rejectedRecent },
      reports: { open: openReports },
      downloads: { total: totalDownloads, last7Days: recentDownloads },
    };
  });

  app.get("/admin/users", guard, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const where = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: "insensitive" as const } },
            { displayName: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [total, users] = await Promise.all([
      app.prisma.user.count({ where }),
      app.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { developer: { select: { id: true, slug: true } } },
        ...skipTake(query),
      }),
    ]);

    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        emailVerified: Boolean(user.emailVerifiedAt),
        mfaEnabled: user.mfaEnabled,
        developerSlug: user.developer?.slug ?? null,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      })),
      pagination: pageMeta(query, total),
    };
  });

  app.patch("/admin/users/:id", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const input = adminUserUpdateSchema.parse(request.body);
    const target = await app.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundError("User not found");

    const actor = request.auth!.user;
    if (target.id === actor.id && input.status === "SUSPENDED") {
      throw new BadRequestError("You cannot suspend your own account");
    }
    if (target.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new BadRequestError("Only a super administrator can change a super administrator");
    }
    if (input.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new BadRequestError("Only a super administrator can grant that role");
    }

    const updated = await app.prisma.user.update({
      where: { id },
      data: { status: input.status ?? undefined, role: input.role ?? undefined },
    });

    if (input.status === "SUSPENDED") {
      await app.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    await recordAudit(app.prisma, {
      actorUserId: actor.id,
      action: input.status === "SUSPENDED" ? "user.suspend" : input.status === "ACTIVE" ? "user.activate" : "user.update",
      entityType: "user",
      entityId: id,
      metadata: { status: updated.status, role: updated.role },
      ipAddress: request.ip,
    });

    return { ok: true, user: { id: updated.id, status: updated.status, role: updated.role } };
  });

  app.get("/admin/developers", guard, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const where = query.search
      ? { OR: [{ displayName: { contains: query.search, mode: "insensitive" as const } }, { slug: { contains: query.search, mode: "insensitive" as const } }] }
      : {};
    const [total, developers] = await Promise.all([
      app.prisma.developerProfile.count({ where }),
      app.prisma.developerProfile.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true, status: true } }, _count: { select: { apps: true } } },
        ...skipTake(query),
      }),
    ]);
    return {
      items: developers.map((developer) => ({
        id: developer.id,
        displayName: developer.displayName,
        slug: developer.slug,
        supportEmail: developer.supportEmail,
        isVerified: developer.isVerified,
        accountStatus: developer.user.status,
        appCount: developer._count.apps,
        createdAt: developer.createdAt.toISOString(),
      })),
      pagination: pageMeta(query, total),
    };
  });

  app.get("/admin/apps", guard, async (request) => {
    const query = listQuerySchema.extend({ status: z.string().optional() }).parse(request.query);
    const where = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { packageName: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [total, apps] = await Promise.all([
      app.prisma.app.count({ where }),
      app.prisma.app.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          developer: { select: { displayName: true, slug: true } },
          category: { select: { name: true } },
          _count: { select: { versions: true, downloadEvents: true } },
        },
        ...skipTake(query),
      }),
    ]);
    return {
      items: apps.map((record) => ({
        id: record.id,
        slug: record.slug,
        name: record.name,
        packageName: record.packageName,
        status: record.status,
        developer: record.developer.displayName,
        category: record.category.name,
        versionCount: record._count.versions,
        downloadCount: record._count.downloadEvents,
        isFeatured: record.isFeatured,
        updatedAt: record.updatedAt.toISOString(),
      })),
      pagination: pageMeta(query, total),
    };
  });

  app.post("/admin/apps/:id/suspend", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const { reason } = suspendAppSchema.parse(request.body);
    const record = await app.prisma.app.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Application not found");

    await app.prisma.app.update({
      where: { id },
      data: { status: "SUSPENDED", suspendedReason: reason },
    });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "app.suspend",
      entityType: "app",
      entityId: id,
      metadata: { reason },
      ipAddress: request.ip,
    });
    return { ok: true, status: "SUSPENDED" };
  });

  app.post("/admin/apps/:id/restore", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const record = await app.prisma.app.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Application not found");

    const published = await app.prisma.appVersion.count({ where: { appId: id, status: "PUBLISHED" } });
    const status = published > 0 ? "PUBLISHED" : "DRAFT";
    await app.prisma.app.update({ where: { id }, data: { status, suspendedReason: null } });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "app.restore",
      entityType: "app",
      entityId: id,
      metadata: { status },
      ipAddress: request.ip,
    });
    return { ok: true, status };
  });

  /** Featured applications drive the editorial block on the marketplace home page. */
  app.post("/admin/apps/:id/feature", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const { rank } = z.object({ rank: z.coerce.number().int().min(0).max(99).default(0) }).parse(request.body ?? {});
    const record = await app.prisma.app.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Application not found");

    await app.prisma.app.update({ where: { id }, data: { isFeatured: true, featuredRank: rank } });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "app.feature",
      entityType: "app",
      entityId: id,
      metadata: { rank },
      ipAddress: request.ip,
    });
    return { ok: true, isFeatured: true };
  });

  app.post("/admin/apps/:id/unfeature", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const record = await app.prisma.app.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Application not found");

    await app.prisma.app.update({ where: { id }, data: { isFeatured: false, featuredRank: null } });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "app.unfeature",
      entityType: "app",
      entityId: id,
      ipAddress: request.ip,
    });
    return { ok: true, isFeatured: false };
  });

  app.get("/admin/submissions", guard, async (request) => {
    const query = listQuerySchema.extend({ status: z.string().optional() }).parse(request.query);
    const where = {
      status: (query.status ?? "PENDING_REVIEW") as never,
    };
    const [total, versions] = await Promise.all([
      app.prisma.appVersion.count({ where }),
      app.prisma.appVersion.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        include: {
          app: { include: { developer: { select: { displayName: true, slug: true } } } },
          file: true,
        },
        ...skipTake(query),
      }),
    ]);
    return {
      items: versions.map((version) => ({
        ...toVersionDto(version),
        app: {
          id: version.app.id,
          name: version.app.name,
          slug: version.app.slug,
          status: version.app.status,
          developer: version.app.developer.displayName,
        },
      })),
      pagination: pageMeta(query, total),
    };
  });

  app.get("/admin/submissions/:id", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const version = await app.prisma.appVersion.findUnique({
      where: { id },
      include: {
        file: true,
        app: { include: { developer: true, category: true, assets: true } },
        submissionEvents: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!version) throw new NotFoundError("Submission not found");

    return {
      ...toVersionDto(version),
      app: {
        id: version.app.id,
        name: version.app.name,
        slug: version.app.slug,
        packageName: version.app.packageName,
        status: version.app.status,
        shortDescription: version.app.shortDescription,
        fullDescription: version.app.fullDescription,
        category: version.app.category.name,
        developer: {
          id: version.app.developer.id,
          displayName: version.app.developer.displayName,
          supportEmail: version.app.developer.supportEmail,
          isVerified: version.app.developer.isVerified,
        },
        screenshots: version.app.assets.filter((asset) => asset.kind === "SCREENSHOT").map((asset) => asset.url),
      },
      scanReport: version.file?.scanReport ?? null,
      history: version.submissionEvents.map((event) => ({
        from: event.fromStatus,
        to: event.toStatus,
        note: event.note,
        at: event.createdAt.toISOString(),
      })),
    };
  });

  app.post("/admin/submissions/:id/approve", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const version = await app.prisma.appVersion.findUnique({ where: { id }, include: { file: true, app: true } });
    if (!version) throw new NotFoundError("Submission not found");
    if (version.status !== "PENDING_REVIEW") {
      throw new ConflictError(`A version in ${version.status} cannot be approved`, "invalid_state");
    }
    if (version.file?.scanStatus !== "CLEAN") {
      throw new BadRequestError("This APK has not passed scanning and cannot be approved");
    }

    const actorId = request.auth!.user.id;
    await transitionVersion(app.prisma, id, {
      from: "PENDING_REVIEW",
      to: "APPROVED",
      actorUserId: actorId,
      note: "Approved by administrator",
      extra: { reviewedAt: new Date() },
    });
    const published = await publishVersion(app.prisma, app.storage, id, actorId);

    await recordAudit(app.prisma, {
      actorUserId: actorId,
      action: "submission.approve",
      entityType: "app_version",
      entityId: id,
      metadata: { appId: version.appId, versionCode: version.versionCode, storageKey: published.storageKey },
      ipAddress: request.ip,
    });

    return { ok: true, status: "PUBLISHED" };
  });

  app.post("/admin/submissions/:id/reject", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const { reason } = rejectSchema.parse(request.body);
    const version = await app.prisma.appVersion.findUnique({ where: { id }, include: { app: true } });
    if (!version) throw new NotFoundError("Submission not found");
    if (!["PENDING_REVIEW", "FLAGGED", "QUARANTINED"].includes(version.status)) {
      throw new ConflictError(`A version in ${version.status} cannot be rejected`, "invalid_state");
    }

    await transitionVersion(app.prisma, id, {
      from: version.status,
      to: "REJECTED",
      actorUserId: request.auth!.user.id,
      note: reason,
      extra: { rejectionReason: reason, reviewedAt: new Date() },
    });

    const published = await app.prisma.appVersion.count({ where: { appId: version.appId, status: "PUBLISHED" } });
    if (published === 0) {
      await app.prisma.app.update({ where: { id: version.appId }, data: { status: "REJECTED" } });
    }

    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "submission.reject",
      entityType: "app_version",
      entityId: id,
      metadata: { reason, appId: version.appId },
      ipAddress: request.ip,
    });

    return { ok: true, status: "REJECTED" };
  });

  app.get("/admin/reports", guard, async (request) => {
    const query = listQuerySchema.extend({ status: z.string().optional() }).parse(request.query);
    const where = query.status ? { status: query.status as never } : {};
    const [total, reports] = await Promise.all([
      app.prisma.report.count({ where }),
      app.prisma.report.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          app: { select: { id: true, name: true, slug: true } },
          reporter: { select: { email: true, displayName: true } },
        },
        ...skipTake(query),
      }),
    ]);
    return {
      items: reports.map((report) => ({
        id: report.id,
        reason: report.reason,
        details: report.details,
        status: report.status,
        app: report.app,
        reporter: report.reporter,
        createdAt: report.createdAt.toISOString(),
        resolvedAt: report.resolvedAt?.toISOString() ?? null,
      })),
      pagination: pageMeta(query, total),
    };
  });

  app.patch("/admin/reports/:id", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const input = reportUpdateSchema.parse(request.body);
    const report = await app.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundError("Report not found");

    const updated = await app.prisma.report.update({
      where: { id },
      data: {
        status: input.status,
        resolutionNote: input.note ?? null,
        resolvedById: request.auth!.user.id,
        resolvedAt: input.status === "OPEN" ? null : new Date(),
      },
    });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "report.update",
      entityType: "report",
      entityId: id,
      metadata: { status: updated.status },
      ipAddress: request.ip,
    });
    return { ok: true, status: updated.status };
  });

  app.get("/admin/reviews", guard, async (request) => {
    const query = listQuerySchema.extend({ status: z.string().optional() }).parse(request.query);
    const where = query.status ? { status: query.status as never } : {};
    const [total, reviews] = await Promise.all([
      app.prisma.review.count({ where }),
      app.prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { displayName: true, email: true } },
          app: { select: { name: true, slug: true } },
        },
        ...skipTake(query),
      }),
    ]);
    return {
      items: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        body: review.body,
        status: review.status,
        author: review.user.displayName,
        app: review.app,
        createdAt: review.createdAt.toISOString(),
      })),
      pagination: pageMeta(query, total),
    };
  });

  app.patch("/admin/reviews/:id", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const { status } = z.object({ status: z.enum(["VISIBLE", "HIDDEN", "REMOVED"]) }).parse(request.body);
    const review = await app.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundError("Review not found");

    await app.prisma.review.update({ where: { id }, data: { status } });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "review.moderate",
      entityType: "review",
      entityId: id,
      metadata: { status },
      ipAddress: request.ip,
    });
    return { ok: true, status };
  });

  app.get("/admin/audit-logs", guard, async (request) => {
    const query = listQuerySchema.extend({ entityType: z.string().optional() }).parse(request.query);
    const where = query.entityType ? { entityType: query.entityType } : {};
    const [total, logs] = await Promise.all([
      app.prisma.auditLog.count({ where }),
      app.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, email: true, displayName: true } } },
        ...skipTake(query),
      }),
    ]);
    return {
      items: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt.toISOString(),
        actor: log.actor,
      })),
      pagination: pageMeta(query, total),
    };
  });

  app.get("/admin/categories", guard, async () => {
    const categories = await app.prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { apps: true } } },
    });
    return {
      items: categories.map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        icon: category.icon,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        appCount: category._count.apps,
      })),
    };
  });

  app.post("/admin/categories", guard, async (request, reply) => {
    const input = categoryCreateSchema.parse(request.body);
    const category = await app.prisma.category.create({
      data: {
        name: input.name,
        slug: input.slug ?? slugify(input.name),
        description: input.description ?? null,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "category.create",
      entityType: "category",
      entityId: category.id,
      metadata: { name: category.name },
      ipAddress: request.ip,
    });
    return reply.status(201).send({ id: category.id, slug: category.slug });
  });

  app.patch("/admin/categories/:id", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const input = categoryUpdateSchema.parse(request.body);
    const existing = await app.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Category not found");

    const updated = await app.prisma.category.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        slug: input.slug ?? undefined,
        description: input.description ?? undefined,
        icon: input.icon ?? undefined,
        sortOrder: input.sortOrder ?? undefined,
        isActive: input.isActive ?? undefined,
      },
    });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "category.update",
      entityType: "category",
      entityId: id,
      metadata: { name: updated.name, isActive: updated.isActive },
      ipAddress: request.ip,
    });
    return { ok: true };
  });

  app.get("/admin/collections", guard, async () => {
    const collections = await app.prisma.collection.findMany({
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      include: { _count: { select: { apps: true } } },
    });
    return {
      items: collections.map((collection) => ({
        id: collection.id,
        slug: collection.slug,
        title: collection.title,
        description: collection.description,
        isActive: collection.isActive,
        sortOrder: collection.sortOrder,
        appCount: collection._count.apps,
      })),
    };
  });

  app.post("/admin/collections", guard, async (request, reply) => {
    const input = collectionCreateSchema.parse(request.body);
    const collection = await app.prisma.collection.create({
      data: {
        title: input.title,
        slug: input.slug ?? slugify(input.title),
        description: input.description ?? null,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
        apps: input.appIds
          ? { create: input.appIds.map((appId, index) => ({ appId, sortOrder: index })) }
          : undefined,
      },
    });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "collection.create",
      entityType: "collection",
      entityId: collection.id,
      metadata: { title: collection.title },
      ipAddress: request.ip,
    });
    return reply.status(201).send({ id: collection.id, slug: collection.slug });
  });

  app.patch("/admin/collections/:id", guard, async (request) => {
    const { id } = idSchema.parse(request.params);
    const input = collectionUpdateSchema.parse(request.body);
    const existing = await app.prisma.collection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Collection not found");

    await app.prisma.$transaction(async (tx) => {
      await tx.collection.update({
        where: { id },
        data: {
          title: input.title ?? undefined,
          slug: input.slug ?? undefined,
          description: input.description ?? undefined,
          isActive: input.isActive ?? undefined,
          sortOrder: input.sortOrder ?? undefined,
        },
      });
      if (input.appIds) {
        await tx.collectionApp.deleteMany({ where: { collectionId: id } });
        await tx.collectionApp.createMany({
          data: input.appIds.map((appId, index) => ({ collectionId: id, appId, sortOrder: index })),
        });
      }
    });

    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "collection.update",
      entityType: "collection",
      entityId: id,
      metadata: { title: input.title ?? existing.title },
      ipAddress: request.ip,
    });
    return { ok: true };
  });

  app.get("/admin/settings", guard, async () => {
    const settings = await app.prisma.setting.findMany({ orderBy: { key: "asc" } });
    return {
      items: settings.map((setting) => ({
        key: setting.key,
        value: setting.value,
        updatedAt: setting.updatedAt.toISOString(),
      })),
    };
  });

  app.put("/admin/settings", guard, async (request) => {
    const input = settingUpdateSchema.parse(request.body);
    const setting = await app.prisma.setting.upsert({
      where: { key: input.key },
      create: { key: input.key, value: input.value as object, updatedBy: request.auth!.user.id },
      update: { value: input.value as object, updatedBy: request.auth!.user.id },
    });
    await recordAudit(app.prisma, {
      actorUserId: request.auth!.user.id,
      action: "setting.update",
      entityType: "setting",
      entityId: setting.key,
      metadata: { key: setting.key },
      ipAddress: request.ip,
    });
    return { ok: true, key: setting.key };
  });
}
