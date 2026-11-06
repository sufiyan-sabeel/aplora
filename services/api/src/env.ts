import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { z } from "zod";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
loadDotenv();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(168),
  COOKIE_SECURE: booleanish.default(false),
  COOKIE_DOMAIN: z.string().optional().default(""),
  /**
   * SameSite policy. "lax" is right when the portals and the API share a site
   * (example.com and api.example.com). "none" is required when the frontend is
   * hosted on a different site, such as GitHub Pages, and requires Secure.
   */
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().default("./.storage"),
  STORAGE_ENDPOINT: z.string().optional().default(""),
  STORAGE_BUCKET: z.string().default("aplora-storage"),
  STORAGE_ACCESS_KEY: z.string().optional().default(""),
  STORAGE_SECRET_KEY: z.string().optional().default(""),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_FORCE_PATH_STYLE: booleanish.default(true),

  PUBLIC_MARKETPLACE_URL: z.string().url().default("http://localhost:4321"),
  PUBLIC_DEVELOPER_URL: z.string().url().default("http://localhost:4322"),
  PUBLIC_ADMIN_URL: z.string().url().default("http://localhost:4323"),

  MAX_APK_SIZE_MB: z.coerce.number().int().min(1).max(2048).default(200),
  MAX_IMAGE_SIZE_MB: z.coerce.number().int().min(1).max(64).default(8),

  MALWARE_SCANNER: z.enum(["local", "clamav"]).default("local"),
  CLAMAV_HOST: z.string().default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  SMTP_FROM: z.string().default("Aplora <no-reply@aplora.local>"),

  WORKER_QUEUE_SCHEMA: z.string().default("pgboss"),
  MFA_ISSUER: z.string().default("Aplora"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
  maxApkBytes: number;
  maxImageBytes: number;
};

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    const problems: string[] = [];
    if (env.SESSION_SECRET === "replace-with-a-long-random-secret" || env.SESSION_SECRET.length < 32) {
      problems.push("SESSION_SECRET must be a unique random value of at least 32 characters in production");
    }
    if (!env.COOKIE_SECURE) problems.push("COOKIE_SECURE must be true in production");
    if (env.STORAGE_DRIVER === "s3" && (!env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY)) {
      problems.push("STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required when STORAGE_DRIVER=s3");
    }
    if (problems.length > 0) {
      throw new Error(`Refusing to start in production:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    }
  }

  // Browsers reject SameSite=None without Secure, in every environment.
  if (env.COOKIE_SAMESITE === "none" && !env.COOKIE_SECURE) {
    throw new Error(
      "COOKIE_SAMESITE=none requires COOKIE_SECURE=true: browsers reject a SameSite=None cookie that is not marked Secure.",
    );
  }

  cached = {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    maxApkBytes: env.MAX_APK_SIZE_MB * 1024 * 1024,
    maxImageBytes: env.MAX_IMAGE_SIZE_MB * 1024 * 1024,
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
