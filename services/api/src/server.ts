import { buildApp } from "./app";
import { getConfig } from "./env";

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp({ config });

  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
    app.log.info(`Aplora API listening on http://localhost:${config.API_PORT}`);
  } catch (error) {
    app.log.error({ err: error }, "failed to start");
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
