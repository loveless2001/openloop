# OpenLoop

OpenLoop is a local-first, stateful LLM co-writer harness. This repository currently implements
Phases 0–3 from `openloop-cowriter-harness-spec.md`: workspace and persistence, editor
persistence, inline completion, and the critic issue ledger. The current iteration also adds a
Markdown-first file workflow and small-model local autocomplete through Ollama.

The current vertical slice provides a TipTap editor with persistent paragraph, heading, and
blockquote node IDs; a changed-node accumulator; debounced autosave; optimistic document
versions; local SQLite persistence; streamed ghost-text completion; queued changed-block critique;
anchored gutter markers; persistent issue actions and history; and visible dirty, saving, conflict,
and error states. Markdown files can be opened and downloaded from the File menu. Anchor
reconciliation, resurfacing, and the formal unresolved-issue export review belong to later phases
and are intentionally not implemented.

## Requirements

- Node.js 20 or newer
- pnpm 10
- Ollama with `qwen2.5:0.5b` for the default local autocomplete path

## Start locally

```bash
# macOS/Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env

pnpm install
pnpm setup:ollama
pnpm db:migrate
pnpm dev
```

Open <http://127.0.0.1:5173>. The web application proxies `/v1` requests to the API at
<http://127.0.0.1:8787>. `GET /v1/health` returns `{"status":"ok"}`.

The default configuration uses the 398 MB `qwen2.5:0.5b` model through Ollama for autocomplete and
the deterministic mock for criticism, so document text does not leave the machine. Local state is
stored in `data/openloop.db`, which is excluded from Git. The browser remembers the current
document ID in local storage, reloads it on startup, and creates a blank document when no saved
document exists.

`pnpm setup:ollama` verifies that the `ollama` command is installed, temporarily starts a local Ollama
server when necessary, and pulls the configured completion model if it is missing. It reads
`COMPLETION_PROVIDER`, `COMPLETION_BASE_URL`, and `COMPLETION_MODEL` from `.env`.

Starting OpenLoop owns the remaining runtime lifecycle. Server boot probes Ollama, launches
`ollama serve` when the configured local endpoint is unavailable, verifies the model, warms it, and
only then exposes the API as ready. Shutdown stops Ollama only when OpenLoop started that process;
an Ollama instance that was already running is left untouched.

## Inline completion

With the editor focused, type at least three non-whitespace characters at the end of a paragraph,
heading, or blockquote and pause for 300 ms. The local Ollama model streams a completion as ghost
text without changing the document.

- `Tab` accepts the full completion.
- `ArrowRight` accepts one word and leaves the remainder visible.
- `Escape` dismisses it.
- Typing, moving the cursor, changing the prefix, or starting IME composition invalidates the
  active request.

The complete streamed suggestion remains visible as ghost text. A compact action hint beside it
offers clickable Accept and Reject controls with `Tab` and `Esc` tooltips; `ArrowRight` remains the
one-word acceptance shortcut.

The browser-local personal dictionary runs before the model. Add plain names, terms, or frequent
phrases in **Settings**, one per line, to complete them from a partial suffix. Add abbreviation
expansions as `shortcut => replacement`; accepting replaces the shortcut. Rejecting a dictionary
suggestion falls through to Qwen for the same editor context.

Completion and criticism have separate provider settings. The default `.env.example` routes only
completion to `http://127.0.0.1:11434/v1` with `COMPLETION_PROVIDER=ollama` and
`COMPLETION_MODEL=qwen2.5:0.5b`. Use `COMPLETION_PROVIDER=mock` if you want the deterministic test
completion instead. The header reports the active autocomplete model.

The server warms the model without generating text, then uses Ollama's native streaming API with a
fixed 2K context for every suggestion. `COMPLETION_KEEP_ALIVE=30m` keeps the model resident between
typing bursts and can be increased on a dedicated workstation. See
[the local benchmark](docs/OLLAMA-BENCHMARK.md) for cold-start, steady-state, and end-to-end
measurements.

The critic can remain mocked or use an independent OpenAI/OpenAI-compatible backend. Copy
`.env.openai.example` to pair local autocomplete with an OpenAI critic, set `CRITIC_API_KEY`, and
restart the server. Generic backends use `CRITIC_PROVIDER=openai-compatible` plus
`CRITIC_BASE_URL`, `CRITIC_API_KEY`, `CRITIC_MODEL`, and
`CRITIC_SUPPORTS_JSON_SCHEMA`. Provider credentials remain server-side.

