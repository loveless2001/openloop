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

## Markdown files and toolbar

The editor uses TipTap's Markdown parser/serializer while retaining internal TipTap JSON and stable
node IDs for issue anchoring. The File menu supports New, Open Markdown, Save locally, and Download
Markdown. `Ctrl/Cmd+N`, `Ctrl/Cmd+O`, and `Ctrl/Cmd+S` provide the same operations. Opening a file
creates a new locally persisted document; it does not overwrite the previous document.

The compact toolbar applies Markdown-compatible bold, italic, inline code, headings, lists, and
blockquote formatting. Downloaded `.md` files contain document content only; internal node IDs and
issue comments are not included.

## Critic and issue ledger

Meaningful changed blocks are queued for critique after 1,800 ms idle. Pressing Enter after a
non-empty paragraph or creating a heading requests critique sooner; **Critique now** analyzes the
currently accumulated changed blocks, including short passages. The server sends only changed
blocks and immediate context to the configured smart model.

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
