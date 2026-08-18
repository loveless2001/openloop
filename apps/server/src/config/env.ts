import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { findWorkspaceRoot } from "./workspace.js";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const ProviderSchema = z.enum([
  "mock",
  "ollama",
  "openai",
  "openai-compatible",
]);

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
    COMPLETION_PROVIDER: ProviderSchema.default("ollama"),
    COMPLETION_BASE_URL: z.url().default("http://127.0.0.1:11434/v1"),
    COMPLETION_API_KEY: z.string().default(""),
    COMPLETION_MODEL: z.string().min(1).default("qwen2.5:0.5b"),
    COMPLETION_KEEP_ALIVE: z.string().min(1).default("30m"),
    CRITIC_PROVIDER: ProviderSchema.default("mock"),
    CRITIC_BASE_URL: z.url().default("http://127.0.0.1:11434/v1"),
    CRITIC_API_KEY: z.string().default(""),
    CRITIC_MODEL: z.string().min(1).default("gpt-5.6-terra"),
    CRITIC_SUPPORTS_JSON_SCHEMA: booleanFromString.default(false),
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
      environment.COMPLETION_PROVIDER === "openai" &&
      !environment.COMPLETION_API_KEY
    ) {
      context.addIssue({
        code: "custom",
        message: "COMPLETION_API_KEY is required for the OpenAI provider.",
        path: ["COMPLETION_API_KEY"],
      });
    }
    if (
      environment.CRITIC_PROVIDER === "openai" &&
      !environment.CRITIC_API_KEY
    ) {
      context.addIssue({
        code: "custom",
        message: "CRITIC_API_KEY is required for the OpenAI provider.",
        path: ["CRITIC_API_KEY"],
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
