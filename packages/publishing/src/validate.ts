import { inspectApk } from "@aplora/apk";
import { transitionVersion } from "./transitions";
import type { PublishingContext } from "./types";

export interface ValidationOutcome {
  status: "VALID" | "QUARANTINED";
  reasons: string[];
  versionId: string;
}

/**
 * Structural validation of a submitted APK: archive integrity, manifest
 * metadata, package identity, version identity and signing certificate pinning.
 * A failure moves the version to QUARANTINED with a reviewer-visible reason and
 * the file never becomes downloadable.
 */
export async function validateVersionUpload(
  context: PublishingContext,
  versionId: string,
): Promise<ValidationOutcome> {
  const { prisma, storage, logger } = context;
  const version = await prisma.appVersion.findUnique({
    where: { id: versionId },
    include: { app: true, file: true },
  });
  if (!version) throw new Error(`Version ${versionId} does not exist`);
  if (!version.file) throw new Error(`Version ${versionId} has no uploaded file`);
  if (!version.file.quarantineKey) throw new Error(`Version ${versionId} has no quarantine object`);

  const quarantine = async (reasons: string[]) => {
    await transitionVersion(prisma, versionId, {
      from: version.status,
      to: "QUARANTINED",
      note: reasons.join("; ").slice(0, 900),
      extra: { rejectionReason: reasons.join("; ").slice(0, 900) },
    });
    await prisma.appFile.update({
      where: { versionId },
      data: {
        scanStatus: "ERROR",
        scannedAt: new Date(),
        scanReport: { stage: "validation", reasons } as object,
      },
    });
    logger.warn({ versionId, reasons }, "apk quarantined during validation");
    return { status: "QUARANTINED" as const, reasons, versionId };
  };

  const buffer = await storage.get(version.file.quarantineKey);
  const inspection = inspectApk(buffer, { maxSizeBytes: context.maxApkBytes });

  const reasons = [...inspection.errors];

  if (inspection.packageName && inspection.packageName !== version.app.packageName) {
    reasons.push(
      `APK package name ${inspection.packageName} does not match the listing package name ${version.app.packageName}`,
    );
  }

  // The manifest is authoritative for version identity: a developer cannot
  // claim versionCode 42 while shipping versionCode 41.
  if (inspection.versionCode !== null && inspection.versionCode !== version.versionCode) {
    reasons.push(
      `APK declares versionCode ${inspection.versionCode} but the submission is registered as ${version.versionCode}`,
    );
  }
  if (inspection.versionName && inspection.versionName !== version.versionName) {
    reasons.push(
      `APK declares versionName ${inspection.versionName} but the submission is registered as ${version.versionName}`,
    );
  }

  // Signing identity must be stable across releases of the same app.
  if (inspection.signature) {
    const previous = await prisma.appVersion.findFirst({
      where: {
        appId: version.appId,
        id: { not: versionId },
        signingCertSha256: { not: null },
        status: { in: ["APPROVED", "PUBLISHED", "PENDING_REVIEW"] },
      },
      orderBy: { versionCode: "desc" },
    });
    if (previous?.signingCertSha256 && previous.signingCertSha256 !== inspection.signature.sha256) {
      reasons.push(
        "Signing certificate does not match the certificate used for previous releases of this application",
      );
    }
  }

  const duplicateVersion = await prisma.appVersion.findFirst({
    where: { appId: version.appId, versionCode: inspection.versionCode ?? -1, id: { not: versionId } },
  });
  if (duplicateVersion) {
    reasons.push(`Version code ${inspection.versionCode} already exists for this application`);
  }

  if (reasons.length > 0) return quarantine(reasons);

  const updated = await prisma.appVersion.update({
    where: { id: versionId },
    data: {
      versionName: inspection.versionName ?? version.versionName,
      versionCode: inspection.versionCode ?? version.versionCode,
      minSdk: inspection.minSdk,
      targetSdk: inspection.targetSdk,
      fileSize: BigInt(inspection.size),
      sha256: inspection.sha256,
      signingCertSha256: inspection.signature?.sha256 ?? null,
      rejectionReason: null,
    },
  });

  await prisma.appFile.update({
    where: { versionId },
    data: {
      size: BigInt(inspection.size),
      sha256: inspection.sha256,
      scanStatus: "PENDING",
      scanReport: {
        stage: "validation",
        entryCount: inspection.entryCount,
        permissions: inspection.permissions,
        signingScheme: inspection.signature?.scheme ?? null,
        certificate: inspection.signature,
      } as object,
    },
  });

  await transitionVersion(prisma, versionId, {
    from: updated.status,
    to: "SCANNING",
    note: "Structural validation passed",
  });

  logger.info({ versionId, sha256: inspection.sha256 }, "apk validated");
  return { status: "VALID", reasons: [], versionId };
}
