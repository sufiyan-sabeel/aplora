import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import type { StorageAdapter } from "./types";

export * from "./types";
export { LocalStorageAdapter } from "./local";
export { S3StorageAdapter } from "./s3";

export interface StorageConfig {
  driver: "local" | "s3";
  localRoot: string;
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle: boolean;
}

/**
 * Storage keys are namespaced by purpose so that quarantine, published files
 * and public assets never share a prefix.
 */
export const StorageKeys = {
  quarantine: (versionId: string, fileName: string) => `quarantine/${versionId}/${fileName}`,
  published: (appId: string, versionId: string, fileName: string) => `published/${appId}/${versionId}/${fileName}`,
  asset: (appId: string, assetId: string, fileName: string) => `assets/${appId}/${assetId}-${fileName}`,
} as const;

export function createStorage(config: StorageConfig): StorageAdapter {
  if (config.driver === "s3") {
    if (!config.accessKey || !config.secretKey) {
      throw new Error("STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required when STORAGE_DRIVER=s3");
    }
    return new S3StorageAdapter({
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
      forcePathStyle: config.forcePathStyle,
    });
  }
  return new LocalStorageAdapter(config.localRoot);
}
