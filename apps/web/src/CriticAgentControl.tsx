import { useCallback, useEffect, useState } from "react";

import type { CriticAgentStatusResponse } from "@openloop/shared";

import {
  launchCriticAgent,
  loadCriticAgentStatus,
  type ApiClientError,
} from "./api.js";

export function CriticAgentControl({
  onMessage,
}: {
  onMessage: (message: string, duration?: number) => void;
}) {
  const [status, setStatus] = useState<CriticAgentStatusResponse>();
  const [launching, setLaunching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await loadCriticAgentStatus());
    } catch {
      setStatus(undefined);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const launch = async () => {
    setLaunching(true);
    try {
      const next = await launchCriticAgent();
      setStatus(next);
      onMessage(
        `${next.agent} critic terminal started. If login is requested, attach with: ${next.attachCommand}`,
        5_000,
      );
    } catch (error) {
      onMessage(
        (error as ApiClientError)?.message || "Could not launch critic CLI.",
        4_000,
      );
      await refresh();
    } finally {
      setLaunching(false);
    }
  };

  const running = status?.state === "running";
  const canLaunch = status?.state === "stopped" && !launching;
  const label = launching
    ? "Starting critic CLI…"
    : running
      ? status.bridgeState === "busy"
        ? `${status.agent} critic busy`
        : status.bridgeState === "queued"
          ? `${status.agent} critic queued`
          : status.bridgeState === "idle"
            ? `${status.agent} CLI running`
            : `${status.agent} CLI running`
      : status?.state === "stopped"
        ? `Start ${status.agent} CLI`
        : "Critic CLI unavailable";
  const title = status
    ? `${status.message}${running ? ` Attach: ${status.attachCommand}` : ""}`
    : "Checking the managed critic terminal…";

  return (
    <button
      aria-label="Managed critic CLI"
      className="critic-agent-button"
      data-state={status?.state ?? "checking"}
      disabled={!canLaunch}
      onClick={() => void launch()}
      title={title}
      type="button"
    >
      <span aria-hidden="true" className="critic-agent-dot" />
      {label}
    </button>
  );
}
