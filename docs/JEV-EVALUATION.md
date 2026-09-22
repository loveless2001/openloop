# Writing rubric evaluation — J0–J3 implementation map

This document records the J0 inspection, J1 mock-backed vertical slice, J2 native transport, and J3 research workflow. The J milestones are
separate from the original harness Phase 0–6 work. The implementation was mapped against
`6547a3675ee89f18f3b8ac966c1f52d38845ae69`; the reference commit named by the specification was
not checked out or used to replace local state.

## Existing boundaries and current mappings

| Concern                              | Current boundary used by J1                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical document and versions      | `apps/server/src/documents.ts` and the existing `saveNow()` path in `apps/web/src/use-document-session.ts`                                                    |
| Selection capture                    | `apps/web/src/editor/critic-selection.ts`; evaluation reuses exact stable-node fragments while excluding container blockquotes to avoid duplicate nested text |
| Deterministic text/snapshot policy   | `packages/core/src/writing-evaluation.ts` (`evaluation-text.v1`, `jev-writing.v1`, `jev-display.v1`)                                                          |
| Network contracts                    | `packages/shared/src/writing-evaluation.ts`, exported from the existing shared package                                                                        |
| Evaluator boundary                   | `WritingEvaluator` in `packages/model-adapters`; it is separate from completion, critic, and reconciliation `ModelAdapter` methods                            |
| Composition and dependency injection | `apps/server/src/app.ts`, including an injectable evaluator for route/lifecycle tests                                                                         |
| Persistence                          | Forward migration `0003_smart_misty_knight.sql`; TipTap JSON and SQLite remain canonical                                                                      |
| UI                                   | Existing selection toolbar plus the top document action; evaluation and the issue ledger switch within the existing right workspace                           |

No path required a substitute for the locations proposed by the specification. The existing
document route error handler remains the application-wide Fastify error envelope, so it also maps
the new evaluation and rubric errors.

## J1 behavior and boundaries

The writer can create or revise a 1–6 criterion rubric, prepare an exact selection or complete
saved-document snapshot, inspect the complete prepared request JSON and byte size, and explicitly
run the deterministic evaluator. The server checks the document version, rubric revision, exact
selection text and UTF-16 offsets, input hash, request identity, and 24,000-byte cap before queuing.
One evaluation runs globally and at most two wait. Queued/running work becomes `interrupted` after
restart; cancellation and deletion cannot be revived by a late response.

Every run owns immutable snapshot, rubric, compiler/policy version, and mock model provenance. Old
results remain readable after rubric edits and are labeled when the draft has unsaved changes, the
saved document version changes, or the live rubric revision changes. Evaluations do not edit the
document, create issues, enter training traces, or call the critic.

`Mock — UI test only` is a fixed fixture sequencer used to exercise assessed, missing-context,
not-applicable, uncertain, mixed, and incompatible-scope display paths. It does not infer writing
quality, and passing its tests is only integration evidence.

## Native provider contract and transport

The official TypeSafe documentation was rechecked on 2026-09-21. It still documents native
`POST https://api.typesafe.ai/v1/systemone` requests with `state`, `model`, and a question-ID map;
Score uses an ordered criteria array and returns score/distribution/legend/confidence; Choice uses
an option map and returns choice/distribution/confidence. The models page still lists
`jev-1.13.0`, with `jev-latest` resolving to that version on the checked date.

- <https://docs.typesafe.ai/api>
- <https://docs.typesafe.ai/primitives/score>
- <https://docs.typesafe.ai/primitives/choice>
- <https://docs.typesafe.ai/models>

The official JavaScript SDK source was also checked. Its `TypeSafeClient.systemOne()` sends the
supplied structured `state`, question-ID map, and resolved `model` directly to
`POST /v1/systemone`. Score criteria are an ordered array, Choice criteria are a label-to-description
map, and response usage uses `input_tokens` / `output_tokens`. The canonical SDK credential is
`TYPESAFE_API_KEY`.

