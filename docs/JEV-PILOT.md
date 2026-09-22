# Jev writing pilot

J3 provides eight synthetic pairs (16 evaluations), including English and Vietnamese examples.
The relationships are author-reviewable hypotheses, not benchmark ground truth. A mock run checks
integration only; it cannot measure Jev's writing judgments or Vietnamese proficiency.

## Run locally

```bash
pnpm eval:jev -- --input docs/fixtures/jev-writing-pilot.json --provider mock --output data/evaluations/pilot.jsonl
```

Paths resolve from the workspace root. Outputs must be `.jsonl` files under ignored `data/` and
must not already exist. The runner creates output with owner-only permissions and flushes each
record. It never opens the application's document database. Source text and comments are present
in exports, so review them before sharing.

For an explicitly chosen remote run, configure `TYPESAFE_API_KEY`, `JEV_API_BASE_URL`, `JEV_MODEL`,
and `JEV_TIMEOUT_MS` server-side, and use both `--provider typesafe --allow-remote`. These flags
authorize the fixture inputs for that invocation. Every pair is compiled and checked against the
24,000-byte request cap before the first inference. Calls are sequential, with one attempt per
variant. The first failure is written as a sanitized error record and stops the batch with a
nonzero exit code; the terminal summary reports completed, failed, and unattempted counts.
Unknown usage remains absent. Resuming requires selecting the remaining fixtures and explicitly
invoking a new run with a new output file. There is no automatic retry, fallback, or training.

## Fixture and output contracts

`WritingPilotFixtureSchema` in `packages/shared/src/writing-pilot.ts` defines
`writing-pilot-fixtures.v1`. It contains a stable fixture ID, full versioned rubrics, and pairs with
an ID, hypothesis, and exactly two uniquely named variants. Each variant references a saved rubric
ID and supplies language, scope, target text, and optional selection context. Whole-document
fixtures must put all content in `targetText`. Nearby context uses the editor's same clipping
policy. To change purpose, audience, or level definitions, supply another versioned rubric and
reference it explicitly; do not overwrite the original record.

Each `writing-pilot-result.v1` JSONL row records the fixture-file SHA-256, pair/variant identity,
hypothesis, request bytes, and a `writing-evaluation-export.v1` record. The nested record contains
an immutable source/rubric snapshot, rubric and input hashes, compiler/serializer/policy versions,
policy thresholds, requested/returned model, raw score and assessability distributions,
provider confidence/legend, duration, token usage when known, status, and sanitized error.
Mock assessments are labeled `mock_fixture`; real assessments are `model_assessment`. Author
feedback is a separate array labeled `author_feedback_not_verified_ground_truth`. Pilot feedback
starts empty. Abstentions retain their status and any returned diagnostic score; the score is not
used for the assessment. No missing score is replaced by zero.

Document and node IDs are stable within a fixture pair. The repeat pair therefore compiles to the
same semantic input hash, while each observation gets a distinct run/request ID. Changing source,
rubric, scope, provider, or model changes the relevant provenance. A stable hash does not promise
deterministic provider outputs.

## Review worksheet

Before viewing real model results, record your rubric-based judgment for a subset of cases. Keep
those judgments separate from hypotheses used to create or revise the rubric. The app's feedback
form is for reviewing an already visible result; use this worksheet for judgments made beforehand.

| Pair                    | Intervention                                         | Author judgment before viewing results | Observed assessment/distribution change | Context or rubric concern |
| ----------------------- | ---------------------------------------------------- | -------------------------------------- | --------------------------------------- | ------------------------- |
| remove-repetition       | Remove a redundant Vietnamese sentence               |                                        |                                         |                           |
| add-reason              | Add a reason to a Vietnamese conclusion              |                                        |                                         |                           |
| change-audience         | Specialists versus beginners                         |                                        |                                         |                           |
| necessary-context       | Supply a preceding definition                        |                                        |                                         |                           |
| irrelevant-context      | Add unrelated neighboring prose                      |                                        |                                         |                           |
| document-contradiction  | Isolated selection versus conflicting complete draft |                                        |                                         |                           |
| adversarial-instruction | Insert prose requesting the highest score            |                                        |                                         |                           |
| repeat-pinned-input     | Repeat identical Vietnamese input                    |                                        |                                         |                           |

Report sample counts, failures, abstentions, and unattempted cases alongside any author agreement.
Inspect criterion, scope, and language separately; criteria from one passage are not independent
samples. Preserve regressions and adversarial failures. Keep rubric-development cases separate
from a frozen follow-up set. These small synthetic pairs cannot establish calibration,
writing-quality accuracy, language proficiency, or training value. Later training experiments can
consume explicit exports, but need their own dataset selection and held-out evaluation decisions.

## Worked example: sentence, paragraph, and whole article

The [September 22 article-scope report](reports/jev-article-scopes-2026-09-22.md) records five actual
`jev-1.13.0` evaluations through the application's browser UI. It includes the sample article,
exact user-entered rubric, selection/context settings, pre-run expectations, validated exports,
screenshots, token usage, observed limitations, and instructions for reopening the saved history.
Its separate browser runner exercises one article across scopes rather than the paired-fixture CLI.
