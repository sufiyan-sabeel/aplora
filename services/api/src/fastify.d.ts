import type { PrismaClient } from "@aplora/database";
import type { StorageAdapter } from "@aplora/storage";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "./env";
import type { AuthContext } from "./services/sessions";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
    /** Set by the upload routes once the body has been consumed. */
    uploadedFile?: { buffer: Buffer; filename: string; mimetype: string };
  }

  interface FastifyInstance {
    prisma: PrismaClient;
    storage: StorageAdapter;
    config: AppConfig;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    mailer: import("./lib/mailer").Mailer;
    queue: import("./lib/queue").QueueClient;
  }
}