The J2 adapter uses server-side native `fetch` and the same wire shape without adding the SDK as a
runtime dependency. It requires HTTPS except for explicitly enabled test loopback, disables
redirects, makes exactly one attempt, supports cancellation and timeout, maps native token usage,
and validates the response before the request-dependent display policy runs. Authentication,
rate-limit, context-limit, timeout, availability, and malformed-response failures remain isolated
to evaluation. Error bodies are never returned or logged, and there is no fallback to the mock.

Append `.env.jev.example` to the existing `.env`, set `TYPESAFE_API_KEY`, and choose
`EVALUATOR_PROVIDER=typesafe`. `pnpm test:jev-live` sends one synthetic evaluation through the full
preview, queue, transport, validation, and persistence path; it does not use a private document.

### Live smoke record

On 2026-09-21, one 1,986-byte synthetic request reached the configured TypeSafe endpoint and was
rejected as `EVALUATOR_AUTH` after 1,134 ms. The temporary compatibility mapping used for that call
copied the quoted `TYPESAFE_API` source literally, while dotenv would remove those quotes; therefore
that result did not establish whether the underlying key or pinned model was available. Per the
one-attempt policy, it was not retried without fresh authorization. No returned model, token usage,
or writing assessment was recorded, and no private document text was sent.

After the credential was renamed to the canonical `TYPESAFE_API_KEY`, a separately authorized
retry completed against requested and returned model `jev-1.13.0` in 1,165 ms. It used 696 input
tokens and 138 output tokens. The assessability Choice passed validation with `assessable` at 0.88;
the Score passed validation at 1.38 with probabilities 0.01, 0.60, and 0.39, producing the saved
middle rubric level under `jev-display.v1`. This single synthetic result proves the configured
transport, validation, and persistence path worked; it is not evidence of general writing-quality
accuracy or calibration.

## J1–J2 correctness pass

The correctness review at baseline `1592f4f8bd621ac164f778228375c23334ce1bdf` confirmed all five
reported application issues. The fixes retain the J1–J2 boundaries and make no evaluator, critic,
issue-ledger, persistence, CLI/MCP, autocomplete, or training handoff.

- A prepared evaluation is now one atomic `{ identity, intent, preview }` value. Its identity binds
  the document, editor generation, target fragments, rubric ID/revision, context mode, and language.
  An abortable preparation epoch is checked after the save barrier and preview request; input changes
  or a document switch invalidate the epoch and remote confirmation. Submit, initial-load, cancel,
  and poll responses are likewise guarded by document and tracked-run identity. Completed historical
  results are independent of preview freshness.
- Complete-document preparation captures the current editor generation when **Prepare preview** is
  pressed. A selection retains the generation and exact fragments captured when it was highlighted;
  editing makes it stale and requires a new selection. The evaluation-specific save barrier reports
  conflicts and network failures while preserving the local editable draft.
- One explicit evaluation action owns one request ID and immutable payload. An ambiguous client
  failure exposes **Retry submission**, which resends those exact bytes semantically (the same JSON
  value and request ID). Starting a different run requires explicitly discarding recovery and
  preparing/reviewing a new snapshot. The server still resolves an accepted matching request ID
  before checking whether the live draft has since changed; a changed identity remains a conflict.
- Submit, initial retrieval, and polling share terminal-result ingestion. A locally completed
  all-incompatible run replaces the displayed cards immediately, records zero token usage and
  `providerCalled: false`, and has no returned model. A pending newer run preserves the previous
  completed result until its own completion.
- Exact selections are extracted as a contiguous range of the canonical evaluation string rather
  than by joining non-empty fragments. Empty paragraphs and separators are retained; partial edge
  blocks, nested lists/quotes, hard breaks, emoji, decomposed Vietnamese combining marks, and UTF-16
  offsets stay exact. Incomplete or unsupported mappings fail closed. Nearby context uses the same
  canonical start/end offsets, so the target is neither duplicated nor omitted.

