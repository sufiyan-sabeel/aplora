import { buildApkFixture } from "./src/testing/fixture";
import { inspectApk } from "./src/inspect";

const { buffer, certificateSha256 } = buildApkFixture({
  packageName: "com.aplora.demo",
  versionName: "1.2.3",
  versionCode: 42,
  permissions: ["android.permission.INTERNET", "android.permission.CAMERA"],
});
console.log("size", buffer.length);
const result = inspectApk(buffer, { maxSizeBytes: 200 * 1024 * 1024 });
console.log(JSON.stringify({
  valid: result.valid,
  errors: result.errors,
  package: result.packageName,
  versionName: result.versionName,
  versionCode: result.versionCode,
  minSdk: result.minSdk,
  targetSdk: result.targetSdk,
  permissions: result.permissions,
  signature: result.signature,
  certMatches: result.signature?.sha256 === certificateSha256,
}, null, 2));
