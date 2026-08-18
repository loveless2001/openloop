import { describe, expect, it } from "vitest";

import { markdownFilename } from "./FileMenu.js";

describe("markdownFilename", () => {
  it("produces a portable Markdown filename", () => {
    expect(markdownFilename(" Draft: A/B? ")).toBe("Draft- A-B-.md");
    expect(markdownFilename("notes.md")).toBe("notes.md");
    expect(markdownFilename("   ")).toBe("untitled.md");
  });
});
