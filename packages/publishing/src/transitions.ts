import type { Prisma, PrismaClient, VersionStatus } from "@aplora/database";
import type { TransitionOptions } from "./types";

/**
 * Allowed lifecycle moves for an APK version. Anything not listed is rejected so
 * that a version can never jump straight from DRAFT to PUBLISHED.
 */
export const ALLOWED_TRANSITIONS: Record<VersionStatus, VersionStatus[]> = {
  DRAFT: ["UPLOADED", "QUARANTINED"],
  UPLOADED: ["VALIDATING", "QUARANTINED"],
  VALIDATING: ["SCANNING", "QUARANTINED", "FLAGGED"],
  SCANNING: ["PENDING_REVIEW", "FLAGGED", "QUARANTINED"],
  QUARANTINED: ["VALIDATING", "REJECTED"],
  PENDING_REVIEW: ["APPROVED", "REJECTED", "FLAGGED"],
  APPROVED: ["PUBLISHED", "REJECTED"],
  PUBLISHED: ["FLAGGED"],
  REJECTED: ["VALIDATING"],
  FLAGGED: ["QUARANTINED", "REJECTED", "VALIDATING"],
};

export function canTransition(from: VersionStatus, to: VersionStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class TransitionError extends Error {
  constructor(
    readonly from: VersionStatus,
    readonly to: VersionStatus,
  ) {
    super(`A version in ${from} cannot move to ${to}`);
  }
}

/** Applies a lifecycle transition and records it in the submission history. */
export async function transitionVersion(
  prisma: PrismaClient | Prisma.TransactionClient,
  versionId: string,
  options: TransitionOptions,
) {
  if (!canTransition(options.from, options.to)) {
    throw new TransitionError(options.from, options.to);
  }

  const version = await prisma.appVersion.update({
    where: { id: versionId },
    data: {
      status: options.to,
      ...(options.extra as Prisma.AppVersionUpdateInput | undefined),
    },
  });

  await prisma.submissionHistory.create({
    data: {
      versionId,
      fromStatus: options.from,
      toStatus: options.to,
      actorUserId: options.actorUserId ?? null,
      note: options.note ?? null,
    },
  });

  return version;
}
