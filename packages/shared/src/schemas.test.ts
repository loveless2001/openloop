import { describe, expect, it } from "vitest";

import {
  CriticJobRequestSchema,
  CreateDocumentRequestSchema,
  EditorChangeBatchSchema,
  IssueActionRequestSchema,
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

  it("validates critic jobs and discriminated issue actions", () => {
    const nodeId = crypto.randomUUID();
    expect(
      CriticJobRequestSchema.parse({
        requestId: crypto.randomUUID(),
        documentVersion: 2,
        trigger: "word_threshold",
        changedBlocks: [
          {
            nodeId,
            nodeType: "paragraph",
            text: "A consequential claim.",
            headingPath: [],
          },
        ],
      }).trigger,
    ).toBe("word_threshold");
    expect(() =>
      IssueActionRequestSchema.parse({
        action: "apply_rewrite",
        documentVersion: 2,
      }),
    ).toThrow();
  });
});