The CI matrix continues to run formatting, lint, typecheck, unit/integration tests, and build on
Ubuntu, macOS, and Windows. Chromium plus its OS dependencies and the Playwright suite run once on
the Ubuntu job rather than on every platform.

### Correctness verification

The pass was verified without TypeSafe credentials or the paid live-smoke command:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`

Focused development runs additionally covered the web hook/component tests, core canonical-range
tests, server idempotency/invocation tests, and `e2e/writing-evaluation.spec.ts`. Browser races use
delayed or dropped mocked responses rather than sleeps or remote-provider access.

## J3 research workflow — 2026-09-22

- Evaluation history paginates run summaries and opens saved source/context and rubric revisions.
  Selecting history is separate from preparing or submitting a new evaluation; saved offsets are
  not attached to the current editor. The latest result remains available through an explicit button.
- Per-criterion feedback records an explicit verdict, optional preferred level, and comment up to
  2,000 characters. The server requires a completed run and validates against that run's saved
  rubric, including criteria subsequently removed from the live rubric. Saving feedback updates
  only the feedback row; missing optional fields clear prior values. No feedback is inferred.
- Migration `0004_loud_sunfire.sql` adds `writing_evaluation_feedback`, keyed by run and criterion.
  Run/document/local-data deletion cascades to feedback. Existing migrations and runs are retained.
- `GET /v1/evaluations/:runId/feedback` retrieves saved author feedback;
  `PUT /v1/evaluations/:runId/feedback/:criterionId` validates and saves it.
  `GET /v1/evaluations/:runId/export` returns a versioned JSON attachment with immutable inputs,
  compiled request, model/result/usage provenance, saved display policy, and separate feedback.
  The UI warns that source text, context, rubric, and saved comments are included.
- `pnpm eval:jev` runs versioned paired synthetic fixtures through the existing compiler,
  adapter, and display policy. All inputs are preflighted, remote use requires explicit opt-in,
  and the first failure stops the batch. Outputs are versioned JSONL under ignored `data/`.
  See `docs/JEV-PILOT.md` for the eight pairs, worksheet, schema, and interpretation limits.

Model assessments, mock fixtures, and author feedback retain distinct provenance for later
research. None are automatically accepted as ground truth or sent into training.

### J3 verification

Local verification on 2026-09-22 passed `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and `pnpm build`. The browser suite covered ten scenarios; the J3 cases were also
rerun after the historical-feedback preservation fix and visual check. Coverage includes delayed
history responses, a new evaluation completing while old-run feedback is unsaved, feedback
persistence across reload, export of the old rubric revision, and disabled autocomplete.
One existing platform-dependent server test remains skipped in this environment.

The command-line mock pilot completed 16/16 evaluations across eight English/Vietnamese pairs,
with zero failures or unattempted cases. Its local artifact is
`data/evaluations/j3-mock-validation.jsonl` (ignored by Git). These results verify integration only.
No live TypeSafe pilot, training job, hosted CI run, commit, or push was performed for J3.

### Follow-up live article test

After J3 implementation, the separately requested [September 22 article-scope test](reports/jev-article-scopes-2026-09-22.md)
completed five real `jev-1.13.0` requests through the browser: sentence and paragraph selections
with/without nearby context, and the complete article. It used one synthetic article and the same
four-criterion saved rubric, consumed 9,877 input and 2,139 output tokens, and retained the exact
exports and application history. This is a small exploratory behavior observation, not training
validation. No retries or further live runs were made.

## Autocomplete disabled by default

`COMPLETION_ENABLED=false` now suppresses model warmup, editor suggestions (including dictionary
suggestions), and completion inference. `/v1/model-status` reports `disabled`, and the stream route
returns `COMPLETION_DISABLED` before touching model-run or training-trace state. Critic and evaluator
configuration remain independent. Set `COMPLETION_ENABLED=true` and restart to restore completion;
existing completion regression suites explicitly opt in.

## Remaining boundaries

Automatic evaluation, issue/critic handoff, extra MCP tools, model training, and document mutation
remain outside the POC boundary.
