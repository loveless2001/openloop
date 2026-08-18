# OpenLoop

OpenLoop is a local-first, stateful LLM co-writer harness. This repository currently implements
Phases 0–3 from `openloop-cowriter-harness-spec.md`: workspace and persistence, editor
persistence, inline completion, and the critic issue ledger. The current iteration also adds a
Markdown-first file workflow and production OpenAI autocomplete configuration.

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

## Start locally

```bash
# macOS/Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env

pnpm install
pnpm db:migrate
pnpm dev
```

Open <http://127.0.0.1:5173>. The web application proxies `/v1` requests to the API at
<http://127.0.0.1:8787>. `GET /v1/health` returns `{"status":"ok"}`.

The default configuration uses the deterministic mock provider and requires no external API.
Local state is stored in `data/openloop.db`, which is excluded from Git. The browser remembers the
current document ID in local storage, reloads it on startup, and creates a blank document when no
saved document exists.

## Inline completion

With the editor focused, type at least three non-whitespace characters at the end of a paragraph,
heading, or blockquote and pause for 300 ms. The deterministic mock provider streams a completion
as ghost text without changing the document.

- `Tab` accepts the full completion.
- `ArrowRight` accepts one word and leaves the remainder visible.
- `Escape` dismisses it.
- Typing, moving the cursor, changing the prefix, or starting IME composition invalidates the
  active request.

For real autocomplete with OpenAI, copy `.env.openai.example` to `.env`, set
`OPENAI_API_KEY`, and restart the server. The production defaults are `gpt-5.6-luna` for fast,
low-reasoning completion and `gpt-5.6-terra` for the smarter critic. The key remains server-side,
and the header reports the active provider and fast model. Account model access can vary.

To use another OpenAI-compatible endpoint instead, set `MODEL_PROVIDER=openai-compatible`,
`MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_FAST`, `MODEL_SMART`, and
`MODEL_SUPPORTS_JSON_SCHEMA`. The same adapter boundary supports both paths.

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
