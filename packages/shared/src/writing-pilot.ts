import { z } from "zod";

import {
  WritingLanguageHintSchema,
  WritingRubricSchema,
  WritingScopeSchema,
} from "./writing-evaluation.js";

const PilotVariantSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .max(80),
    rubricId: z.uuid(),
    scope: WritingScopeSchema,
    languageHint: WritingLanguageHintSchema,
    targetText: z.string().min(1),
    contextBefore: z.string().default(""),
    contextAfter: z.string().default(""),
  })
  .strict()
  .superRefine((variant, context) => {
    if (
      variant.scope === "document" &&
      (variant.contextBefore || variant.contextAfter)
    ) {
      context.addIssue({
        code: "custom",
        message: "Whole-document fixtures must put all text in targetText.",
      });
    }
  });

export const WritingPilotFixtureSchema = z
  .object({
    schemaVersion: z.literal("writing-pilot-fixtures.v1"),
    id: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .max(80),
    rubrics: z.array(WritingRubricSchema).min(1).max(20),
    pairs: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9_-]+$/)
              .max(80),
            hypothesis: z.string().min(1).max(2_000),
            variants: z.tuple([PilotVariantSchema, PilotVariantSchema]),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((fixture, context) => {
    const rubricIds = fixture.rubrics.map((rubric) => rubric.id);
    const pairIds = fixture.pairs.map((pair) => pair.id);
    if (
      new Set(rubricIds).size !== rubricIds.length ||
      new Set(pairIds).size !== pairIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Rubric IDs and pair IDs must be unique.",
      });
    }
    for (const pair of fixture.pairs) {
      if (
        pair.variants[0].id === pair.variants[1].id ||
        pair.variants.some((variant) => !rubricIds.includes(variant.rubricId))
      ) {
        context.addIssue({
          code: "custom",
          message: "Each pair needs unique variant IDs and known rubric IDs.",
        });
      }
    }
  });

export type WritingPilotFixture = z.infer<typeof WritingPilotFixtureSchema>;
