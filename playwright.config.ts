import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${webPort}`, headless: true },
  webServer: {
    command: "pnpm dev",
    env: {
      COMPLETION_PROVIDER: "mock",
      COMPLETION_ENABLED: "true",
      CRITIC_PROVIDER: "mock",
      EVALUATOR_PROVIDER: "mock",
      DATABASE_URL: `file:${join(tmpdir(), `openloop-playwright-${process.pid}.db`)}`,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:8787/v1/health",
  },
});
