# Architecture

This document describes the implemented Phase 0–3 slice plus the current Markdown/file workflow.

The browser owns the TipTap editor, stable node IDs, changed-node tracking, dirty state, and
autosave scheduling. It sends canonical TipTap JSON, derived text, a base version, and an
accumulated `EditorChangeBatch` to the Fastify API after the writer-configured autosave delay.

The official TipTap Markdown bridge parses opened `.md` files and serializes downloads. Markdown
is the user-facing file format, while TipTap JSON remains the internal anchor-preserving format.
Imported blocks receive fresh stable IDs; exported files omit IDs and issue metadata.

The browser also owns completion eligibility, debounce, request cancellation, staleness checks,
and the ProseMirror ghost-text decoration. Completion text remains outside TipTap JSON until the
writer accepts it. The frontend sends provider-neutral completion requests and metadata-only
interaction events; it contains no provider credentials or provider-specific protocol code.

Before starting a model request, the completion controller checks a browser-local personal
dictionary. Partial names, terms, and phrases append their unmatched suffix; exact shortcuts replace
the shortcut on acceptance. Explicit rejection suppresses that dictionary candidate for the current
context and allows the normal Qwen debounce and request path to proceed.

The browser separately accumulates meaningful changed blocks and newly added word counts for
critique. Configurable idle, paragraph-end, heading-created, word-threshold, and manual triggers
submit that bounded context after autosave. A non-empty ProseMirror selection instead produces exact
node-anchored selection snapshots and a focused manual job. Full autocomplete acceptance selects
the inserted range and uses the same selection toolbar. The default idle delay is 10 seconds, the
default word threshold is 250, and selections over 1,000 words require confirmation. Writer-facing
settings persist as a versioned browser-local profile and take effect without restarting; provider
and model configuration remains server-owned in `.env`. The
browser consumes critic SSE events with capped reconnect backoff and polling fallback, renders issue
anchors through ProseMirror decorations, and keeps issue filters, selection, and history in React
state rather than inside the editor extension.

The server owns environment validation, document persistence, and version arbitration. It parses
every JSON boundary with Zod, regenerates `plainText` from canonical TipTap JSON, and performs a
conditional update against `baseVersion`. A stale save returns `DOCUMENT_VERSION_CONFLICT` with
the current server version and never overwrites the local draft.

SQLite lives under `data/` by default. Drizzle defines the complete baseline database schema from
the specification so later vertical slices can add behavior without replacing persistence. Phase
3 uses `documents`, `model_runs`, `issues`, and append-only `issue_events`. Issue conversations add
one thread per issue plus ordered `issue_chat_messages`; preference weights remain unused until
Phase 5.

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

The CLI critic is a tmux-backed macOS/Linux reverse-MCP worker; Windows users can run this optional
mode inside WSL. The server exposes status and idempotent launch
endpoints for one fixed `openloop-critic` tmux session. The configured `codex` or `claude`
executable is resolved on the server; neither its command nor tmux arguments can be supplied by the
browser. The process runs in a private temporary runtime directory rather than the Git checkout,
since its only document access is the bounded MCP bridge. Codex startup update checks are disabled
to prevent an interactive update prompt from blocking job claims. Codex receives the loopback MCP
URL through CLI config
overrides, an explicit seven-tool allowlist, and per-server MCP preapproval; it retains the read-only
sandbox. Its ephemeral bearer token arrives through an environment variable. Claude receives a
mode-0600 MCP config under ignored `data/`, loads it with strict MCP isolation, removes built-in
tools, and preapproves only the seven OpenLoop tools. User/project settings sources, hooks,
auto-memory, Git instructions, and Chrome integration are disabled for this managed Claude session.
The random bridge bearer token is also mode 0600 and
persists locally so an existing fixed tmux session remains valid across server restarts. Both CLIs
retain their normal local login and credential storage.

`CliCriticAdapter` places provider-neutral `CriticInput` objects into an in-memory broker. One CLI
coordinator serializes document critiques and issue-chat turns before waking tmux, so automatic
review cannot interleave with a user conversation. The MCP endpoint supports leased claim,
bounded-context, submit, and fail tools for document critique plus separate leased claim, reply, and
fail tools for issue chat. The worker claims exactly one job per wake. Unknown, expired, or
mismatched leases are rejected. Critique jobs contain only focused blocks and server-selected
relevant open issues. If neighboring prose is required to disambiguate the focus, the
adapter-neutral context-provider boundary lets the CLI request at most two windows of six blocks per
side. The browser polls process and bridge states but never receives the MCP bearer token.

Each issue has a persisted conversation whose state is independent of issue status. The browser
keeps exactly one current issue chat in a floating workspace window, which may be expanded or
collapsed without consuming ledger space. Selecting a different issue queues `/clear` through the
serialized coordinator before that issue can send a turn; opening or expanding the same issue does
not reset it. If an automatic document critique runs while a chat
remains current, the coordinator clears the chat context first and replays at most the latest twenty
persisted messages when the next chat turn begins. The database, rather than hidden CLI state, is
therefore authoritative. Highlighted editor text becomes a removable message attachment and is not
sent until the writer submits. The critic may return a normal reply or a focused clarification
request, but only the writer-facing status controls can resolve, dismiss, snooze, or reopen an issue.

Critic results still return through the existing adapter boundary. The server rechecks document
version after the CLI responds, validates exact anchors against canonical content, filters and
deduplicates candidates, and alone persists issue-ledger changes. Thus the CLI has ledger awareness
without ledger authority.

Optional training capture sits behind `CAPTURE_TRAINING_TRACES`. When disabled, completion events
remain metadata-only. When explicitly enabled, the server appends raw candidate context and
interaction outcomes to local trace-v2 JSONL as candidate-ID-linked records. Trace I/O is
serialized, flushed during shutdown, and never changes completion delivery when capture fails.
The separate `@openloop/training` package owns trace and dataset contracts, deterministic offline
compilation, content-hashed manifests, inert experiment plans, and deployment gate evaluation. It
does not contain a trainer or deployment actuator; its plan manifests explicitly disable execution.

For a local Ollama endpoint, server readiness includes the model runtime. Startup reuses an
existing Ollama server or launches `ollama serve`, verifies that the configured completion model is
installed, and completes a no-output warm-up before Fastify begins listening. The server records
process ownership and stops Ollama on shutdown only when it launched that process. Model downloads
remain the explicit responsibility of `pnpm setup:ollama`.

Critic jobs use a bounded in-process queue with at most one active job per document and at most
three queued jobs globally. Pending jobs for one document merge changed blocks by stable node ID.
Focused selection jobs supersede a queued automatic job and are not swallowed by a running
automatic review.
The server filters low-confidence candidates, verifies exact quotes against both submitted changes
and canonical saved TipTap JSON, deterministically deduplicates them, and persists validated issues.
All issue actions pass through the pure `transitionIssue` state machine and append their event in
the same SQLite transaction. Apply rewrite returns a validated editor operation; the server never
mutates document JSON on the model's behalf.
