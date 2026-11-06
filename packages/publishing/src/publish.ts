import type { PrismaClient } from "@aplora/database";
import type { StorageAdapter } from "@aplora/storage";
import { transitionVersion } from "./transitions";

export interface PublishResult {
  versionId: string;
  storageKey: string;
}

/**
 * Moves a reviewed APK out of quarantine into the published area and makes the
 * version downloadable. The published object is immutable: a new build is a new
 * version, never a replacement of an approved file.
 */
export async function publishVersion(
  prisma: PrismaClient,
  storage: StorageAdapter,
  versionId: string,
  actorUserId: string,
): Promise<PublishResult> {
  const version = await prisma.appVersion.findUnique({ where: { id: versionId }, include: { file: true, app: true } });
  if (!version?.file) throw new Error(`Version ${versionId} has no file`);
  if (version.status !== "APPROVED") throw new Error(`Version ${versionId} is not approved`);

  const quarantineKey = version.file.quarantineKey;
  const publishedKey = `published/${version.appId}/${versionId}/${version.app.packageName}-${version.versionCode}.apk`;

  if (quarantineKey) {
    const buffer = await storage.get(quarantineKey);
    await storage.put(publishedKey, buffer, "application/vnd.android.package-archive");
  }

  const now = new Date();
  const updated = await transitionVersion(prisma, versionId, {
    from: "APPROVED",
    to: "PUBLISHED",
    actorUserId,
    note: "Approved and published",
    extra: { publishedAt: now },
  });

  await prisma.appFile.update({
    where: { versionId },
    data: { storageKey: publishedKey, quarantineKey: null },
  });

  await prisma.app.update({
    where: { id: version.appId },
    data: { status: "PUBLISHED", publishedAt: version.app.publishedAt ?? now, suspendedReason: null },
  });

  return { versionId: updated.id, storageKey: publishedKey };
}
