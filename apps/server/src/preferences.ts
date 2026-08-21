import type { IssueRecord, PreferenceWeightRecord } from "@openloop/shared";
import { and, eq } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { preferenceWeights } from "./db/schema.js";

const LOCAL_USER_ID = "local-user" as const;

function clampWeight(value: number): number {
  return Math.min(1.5, Math.max(0.5, value));
}

function toRecord(
  row: typeof preferenceWeights.$inferSelect,
): PreferenceWeightRecord {
  return {
    userId: LOCAL_USER_ID,
    issueType: row.issueType as IssueRecord["type"],
    weight: row.weight,
    explicitDismissals: row.explicitDismissals,
    applies: row.applies,
    silentIgnores: row.silentIgnores,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function listPreferenceWeights(
  database: Database,
): PreferenceWeightRecord[] {
  return database.orm
    .select()
    .from(preferenceWeights)
    .where(eq(preferenceWeights.userId, LOCAL_USER_ID))
    .all()
    .map(toRecord);
}

export function preferenceWeightMap(
  database: Database,
): Partial<Record<IssueRecord["type"], number>> {
  return Object.fromEntries(
    listPreferenceWeights(database).map((record) => [
      record.issueType,
      record.weight,
    ]),
  );
}

export function updatePreferenceWeight(
  database: Database,
  issueType: IssueRecord["type"],
  action: "apply_rewrite" | "resolve" | "dismiss" | "silent_ignore",
  now: number,
): PreferenceWeightRecord {
  const existing = database.orm
    .select()
    .from(preferenceWeights)
    .where(
      and(
        eq(preferenceWeights.userId, LOCAL_USER_ID),
        eq(preferenceWeights.issueType, issueType),
      ),
    )
    .get();
  const delta = {
    apply_rewrite: 0.05,
    resolve: 0.03,
    dismiss: -0.12,
    silent_ignore: -0.02,
  }[action];
  const row: typeof preferenceWeights.$inferInsert = {
    userId: LOCAL_USER_ID,
    issueType,
    weight: clampWeight((existing?.weight ?? 1) + delta),
    explicitDismissals:
      (existing?.explicitDismissals ?? 0) + (action === "dismiss" ? 1 : 0),
    applies: (existing?.applies ?? 0) + (action === "apply_rewrite" ? 1 : 0),
    silentIgnores:
      (existing?.silentIgnores ?? 0) + (action === "silent_ignore" ? 1 : 0),
    updatedAt: now,
  };
  database.orm
    .insert(preferenceWeights)
    .values(row)
    .onConflictDoUpdate({
      target: [preferenceWeights.userId, preferenceWeights.issueType],
      set: row,
    })
    .run();
  return toRecord(row as typeof preferenceWeights.$inferSelect);
}
