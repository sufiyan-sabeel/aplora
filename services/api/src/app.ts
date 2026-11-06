import { randomUUID } from "node:crypto";
import { prisma } from "@aplora/database";
import { createStorage, type StorageAdapter } from "@aplora/storage";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { getConfig, type AppConfig } from "./env";
import { errorHandler } from "./lib/errors";
import { createMailer, type Mailer } from "./lib/mailer";
import { createQueue, type QueueClient } from "./lib/queue";
import authPlugin from "./plugins/auth";
import securityPlugin from "./plugins/security";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import catalogRoutes from "./routes/catalog";
import developerRoutes from "./routes/developer";
import downloadRoutes from "./routes/downloads";

export interface BuildOptions {
  config?: AppConfig;
  storage?: StorageAdapter;
  queue?: QueueClient;
  mailer?: Mailer;
  logger?: boolean;
}

/**
 * Builds a fully wired API instance. Tests use this directly with
 * `app.inject()` so the same routing, validation and security code that serves
 * production is what gets exercised.
 */
export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? getConfig();

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.isTest ? "silent" : config.isProduction ? "info" : "debug",
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                "req.headers['x-csrf-token']",
                "res.headers['set-cookie']",
              ],
              remove: true,
            },
            transport: config.isProduction
              ? undefined
              : config.isTest
                ? undefined
                : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
          },
    genReqId: () => randomUUID(),
    trustProxy: true,
    // Signed download tokens are longer than the 100 character default.
    maxParamLength: 512,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: config.isTest,
  });

  app.decorate("config", config);
  app.decorate("prisma", prisma);
  app.decorate(
    "storage",
    options.storage ??
      createStorage({
        driver: config.STORAGE_DRIVER,
        localRoot: config.STORAGE_LOCAL_ROOT,
        endpoint: config.STORAGE_ENDPOINT || undefined,
        region: config.STORAGE_REGION,
        bucket: config.STORAGE_BUCKET,
        accessKey: config.STORAGE_ACCESS_KEY || undefined,
        secretKey: config.STORAGE_SECRET_KEY || undefined,
        forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
      }),
  );
  app.decorate("mailer", options.mailer ?? createMailer(config, app.log));
  app.decorate("queue", options.queue ?? (await createQueue(config, app.log)));

  await app.register(securityPlugin, { config });
  await app.register(authPlugin);
  await app.register(multipart, {
    limits: { fileSize: config.maxApkBytes, files: 4, fields: 20, parts: 24 },
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", request.id);
    return payload;
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: "not_found", message: "This endpoint does not exist", requestId: request.id },
    });
  });

  app.get("/health", async () => ({ status: "ok", uptime: Math.round(process.uptime()) }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: "ready", database: "up", storage: app.storage.driver });
    } catch (error) {
      requestLog(app, error);
      return reply.status(503).send({ status: "degraded", database: "down" });
    }
  });

  await app.register(
    async (scope) => {
      await scope.register(authRoutes);
      await scope.register(catalogRoutes);
      await scope.register(downloadRoutes);
      await scope.register(developerRoutes);
      await scope.register(adminRoutes);
    },
    { prefix: "/api/v1" },
  );

  app.addHook("onClose", async () => {
    await app.queue.stop().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  });

  return app;
}

function requestLog(app: FastifyInstance, error: unknown): void {
  app.log.error({ err: error }, "readiness check failed");
}
