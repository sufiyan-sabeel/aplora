import type { Readable } from "node:stream";

export interface StorageObject {
  body: Buffer;
}

export interface StorageAdapter {
  /** Human-readable driver name, surfaced in /health and the admin settings page. */
  readonly driver: string;
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Size in bytes, or null when the object does not exist. */
  size(key: string): Promise<number | null>;
  /**
   * Short-lived direct URL when the backend supports it (S3/MinIO).
   * Local storage returns null and the API streams the file itself.
   */
  presignedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}
