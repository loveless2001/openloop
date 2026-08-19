// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_APP_SETTINGS } from "./app-settings.js";
import { SettingsDialog } from "./SettingsDialog.js";

describe("SettingsDialog", () => {
  it("saves validated UI preferences and identifies env-owned models", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        createElement(SettingsDialog, {
          modelStatus: {
            provider: "ollama",
            completionModel: "qwen2.5:0.5b",
            criticProvider: "openai",
            criticModel: "smart-model",
            mode: "local",
            state: "ready",
          },
          onClose: vi.fn(),
          onReset: vi.fn(),
          onSave,
          open: true,
          settings: DEFAULT_APP_SETTINGS,
        }),
      );
    });

    const idleInput = container.querySelectorAll<HTMLInputElement>(
      'input[type="number"]',
    )[0];
    expect(idleInput?.value).toBe("10");
    await act(async () => {
      if (!idleInput) throw new Error("Idle input missing");
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(idleInput, "25");
      idleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const dictionaryInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-describedby="dictionary-help"]',
    );
    await act(async () => {
      if (!dictionaryInput) throw new Error("Dictionary input missing");
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setValue?.call(dictionaryInput, "OpenTelemetry\nbtw => by the way");
      dictionaryInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        criticIdleDelayMs: 25_000,
        dictionaryEntries: [
          { trigger: "OpenTelemetry", replacement: "OpenTelemetry" },
          { trigger: "btw", replacement: "by the way" },
        ],
      }),
    );
    expect(container.textContent).toContain(
      "Managed by the server’s .env file",
    );
    expect(container.textContent).toContain("openai · smart-model");

    await act(async () => root.unmount());
    container.remove();
  });
});
