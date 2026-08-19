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

Autocomplete and criticism select independent adapters. The default completion provider is local
Ollama with the installed `qwen2.5:0.5b` model; its 398 MB footprint is appropriate for frequent,
short, latency-sensitive suggestions. The default critic remains deterministic mock. An optional
OpenAI or compatible smart critic can therefore inspect changed blocks without becoming a hard
dependency for autocomplete. Configuration uses explicit `COMPLETION_*` and `CRITIC_*` variables;
there is no shared or legacy provider path.

## 014 — Make local model readiness part of application boot

`pnpm setup:ollama` installs the configured Ollama model, while normal server boot manages the serving
process. A local Ollama endpoint is probed, started when absent, checked for the configured model,
and warmed before Fastify reports readiness. OpenLoop terminates Ollama only when it owns the child
process. This makes `pnpm dev` self-starting without hiding model downloads inside routine boot.

## 015 — Capture training data only through explicit local opt-in

The normal completion-event path remains metadata-only. `CAPTURE_TRAINING_TRACES=true` separately
enables append-only JSONL containing raw cursor context, model output, and interaction outcomes.
Candidate and feedback records share a request ID so partial acceptance remains reconstructable.
The default path is ignored local storage, and live online weight updates are deliberately excluded;
training is an offline, reviewable operation.

## 016 — Separate model environment from writer preferences

Provider selection, endpoints, credentials, model IDs, local-model residency, and diagnostic
capture remain server-owned `.env` configuration. Writer-facing behavior belongs to a versioned
browser-local settings profile that can be edited without restarting: autocomplete and autosave
delays plus independently enabled critic idle, paragraph, heading, and accumulated-word triggers.
The critic waits 10 seconds at idle and triggers at 250 newly added words by default. This keeps
secrets out of the browser while making interaction timing a user preference rather than deployment
configuration.

## 017 — Put deterministic personal vocabulary before model completion

Names, terminology, recurring phrases, and shortcut expansions are deterministic user preferences,
not model knowledge. They live with browser-local app settings and are matched synchronously before
Qwen is called. Plain entries append only the unmatched suffix; `shortcut => replacement` entries
replace the exact shortcut only after acceptance. Rejecting the dictionary result suppresses it for
that unchanged context and falls through to Qwen. This keeps lexical completions immediate and
private while reserving the model for contextual clause and sentence generation.

## 018 — Keep autocomplete adaptation offline and non-executing by default

Training-data contracts, deterministic compilation, experiment plans, and evaluation gates live in
a separate `@openloop/training` package. Trace capture remains explicit local opt-in, all generated
datasets and artifacts are ignored, and stage plans carry `executionEnabled: false`. Replacement
capture, natural-continuation sampling, trainers, conversion, model registration, and deployment are
not activated by this architecture slice. This makes later CPT, continuation SFT, and preference
experiments reviewable without coupling routine application boot to weight updates.

## 019 — Manage one fixed Linux critic CLI session

The initial no-API-key critic process uses a fixed `openloop-critic` tmux session on Linux. The
server, not the browser, selects the `.env`-configured Codex or Claude executable. The worker runs
in a private temporary directory rather than the Git workspace, and Codex startup update checks are
disabled so update and repository-trust prompts cannot create a false-ready worker. Launch is
detached and idempotent, status is obtained from tmux, and the UI publishes
`tmux attach -t openloop-critic` for authentication or inspection. The CLI continues to own its
credentials. Codex preapproves only the explicit seven-tool OpenLoop MCP allowlist while retaining
its read-only sandbox; global approval and sandbox bypass is not used. The browser cannot supply a
command, arguments, MCP URL, or token.

## 020 — Give the CLI bounded ledger context through leased MCP jobs

`CRITIC_PROVIDER=cli-agent` adapts the existing critic interface to an in-memory reverse-MCP broker.
The agent can claim one job, submit zero to three validated candidates, or fail the lease. Jobs
contain changed blocks and the same relevant open-issue subset used by API-backed critics; there is
no general ledger read or write tool. A random mode-0600 bearer token under ignored local data
protects the loopback endpoint and remains stable across server restarts; a separate random token
binds every submission to its active job lease. The server rejects stale document versions and
remains solely responsible for filtering, anchoring, deduplication, and persistence.

## 021 — Use explicit selections as the shared review scope

Manual critique and accepted autocomplete text use one editor selection representation: exact
stable-node snapshots, source, character offsets, and word count. A selection job supersedes queued
automatic work for that document, while server-side anchor and document-version checks remain
unchanged. The browser warns above a writer-configurable 1,000-word default but permits explicit
confirmation. Interactive critic adapters receive a bounded context-provider callback; the CLI
exposes it as a lease-authenticated MCP tool limited to two requests of six neighboring blocks per
side. This supports clarification without granting general document or ledger access.

## 022 — Make issue chat persisted, singular, floating, and reset at issue boundaries

The browser has exactly one current issue chat in a floating workspace window rather than the ledger
layout. Collapsing it preserves that current issue; selecting a different issue switches the chat and
sends `/clear` to the authenticated CLI before any new turn. All CLI work passes through one
serialized coordinator, so a reset cannot be inserted between claim and submission. Thread state
(`idle`, waiting on either participant, or error) is separate from issue status, and only explicit
writer actions change the issue lifecycle. Messages and selected-text
attachments are persisted in SQLite; each CLI turn receives the issue plus at most twenty saved
messages. This makes the database authoritative, prevents hidden context from leaking across issues,
and lets an automatic critique temporarily use the same CLI without losing the visible conversation.
