import * as forge from "node-forge";
import { buildApkFixture } from "./src/testing/fixture";
import { ZipArchive } from "./src/zip";

const { buffer } = buildApkFixture({});
const archive = new ZipArchive(buffer);
const names = archive.names();
console.log("entries:", names);
const block = archive.read("META-INF/CERT.RSA", 1024 * 1024);
console.log("block bytes:", block.length);
try {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(block.toString("binary")));
  const p7: any = forge.pkcs7.messageFromAsn1(asn1);
  console.log("certificates:", p7.certificates?.length);
  const cert = p7.certificates[0];
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  console.log("der len", der.length, "cn", cert.subject.getField("CN")?.value);
} catch (e) {
  console.log("ERROR:", (e as Error).message);
}
