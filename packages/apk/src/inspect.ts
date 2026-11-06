import { createHash } from "node:crypto";
import { readManifest, type ApkManifest } from "./manifest";
import { extractSigningCertificate, type SigningCertificate } from "./signature";
import { ZipArchive } from "./zip";

export interface ApkInspectionOptions {
  maxSizeBytes: number;
}

export interface ApkInspection {
  valid: boolean;
  errors: string[];
  warnings: string[];
  size: number;
  sha256: string;
  manifest: ApkManifest | null;
  packageName: string | null;
  versionName: string | null;
  versionCode: number | null;
  minSdk: number | null;
  targetSdk: number | null;
  permissions: string[];
  signature: SigningCertificate | null;
  entryCount: number;
  duplicateEntries: string[];
  compressionRatio: number;
  dexCount: number;
  hasDex: boolean;
  unsignedNativeLibraries: string[];
}

const PACKAGE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/**
 * Full structural inspection of an APK. Every check is performed on the bytes
 * themselves — never on the file name or a browser-supplied MIME type.
 */
export function inspectApk(buffer: Buffer, options: ApkInspectionOptions): ApkInspection {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const inspection: ApkInspection = {
    valid: false,
    errors,
    warnings,
    size: buffer.length,
    sha256,
    manifest: null,
    packageName: null,
    versionName: null,
    versionCode: null,
    minSdk: null,
    targetSdk: null,
    permissions: [],
    signature: null,
    entryCount: 0,
    duplicateEntries: [],
    compressionRatio: 0,
    dexCount: 0,
    hasDex: false,
    unsignedNativeLibraries: [],
  };

  if (buffer.length === 0) {
    errors.push("Uploaded file is empty");
    return inspection;
  }
  if (buffer.length > options.maxSizeBytes) {
    errors.push(`APK is larger than the ${Math.round(options.maxSizeBytes / (1024 * 1024))} MB limit`);
    return inspection;
  }
  const zipMagic = buffer.subarray(0, 4);
  if (zipMagic[0] !== 0x50 || zipMagic[1] !== 0x4b) {
    errors.push("File is not a ZIP archive, so it cannot be an APK");
    return inspection;
  }

  let archive: ZipArchive;
  try {
    archive = new ZipArchive(buffer);
  } catch (error) {
    errors.push(`Archive could not be read: ${(error as Error).message}`);
    return inspection;
  }

  inspection.entryCount = archive.entries.size;
  inspection.duplicateEntries = archive.duplicateNames;
  inspection.compressionRatio = buffer.length > 0 ? archive.totalUncompressedSize / buffer.length : 0;
  if (inspection.duplicateEntries.length > 0) {
    errors.push("Archive contains duplicate entries, which is a security risk");
  }
  if (inspection.compressionRatio > 1000 && archive.totalUncompressedSize > 100 * 1024 * 1024) {
    errors.push("Archive expands to an unreasonable size (possible decompression bomb)");
  }

  const names = archive.names();
  const unsafeEntries = names.filter((name) => name.includes("..") || name.startsWith("/"));
  if (unsafeEntries.length > 0) {
    errors.push(`Archive contains unsafe paths: ${unsafeEntries.slice(0, 3).join(", ")}`);
  }

  inspection.dexCount = names.filter((name) => /^classes\d*\.dex$/.test(name)).length;
  inspection.hasDex = inspection.dexCount > 0;
  if (!inspection.hasDex) errors.push("APK contains no DEX files, so it has no executable code");

  inspection.unsignedNativeLibraries = names
    .filter((name) => /^lib\/[^/]+\/[^/]+\.so$/.test(name))
    .map((name) => name.split("/")[2] ?? name);

  if (!archive.has("AndroidManifest.xml")) {
    errors.push("AndroidManifest.xml is missing from the archive");
  } else {
    try {
      const manifestXml = archive.read("AndroidManifest.xml", 8 * 1024 * 1024);
      const manifest = readManifest(manifestXml);
      inspection.manifest = manifest;
      inspection.packageName = manifest.packageName;
      inspection.versionName = manifest.versionName;
      inspection.versionCode = manifest.versionCode;
      inspection.minSdk = manifest.minSdk;
      inspection.targetSdk = manifest.targetSdk;
      inspection.permissions = manifest.permissions;

      if (!PACKAGE_NAME_PATTERN.test(manifest.packageName)) {
        errors.push("Manifest package name is not a valid Android package name");
      }
      if (manifest.versionCode === null || manifest.versionCode < 1) {
        errors.push("Manifest is missing a valid versionCode");
      }
      if (!manifest.versionName) {
        errors.push("Manifest is missing a versionName");
      }
    } catch (error) {
      errors.push(`AndroidManifest.xml could not be parsed: ${(error as Error).message}`);
    }
  }

  inspection.signature = extractSigningCertificate(buffer, archive);
  if (!inspection.signature) {
    errors.push("APK is not signed: no signing certificate could be read");
  }

  inspection.valid = errors.length === 0;
  return inspection;
}
