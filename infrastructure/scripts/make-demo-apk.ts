/**
 * Builds a structurally valid, self-signed APK for trying the upload flow by
 * hand. It is a fixture, not a working Android application.
 *
 *   npx tsx infrastructure/scripts/make-demo-apk.ts com.example.demo 1.0.0 1
 */
import { writeFileSync } from "node:fs";
import { buildApkFixture } from "@aplora/apk/testing";

const [, , packageName = "com.aplora.demo", versionName = "1.0.0", versionCode = "1"] = process.argv;

const fixture = buildApkFixture({
  packageName,
  versionName,
  versionCode: Number(versionCode),
  permissions: ["android.permission.INTERNET"],
});

const fileName = `demo-${packageName}-${versionCode}.apk`;
writeFileSync(fileName, fixture.buffer);
console.log(`Wrote ${fileName} (${fixture.buffer.length} bytes)`);
console.log(`Signing certificate SHA-256: ${fixture.certificateSha256}`);
console.log("Upload it from the developer portal; it passes validation and scanning.");
