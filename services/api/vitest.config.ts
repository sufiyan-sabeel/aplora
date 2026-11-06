import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The integration tests share one PostgreSQL database, so they run in a
    // single process and truncate between files.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ["./test/setup-env.ts"],
    include: ["test/**/*.test.ts"],
  },
});
