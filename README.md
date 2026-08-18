# OpenLoop

OpenLoop is a local-first, stateful LLM co-writer harness. This repository currently implements
Phase 0 (workspace and persistence scaffold) and Phase 1 (editor persistence) from
`openloop-cowriter-harness-spec.md`.

The current vertical slice provides a TipTap editor with persistent paragraph, heading, and
blockquote node IDs; a changed-node accumulator; debounced autosave; optimistic document
versions; local SQLite persistence; and visible dirty, saving, conflict, and error states. Model
completion, criticism, issue memory, reconciliation, resurfacing, and export belong to later
phases and are intentionally not implemented.

## Requirements

- Node.js 20 or newer
- pnpm 10

## Start locally

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev
```

Open <http://127.0.0.1:5173>. The web application proxies `/v1` requests to the API at
<http://127.0.0.1:8787>. `GET /v1/health` returns `{"status":"ok"}`.

The default configuration uses the mock provider, but Phase 1 does not make model calls. Local
state is stored in `data/openloop.db`, which is excluded from Git. The browser remembers the
current document ID in local storage, reloads it on startup, and creates a blank document when no
saved document exists.

## Verification

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

The Phase 0/1 tests cover shared request schemas, TipTap-to-plain-text derivation, stable node IDs,
changed-node accumulation, migration creation, the health endpoint, document create/load/save,
and stale-version rejection. The Playwright workflow is reserved for the later MVP completion
phase, so `pnpm test:e2e` is present as the specified repository command but has no Phase 1 test.

## Workspace

```text
apps/web                 React, Vite, and TipTap client
apps/server              Fastify API, SQLite, Drizzle schema, and migrations
packages/core            Provider-independent document behavior
packages/model-adapters  Reserved fixed boundary; implementation starts in Phase 2
packages/shared          Zod network/process schemas and shared types
docs                     Architecture and implementation decisions
data                     Local SQLite files (ignored)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the implemented runtime boundaries and
[docs/DECISIONS.md](docs/DECISIONS.md) for Phase 0/1 choices.
