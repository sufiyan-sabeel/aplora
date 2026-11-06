import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __aploraPrisma: PrismaClient | undefined;
}

/**
 * A single Prisma client per process. In development the instance is cached on
 * globalThis so that tsx watch reloads do not exhaust the connection pool.
 */
export const prisma: PrismaClient =
  global.__aploraPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__aploraPrisma = prisma;
}

export * from "@prisma/client";
export { Prisma } from "@prisma/client";
