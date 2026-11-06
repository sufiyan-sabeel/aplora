import type { FastifyRequest } from "fastify";
import { BadRequestError, PayloadTooLargeError } from "./errors";

export interface MultipartResult {
  fields: Record<string, string>;
  file: { buffer: Buffer; filename: string; mimetype: string } | null;
}

/**
 * Reads a multipart body into memory with a hard byte cap. Files are never
 * written anywhere until they have been validated, and the cap is enforced by
 * the multipart parser itself, not by a Content-Length header.
 */
export async function readMultipart(
  request: FastifyRequest,
  options: { maxFileBytes: number; required?: boolean },
): Promise<MultipartResult> {
  if (!request.isMultipart()) throw new BadRequestError("Expected a multipart/form-data request");

  const fields: Record<string, string> = {};
  let file: MultipartResult["file"] = null;

  try {
    for await (const part of request.parts({ limits: { fileSize: options.maxFileBytes, files: 4 } })) {
      if (part.type === "file") {
        if (file) {
          part.file.resume();
          continue;
        }
        const buffer = await part.toBuffer();
        file = { buffer, filename: part.filename ?? "upload", mimetype: part.mimetype ?? "application/octet-stream" };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT") {
      throw new PayloadTooLargeError(
        `The file is larger than the ${Math.round(options.maxFileBytes / (1024 * 1024))} MB limit`,
      );
    }
    throw error;
  }

  if (!file && options.required !== false) throw new BadRequestError("Attach a file to this request");
  return { fields, file };
}
