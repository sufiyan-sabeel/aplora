import net from "node:net";
import type { ApkInspection } from "./inspect";

export type FindingSeverity = "info" | "warning" | "critical";

export interface ScanFinding {
  severity: FindingSeverity;
  code: string;
  message: string;
}

export interface ScanResult {
  status: "CLEAN" | "INFECTED" | "ERROR";
  engine: string;
  findings: ScanFinding[];
  durationMs: number;
  scannedAt: string;
}

export interface ScanOptions {
  driver: "local" | "clamav";
  clamavHost?: string;
  clamavPort?: number;
  timeoutMs?: number;
}

/** Permissions that deserve a reviewer's attention. */
const SENSITIVE_PERMISSIONS = new Map<string, string>([
  ["android.permission.SEND_SMS", "Can send SMS messages"],
  ["android.permission.READ_SMS", "Can read SMS messages"],
  ["android.permission.RECEIVE_SMS", "Can intercept incoming SMS"],
  ["android.permission.CALL_PHONE", "Can place phone calls"],
  ["android.permission.READ_CALL_LOG", "Can read the call log"],
  ["android.permission.READ_CONTACTS", "Can read contacts"],
  ["android.permission.RECORD_AUDIO", "Can record audio"],
  ["android.permission.CAMERA", "Can use the camera"],
  ["android.permission.ACCESS_FINE_LOCATION", "Can access precise location"],
  ["android.permission.REQUEST_INSTALL_PACKAGES", "Can install other applications"],
  ["android.permission.SYSTEM_ALERT_WINDOW", "Can draw over other applications"],
  ["android.permission.BIND_ACCESSIBILITY_SERVICE", "Can use accessibility services"],
  ["android.permission.PACKAGE_USAGE_STATS", "Can read app usage statistics"],
]);

function staticAnalysis(inspection: ApkInspection): ScanFinding[] {
  const findings: ScanFinding[] = [];

  for (const permission of inspection.permissions) {
    const description = SENSITIVE_PERMISSIONS.get(permission);
    if (description) {
      findings.push({ severity: "warning", code: "sensitive_permission", message: `${permission}: ${description}` });
    }
  }

  if (inspection.duplicateEntries.length > 0) {
    findings.push({
      severity: "critical",
      code: "duplicate_entries",
      message: `Archive contains duplicate entries (${inspection.duplicateEntries.slice(0, 3).join(", ")}), a known technique for hiding payloads`,
    });
  }

  if (inspection.compressionRatio > 200 && inspection.size > 1024 * 1024) {
    findings.push({
      severity: "warning",
      code: "high_compression_ratio",
      message: `Archive decompresses to ${Math.round(inspection.compressionRatio)}x its size`,
    });
  }

  if (inspection.signature) {
    const expiry = inspection.signature.validTo ? Date.parse(inspection.signature.validTo) : null;
    if (expiry && expiry < Date.now()) {
      findings.push({ severity: "warning", code: "expired_certificate", message: "Signing certificate has expired" });
    }
  }

  if (inspection.unsignedNativeLibraries.length > 0) {
    findings.push({
      severity: "warning",
      code: "native_libraries",
      message: `Bundles native libraries: ${inspection.unsignedNativeLibraries.slice(0, 5).join(", ")}`,
    });
  }

  if (inspection.hasDex && inspection.dexCount === 0) {
    findings.push({ severity: "critical", code: "missing_dex", message: "APK declares DEX files but none were found" });
  }

  return findings;
}

/** ClamAV INSTREAM scan over a raw socket (clamd must be running). */
async function clamavScan(buffer: Buffer, host: string, port: number, timeoutMs: number): Promise<ScanFinding[]> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(parseClamavResponse(Buffer.concat(chunks).toString("utf8")));
    };

    socket.setTimeout(timeoutMs, () => finish(new Error("ClamAV scan timed out")));
    socket.on("error", (error) => finish(error));
    socket.on("data", (data) => chunks.push(data));
    socket.on("close", () => finish(null));

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        socket.write(header);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

function parseClamavResponse(response: string): ScanFinding[] {
  const trimmed = response.trim().replace(/\0/g, "");
  if (/FOUND$/.test(trimmed)) {
    const signature = trimmed.split(":").pop()?.replace("FOUND", "").trim() ?? "unknown";
    return [{ severity: "critical", code: "malware_detected", message: `ClamAV detected ${signature}` }];
  }
  if (!/OK$/.test(trimmed)) {
    throw new Error(`Unexpected ClamAV response: ${trimmed.slice(0, 120)}`);
  }
  return [{ severity: "info", code: "clamav_clean", message: "ClamAV reported no known malware signatures" }];
}

/**
 * Runs the configured malware scan. The built-in static analysis always runs;
 * ClamAV is added when it is configured. A clean result is evidence, not proof:
 * applications can still be suspended after publication.
 */
export async function scanApk(
  buffer: Buffer,
  inspection: ApkInspection,
  options: ScanOptions,
): Promise<ScanResult> {
  const startedAt = Date.now();
  const findings = staticAnalysis(inspection);

  if (options.driver === "clamav") {
    try {
      const clamFindings = await clamavScan(
        buffer,
        options.clamavHost ?? "127.0.0.1",
        options.clamavPort ?? 3310,
        options.timeoutMs ?? 120_000,
      );
      findings.push(...clamFindings);
    } catch (error) {
      return {
        status: "ERROR",
        engine: "clamav",
        findings: [...findings, { severity: "critical", code: "scanner_error", message: (error as Error).message }],
        durationMs: Date.now() - startedAt,
        scannedAt: new Date().toISOString(),
      };
    }
  }

  const infected = findings.some((finding) => finding.severity === "critical");
  return {
    status: infected ? "INFECTED" : "CLEAN",
    engine: options.driver === "clamav" ? "clamav+static" : "static",
    findings,
    durationMs: Date.now() - startedAt,
    scannedAt: new Date().toISOString(),
  };
}
