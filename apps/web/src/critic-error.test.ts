import { describe, expect, it } from "vitest";

import { criticErrorMessage } from "./critic-error.js";

describe("critic error feedback", () => {
  it("surfaces the server's actionable bridge error", () => {
    expect(
      criticErrorMessage(
        JSON.stringify({
          code: "MODEL_UNAVAILABLE",
          message: "Start the managed critic CLI before requesting criticism.",
        }),
      ),
    ).toBe("Start the managed critic CLI before requesting criticism.");
  });

  it("falls back safely for malformed events", () => {
    expect(criticErrorMessage("not-json")).toBe("Critic unavailable");
  });
});
