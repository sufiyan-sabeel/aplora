#!/usr/bin/env node
/**
 * Starts the whole development environment with one command.
 *
 *   pnpm dev
 *
 * Steps: check for .env, optionally bring up infrastructure with Docker,
 * apply migrations, seed reference data, then run the API, the worker and the
 * three portals side by side with prefixed output.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const useDocker = process.env.SKIP_DOCKER !== "1" && !process.env.DATABASE_URL;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...options });
  return result.status ?? 1;
}

if (!existsSync(resolve(root, ".env"))) {
  console.log("No .env found — copying .env.example to .env");
  copyFileSync(resolve(root, ".env.example"), resolve(root, ".env"));
}

if (useDocker) {
  console.log("Starting PostgreSQL, MinIO and Mailpit with Docker Compose…");
  const status = run("docker", ["compose", "up", "-d", "postgres", "minio", "mailpit"]);
  if (status !== 0) {
    console.warn("Docker Compose failed. Start PostgreSQL yourself and set DATABASE_URL, or run with SKIP_DOCKER=1.");
  }
  // Give PostgreSQL a moment to accept connections.
  run("bash", ["-lc", "for i in $(seq 1 30); do pg_isready -h localhost -p 5432 >/dev/null 2>&1 && exit 0; sleep 1; done; exit 0"]);
}

console.log("Applying database migrations…");
if (run("npx", ["prisma", "migrate", "deploy", "--schema", "packages/database/prisma/schema.prisma"]) !== 0) {
  console.error("Migrations failed. Check DATABASE_URL in .env.");
  process.exit(1);
}

console.log("Seeding reference data…");
run("npx", ["tsx", "packages/database/prisma/seed.ts"]);

const targets = [
  { name: "api", args: ["--filter", "@aplora/api", "dev"], color: "\u001b[36m" },
  { name: "worker", args: ["--filter", "@aplora/worker", "dev"], color: "\u001b[35m" },
  { name: "market", args: ["--filter", "@aplora/marketplace", "dev"], color: "\u001b[32m" },
  { name: "dev-portal", args: ["--filter", "@aplora/developer", "dev"], color: "\u001b[33m" },
  { name: "admin", args: ["--filter", "@aplora/admin", "dev"], color: "\u001b[31m" },
];

const children = targets.map((target) => {
  const child = spawn("npm", ["run", ...target.args], { cwd: root, env: process.env, shell: process.platform === "win32" });
  const prefix = `${target.color}[${target.name}]\u001b[0m `;
  const pipe = (stream, out) => {
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) out.write(`${prefix}${line}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`${prefix}exited with code ${code}`);
  });
  return child;
});

console.log(`
Aplora is starting:
  Marketplace  http://localhost:4321
  Developer    http://localhost:4322
  Admin        http://localhost:4323
  API          http://localhost:4000

Press Ctrl+C to stop.
`);

const shutdown = () => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
