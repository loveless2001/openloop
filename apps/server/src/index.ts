import { buildServer } from "./app.js";
import { loadEnvironment } from "./config/env.js";

const environment = loadEnvironment();
const server = buildServer({ environment });
let closing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, "Shutting down OpenLoop");
  await server.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.listen({ host: "127.0.0.1", port: environment.SERVER_PORT });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
  await server.close();
}
