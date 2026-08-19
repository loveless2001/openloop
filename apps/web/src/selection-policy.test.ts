import { describe, expect, it } from "vitest";

import { selectionRequiresWarning } from "./selection-policy.js";

describe("selection critique policy", () => {
  it("warns only when the selection exceeds the configured threshold", () => {
    expect(selectionRequiresWarning(1_000, 1_000)).toBe(false);
    expect(selectionRequiresWarning(1_001, 1_000)).toBe(true);
    expect(selectionRequiresWarning(1_500, 2_000)).toBe(false);
  });
});
