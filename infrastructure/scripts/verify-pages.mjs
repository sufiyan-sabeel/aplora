#!/usr/bin/env node
/**
 * Verifies the built Pages artifact before it is uploaded.
 *
 * Checks that every portal entry point exists, that referenced assets are
 * present, that internal links resolve to real files, and that no secret or
 * development credential leaked into the bundle.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../../dist");
const prefix = "/aplora";

const problems = [];
const checkedLinks = new Set();

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

if (!existsSync(dist)) {
  console.error("dist/ does not exist. Run `npm run build:pages` first.");
  process.exit(1);
}

const files = walk(dist);
const htmlFiles = files.filter((file) => file.endsWith(".html"));

if (htmlFiles.length === 0) problems.push("no HTML files were generated");

/** Maps a site path to the file GitHub Pages would serve. */
function resolvePath(pathname) {
  const clean = pathname.split("?")[0].split("#")[0];
  if (!clean.startsWith(prefix)) return null;
  let relative = clean.slice(prefix.length);
  if (relative === "" || relative === "/") return join(dist, "index.html");
  const candidate = join(dist, relative);
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, "index.html");
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(`${candidate}.html`)) return `${candidate}.html`;
  if (existsSync(join(candidate, "index.html"))) return join(candidate, "index.html");
  return null;
}

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const references = [
    ...html.matchAll(/(?:href|src)="([^"]+)"/g),
    ...html.matchAll(/url\(['"]?([^'")]+)['"]?\)/g),
  ].map((match) => match[1]);

  for (const reference of references) {
    if (!reference || reference.startsWith("#") || reference.startsWith("data:")) continue;
    if (/^https?:\/\//.test(reference)) continue;
    if (!reference.startsWith(prefix)) {
      problems.push(`${file.replace(dist, "")} references "${reference}" outside ${prefix}`);
      continue;
    }
    checkedLinks.add(reference);
    if (!resolvePath(reference)) {
      problems.push(`${file.replace(dist, "")} references missing asset "${reference}"`);
    }
  }
}

// Assets referenced from CSS are relative to the stylesheet.
for (const file of files.filter((entry) => entry.endsWith(".css"))) {
  const css = readFileSync(file, "utf8");
  for (const match of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const reference = match[2];
    if (!reference || reference.startsWith("data:") || /^https?:\/\//.test(reference)) continue;
    if (!reference.startsWith(prefix)) continue;
    if (!resolvePath(reference)) problems.push(`${file.replace(dist, "")} references missing asset "${reference}"`);
  }
}

// Secret scan across every shipped text file.
const forbidden = [
  /SESSION_SECRET\s*=\s*[A-Za-z0-9]/,
  /postgres(?:ql)?:\/\/[^\s"'<]+:[^\s"'<]+@/,
  /DATABASE_URL\s*=\s*postgres/,
  /STORAGE_SECRET_KEY\s*=\s*\S/,
  /ChangeMe12345/,
  /dev-secret-please-change/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /SUPER_ADMIN_PASSWORD/,
];

for (const file of files.filter((entry) => /\.(html|js|css|json|txt|map)$/.test(entry))) {
  const text = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) problems.push(`${file.replace(dist, "")} contains a value matching ${pattern}`);
  }
}

// Every portal must have its entry point and a 404 page.
for (const required of ["index.html", "404.html", "developer/index.html", "admin/index.html"]) {
  if (!existsSync(join(dist, required))) problems.push(`missing ${required}`);
}
if (!existsSync(join(dist, ".nojekyll"))) problems.push("missing .nojekyll (Astro assets would be dropped by Jekyll)");

const apiBase = process.env.PUBLIC_API_BASE_URL ?? "";
if (!apiBase) {
  console.warn("Warning: PUBLIC_API_BASE_URL was not set, so this build will show the API-not-configured state.");
} else {
  const bundles = files.filter((file) => file.endsWith(".js"));
  const found = bundles.some((file) => readFileSync(file, "utf8").includes(apiBase));
  if (!found) {
    problems.push(`the API base URL ${apiBase} was not found in any JavaScript bundle (${bundles.length} checked)`);
  }
}

console.log(`Checked ${htmlFiles.length} HTML files and ${checkedLinks.size} internal references.`);

if (problems.length > 0) {
  console.error("\nArtifact verification failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("Artifact verification passed.");
