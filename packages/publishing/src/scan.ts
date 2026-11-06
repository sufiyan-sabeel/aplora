import { scanApk, type ApkInspection } from "@aplora/apk";
import { transitionVersion } from "./transitions";
import type { PublishingContext } from "./types";

export interface ScanOutcome {
  status: "CLEAN" | "INFECTED" | "ERROR";
  findings: Array<{ severity: string; code: string; message: string }>;
  versionId: string;
}

/**
 * Malware scan of a validated APK. CLEAN moves the version into the review
 * queue; INFECTED flags it for an administrator and blocks publication.
 */
export async function scanVersionFile(context: PublishingContext, versionId: string): Promise<ScanOutcome> {
  const { prisma, storage, logger } = context;
  const version = await prisma.appVersion.findUnique({
    where: { id: versionId },
    include: { file: true },
  });
  if (!version?.file?.quarantineKey) throw new Error(`Version ${versionId} has no quarantined file`);

  const buffer = await storage.get(version.file.quarantineKey);

  const inspection = {
    permissions: [],
    duplicateEntries: [],
    compressionRatio: 0,
    size: buffer.length,
    signature: null,
    hasDex: true,
    dexCount: 1,
    unsignedNativeLibraries: [],
  } as unknown as ApkInspection;

  const stored = version.file.scanReport as { permissions?: string[]; certificate?: unknown } | null;
  if (stored?.permissions) inspection.permissions = stored.permissions;
  if (stored?.certificate) inspection.signature = stored.certificate as ApkInspection["signature"];

  const result = await scanApk(buffer, inspection, {
    driver: context.scanner.driver,
    clamavHost: context.scanner.clamavHost,
    clamavPort: context.scanner.clamavPort,
  });

  await prisma.appFile.update({
    where: { versionId },
    data: {
      scanStatus: result.status === "CLEAN" ? "CLEAN" : result.status === "INFECTED" ? "INFECTED" : "ERROR",
      scanReport: result as unknown as object,
      scannedAt: new Date(),
    },
  });

  if (result.status === "CLEAN") {
    await transitionVersion(prisma, versionId, {
      from: version.status,
      to: "PENDING_REVIEW",
      note: "Scan completed without findings",
    });
    await prisma.app.update({ where: { id: version.appId }, data: { status: "PENDING_REVIEW" } });
  } else {
    await transitionVersion(prisma, versionId, {
      from: version.status,
      to: result.status === "INFECTED" ? "FLAGGED" : "QUARANTINED",
      note: result.findings.map((finding) => finding.message).join("; ").slice(0, 900),
      extra: {
        rejectionReason:
          result.status === "INFECTED"
            ? "Automatic scan reported a security problem"
            : "Automatic scan could not complete",
      },
    });
    logger.warn({ versionId, status: result.status }, "apk scan did not pass");
  }

  return { status: result.status, findings: result.findings, versionId };
}
