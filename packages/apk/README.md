# @aplora/apk

Self-contained inspection for uploaded APK files. No external binary is required.

- `zip.ts` — bounded ZIP reader (no zip64, hard output cap on inflate).
- `axml.ts` — parser for Android binary XML (`AndroidManifest.xml`).
- `manifest.ts` — package name, version name/code, min/target SDK, permissions.
- `signature.ts` — signing certificate from the APK Signing Block (v2/v3) or the
  JAR signature (v1).
- `inspect.ts` — the full structural validation used by the upload pipeline.
- `scanner.ts` — static analysis plus optional ClamAV (`clamd`) scanning.

The certificate is read for identity pinning (a new version of an app must be
signed by the same certificate as the previously approved version). The
cryptographic signature over the archive is not re-verified; see
`docs/SECURITY.md` for what that means and what compensates for it.
