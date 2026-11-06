import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { StorageAdapter } from "./types";

/**
 * Filesystem adapter for local development and single-node deployments.
 * Keys are sanitised so a crafted key can never escape the storage root.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const safeKey = key.replace(/\\/g, "/").replace(/\.\.(\/|$)/g, "");
    const target = path.resolve(this.root, safeKey);
    if (!target.startsWith(this.root + path.sep) && target !== this.root) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return target;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, { mode: 0o640 });
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async stream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    return createReadStream(this.resolve(key), range ? { start: range.start, end: range.end } : undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async size(key: string): Promise<number | null> {
    try {
      const stat = await fs.stat(this.resolve(key));
      return stat.size;
    } catch {
      return null;
    }
  }

  async presignedUrl(): Promise<string | null> {
    return null;
  }
}
