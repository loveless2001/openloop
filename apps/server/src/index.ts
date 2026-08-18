import { buildServer } from "./app.js";
import { loadEnvironment } from "./config/env.js";

const environment = loadEnvironment();
const server = buildServer({ environment });

try {
  await server.listen({ host: "127.0.0.1", port: environment.SERVER_PORT });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
