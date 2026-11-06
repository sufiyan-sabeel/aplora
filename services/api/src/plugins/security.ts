import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../env";

/**
 * Transport-level hardening: security headers, a strict CORS allowlist for the
 * three portals, signed-cookie support and a global rate limit.
 */
export default fp(async (app, options: { config: AppConfig }) => {
  const { config } = options;

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  });

  await app.register(cookie, { secret: config.SESSION_SECRET, hook: "onRequest" });

  await app.register(cors, {
    origin: [config.PUBLIC_MARKETPLACE_URL, config.PUBLIC_DEVELOPER_URL, config.PUBLIC_ADMIN_URL],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-csrf-token", "accept"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    allowList: (request: FastifyRequest) => request.url === "/health",
    keyGenerator: (request: FastifyRequest) => request.ip,
    // Returning an object with a statusCode keeps the error envelope consistent
    // instead of falling through to a generic 500.
    errorResponseBuilder: (_request: FastifyRequest, context: { after: string }) => ({
      statusCode: 429,
      code: "rate_limited",
      message: `Too many requests. Try again in ${context.after}.`,
    }),
  });
});
