import { createToken } from "@aplora/auth";
import { hashIp } from "@aplora/auth";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError } from "../lib/errors";
import { signDownloadToken, verifyDownloadToken } from "../lib/download-token";
import { resolveApp } from "../services/catalog";

const TICKET_TTL_SECONDS = 120;

export default async function downloadRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Resolves the downloadable version of an app, records the download and
   * returns a short-lived signed URL. Nothing is fabricated: if no approved,
   * published and clean version exists, the request fails.
   */
  app.post("/apps/:slug/download", { preHandler: app.optionalAuth }, async (request, reply) => {
    const { slug } = z.object({ slug: z.string().min(1).max(120) }).parse(request.params);
    const resolved = await resolveApp(app.prisma, slug);

    if (resolved.status !== "PUBLISHED") throw new NotFoundError("This application is not available for download");

    const version = await app.prisma.appVersion.findFirst({
      where: { appId: resolved.id, status: "PUBLISHED", file: { scanStatus: "CLEAN" } },
      orderBy: { versionCode: "desc" },
      include: { file: true },
    });
    if (!version?.file) throw new NotFoundError("No published version is available for download");

    const payload = {
      versionId: version.id,
      appId: resolved.id,
      exp: Date.now() + TICKET_TTL_SECONDS * 1000,
      nonce: createToken(9),
    };
    const token = signDownloadToken(payload, app.config.SESSION_SECRET);

    await app.prisma.downloadEvent.create({
      data: {
        appId: resolved.id,
        versionId: version.id,
        userId: request.auth?.user.id ?? null,
        ipHash: hashIp(request.ip, app.config.SESSION_SECRET),
        userAgent: request.headers["user-agent"]?.slice(0, 300) ?? null,
      },
    });

    return reply.status(201).send({
      url: `${app.config.API_PUBLIC_URL}/api/v1/downloads/${token}`,
      expiresAt: new Date(payload.exp).toISOString(),
      fileName: `${resolved.packageName}-${version.versionCode}.apk`,
      size: Number(version.file.size),
      sha256: version.file.sha256,
      versionName: version.versionName,
      versionCode: version.versionCode,
    });
  });

  app.get("/downloads/:token", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(request.params);

    let payload;
    try {
      payload = verifyDownloadToken(token, app.config.SESSION_SECRET);
    } catch {
      throw new NotFoundError("This download link is invalid or has expired");
    }

    // Re-check every condition at delivery time: an app suspended between the
    // ticket being issued and the file being fetched must not be served.
    const version = await app.prisma.appVersion.findFirst({
      where: { id: payload.versionId, appId: payload.appId, status: "PUBLISHED", file: { scanStatus: "CLEAN" } },
      include: { file: true, app: true },
    });
    if (!version?.file) throw new NotFoundError("This download link is invalid or has expired");
    if (version.app.status !== "PUBLISHED") throw new NotFoundError("This application is not available");

    const exists = await app.storage.exists(version.file.storageKey);
    if (!exists) throw new NotFoundError("The file for this version is unavailable");

    const fileName = `${version.app.packageName}-${version.versionCode}.apk`;
    reply
      .header("Content-Type", "application/vnd.android.package-archive")
      .header("Content-Disposition", `attachment; filename="${fileName}"`)
      .header("Content-Length", String(version.file.size))
      .header("X-Checksum-Sha256", version.file.sha256)
      .header("Cache-Control", "private, no-store");

    const stream = await app.storage.stream(version.file.storageKey);
    return reply.send(stream);
  });
}
