import { createHash } from "node:crypto";
import * as forge from "node-forge";
import type { ZipArchive } from "./zip";

const APK_SIG_BLOCK_MAGIC = "APK Sig Block 42";
const SIG_BLOCK_ID_V2 = 0x7109871a;
const SIG_BLOCK_ID_V3 = 0xf05368c0;

export interface SigningCertificate {
  scheme: "v1" | "v2" | "v3";
  sha256: string;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
}

function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function describeCertificate(der: Buffer, scheme: SigningCertificate["scheme"]): SigningCertificate | null {
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString("binary")));
    const certificate = forge.pki.certificateFromAsn1(asn1);
    return {
      scheme,
      sha256: sha256Of(der),
      subject: certificate.subject.getField("CN")?.value ?? certificate.subject.attributes[0]?.value ?? null,
      issuer: certificate.issuer.getField("CN")?.value ?? certificate.issuer.attributes[0]?.value ?? null,
      validFrom: certificate.validity?.notBefore ? certificate.validity.notBefore.toISOString() : null,
      validTo: certificate.validity?.notAfter ? certificate.validity.notAfter.toISOString() : null,
    };
  } catch {
    return null;
  }
}

/** Reads one uint32-length-prefixed slice. */
function readLengthPrefixed(buffer: Buffer, offset: number): { value: Buffer; next: number } {
  if (offset + 4 > buffer.length) throw new Error("Truncated length prefix");
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length) throw new Error("Length prefix exceeds buffer");
  return { value: buffer.subarray(start, end), next: end };
}

/**
 * Extracts the signing certificate from the APK Signing Block (scheme v2/v3).
 * Returns null when the block is absent or cannot be parsed.
 */
function readSigningBlockCertificate(buffer: Buffer, centralDirectoryOffset: number): SigningCertificate | null {
  if (centralDirectoryOffset < 32) return null;
  const magic = buffer.subarray(centralDirectoryOffset - 16, centralDirectoryOffset).toString("binary");
  if (magic !== APK_SIG_BLOCK_MAGIC) return null;

  const blockSize = Number(buffer.readBigUInt64LE(centralDirectoryOffset - 24));
  const blockStart = centralDirectoryOffset - blockSize - 8;
  if (blockStart < 0) return null;

  let offset = blockStart + 8;
  const pairsEnd = centralDirectoryOffset - 24;
  while (offset + 12 <= pairsEnd) {
    const length = Number(buffer.readBigUInt64LE(offset));
    if (length < 4 || offset + 8 + length > pairsEnd) break;
    const id = buffer.readUInt32LE(offset + 8);
    const value = buffer.subarray(offset + 12, offset + 8 + length);

    if (id === SIG_BLOCK_ID_V2 || id === SIG_BLOCK_ID_V3) {
      const scheme: SigningCertificate["scheme"] = id === SIG_BLOCK_ID_V2 ? "v2" : "v3";
      try {
        const signers = readLengthPrefixed(value, 0).value;
        const firstSigner = readLengthPrefixed(signers, 0).value;
        const signedData = readLengthPrefixed(firstSigner, 0).value;
        const digestsEnd = readLengthPrefixed(signedData, 0).next;
        const certificates = readLengthPrefixed(signedData, digestsEnd).value;
        const firstCertificate = readLengthPrefixed(certificates, 0).value;
        const described = describeCertificate(firstCertificate, scheme);
        if (described) return described;
      } catch {
        /* fall through to v1 */
      }
    }
    offset += 8 + length;
  }
  return null;
}

/** Reads the JAR signature (scheme v1) certificate from META-INF. */
function readV1Certificate(archive: ZipArchive): SigningCertificate | null {
  const signatureEntry = archive
    .names()
    .find((name) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(name));
  if (!signatureEntry) return null;

  let block: Buffer;
  try {
    block = archive.read(signatureEntry, 1024 * 1024);
  } catch {
    return null;
  }

  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(block.toString("binary")));
    const pkcs7 = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
      certificates?: Array<{ subject: forge.pki.Certificate["subject"]; issuer: forge.pki.Certificate["issuer"]; validity: forge.pki.Certificate["validity"] }>;
    };
    const certificate = pkcs7.certificates?.[0];
    if (!certificate) return null;
    const der = Buffer.from(
      forge.asn1.toDer(forge.pki.certificateToAsn1(certificate as unknown as forge.pki.Certificate)).getBytes(),
      "binary",
    );
    return describeCertificate(der, "v1");
  } catch {
    return null;
  }
}

/**
 * Returns the signing certificate of an APK. v2/v3 (APK Signing Block) is
 * preferred because it is the scheme Android uses on modern releases; v1 (JAR
 * signature) is the fallback.
 *
 * Note: this reads the certificate identity. It does not re-verify the
 * cryptographic signature over the archive contents; see docs/SECURITY.md.
 */
export function extractSigningCertificate(buffer: Buffer, archive: ZipArchive): SigningCertificate | null {
  return readSigningBlockCertificate(buffer, archive.centralDirectoryOffset) ?? readV1Certificate(archive);
}
