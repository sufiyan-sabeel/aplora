import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  outDir: "dist",
  format: ["cjs"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  // Workspace packages are TypeScript source, so they must be bundled.
  noExternal: [/^@aplora\//],
  external: ["@prisma/client", "@node-rs/argon2", "pg-boss", "nodemailer", "fastify"],
});
