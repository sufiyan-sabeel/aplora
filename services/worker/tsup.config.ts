import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["cjs"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  noExternal: [/^@aplora\//],
  external: ["@prisma/client", "pg-boss"],
});
