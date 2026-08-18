import { describe, expect, it } from "vitest";

import { tipTapJsonToPlainText } from "./plain-text.js";

describe("tipTapJsonToPlainText", () => {
  it("derives block-separated text from canonical TipTap JSON", () => {
    expect(
      tipTapJsonToPlainText({
        type: "doc",
        content: [
          { type: "heading", content: [{ type: "text", text: "Title" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ],
          },
        ],
      }),
    ).toBe("Title\nHello world");
  });
});
