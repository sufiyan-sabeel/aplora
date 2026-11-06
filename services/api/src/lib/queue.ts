import PgBoss from "pg-boss";
import type { AppConfig } from "../env";

export const QUEUES = {
  apkValidate: "apk.validate",
  apkScan: "apk.scan",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface QueueClient {
  send(name: QueueName, data: object): Promise<void>;
  stop(): Promise<void>;
}

/**
 * PostgreSQL-backed queue (pg-boss). No Redis is required, and jobs survive a
 * restart because they live in the same database as the rest of the platform.
 */
export async function createQueue(config: AppConfig, logger: { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void }): Promise<QueueClient> {
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: config.WORKER_QUEUE_SCHEMA,
    retryLimit: 2,
    retryDelay: 30,
    expireInMinutes: 30,
  });
  boss.on("error", (error: Error) => logger.error({ err: error }, "pg-boss error"));
  await boss.start();
  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue);
  }

  return {
    async send(name, data) {
      await boss.send(name, data, { retryLimit: 2 });
    },
    async stop() {
      await boss.stop({ graceful: true, timeout: 5_000 });
    },
  };
}
