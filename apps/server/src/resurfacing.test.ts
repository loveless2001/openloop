import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./db/client.js";
import { openDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrations.js";
import { issueEvents, issues } from "./db/schema.js";
import { createDocument, saveDocument } from "./documents.js";
import { listIssueEvents } from "./issues.js";
import {
  listPreferenceWeights,
  updatePreferenceWeight,
} from "./preferences.js";
import { resurfaceIssue } from "./resurfacing.js";

let database: Database;
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "openloop-resurface-"));
  database = openDatabase(`file:${join(directory, "test.db")}`);
  applyMigrations(database);
});

afterEach(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("resurfacing persistence", () => {
  it("shows the same issue id after claim reuse and appends history", () => {
    const anchorNodeId = randomUUID();
    const reuseNodeId = randomUUID();
    const anchorText = "The model interface guarantees equivalent quality.";
    const reusedText =
      "Therefore the model interface guarantees equal quality.";
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: anchorNodeId },
          content: [{ type: "text", text: anchorText }],
        },
        {
          type: "paragraph",
          attrs: { nodeId: reuseNodeId },
          content: [{ type: "text", text: reusedText }],
        },
      ],
    };
    const created = createDocument(database, {
      title: "Draft",
      contentJson: content,
    });
    const saved = saveDocument(database, created.id, {
      baseVersion: 0,
      title: "Draft",
      contentJson: content,
    });
    const issueId = randomUUID();
    const oldShownAt = new Date("2026-08-21T10:00:00.000Z").getTime();
    database.orm
      .insert(issues)
      .values({
        id: issueId,
        documentId: created.id,
        type: "ambiguity",
        status: "snoozed",
        question: "Are model interface and quality equivalent?",
        rationale: "They are different claims.",
        severity: 4,
        confidence: 0.98,
        interruptWorthiness: 0.95,
        anchorJson: JSON.stringify({
          nodeId: anchorNodeId,
          quote: "model interface guarantees equivalent quality",
          quoteStart: 4,
          quoteEnd: 49,
          leftContext: "The ",
          rightContext: ".",
          normalizedFingerprint: "a".repeat(64),
          sourceDocumentVersion: 0,
          detached: false,
        }),
        keywordsJson: JSON.stringify(["model", "interface", "quality"]),
        resurfaceTriggersJson: JSON.stringify(["claim_reused"]),
        dedupeKey: "b".repeat(64),
        shownCount: 1,
        silentIgnoreCount: 0,
        lastShownAt: oldShownAt,
        snoozedUntil: oldShownAt + 120_000,
        createdAt: oldShownAt,
        updatedAt: oldShownAt,
      })
      .run();
    database.orm
      .insert(issueEvents)
      .values({
        id: randomUUID(),
        issueId,
        documentId: created.id,
        action: "show",
        documentVersion: 0,
        payloadJson: JSON.stringify({ reason: "new_issue" }),
        createdAt: oldShownAt,
      })
      .run();

    const resurfaced = resurfaceIssue(
      database,
      created.id,
      {
        documentVersion: saved.version,
        trigger: "claim_reused",
        changedBlocks: [
          {
            nodeId: reuseNodeId,
            nodeType: "paragraph",
            text: reusedText,
            headingPath: [],
          },
        ],
        attention: {
          userIdleMs: 1_200,
          completionVisible: false,
          issueCardExpanded: false,
        },
      },
      new Date("2026-08-21T12:00:00.000Z"),
    );

    expect(resurfaced).toMatchObject({
      id: issueId,
      status: "open",
      shownCount: 2,
      snoozedUntil: undefined,
    });
    expect(listIssueEvents(database, issueId).at(-1)).toMatchObject({
      action: "show",
      documentVersion: 1,
      payload: { reason: "claim_reused", resurfaced: true },
    });
  });

  it("clamps and persists preference updates", () => {
    for (let index = 0; index < 10; index += 1) {
      updatePreferenceWeight(database, "ambiguity", "dismiss", index);
    }
    expect(listPreferenceWeights(database)).toEqual([
      expect.objectContaining({
        issueType: "ambiguity",
        weight: 0.5,
        explicitDismissals: 10,
      }),
    ]);
  });
});
