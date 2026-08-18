import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { findWorkspaceRoot } from "./workspace.js";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const EnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    WEB_PORT: z.coerce.number().int().positive().default(5173),
    SERVER_PORT: z.coerce.number().int().positive().default(8787),
    DATABASE_URL: z
      .string()
      .startsWith("file:")
      .default("file:./data/openloop.db"),
    MODEL_PROVIDER: z.enum(["mock", "openai-compatible"]).default("mock"),
    MODEL_BASE_URL: z.url().default("http://localhost:11434/v1"),
    MODEL_API_KEY: z.string().default(""),
    MODEL_FAST: z.string().min(1).default("fast-model-id"),
    MODEL_SMART: z.string().min(1).default("smart-model-id"),
    MODEL_SUPPORTS_JSON_SCHEMA: booleanFromString.default(false),
    COMPLETION_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(300),
    CRITIC_IDLE_MS: z.coerce.number().int().nonnegative().default(1800),
    AUTOSAVE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(750),
    GLOBAL_INTERRUPTION_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(45_000),
    ISSUE_BASE_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(120_000),
    LOG_MODEL_CONTENT: booleanFromString.default(false),
    LOG_DOCUMENT_CONTENT: booleanFromString.default(false),
  })
  .superRefine((environment, context) => {
    if (
      environment.MODEL_PROVIDER === "openai-compatible" &&
      !environment.MODEL_API_KEY
    ) {
      context.addIssue({
        code: "custom",
        message:
          "MODEL_API_KEY is required for MODEL_PROVIDER=openai-compatible",
        path: ["MODEL_API_KEY"],
      });
    }
  });

export type Environment = z.infer<typeof EnvironmentSchema>;

export function readEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  return EnvironmentSchema.parse(source);
}

export function loadEnvironment(): Environment {
  loadDotEnv({ path: `${findWorkspaceRoot()}/.env`, quiet: true });
  return readEnvironment();
}
