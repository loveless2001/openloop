import { describe, expect, it } from "vitest";

import {
  CreateDocumentRequestSchema,
  EditorChangeBatchSchema,
} from "./schemas.js";

describe("shared Phase 0/1 schemas", () => {
  it("accepts TipTap JSON at the document boundary", () => {
    expect(
      CreateDocumentRequestSchema.parse({
        title: "Harness note",
        contentJson: {
          type: "doc",
          content: [
            { type: "paragraph", attrs: { nodeId: crypto.randomUUID() } },
          ],
        },
      }).title,
    ).toBe("Harness note");
  });

  it("rejects a non-monotonic client sequence", () => {
    expect(() =>
      EditorChangeBatchSchema.parse({
        documentId: crypto.randomUUID(),
        baseVersion: 0,
        clientSequence: 0,
        changedBlocks: [],
        removedNodeIds: [],
        mergedNodeMap: {},
        reason: "typing",
      }),
    ).toThrow();
  });
});
