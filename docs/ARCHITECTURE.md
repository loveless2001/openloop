# Architecture

This document describes the implemented Phase 0–3 slice plus the current Markdown/file workflow.

The browser owns the TipTap editor, stable node IDs, changed-node tracking, dirty state, and
autosave scheduling. It sends canonical TipTap JSON, derived text, a base version, and an
accumulated `EditorChangeBatch` to the Fastify API after 750 ms of inactivity.

The official TipTap Markdown bridge parses opened `.md` files and serializes downloads. Markdown
is the user-facing file format, while TipTap JSON remains the internal anchor-preserving format.
Imported blocks receive fresh stable IDs; exported files omit IDs and issue metadata.

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
mock implementation, and Ollama/OpenAI-compatible implementation.

The server selects separate completion and critic adapters at startup.
`/v1/completions/stream` hashes request context, persists model-run metadata, and emits
provider-neutral SSE `delta`, `done`, or `error` events. By default, autocomplete calls Ollama's
native streaming API with `qwen2.5:0.5b`, a fixed 2K context, and a configurable keep-alive; the
critic remains deterministic mock. A
smart OpenAI or compatible critic can be enabled independently without moving autocomplete or its
keystroke context off-machine. The dedicated Ollama adapter owns low-latency completion and model
residency, while the compatible critic adapter owns request formatting, timeouts, JSON-schema
handling, and one repair attempt for malformed structured outputs.

For a local Ollama endpoint, server readiness includes the model runtime. Startup reuses an
existing Ollama server or launches `ollama serve`, verifies that the configured completion model is
installed, and completes a no-output warm-up before Fastify begins listening. The server records
process ownership and stops Ollama on shutdown only when it launched that process. Model downloads
remain the explicit responsibility of `pnpm setup:ollama`.

Critic jobs use a bounded in-process queue with at most one active job per document and at most
three queued jobs globally. Pending jobs for one document merge changed blocks by stable node ID.
The server filters low-confidence candidates, verifies exact quotes against both submitted changes
and canonical saved TipTap JSON, deterministically deduplicates them, and persists validated issues.
All issue actions pass through the pure `transitionIssue` state machine and append their event in
the same SQLite transaction. Apply rewrite returns a validated editor operation; the server never
mutates document JSON on the model's behalf.
