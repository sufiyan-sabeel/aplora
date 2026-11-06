import { attributeValue, parseAxml, type AxmlElement } from "./axml";

export interface ApkManifest {
  packageName: string;
  versionName: string | null;
  versionCode: number | null;
  minSdk: number | null;
  targetSdk: number | null;
  permissions: string[];
  applicationLabel: string | null;
}

function toInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readManifest(manifestXml: Buffer): ApkManifest {
  const manifest = parseAxml(manifestXml);
  const packageName = attributeValue(manifest, "package") ?? "";
  if (!packageName) throw new Error("AndroidManifest.xml is missing the package attribute");

  const usesSdk = manifest.children.find((child) => child.name === "uses-sdk");
  const permissions = manifest.children
    .filter((child: AxmlElement) => child.name === "uses-permission" || child.name === "uses-permission-sdk-23")
    .map((child) => attributeValue(child, "name"))
    .filter((value): value is string => Boolean(value));

  const application = manifest.children.find((child) => child.name === "application");

  return {
    packageName,
    versionName: attributeValue(manifest, "versionName") ?? null,
    versionCode: toInteger(attributeValue(manifest, "versionCode")),
    minSdk: usesSdk ? toInteger(attributeValue(usesSdk, "minSdkVersion")) : null,
    targetSdk: usesSdk ? toInteger(attributeValue(usesSdk, "targetSdkVersion")) : null,
    permissions,
    applicationLabel: application ? attributeValue(application, "label") ?? null : null,
  };
}
