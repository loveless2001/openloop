// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { FileMenu, markdownFilename } from "./FileMenu.js";

describe("markdownFilename", () => {
  it("produces a portable Markdown filename", () => {
    expect(markdownFilename(" Draft: A/B? ")).toBe("Draft- A-B-.md");
    expect(markdownFilename("notes.md")).toBe("notes.md");
    expect(markdownFilename("   ")).toBe("untitled.md");
  });
});

describe("FileMenu", () => {
  it("closes when a pointer interaction occurs outside the menu", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(container, outside);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FileMenu, {
          documentTitle: "Draft",
          onDownload: () => undefined,
          onNew: async () => undefined,
          onOpen: async () => undefined,
          onSave: async () => undefined,
        }),
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".menu-trigger")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
    outside.remove();
  });
});
