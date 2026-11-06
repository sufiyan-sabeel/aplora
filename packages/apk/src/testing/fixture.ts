import * as forge from "node-forge";
import { zipSync } from "fflate";
import { encodeAxml, type FixtureElement } from "./axml-encoder";

export interface ApkFixtureOptions {
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  minSdk?: number;
  targetSdk?: number;
  permissions?: string[];
  signed?: boolean;
  includeManifest?: boolean;
  includeDex?: boolean;
  extraEntries?: Record<string, Uint8Array>;
}

export interface ApkFixture {
  buffer: Buffer;
  certificateSha256: string;
}

function buildManifest(options: Required<Pick<ApkFixtureOptions, "packageName" | "versionName" | "versionCode" | "minSdk" | "targetSdk">> & {
  permissions: string[];
}): Buffer {
  const manifest: FixtureElement = {
    name: "manifest",
    attributes: [
      { name: "package", value: options.packageName },
      { name: "versionCode", value: options.versionCode },
      { name: "versionName", value: options.versionName },
    ],
    children: [
      {
        name: "uses-sdk",
        attributes: [
          { name: "minSdkVersion", value: options.minSdk },
          { name: "targetSdkVersion", value: options.targetSdk },
        ],
        children: [],
      },
      ...options.permissions.map((permission) => ({
        name: "uses-permission",
        attributes: [{ name: "name", value: permission }],
        children: [] as FixtureElement[],
      })),
      {
        name: "application",
        attributes: [{ name: "label", value: "Fixture App" }],
        children: [],
      },
    ],
  };
  return encodeAxml(manifest);
}

function buildSignatureBlock(): { bytes: Uint8Array; sha256: string } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  certificate.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attributes = [{ name: "commonName", value: "Aplora Test Signing" }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());

  const pkcs7 = forge.pkcs7.createSignedData();
  pkcs7.content = forge.util.createBuffer("Aplora fixture");
  pkcs7.addCertificate(certificate);
  pkcs7.addSigner({
    key: keys.privateKey,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
  });
  pkcs7.sign();

  const der = forge.asn1.toDer(pkcs7.toAsn1()).getBytes();
  const bytes = Buffer.from(der, "binary");
  const certDer = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(),
    "binary",
  );
  return { bytes, sha256: require("node:crypto").createHash("sha256").update(certDer).digest("hex") };
}

/**
 * Builds a structurally valid APK: real binary AndroidManifest.xml, DEX entries
 * and a PKCS#7 signature block in META-INF, so the upload pipeline can be tested
 * end to end without shipping a third-party binary in the repository.
 */
export function buildApkFixture(options: ApkFixtureOptions = {}): ApkFixture {
  const resolved = {
    packageName: options.packageName ?? "com.aplora.fixture",
    versionName: options.versionName ?? "1.0.0",
    versionCode: options.versionCode ?? 1,
    minSdk: options.minSdk ?? 24,
    targetSdk: options.targetSdk ?? 34,
    permissions: options.permissions ?? ["android.permission.INTERNET"],
  };

  const files: Record<string, Uint8Array> = {};

  if (options.includeManifest !== false) {
    files["AndroidManifest.xml"] = buildManifest(resolved);
  }
  if (options.includeDex !== false) {
    files["classes.dex"] = new Uint8Array([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0x00]);
  }
  files["resources.arsc"] = new Uint8Array([0x02, 0x00, 0x0c, 0x00]);

  let certificateSha256 = "";
  if (options.signed !== false) {
    const signature = buildSignatureBlock();
    files["META-INF/CERT.RSA"] = signature.bytes;
    files["META-INF/MANIFEST.MF"] = new Uint8Array(Buffer.from("Manifest-Version: 1.0\r\n\r\n", "utf8"));
    certificateSha256 = signature.sha256;
  }

  for (const [name, bytes] of Object.entries(options.extraEntries ?? {})) {
    files[name] = bytes;
  }

  return { buffer: Buffer.from(zipSync(files)), certificateSha256 };
}
