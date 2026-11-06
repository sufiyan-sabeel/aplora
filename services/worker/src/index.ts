import { prisma } from "@aplora/database";
import { scanVersionFile, validateVersionUpload, type PublishingContext } from "@aplora/publishing";
import { createStorage } from "@aplora/storage";
import PgBoss from "pg-boss";
import { getConfig } from "./env";

const QUEUES = { apkValidate: "apk.validate", apkScan: "apk.scan" } as const;

async function main(): Promise<void> {
  const config = getConfig();

  const storage = createStorage({
    driver: config.STORAGE_DRIVER,
    localRoot: config.STORAGE_LOCAL_ROOT,
    endpoint: config.STORAGE_ENDPOINT || undefined,
    region: config.STORAGE_REGION,
    bucket: config.STORAGE_BUCKET,
    accessKey: config.STORAGE_ACCESS_KEY || undefined,
    secretKey: config.STORAGE_SECRET_KEY || undefined,
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
  });

  const logger = {
    info: (obj: object, msg?: string) => console.log(msg ?? "", JSON.stringify(obj)),
    warn: (obj: object, msg?: string) => console.warn(msg ?? "", JSON.stringify(obj)),
    error: (obj: object, msg?: string) => console.error(msg ?? "", JSON.stringify(obj)),
  };

  const context: PublishingContext = {
    prisma,
    storage,
    maxApkBytes: config.MAX_APK_SIZE_MB * 1024 * 1024,
    scanner: {
      driver: config.MALWARE_SCANNER,
      clamavHost: config.CLAMAV_HOST,
      clamavPort: config.CLAMAV_PORT,
    },
    logger,
  };

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: config.WORKER_QUEUE_SCHEMA,
    retryLimit: 2,
    retryDelay: 30,
    expireInMinutes: 30,
  });
  boss.on("error", (error: Error) => logger.error({ err: error.message }, "pg-boss error"));

  await boss.start();
  for (const queue of Object.values(QUEUES)) await boss.createQueue(queue);

  // pg-boss v10 hands the handler an array of jobs (batch size 1 by default).
  await boss.work<{ versionId: string }>(QUEUES.apkValidate, async (jobs) => {
    for (const job of jobs) {
      const { versionId } = job.data;
      logger.info({ versionId }, "validating uploaded apk");
      const outcome = await validateVersionUpload(context, versionId);
      if (outcome.status === "VALID") {
        await boss.send(QUEUES.apkScan, { versionId });
      }
    }
  });

  await boss.work<{ versionId: string }>(QUEUES.apkScan, async (jobs) => {
    for (const job of jobs) {
      const { versionId } = job.data;
      logger.info({ versionId }, "scanning uploaded apk");
      const outcome = await scanVersionFile(context, versionId);
      logger.info({ versionId, status: outcome.status }, "scan finished");
    }
  });

  logger.info({ queues: Object.values(QUEUES) }, "aplora worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await boss.stop({ graceful: true, timeout: 10_000 });
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
