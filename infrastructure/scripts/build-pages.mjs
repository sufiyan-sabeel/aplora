#!/usr/bin/env node
/**
 * Builds the three portals and assembles the single GitHub Pages artifact.
 *
 *   npm run build:pages
 *
 * Output:
 *   dist/index.html            marketplace   → /aplora/
 *   dist/developer/index.html  developer     → /aplora/developer/
 *   dist/admin/index.html      admin         → /aplora/admin/
 *
 * GitHub Pages serves static files only, so each portal is pre-rendered and
 * fetches its data from the API in the browser.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dist = join(root, "dist");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if ((result.status ?? 1) !== 0) {
    console.error(`\nFailed: ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? countFiles(path) : 1;
  }
  return total;
}

console.log("Building the three portals…");
run("npm", ["run", "build", "--workspace", "@aplora/marketplace"]);
run("npm", ["run", "build", "--workspace", "@aplora/developer"]);
run("npm", ["run", "build", "--workspace", "@aplora/admin"]);

console.log("Assembling the Pages artifact…");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(join(root, "apps/marketplace/dist"), dist, { recursive: true });
cpSync(join(root, "apps/developer/dist"), join(dist, "developer"), { recursive: true });
cpSync(join(root, "apps/admin/dist"), join(dist, "admin"), { recursive: true });

// GitHub Pages runs Jekyll unless told not to, and Jekyll ignores folders that
// start with an underscore — which is exactly where Astro puts its assets.
writeFileSync(join(dist, ".nojekyll"), "");

const required = [
  "index.html",
  "404.html",
  "developer/index.html",
  "admin/index.html",
  "apps/index.html",
  "app/index.html",
  "login/index.html",
  "developer/login/index.html",
  "admin/login/index.html",
];

let ok = true;
for (const file of required) {
  if (!existsSync(join(dist, file))) {
    console.error(`  missing: ${file}`);
    ok = false;
  }
}

const assets = existsSync(join(dist, "_astro")) ? readdirSync(join(dist, "_astro")).length : 0;
if (assets === 0) {
  console.error("  missing: _astro assets");
  ok = false;
}

if (!ok) {
  console.error("\nThe Pages artifact is incomplete.");
  process.exit(1);
}

const total = countFiles(dist);
const size = statSync(dist).size;
console.log(`Artifact ready: ${total} files, ${assets} assets, ${(size / 1024).toFixed(0)} KB (directory entry size).`);
console.log(`Output: ${dist}`);
