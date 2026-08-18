# Architecture

This document describes the implemented Phase 0–3 slice only.

The browser owns the TipTap editor, stable node IDs, changed-node tracking, dirty state, and
autosave scheduling. It sends canonical TipTap JSON, derived text, a base version, and an
accumulated `EditorChangeBatch` to the Fastify API after 750 ms of inactivity.

The browser also owns completion eligibility, debounce, request cancellation, staleness checks,
and the ProseMirror ghost-text decoration. Completion text remains outside TipTap JSON until the
writer accepts it. The frontend sends provider-neutral completion requests and metadata-only
interaction events; it contains no provider credentials or provider-specific protocol code.

The browser separately accumulates meaningful changed blocks for critique. Idle, paragraph-end,
heading-created, and manual triggers submit that bounded context after autosave. It consumes critic
SSE events with capped reconnect backoff and polling fallback, renders issue anchors through
ProseMirror decorations, and keeps issue filters, selection, and history in React state rather than
inside the editor extension.

The server owns environment validation, document persistence, and version arbitration. It parses
every JSON boundary with Zod, regenerates `plainText` from canonical TipTap JSON, and performs a
conditional update against `baseVersion`. A stale save returns `DOCUMENT_VERSION_CONFLICT` with
the current server version and never overwrites the local draft.

SQLite lives under `data/` by default. Drizzle defines the complete baseline database schema from
the specification so later vertical slices can add behavior without replacing persistence. Phase
3 uses `documents`, `model_runs`, `issues`, and append-only `issue_events`; preference weights
remain unused until Phase 5.

The `packages/model-adapters` boundary owns the provider-neutral model interface, deterministic
mock implementation, and OpenAI-compatible implementation.

The server selects one `ModelAdapter` at startup. `/v1/completions/stream` hashes request context,
persists model-run metadata, and emits provider-neutral SSE `delta`, `done`, or `error` events. The
mock adapter is deterministic. The OpenAI-compatible adapter owns provider request formatting,
stream parsing, timeouts, JSON-schema handling, and one repair attempt for malformed structured
outputs.

Critic jobs use a bounded in-process queue with at most one active job per document and at most
three queued jobs globally. Pending jobs for one document merge changed blocks by stable node ID.
The server filters low-confidence candidates, verifies exact quotes against both submitted changes
and canonical saved TipTap JSON, deterministically deduplicates them, and persists validated issues.
All issue actions pass through the pure `transitionIssue` state machine and append their event in
the same SQLite transaction. Apply rewrite returns a validated editor operation; the server never
mutates document JSON on the model's behalf.