Model selection, endpoints, credentials, local model residency, and diagnostic capture remain
authoritative in `.env`. Writer-facing timing and automatic-trigger preferences are configured
through **Settings** in the application and persist in browser local storage without a restart.

## Opt-in local training traces

Set `CAPTURE_TRAINING_TRACES=true` to capture raw completion context, generated suggestions, and
accept/reject outcomes as append-only local JSONL. Capture is off by default and the trace path is
under ignored `data/` storage. See [docs/TRAINING-TRACES.md](docs/TRAINING-TRACES.md) for the schema,
privacy boundary, and [the staged training plan](docs/AUTOCOMPLETE-TRAINING-PIPELINE.md) for the
recommended offline Qwen adaptation workflow.

## Offline training architecture

The `@openloop/training` workspace package provides versioned trace/dataset schemas, a deterministic
local compiler, inert stage manifests, and deployment gate evaluation. It does not download models,
run training, convert checkpoints, register Ollama models, or alter the app's configured model.

```bash
# Compile opted-in traces and an explicitly approved local corpus.
pnpm training:compile -- --config training/configs/personal-qwen.example.json

# Write a reviewable CPT plan. The manifest always has executionEnabled: false.
pnpm training:plan -- --config training/configs/personal-qwen.example.json \
  --stage cpt \
  --dataset-manifest data/training/compiled/personal-qwen-v1/manifest.json \
  --output data/training/plans/cpt.json

# Evaluate recorded candidate metrics against a frozen baseline.
pnpm training:gate -- --config training/configs/personal-qwen.example.json \
  --baseline data/training/eval/baseline.json \
  --candidate data/training/eval/candidate.json \
  --output data/training/eval/gate-report.json
```

See [training/README.md](training/README.md) for input contracts, outputs, and the deliberate
activation boundary.

## Markdown files and toolbar

The editor uses TipTap's Markdown parser/serializer while retaining internal TipTap JSON and stable
node IDs for issue anchoring. The File menu supports New, Open Markdown, Save locally, and Download
Markdown. `Ctrl/Cmd+N`, `Ctrl/Cmd+O`, and `Ctrl/Cmd+S` provide the same operations. Opening a file
creates a new locally persisted document; it does not overwrite the previous document.

The compact toolbar applies Markdown-compatible bold, italic, inline code, headings, lists, and
blockquote formatting. Downloaded `.md` files contain document content only; internal node IDs and
issue comments are not included.

## Critic and issue ledger

Meaningful changed blocks are queued for critique after 10 seconds idle by default. Completing a
non-empty paragraph, creating a heading, or accumulating 250 new words can request critique sooner;
**Critique now** analyzes the currently accumulated changed blocks, including short passages. Open
**Settings** to enable or disable each automatic trigger, choose an idle delay from 10 seconds to 5
minutes, change the word threshold, and tune autocomplete and autosave delays. The server sends only
changed blocks and immediate context to the configured smart model.

The deterministic mock critic creates an ambiguity issue when changed text contains
`any model will work equally well`. The first issue opens in the right-hand ledger and receives a
keyboard-focusable gutter marker. Select an issue to inspect its anchor, rationale, and history,
then choose Apply rewrite, Later, Dismiss, or Resolve. Issue state and events survive refresh.

## Verification

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

The focused tests cover shared request schemas, document persistence, stable node IDs,
changed-node accumulation, model adapter validation and cancellation, completion SSE, ghost-text
acceptance/dismissal/staleness, issue state transitions, critic filtering/deduplication, persistent
actions/history, and gutter rendering. The Playwright workflow is reserved for Phase 6, so
`pnpm test:e2e` is present as the specified repository command but does not yet have an end-to-end
browser test.

## Workspace

```text
apps/web                 React, Vite, and TipTap client
apps/server              Fastify API, SQLite, Drizzle schema, and migrations
packages/core            Provider-independent document behavior
packages/model-adapters  Provider-neutral model interface and implementations
packages/shared          Zod network/process schemas and shared types
docs                     Architecture and implementation decisions
data                     Local SQLite files (ignored)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the implemented runtime boundaries and
[docs/DECISIONS.md](docs/DECISIONS.md) for Phase 0–3 choices.
