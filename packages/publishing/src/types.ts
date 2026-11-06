import type { PrismaClient, VersionStatus } from "@aplora/database";
import type { StorageAdapter } from "@aplora/storage";

export interface PublishingContext {
  prisma: PrismaClient;
  storage: StorageAdapter;
  maxApkBytes: number;
  scanner: {
    driver: "local" | "clamav";
    clamavHost: string;
    clamavPort: number;
  };
  logger: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  };
}

export interface TransitionOptions {
  from: VersionStatus;
  to: VersionStatus;
  actorUserId?: string | null;
  note?: string | null;
  extra?: Record<string, unknown>;
}
