import { createHash, randomUUID } from "node:crypto";
import { StorageKeys } from "@aplora/storage";
import {
  appCreateSchema,
  appUpdateSchema,
  developerProfileUpdateSchema,
  submitVersionSchema,
  versionCreateSchema,
} from "@aplora/validation";
import { transitionVersion } from "@aplora/publishing";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, isUniqueConstraintError } from "../lib/errors";
import { detectImage } from "../lib/image";
import { readMultipart } from "../lib/multipart";
import { QUEUES } from "../lib/queue";
import { toAssetDto, toVersionDto } from "../services/serializers";

const appIdSchema = z.object({ id: z.string().uuid() });
const versionIdSchema = z.object({ id: z.string().uuid() });

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "app"
  );
}

/**
 * Every developer endpoint starts here: the developer profile is derived from
 * the session, never from the request, so one developer cannot act as another.
 */
async function currentDeveloper(app: FastifyInstance, request: FastifyRequest) {
  const user = request.auth!.user;
  const developer = await app.prisma.developerProfile.findUnique({ where: { userId: user.id } });
  if (developer) return developer;

  if (user.role !== "DEVELOPER") {
    throw new ForbiddenError("This account is not a developer account", "not_a_developer");
  }

  const base = slugify(user.displayName);
  return app.prisma.developerProfile.create({
    data: {
      userId: user.id,
      displayName: user.displayName,
      slug: `${base}-${randomUUID().slice(0, 6)}`,
      supportEmail: user.email,
    },
  });
}

/** Ownership check that answers "not found" rather than "not yours". */
async function ownedApp(app: FastifyInstance, developerId: string, appId: string) {
  const record = await app.prisma.app.findFirst({
    where: { id: appId, developerId },
    include: { category: true, developer: true },
  });
  if (!record) throw new NotFoundError("Application not found");
  return record;
}

