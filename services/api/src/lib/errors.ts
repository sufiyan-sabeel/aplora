import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(statusCode: number, code: string, message: string, details?: unknown, expose = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "The request could not be processed", details?: unknown) {
    super(400, "bad_request", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource", code = "forbidden") {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "This resource already exists", code = "conflict") {
    super(409, code, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "The uploaded file is too large") {
    super(413, "payload_too_large", message);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = "Some fields need attention") {
    super(422, "validation_failed", message, details);
  }
}

export function isUniqueConstraintError(error: unknown, field?: string): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code !== "P2002") return false;
  if (!field) return true;
  const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
  const targets = Array.isArray(target) ? target : [String(target ?? "")];
  return targets.some((entry) => entry.toLowerCase().includes(field.toLowerCase()));
}

/** Single place that turns any thrown value into the public error envelope. */
export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id;

  if (error instanceof ZodError) {
    reply.status(422).send({
      error: {
        code: "validation_failed",
        message: "Some fields need attention",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        requestId,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) request.log.error({ err: error }, "request failed");
    reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, details: error.details, requestId },
    });
    return;
  }

  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    reply.status(fastifyError.statusCode).send({
      error: {
        code: fastifyError.code ?? "bad_request",
        message: fastifyError.message,
        requestId,
      },
    });
    return;
  }

  request.log.error({ err: error }, "unhandled error");
  reply.status(500).send({
    error: {
      code: "internal_error",
      message: "Something went wrong on our side",
      requestId,
    },
  });
}
