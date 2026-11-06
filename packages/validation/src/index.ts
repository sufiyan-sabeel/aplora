import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Enter a valid email address")
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long")
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: "Include at least one letter and one number",
  });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

export const packageNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/,
    "Use a reverse-DNS package name such as com.example.app",
  );

export const uuidSchema = z.string().uuid("Invalid identifier");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2, "Enter your name").max(60),
  accountType: z.enum(["USER", "DEVELOPER"]).default("USER"),
  developerName: z.string().trim().min(2).max(60).optional(),
  supportEmail: emailSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(200),
  totp: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "Enter the 6-digit code")
    .optional(),
});

export const verifyEmailSchema = z.object({ token: z.string().min(10).max(200) });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const mfaEnableSchema = z.object({
  secret: z.string().min(16).max(64),
  code: z.string().trim().regex(/^[0-9]{6}$/),
});

export const mfaVerifySchema = z.object({ code: z.string().trim().regex(/^[0-9]{6}$/) });

export const mfaDisableSchema = z.object({ password: z.string().min(1).max(200) });

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export const appSortSchema = z.enum(["relevance", "popular", "rating", "recent", "name"]).default("relevance");

export const appListQuerySchema = paginationSchema.extend({
  category: z.string().trim().max(80).optional(),
  developer: z.string().trim().max(80).optional(),
  sort: appSortSchema,
});

export const searchQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  sort: appSortSchema,
});

export const reviewCreateSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(3, "Write at least a few words").max(2000),
});

export const reviewUpdateSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(3).max(2000).optional(),
});

export const reportCreateSchema = z.object({
  reason: z.enum(["MALWARE", "ILLEGAL_CONTENT", "COPYRIGHT", "SPAM", "MISLEADING", "OTHER"]),
  details: z.string().trim().max(2000).optional(),
});

/* ------------------------------------------------------------------ */
/* Developer                                                           */
/* ------------------------------------------------------------------ */

export const developerProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  website: z.string().trim().url("Enter a full URL").max(200).optional().or(z.literal("")),
  supportEmail: emailSchema.optional(),
  description: z.string().trim().max(2000).optional(),
});

export const appCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter an app name").max(80),
  packageName: packageNameSchema,
  categoryId: uuidSchema,
  shortDescription: z.string().trim().min(10, "Write at least 10 characters").max(120),
  fullDescription: z.string().trim().min(30, "Write at least 30 characters").max(8000),
  slug: slugSchema.optional(),
});

export const appUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  categoryId: uuidSchema.optional(),
  shortDescription: z.string().trim().min(10).max(120).optional(),
  fullDescription: z.string().trim().min(30).max(8000).optional(),
});

export const versionCreateSchema = z.object({
  versionName: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[0-9]+(\.[0-9]+)*([a-zA-Z0-9.-]*)$/, "Use a version such as 1.4.2"),
  versionCode: z.coerce.number().int().min(1).max(2_100_000_000),
  releaseNotes: z.string().trim().max(4000).optional(),
});

export const submitVersionSchema = z.object({
  releaseNotes: z.string().trim().max(4000).optional(),
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export const rejectSchema = z.object({
  reason: z.string().trim().min(5, "Explain the rejection").max(1000),
});

export const suspendAppSchema = z.object({
  reason: z.string().trim().min(5, "Explain the suspension").max(1000),
});

export const adminUserUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  role: z.enum(["USER", "DEVELOPER", "ADMIN", "SUPER_ADMIN"]).optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: slugSchema.optional(),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(40).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.coerce.boolean().default(true),
});

export const categoryUpdateSchema = categoryCreateSchema.partial();

export const collectionCreateSchema = z.object({
  title: z.string().trim().min(2).max(80),
  slug: slugSchema.optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  appIds: z.array(uuidSchema).max(60).optional(),
});

export const collectionUpdateSchema = collectionCreateSchema.partial();

export const reportUpdateSchema = z.object({
  status: z.enum(["OPEN", "REVIEWED", "DISMISSED", "ACTIONED"]),
  note: z.string().trim().max(1000).optional(),
});

export const settingUpdateSchema = z.object({
  key: z.string().trim().min(2).max(60),
  value: z.unknown(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AppCreateInput = z.infer<typeof appCreateSchema>;
export type AppUpdateInput = z.infer<typeof appUpdateSchema>;
export type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;
export type VersionCreateInput = z.infer<typeof versionCreateSchema>;
