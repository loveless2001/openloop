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
const CriticProviderSchema = z.union([ProviderSchema, z.literal("cli-agent")]);

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
    COMPLETION_MODEL: z
      .string()
      .min(1)
      .default("hf.co/mradermacher/SmolLM3-3B-Base-GGUF:Q4_K_M"),
    COMPLETION_KEEP_ALIVE: z.string().min(1).default("30m"),
    CRITIC_PROVIDER: CriticProviderSchema.default("mock"),
    CRITIC_BASE_URL: z.url().default("http://127.0.0.1:11434/v1"),
    CRITIC_API_KEY: z.string().default(""),
    CRITIC_MODEL: z.string().min(1).default("gpt-5.6-terra"),
    CRITIC_SUPPORTS_JSON_SCHEMA: booleanFromString.default(false),
    CRITIC_AGENT: z.enum(["codex", "claude"]).default("codex"),
    CRITIC_AGENT_COMMAND: z.string().trim().default(""),
    CRITIC_AGENT_JOB_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .max(900_000)
      .default(300_000),
    CAPTURE_TRAINING_TRACES: booleanFromString.default(false),
    TRAINING_TRACE_PATH: z
      .string()
      .min(1)
      .default("data/training/completion-traces.jsonl"),
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
