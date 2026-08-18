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
