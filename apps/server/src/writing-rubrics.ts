import { randomUUID } from "node:crypto";

import { stableJson } from "@openloop/core";
import {
  WritingRubricContentSchema,
  WritingRubricSchema,
  type WritingRubric,
  type WritingRubricContent,
} from "@openloop/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { writingRubrics } from "./db/schema.js";

type RubricRow = typeof writingRubrics.$inferSelect;

export class WritingRubricNotFoundError extends Error {
  readonly code = "WRITING_RUBRIC_NOT_FOUND";
}

export class WritingRubricVersionConflictError extends Error {
  readonly code = "RUBRIC_VERSION_CONFLICT";
  constructor(readonly currentRevision: number) {
    super(`Rubric revision is ${currentRevision}.`);
  }
}

function toRubric(row: RubricRow): WritingRubric {
  const content = WritingRubricContentSchema.parse(JSON.parse(row.contentJson));
  return WritingRubricSchema.parse({
    id: row.id,
    revision: row.revision,
    ...content,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
}

export function listWritingRubrics(database: Database): WritingRubric[] {
  return database.orm
    .select()
    .from(writingRubrics)
    .orderBy(desc(writingRubrics.updatedAt))
    .all()
    .map(toRubric);
}

export function getWritingRubric(
  database: Database,
  rubricId: string,
): WritingRubric {
  const row = database.orm
    .select()
    .from(writingRubrics)
    .where(eq(writingRubrics.id, rubricId))
    .get();
  if (!row) throw new WritingRubricNotFoundError("Writing rubric not found.");
  return toRubric(row);
}

export function createWritingRubric(
  database: Database,
  content: WritingRubricContent,
): WritingRubric {
  const validated = WritingRubricContentSchema.parse(content);
  const now = Date.now();
  const row: typeof writingRubrics.$inferInsert = {
    id: randomUUID(),
    revision: 1,
    title: validated.title,
    contentJson: stableJson(validated),
    createdAt: now,
    updatedAt: now,
  };
  database.orm.insert(writingRubrics).values(row).run();
  return toRubric(row);
}

export function updateWritingRubric(
  database: Database,
  rubricId: string,
  input: WritingRubricContent & { baseRevision: number },
): WritingRubric {
  const current = getWritingRubric(database, rubricId);
  if (current.revision !== input.baseRevision) {
    throw new WritingRubricVersionConflictError(current.revision);
  }
  const validated = WritingRubricContentSchema.parse(input);
  const currentContent = WritingRubricContentSchema.parse(current);
  if (stableJson(currentContent) === stableJson(validated)) return current;

  const updated = database.orm
    .update(writingRubrics)
    .set({
      revision: current.revision + 1,
      title: validated.title,
      contentJson: stableJson(validated),
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(writingRubrics.id, rubricId),
        eq(writingRubrics.revision, current.revision),
      ),
    )
    .returning()
    .get();
  if (!updated) {
    const latest = getWritingRubric(database, rubricId);
    throw new WritingRubricVersionConflictError(latest.revision);
  }
  return toRubric(updated);
}
