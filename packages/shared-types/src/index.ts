/**
 * Shared API contract types. Both the backend services and the Astro frontends
 * import these so that a response shape change is a compile error, not a
 * runtime surprise.
 */

export type Role = "USER" | "DEVELOPER" | "ADMIN" | "SUPER_ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "DELETED";
export type AppStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "PUBLISHED" | "REJECTED" | "SUSPENDED";
export type VersionStatus =
  | "DRAFT"
  | "UPLOADED"
  | "QUARANTINED"
  | "VALIDATING"
  | "SCANNING"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "REJECTED"
  | "FLAGGED";
export type ScanStatus = "PENDING" | "CLEAN" | "INFECTED" | "ERROR";
export type ReportStatus = "OPEN" | "REVIEWED" | "DISMISSED" | "ACTIONED";
export type ReportReason = "MALWARE" | "ILLEGAL_CONTENT" | "COPYRIGHT" | "SPAM" | "MISLEADING" | "OTHER";

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  mfaEnabled: boolean;
  developerId: string | null;
  developerSlug: string | null;
}

export interface AuthSessionResponse {
  user: CurrentUser;
  csrfToken: string;
  mfaRequired?: boolean;
}

export interface DeveloperSummary {
  id: string;
  displayName: string;
  slug: string;
  website: string | null;
  supportEmail: string;
  description: string | null;
  isVerified: boolean;
}

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  appCount: number;
}

export interface AppAssetDto {
  id: string;
  kind: "ICON" | "SCREENSHOT" | "FEATURE_GRAPHIC";
  url: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
}

export interface AppSummary {
  id: string;
  slug: string;
  name: string;
  packageName: string;
  shortDescription: string;
  iconUrl: string | null;
  category: { id: string; slug: string; name: string };
  developer: { id: string; displayName: string; slug: string };
  rating: number;
  reviewCount: number;
  downloadCount: number;
  latestVersionName: string | null;
  updatedAt: string;
  isFeatured: boolean;
}

export interface AppVersionDto {
  id: string;
  versionName: string;
  versionCode: number;
  minSdk: number | null;
  targetSdk: number | null;
  releaseNotes: string | null;
  status: VersionStatus;
  fileSize: number | null;
  sha256: string | null;
  signingCertSha256: string | null;
  scanStatus: ScanStatus | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface AppDetail extends AppSummary {
  fullDescription: string;
  status: AppStatus;
  publishedAt: string | null;
  createdAt: string;
  screenshots: AppAssetDto[];
  versions: AppVersionDto[];
  latestVersion: AppVersionDto | null;
}

export interface ReviewDto {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: "VISIBLE" | "HIDDEN" | "REMOVED";
  createdAt: string;
  author: { id: string; displayName: string };
  mine?: boolean;
}

export interface CollectionSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  appCount: number;
}

export interface DownloadTicket {
  url: string;
  expiresAt: string;
  fileName: string;
  size: number;
  sha256: string;
  versionName: string;
  versionCode: number;
}

export interface DeveloperAnalytics {
  totalDownloads: number;
  downloadsLast30Days: number;
  apps: Array<{
    appId: string;
    name: string;
    slug: string;
    status: AppStatus;
    downloads: number;
    downloadsLast30Days: number;
  }>;
  daily: Array<{ date: string; downloads: number }>;
}

export interface AdminDashboard {
  users: { total: number; suspended: number; newLast7Days: number };
  developers: { total: number; verified: number };
  apps: { total: number; published: number; suspended: number; pendingReview: number };
  submissions: { pending: number; approvedLast7Days: number; rejectedLast7Days: number };
  reports: { open: number };
  downloads: { total: number; last7Days: number };
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; email: string; displayName: string } | null;
}

/** Roles that may use the admin portal. */
export const ADMIN_ROLES: Role[] = ["ADMIN", "SUPER_ADMIN"];

export function isAdminRole(role: Role): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function isDeveloperRole(role: Role): boolean {
  return role === "DEVELOPER" || role === "ADMIN" || role === "SUPER_ADMIN";
}

export const APP_STATUS_LABELS: Record<AppStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "In review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};

export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  DRAFT: "Draft",
  UPLOADED: "Uploaded",
  QUARANTINED: "Quarantined",
  VALIDATING: "Validating",
  SCANNING: "Scanning",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
  FLAGGED: "Flagged",
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  MALWARE: "Malware or unsafe content",
  ILLEGAL_CONTENT: "Illegal content",
  COPYRIGHT: "Copyright or trademark violation",
  SPAM: "Spam or deceptive listing",
  MISLEADING: "Misleading description",
  OTHER: "Something else",
};
