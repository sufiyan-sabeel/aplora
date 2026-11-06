import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { z } from "zod";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
loadDotenv();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().default("./.storage"),
  STORAGE_ENDPOINT: z.string().optional().default(""),
  STORAGE_BUCKET: z.string().default("aplora-storage"),
  STORAGE_ACCESS_KEY: z.string().optional().default(""),
  STORAGE_SECRET_KEY: z.string().optional().default(""),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_FORCE_PATH_STYLE: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === "boolean" ? value : value !== "false"))
    .default(true),
  MAX_APK_SIZE_MB: z.coerce.number().int().default(200),
  MALWARE_SCANNER: z.enum(["local", "clamav"]).default("local"),
  CLAMAV_HOST: z.string().default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  WORKER_QUEUE_SCHEMA: z.string().default("pgboss"),
});

export type WorkerConfig = z.infer<typeof schema>;

export function getConfig(): WorkerConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid worker configuration:\n${parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n")}`,
    );
  }
  return parsed.data;
}
