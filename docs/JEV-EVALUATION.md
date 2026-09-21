# Writing rubric evaluation — J0–J2 implementation map

This document records the J0 inspection, J1 mock-backed vertical slice, and J2 native transport. The J milestones are
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

## Deferred explicitly

J3 history navigation, feedback, export, and pilot tooling are absent.
Automatic evaluation, issue/critic handoff, extra MCP tools, model training, and document mutation
remain outside the POC boundary.
