# Decisions

## 001 — Resolve relative database URLs from the workspace root

`DATABASE_URL=file:./data/openloop.db` resolves from the directory containing
`pnpm-workspace.yaml`, regardless of whether a command starts at the repository root or inside
`apps/server`. This keeps the specified `data/` location stable under pnpm filtering and tests.

## 002 — Treat TipTap JSON as canonical on the server

The save request includes `plainText` as specified, but the server regenerates it from validated
TipTap JSON before persistence. This enforces the canonical-content rule and prevents a stale or
incorrect client-derived search field from being stored.

## 003 — Keep the first occurrence of a duplicate node ID

When a transaction contains duplicate paragraph, heading, or blockquote IDs, the first document
occurrence keeps its ID and later occurrences receive fresh UUIDs. This makes a split preserve the
left block and makes same-document paste deterministic without special clipboard state.

## 004 — Persist one browser-selected document

Phase 1 stores the active document ID in browser local storage. Startup loads that document or
creates one blank document when it is missing. A version conflict fetches the latest server
version for evidence but retains the unsaved local draft and does not auto-merge.

## 005 — Use the complete initial migration without later-phase behavior

Phase 0 requires SQLite migrations and the specification fixes five baseline tables. The initial
migration therefore creates all five tables and required indexes. Phase 1 reads and writes only
`documents`; no model, issue, scheduler, reconciliation, export, or preference behavior is
implemented early.

## 006 — Use SSE for completion streaming

The preferred protocol in the specification is used: `POST /v1/completions/stream` returns SSE
`delta`, `done`, and `error` events. The browser parses this provider-neutral stream, so switching
model providers remains a server configuration change.

## 007 — Keep prompt versions in structured model-run logs

The fixed `model_runs` schema has no `prompt_version` column. Phase 2 preserves that schema and
includes `promptVersion` in structured start/finish log metadata while persisting the specified
provider, model, input hash, latency, status, and error code. No prompt or document text is logged.

## 008 — Record completion interactions as metadata-only structured events

The database specification defines an append-only table for issue events but no completion-event
table. The browser therefore posts requested, shown, accepted, dismissed, stale, and error events
to a metadata-only server endpoint. The server records them as structured logs without document or
completion text. This avoids inventing an unrequested persistence table while retaining an
observable harness event stream.

## 009 — Use a bounded in-process critic queue

Phase 3 uses a minimal in-process queue rather than adding another dependency. It enforces one
active critic job per document, merges pending snapshots by stable node ID, caps the global pending
queue at three jobs, and never cancels in-flight critique. The queue emits provider-neutral critic
events through a document-scoped SSE broker.

## 010 — Validate model anchors against canonical saved content

A critic candidate is eligible only when its quote occurs in a submitted changed block and in the
same stable node in saved TipTap JSON. Anchor offsets and surrounding context are derived from the
canonical saved node. This keeps the model advisory and prevents client or model output from
creating an anchor that the persisted document cannot support.

## 011 — Keep applied rewrites open until reconciliation

Apply rewrite validates the current persisted quote and returns a node-relative editor operation.
It appends `apply_rewrite` history but does not mark the issue resolved. Phase 4 reconciliation will
decide whether the resulting edit actually resolves, invalidates, or preserves the objection.

## 012 — Use Markdown at the file boundary and TipTap JSON for anchors

Writers open and download Markdown, and toolbar operations map to Markdown-compatible structure.
Internally, TipTap JSON remains canonical because the critic ledger anchors to persistent block IDs
that Markdown does not represent. Import assigns fresh stable IDs; download serializes document
content and deliberately omits IDs and issue metadata. This preserves the issue lifecycle while
providing a normal Markdown workflow.

## 013 — Give autocomplete a dedicated lightweight production model

`MODEL_PROVIDER=openai` is a first-class configuration rather than an undocumented generic
endpoint recipe. It defaults completion to `gpt-5.6-luna`, sends Chat Completions streaming with
`reasoning_effort: none`, and keeps the smart critic independently configurable as
`gpt-5.6-terra`. The deterministic mock remains the default in `.env.example` so a fresh clone is
runnable without credentials; `.env.openai.example` is the production-model template. Generic
OpenAI-compatible endpoints retain the legacy token parameter for broader compatibility.
