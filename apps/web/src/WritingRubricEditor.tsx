import type {
  WritingCriterion,
  WritingRubric,
  WritingRubricContent,
} from "@openloop/shared";
import { useState } from "react";

function blankCriterion(): WritingCriterion {
  return {
    id: crypto.randomUUID(),
    name: "New criterion",
    question: "What should the evaluator judge?",
    allowedScopes: ["selection", "document"],
    levels: [
      {
        label: "Little alignment",
        description: "Describe observable low alignment.",
      },
      {
        label: "Some alignment",
        description: "Describe observable partial alignment.",
      },
      {
        label: "Strong alignment",
        description: "Describe observable strong alignment.",
      },
    ],
  };
}

export function blankRubric(): WritingRubricContent {
  return {
    title: "Untitled rubric",
    purpose: "",
    audience: "",
    criteria: [blankCriterion()],
  };
}

export function starterRubric(): WritingRubricContent {
  return {
    title: "Writing goals starter",
    purpose:
      "Make the draft focused, supported, and understandable for its intended reader.",
    audience: "The readers named for this draft.",
    criteria: [
      {
        id: crypto.randomUUID(),
        name: "Conciseness",
        question: "Does repeated explanation add a distinct point?",
        allowedScopes: ["selection", "document"],
        levels: [
          {
            label: "Little alignment",
            description:
              "Explanation repeats without adding a distinct reason, example, or qualification.",
          },
          {
            label: "Some alignment",
            description:
              "The text adds useful material but also repeats explanation without a distinct addition.",
          },
          {
            label: "Strong alignment",
            description:
              "The text develops its point without repetition that adds no distinct content.",
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        name: "Explicit support",
        question:
          "Are important conclusions supported by reasons in the supplied text?",
        allowedScopes: ["selection", "document"],
        levels: [
          {
            label: "Little alignment",
            description:
              "Important conclusions are stated without reasons in the supplied text.",
          },
          {
            label: "Some alignment",
            description:
              "Some important conclusions have reasons, while others remain unsupported in the supplied text.",
          },
          {
            label: "Strong alignment",
            description:
              "Important conclusions are connected to explicit reasons in the supplied text.",
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        name: "Audience accessibility",
        question: "Are essential terms understandable for the named audience?",
        allowedScopes: ["selection", "document"],
        levels: [
          {
            label: "Little alignment",
            description:
              "Essential terms are used without enough explanation for the named audience.",
          },
          {
            label: "Some alignment",
            description:
              "Most essential terms are understandable, but some require more explanation for the named audience.",
          },
          {
            label: "Strong alignment",
            description:
              "Essential terms are explained or used in a way the named audience can understand.",
          },
        ],
      },
    ],
  };
}

function cloneContent(content: WritingRubricContent): WritingRubricContent {
  return structuredClone(content);
}

export function WritingRubricEditor(props: {
  busy: boolean;
  initial: WritingRubricContent;
  existing?: WritingRubric;
  onCancel: () => void;
  onSave: (
    content: WritingRubricContent,
    existing?: WritingRubric,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => cloneContent(props.initial));

  const updateCriterion = (
    index: number,
    update: (criterion: WritingCriterion) => WritingCriterion,
  ) => {
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) =>
        criterionIndex === index ? update(criterion) : criterion,
      ),
    }));
  };

  const moveCriterion = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const next = [...current.criteria];
      const destination = index + direction;
      const criterion = next[index];
      if (!criterion || destination < 0 || destination >= next.length)
        return current;
      next.splice(index, 1);
      next.splice(destination, 0, criterion);
      return { ...current, criteria: next };
    });
  };

  return (
    <form
      className="rubric-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSave(draft, props.existing);
      }}
    >
      <p className="rubric-help">
        Describe what you would actually observe at each level. Measure one
        thing at a time. Each description must stand on its own.
      </p>
      <label>
        Rubric title
        <input
          maxLength={120}
          onChange={(event) =>
            setDraft({ ...draft, title: event.target.value })
          }
          required
          value={draft.title}
        />
      </label>
      <label>
        Purpose
        <textarea
          maxLength={1_000}
          onChange={(event) =>
            setDraft({ ...draft, purpose: event.target.value })
          }
          rows={2}
          value={draft.purpose}
        />
      </label>
      <label>
        Audience
        <textarea
          maxLength={1_000}
          onChange={(event) =>
            setDraft({ ...draft, audience: event.target.value })
          }
          rows={2}
          value={draft.audience}
        />
      </label>

      {draft.criteria.map((criterion, criterionIndex) => (
        <fieldset className="rubric-criterion-editor" key={criterion.id}>
          <legend>Criterion {criterionIndex + 1}</legend>
          <div className="criterion-order-actions">
            <button
              disabled={criterionIndex === 0}
              onClick={() => moveCriterion(criterionIndex, -1)}
              type="button"
            >
              Move up
            </button>
            <button
              disabled={criterionIndex === draft.criteria.length - 1}
              onClick={() => moveCriterion(criterionIndex, 1)}
              type="button"
            >
              Move down
            </button>
            <button
              disabled={draft.criteria.length === 1}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  criteria: current.criteria.filter(
                    (_, index) => index !== criterionIndex,
                  ),
                }))
              }
              type="button"
            >
              Remove
            </button>
          </div>
          <label>
            Name
            <input
              maxLength={120}
              onChange={(event) =>
                updateCriterion(criterionIndex, (current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              required
              value={criterion.name}
            />
          </label>
          <label>
            One-dimension question
            <textarea
              maxLength={800}
              onChange={(event) =>
                updateCriterion(criterionIndex, (current) => ({
                  ...current,
                  question: event.target.value,
                }))
              }
              required
              rows={2}
              value={criterion.question}
            />
          </label>
          <div className="rubric-scope-checks">
            {(["selection", "document"] as const).map((scope) => (
              <label key={scope}>
                <input
                  checked={criterion.allowedScopes.includes(scope)}
                  onChange={(event) =>
                    updateCriterion(criterionIndex, (current) => ({
                      ...current,
                      allowedScopes: event.target.checked
                        ? [...current.allowedScopes, scope]
                        : current.allowedScopes.filter(
                            (value) => value !== scope,
                          ),
                    }))
                  }
                  type="checkbox"
                />
                {scope}
              </label>
            ))}
          </div>
          {criterion.levels.map((level, levelIndex) => (
            <div
              className="rubric-level-row"
              key={`${criterion.id}:${levelIndex}`}
            >
              <label>
                Level {levelIndex} label
                <input
                  maxLength={80}
                  onChange={(event) =>
                    updateCriterion(criterionIndex, (current) => {
                      const levels = [
                        ...current.levels,
                      ] as WritingCriterion["levels"];
                      levels[levelIndex] = {
                        ...level,
                        label: event.target.value,
                      };
                      return { ...current, levels };
                    })
                  }
                  required
                  value={level.label}
                />
              </label>
              <label>
                Observable description
                <textarea
                  maxLength={800}
                  onChange={(event) =>
                    updateCriterion(criterionIndex, (current) => {
                      const levels = [
                        ...current.levels,
                      ] as WritingCriterion["levels"];
                      levels[levelIndex] = {
                        ...level,
                        description: event.target.value,
                      };
                      return { ...current, levels };
                    })
                  }
                  required
                  rows={2}
                  value={level.description}
                />
              </label>
            </div>
          ))}
        </fieldset>
      ))}
      <div className="rubric-editor-actions">
        <button
          disabled={draft.criteria.length >= 6}
          onClick={() =>
            setDraft((current) => ({
              ...current,
              criteria: [...current.criteria, blankCriterion()],
            }))
          }
          type="button"
        >
          Add criterion
        </button>
        <span />
        <button onClick={props.onCancel} type="button">
          Cancel
        </button>
        <button className="primary-button" disabled={props.busy} type="submit">
          {props.busy ? "Saving…" : "Save rubric"}
        </button>
      </div>
    </form>
  );
}