export default async function developerRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: app.requireRole("DEVELOPER", "ADMIN", "SUPER_ADMIN") };

  app.get("/developer/profile", guard, async (request) => {
    const developer = await currentDeveloper(app, request);
    const [appCount, downloadCount] = await Promise.all([
      app.prisma.app.count({ where: { developerId: developer.id } }),
      app.prisma.downloadEvent.count({ where: { app: { developerId: developer.id } } }),
    ]);
    return {
      id: developer.id,
      displayName: developer.displayName,
      slug: developer.slug,
      website: developer.website,
      supportEmail: developer.supportEmail,
      description: developer.description,
      isVerified: developer.isVerified,
      appCount,
      downloadCount,
    };
  });

  app.patch("/developer/profile", guard, async (request) => {
    const developer = await currentDeveloper(app, request);
    const input = developerProfileUpdateSchema.parse(request.body);
    const updated = await app.prisma.developerProfile.update({
      where: { id: developer.id },
      data: {
        displayName: input.displayName ?? undefined,
        website: input.website === "" ? null : input.website ?? undefined,
        supportEmail: input.supportEmail ?? undefined,
        description: input.description ?? undefined,
      },
    });
    return { ok: true, profile: { id: updated.id, displayName: updated.displayName } };
  });

  app.get("/developer/apps", guard, async (request) => {
    const developer = await currentDeveloper(app, request);
    const apps = await app.prisma.app.findMany({
      where: { developerId: developer.id },
      orderBy: { updatedAt: "desc" },
      include: {
        category: true,
        versions: { orderBy: { versionCode: "desc" }, include: { file: true } },
      },
    });
    return {
      items: apps.map((record) => ({
        id: record.id,
        slug: record.slug,
        name: record.name,
        packageName: record.packageName,
        status: record.status,
        category: { id: record.category.id, name: record.category.name, slug: record.category.slug },
        updatedAt: record.updatedAt.toISOString(),
        iconUrl: record.iconUrl,
        latestVersion: record.versions[0] ? toVersionDto(record.versions[0]) : null,
        versionCount: record.versions.length,
      })),
    };
  });

  app.post("/developer/apps", guard, async (request, reply) => {
    const developer = await currentDeveloper(app, request);
    const input = appCreateSchema.parse(request.body);

    const category = await app.prisma.category.findFirst({ where: { id: input.categoryId, isActive: true } });
    if (!category) throw new BadRequestError("Choose an existing category");

    const baseSlug = input.slug ?? slugify(input.name);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const clash = await app.prisma.app.findUnique({ where: { slug } });
      if (!clash) break;
      slug = `${baseSlug}-${randomUUID().slice(0, 4)}`;
    }

    try {
      const created = await app.prisma.app.create({
        data: {
          developerId: developer.id,
          categoryId: input.categoryId,
          slug,
          packageName: input.packageName,
          name: input.name,
          shortDescription: input.shortDescription,
          fullDescription: input.fullDescription,
        },
      });
      return reply.status(201).send({ id: created.id, slug: created.slug, status: created.status });
    } catch (error) {
      if (isUniqueConstraintError(error, "package_name") || isUniqueConstraintError(error, "packageName")) {
        throw new ConflictError("An application with this package name already exists", "package_name_taken");
      }
      if (isUniqueConstraintError(error, "slug")) {
        throw new ConflictError("An application with this name already exists", "slug_taken");
      }
      throw error;
    }
  });

  app.get("/developer/apps/:id", guard, async (request) => {
    const { id } = appIdSchema.parse(request.params);
    const developer = await currentDeveloper(app, request);
    const record = await ownedApp(app, developer.id, id);

    const [versions, assets, downloads] = await Promise.all([
      app.prisma.appVersion.findMany({
        where: { appId: id },
        orderBy: { versionCode: "desc" },
        include: { file: true },
      }),
      app.prisma.appAsset.findMany({ where: { appId: id }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
      app.prisma.downloadEvent.count({ where: { appId: id } }),
    ]);

    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      packageName: record.packageName,
      shortDescription: record.shortDescription,
      fullDescription: record.fullDescription,
      status: record.status,
      iconUrl: record.iconUrl,
      category: { id: record.category.id, name: record.category.name, slug: record.category.slug },
      downloadCount: downloads,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      assets: assets.map(toAssetDto),
      versions: versions.map(toVersionDto),
    };
  });

  app.patch("/developer/apps/:id", guard, async (request) => {
    const { id } = appIdSchema.parse(request.params);
    const developer = await currentDeveloper(app, request);
    const record = await ownedApp(app, developer.id, id);
    const input = appUpdateSchema.parse(request.body);

    if (record.status === "SUSPENDED") {
      throw new ForbiddenError("A suspended application cannot be edited", "app_suspended");
    }
    if (input.categoryId) {
      const category = await app.prisma.category.findFirst({ where: { id: input.categoryId, isActive: true } });
      if (!category) throw new BadRequestError("Choose an existing category");
    }

    const updated = await app.prisma.app.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        categoryId: input.categoryId ?? undefined,
        shortDescription: input.shortDescription ?? undefined,
        fullDescription: input.fullDescription ?? undefined,
      },
    });
    return { ok: true, updatedAt: updated.updatedAt.toISOString() };
  });

  app.post("/developer/apps/:id/assets", guard, async (request, reply) => {
    const { id } = appIdSchema.parse(request.params);
    const developer = await currentDeveloper(app, request);
    const record = await ownedApp(app, developer.id, id);

    const { fields, file } = await readMultipart(request, { maxFileBytes: app.config.maxImageBytes });
    if (!file) throw new BadRequestError("Attach an image");

    const kind = z.enum(["ICON", "SCREENSHOT", "FEATURE_GRAPHIC"]).parse(fields.kind ?? "SCREENSHOT");
    const meta = detectImage(file.buffer);
    if (!meta) throw new BadRequestError("Upload a PNG, JPEG or WebP image");

    const limits = kind === "ICON" ? { width: 512, height: 512 } : { width: 2560, height: 2560 };
    if (meta.width > limits.width || meta.height > limits.height) {
      throw new BadRequestError(`Images for ${kind.toLowerCase()} must be at most ${limits.width}x${limits.height}`);
    }

    const assetId = randomUUID();
    const extension = meta.mimeType === "image/png" ? "png" : meta.mimeType === "image/jpeg" ? "jpg" : "webp";
    const storageKey = StorageKeys.asset(id, assetId, `${kind.toLowerCase()}.${extension}`);
    await app.storage.put(storageKey, file.buffer, meta.mimeType);

    const sortOrder = Number.parseInt(fields.sortOrder ?? "0", 10);
    const asset = await app.prisma.appAsset.create({
      data: {
        id: assetId,
        appId: id,
        kind,
        storageKey,
        url: `${app.config.API_PUBLIC_URL}/api/v1/assets/${assetId}/file`,
        mimeType: meta.mimeType,
        size: BigInt(file.buffer.length),
        width: meta.width,
        height: meta.height,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      },
    });

    if (kind === "ICON") {
      await app.prisma.app.update({ where: { id }, data: { iconUrl: asset.url } });
    }

    return reply.status(201).send(toAssetDto(asset));
  });

  app.delete("/developer/apps/:id/assets/:assetId", guard, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), assetId: z.string().uuid() }).parse(request.params);
    const developer = await currentDeveloper(app, request);
    const record = await ownedApp(app, developer.id, params.id);

    const asset = await app.prisma.appAsset.findFirst({ where: { id: params.assetId, appId: record.id } });
    if (!asset) throw new NotFoundError("Asset not found");

    await app.storage.delete(asset.storageKey);
    await app.prisma.appAsset.delete({ where: { id: asset.id } });
    if (asset.kind === "ICON") {
      await app.prisma.app.update({ where: { id: record.id }, data: { iconUrl: null } });
    }
    return reply.status(204).send();
  });

  /**
   * APK upload. The bytes go straight to the quarantine area; the version is not
   * downloadable and no metadata from the client is trusted until the worker has
   * inspected the archive.
   */
  app.post("/developer/apps/:id/versions", guard, async (request, reply) => {
    const { id } = appIdSchema.parse(request.params);
    const developer = await currentDeveloper(app, request);
    const record = await ownedApp(app, developer.id, id);

    if (record.status === "SUSPENDED") throw new ForbiddenError("A suspended application cannot publish", "app_suspended");

    const { fields, file } = await readMultipart(request, { maxFileBytes: app.config.maxApkBytes });
    if (!file) throw new BadRequestError("Attach an APK file");
    if (file.buffer.length < 4 || file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
      throw new BadRequestError("The uploaded file is not an APK archive");
    }

    const input = versionCreateSchema.parse({
      versionName: fields.versionName,
      versionCode: fields.versionCode,
      releaseNotes: fields.releaseNotes || undefined,
    });

    const existing = await app.prisma.appVersion.findFirst({
      where: { appId: id, versionCode: input.versionCode },
    });
    if (existing) throw new ConflictError(`Version code ${input.versionCode} already exists for this app`);

    const versionId = randomUUID();
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const quarantineKey = StorageKeys.quarantine(versionId, `${record.packageName}.apk`);
    await app.storage.put(quarantineKey, file.buffer, "application/vnd.android.package-archive");

    const version = await app.prisma.appVersion.create({
      data: {
        id: versionId,
        appId: id,
        versionName: input.versionName,
        versionCode: input.versionCode,
        releaseNotes: input.releaseNotes ?? null,
        status: "UPLOADED",
        fileSize: BigInt(file.buffer.length),
        sha256,
        file: {
          create: {
            storageKey: quarantineKey,
            quarantineKey,
            size: BigInt(file.buffer.length),
            sha256,
            scanStatus: "PENDING",
          },
        },
      },
      include: { file: true },
    });

    return reply.status(201).send(toVersionDto(version));
  });

  /** Submitting queues the validation + scan pipeline; nothing is published here. */
  app.post("/developer/versions/:id/submit", guard, async (request, reply) => {
    const { id } = versionIdSchema.parse(request.params);
    const developer = await currentDeveloper(app, request);
    const input = submitVersionSchema.parse(request.body ?? {});

    const version = await app.prisma.appVersion.findFirst({
      where: { id, app: { developerId: developer.id } },
      include: { app: true, file: true },
    });
    if (!version) throw new NotFoundError("Version not found");
    if (!version.file) throw new BadRequestError("Upload an APK before submitting this version");
    if (!["UPLOADED", "QUARANTINED", "REJECTED", "FLAGGED"].includes(version.status)) {
      throw new ConflictError(`A version in ${version.status} cannot be submitted`, "invalid_state");
    }
    if (version.app.status === "SUSPENDED") throw new ForbiddenError("This application is suspended", "app_suspended");

    await transitionVersion(app.prisma, version.id, {
      from: version.status,
      to: "VALIDATING",
      actorUserId: request.auth!.user.id,
      note: input.releaseNotes ? `Submitted: ${input.releaseNotes.slice(0, 200)}` : "Submitted for review",
      extra: {
        submittedAt: new Date(),
        rejectionReason: null,
        releaseNotes: input.releaseNotes ?? version.releaseNotes,
      },
    });
    await app.prisma.app.update({
      where: { id: version.appId },
      data: { status: version.app.status === "PUBLISHED" ? "PUBLISHED" : "PENDING_REVIEW" },
    });

    await app.queue.send(QUEUES.apkValidate, { versionId: version.id });

    return reply.status(202).send({ ok: true, status: "VALIDATING" });
  });

  app.get("/developer/submissions", guard, async (request) => {
    const developer = await currentDeveloper(app, request);
    const versions = await app.prisma.appVersion.findMany({
      where: {
        app: { developerId: developer.id },
        status: { in: ["VALIDATING", "SCANNING", "PENDING_REVIEW", "APPROVED", "REJECTED", "QUARANTINED", "FLAGGED"] },
      },
      orderBy: { submittedAt: "desc" },
      include: { app: { select: { id: true, name: true, slug: true } }, file: true },
    });
    return {
      items: versions.map((version) => ({
        ...toVersionDto(version),
        app: version.app,
      })),
    };
  });

  app.get("/developer/analytics", guard, async (request) => {
    const developer = await currentDeveloper(app, request);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const apps = await app.prisma.app.findMany({
      where: { developerId: developer.id },
      select: { id: true, name: true, slug: true, status: true },
    });
    const appIds = apps.map((record) => record.id);

    const [total, recent, perApp, recentPerApp, daily] = await Promise.all([
      app.prisma.downloadEvent.count({ where: { appId: { in: appIds } } }),
      app.prisma.downloadEvent.count({ where: { appId: { in: appIds }, createdAt: { gte: since } } }),
      app.prisma.downloadEvent.groupBy({ by: ["appId"], where: { appId: { in: appIds } }, _count: { _all: true } }),
      app.prisma.downloadEvent.groupBy({
        by: ["appId"],
        where: { appId: { in: appIds }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      app.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', de.created_at) AS day, COUNT(*)::bigint AS count
        FROM download_events de
        JOIN apps a ON a.id = de.app_id
        WHERE a.developer_id = ${developer.id}::uuid AND de.created_at >= ${since}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ]);

    const totalByApp = new Map(perApp.map((row) => [row.appId, row._count._all]));
    const recentByApp = new Map(recentPerApp.map((row) => [row.appId, row._count._all]));

    return {
      totalDownloads: total,
      downloadsLast30Days: recent,
      apps: apps.map((record) => ({
        appId: record.id,
        name: record.name,
        slug: record.slug,
        status: record.status,
        downloads: totalByApp.get(record.id) ?? 0,
        downloadsLast30Days: recentByApp.get(record.id) ?? 0,
      })),
      daily: daily.map((row) => ({ date: row.day.toISOString().slice(0, 10), downloads: Number(row.count) })),
    };
  });
}
