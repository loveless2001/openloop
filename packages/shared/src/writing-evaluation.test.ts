import { describe, expect, it } from "vitest";

import { WritingRubricContentSchema } from "./writing-evaluation.js";

const criterionId = "11111111-1111-4111-8111-111111111111";

function validRubric() {
  return {
    title: "Focus",
    purpose: "Explain one idea.",
    audience: "New readers",
    criteria: [
      {
        id: criterionId,
        name: "Support",
        question: "Is the conclusion supported?",
        allowedScopes: ["selection", "document"],
        levels: [
          { label: "Low", description: "No reason is supplied." },
          { label: "Some", description: "A partial reason is supplied." },
          { label: "Strong", description: "A clear reason is supplied." },
        ],
      },
    ],
  };
}

describe("writing rubric contract", () => {
  it("accepts one to six independent three-level criteria", () => {
    expect(
      WritingRubricContentSchema.parse(validRubric()).criteria,
    ).toHaveLength(1);
  });

  it("rejects duplicate criterion IDs, duplicate descriptions, and empty scopes", () => {
    const duplicateIds = validRubric();
    duplicateIds.criteria.push(structuredClone(duplicateIds.criteria[0]!));
    expect(WritingRubricContentSchema.safeParse(duplicateIds).success).toBe(
      false,
    );

    const duplicateDescriptions = validRubric();
    duplicateDescriptions.criteria[0]!.levels[1]!.description =
      "No reason is supplied.";
    expect(
      WritingRubricContentSchema.safeParse(duplicateDescriptions).success,
    ).toBe(false);

    const emptyScopes = validRubric();
    emptyScopes.criteria[0]!.allowedScopes = [];
    expect(WritingRubricContentSchema.safeParse(emptyScopes).success).toBe(
      false,
    );
  });
});
