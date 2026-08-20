import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Environment } from "./config/env.js";

const TOKEN_ENVIRONMENT_VARIABLE = "OPENLOOP_MCP_TOKEN";
const CRITIC_MCP_TOOLS = [
  "openloop_critic_next",
  "openloop_critic_context",
  "openloop_critic_submit",
  "openloop_critic_fail",
  "openloop_reconcile_next",
  "openloop_reconcile_submit",
  "openloop_reconcile_fail",
  "openloop_issue_chat_next",
  "openloop_issue_chat_submit",
  "openloop_issue_chat_fail",
] as const;
const CLAUDE_ISOLATED_SETTINGS = {
  autoMemoryEnabled: false,
  disableAllHooks: true,
  includeGitInstructions: false,
} as const;

function applyPrivateMode(path: string, mode: number): void {
  // Windows does not implement POSIX ownership modes. Files there inherit the
  // current user's ACL; chmod can only toggle the read-only attribute.
  if (process.platform !== "win32") chmodSync(path, mode);
}

export interface CriticAgentLaunchConfig {
  args: string[];
  environment: Record<string, string>;
  workingDirectory: string;
}

export function loadOrCreateCriticMcpToken(workspaceRoot: string): string {
  const dataDirectory = join(workspaceRoot, "data");
  const tokenPath = join(dataDirectory, "critic-agent-token");
  mkdirSync(dataDirectory, { recursive: true });
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(existing)) {
      applyPrivateMode(tokenPath, 0o600);
      return existing;
    }
  } catch {
    // Generate the first local bridge token below.
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  applyPrivateMode(tokenPath, 0o600);
  return token;
}

export function createCriticAgentLaunchConfig(input: {
  environment: Environment;
  bearerToken: string;
  workspaceRoot: string;
}): CriticAgentLaunchConfig {
  const url = `http://127.0.0.1:${input.environment.SERVER_PORT}/mcp`;
  const workingDirectory = join(tmpdir(), "openloop-critic-runtime");
  mkdirSync(workingDirectory, { recursive: true, mode: 0o700 });
  applyPrivateMode(workingDirectory, 0o700);
  if (input.environment.CRITIC_AGENT === "codex") {
    return {
      args: [
        "-c",
        `mcp_servers.openloop.url=${JSON.stringify(url)}`,
        "-c",
        `mcp_servers.openloop.bearer_token_env_var=${JSON.stringify(TOKEN_ENVIRONMENT_VARIABLE)}`,
        "-c",
        `mcp_servers.openloop.enabled_tools=${JSON.stringify(CRITIC_MCP_TOOLS)}`,
        "-c",
        'mcp_servers.openloop.default_tools_approval_mode="approve"',
        "-c",
        "check_for_update_on_startup=false",
        "--sandbox",
        "read-only",
        "--ask-for-approval",
        "never",
      ],
      environment: { [TOKEN_ENVIRONMENT_VARIABLE]: input.bearerToken },
      workingDirectory,
    };
  }

  const dataDirectory = join(input.workspaceRoot, "data");
  const configPath = join(dataDirectory, "critic-agent-mcp.json");
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        mcpServers: {
          openloop: {
            type: "http",
            url,
            headers: { Authorization: `Bearer ${input.bearerToken}` },
          },
        },
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  applyPrivateMode(configPath, 0o600);
  return {
    args: [
      "--mcp-config",
      configPath,
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--settings",
      JSON.stringify(CLAUDE_ISOLATED_SETTINGS),
      "--permission-mode",
      "default",
      "--allowed-tools",
      CRITIC_MCP_TOOLS.map((tool) => `mcp__openloop__${tool}`).join(","),
      "--tools",
      "",
      "--no-chrome",
    ],
    environment: {},
    workingDirectory,
  };
}
