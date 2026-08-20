import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readEnvironment } from "./config/env.js";
import {
  createCriticAgentLaunchConfig,
  loadOrCreateCriticMcpToken,
} from "./critic-agent-launch-config.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("critic agent launch configuration", () => {
  it("reuses a private local bearer token across server restarts", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "openloop-mcp-token-"));
    directories.push(workspaceRoot);
    const first = loadOrCreateCriticMcpToken(workspaceRoot);
    const second = loadOrCreateCriticMcpToken(workspaceRoot);
    const tokenPath = join(workspaceRoot, "data", "critic-agent-token");

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    if (process.platform !== "win32") {
      expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    }
  });

  it("injects the Codex MCP URL and an environment-owned bearer token", () => {
    const config = createCriticAgentLaunchConfig({
      environment: readEnvironment({
        SERVER_PORT: "9876",
        CRITIC_AGENT: "codex",
      }),
      bearerToken: "secret",
      workspaceRoot: "/workspace",
    });

    expect(config.args).toContain(
      'mcp_servers.openloop.url="http://127.0.0.1:9876/mcp"',
    );
    expect(config.args).toContain(
      'mcp_servers.openloop.bearer_token_env_var="OPENLOOP_MCP_TOKEN"',
    );
    expect(config.args).toContain(
      'mcp_servers.openloop.enabled_tools=["openloop_critic_next","openloop_critic_context","openloop_critic_submit","openloop_critic_fail","openloop_reconcile_next","openloop_reconcile_submit","openloop_reconcile_fail","openloop_issue_chat_next","openloop_issue_chat_submit","openloop_issue_chat_fail"]',
    );
    expect(config.args).toContain(
      'mcp_servers.openloop.default_tools_approval_mode="approve"',
    );
    expect(config.args).toContain("check_for_update_on_startup=false");
    expect(config.environment).toEqual({ OPENLOOP_MCP_TOKEN: "secret" });
    expect(config.workingDirectory).toBe(
      join(tmpdir(), "openloop-critic-runtime"),
    );
    if (process.platform !== "win32") {
      expect(statSync(config.workingDirectory).mode & 0o777).toBe(0o700);
    }
  });

  it("writes an isolated Claude MCP config under ignored local data", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "openloop-mcp-config-"));
    directories.push(workspaceRoot);
    const config = createCriticAgentLaunchConfig({
      environment: readEnvironment({ CRITIC_AGENT: "claude" }),
      bearerToken: "secret",
      workspaceRoot,
    });
    const configPath = join(workspaceRoot, "data", "critic-agent-mcp.json");

    expect(config.args).toEqual([
      "--mcp-config",
      configPath,
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--settings",
      '{"autoMemoryEnabled":false,"disableAllHooks":true,"includeGitInstructions":false}',
      "--permission-mode",
      "default",
      "--allowed-tools",
      "mcp__openloop__openloop_critic_next,mcp__openloop__openloop_critic_context,mcp__openloop__openloop_critic_submit,mcp__openloop__openloop_critic_fail,mcp__openloop__openloop_reconcile_next,mcp__openloop__openloop_reconcile_submit,mcp__openloop__openloop_reconcile_fail,mcp__openloop__openloop_issue_chat_next,mcp__openloop__openloop_issue_chat_submit,mcp__openloop__openloop_issue_chat_fail",
      "--tools",
      "",
      "--no-chrome",
    ]);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
      mcpServers: {
        openloop: {
          type: "http",
          url: "http://127.0.0.1:8787/mcp",
          headers: { Authorization: "Bearer secret" },
        },
      },
    });
    expect(config.environment).toEqual({});
    expect(config.args.join(" ")).not.toContain("secret");
    if (process.platform !== "win32") {
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
    }
    expect(config.workingDirectory).toBe(
      join(tmpdir(), "openloop-critic-runtime"),
    );
  });
});
