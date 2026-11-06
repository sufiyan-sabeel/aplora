import type {
  App,
  AppAsset,
  AppFile,
  AppVersion,
  Category,
  DeveloperProfile,
  Review,
  User,
} from "@aplora/database";
import type {
  AppAssetDto,
  AppDetail,
  AppSummary,
  AppVersionDto,
  ReviewDto,
} from "@aplora/shared-types";

export type AppWithRelations = App & {
  developer: DeveloperProfile;
  category: Category;
};

export interface AppAggregates {
  rating: number;
  reviewCount: number;
  downloadCount: number;
  latestVersionName: string | null;
}

const EMPTY_AGGREGATES: AppAggregates = { rating: 0, reviewCount: 0, downloadCount: 0, latestVersionName: null };

export function toAppSummary(app: AppWithRelations, aggregates: AppAggregates = EMPTY_AGGREGATES): AppSummary {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    packageName: app.packageName,
    shortDescription: app.shortDescription,
    iconUrl: app.iconUrl,
    category: { id: app.category.id, slug: app.category.slug, name: app.category.name },
    developer: { id: app.developer.id, displayName: app.developer.displayName, slug: app.developer.slug },
    rating: aggregates.rating,
    reviewCount: aggregates.reviewCount,
    downloadCount: aggregates.downloadCount,
    latestVersionName: aggregates.latestVersionName,
    updatedAt: app.updatedAt.toISOString(),
    isFeatured: app.isFeatured,
  };
}

export function toVersionDto(
  version: AppVersion & { file?: AppFile | null },
): AppVersionDto {
  return {
    id: version.id,
    versionName: version.versionName,
    versionCode: version.versionCode,
    minSdk: version.minSdk,
    targetSdk: version.targetSdk,
    releaseNotes: version.releaseNotes,
    status: version.status,
    fileSize: version.fileSize === null ? null : Number(version.fileSize),
    sha256: version.sha256,
    signingCertSha256: version.signingCertSha256,
    scanStatus: version.file?.scanStatus ?? null,
    rejectionReason: version.rejectionReason,
    submittedAt: version.submittedAt?.toISOString() ?? null,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toAssetDto(asset: AppAsset): AppAssetDto {
  return {
    id: asset.id,
    kind: asset.kind,
    url: asset.url,
    width: asset.width,
    height: asset.height,
    sortOrder: asset.sortOrder,
  };
}

export function toAppDetail(
  app: AppWithRelations,
  aggregates: AppAggregates,
  assets: AppAsset[],
  versions: Array<AppVersion & { file?: AppFile | null }>,
): AppDetail {
  const published = versions.filter((version) => version.status === "PUBLISHED");
  const latest = published.sort((a, b) => b.versionCode - a.versionCode)[0] ?? null;
  return {
    ...toAppSummary(app, aggregates),
    fullDescription: app.fullDescription,
    status: app.status,
    publishedAt: app.publishedAt?.toISOString() ?? null,
    createdAt: app.createdAt.toISOString(),
    screenshots: assets.filter((asset) => asset.kind === "SCREENSHOT").map(toAssetDto),
    versions: published.map(toVersionDto),
    latestVersion: latest ? toVersionDto(latest) : null,
  };
}

export function toReviewDto(review: Review & { user: Pick<User, "id" | "displayName"> }, viewerId?: string | null): ReviewDto {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    status: review.status,
    createdAt: review.createdAt.toISOString(),
    author: { id: review.user.id, displayName: review.user.displayName },
    mine: viewerId ? review.user.id === viewerId : undefined,
  };
}

export function toCurrentUser(
  user: User & { developer: { id: string; slug: string } | null },
) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    mfaEnabled: user.mfaEnabled,
    developerId: user.developer?.id ?? null,
    developerSlug: user.developer?.slug ?? null,
  };
}
