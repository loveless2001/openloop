# Architecture

This document describes the implemented Phase 0/1 slice only.

The browser owns the TipTap editor, stable node IDs, changed-node tracking, dirty state, and
autosave scheduling. It sends canonical TipTap JSON, derived text, a base version, and an
accumulated `EditorChangeBatch` to the Fastify API after 750 ms of inactivity.

The server owns environment validation, document persistence, and version arbitration. It parses
every JSON boundary with Zod, regenerates `plainText` from canonical TipTap JSON, and performs a
conditional update against `baseVersion`. A stale save returns `DOCUMENT_VERSION_CONFLICT` with
the current server version and never overwrites the local draft.

SQLite lives under `data/` by default. Drizzle defines the complete baseline database schema from
the specification so later vertical slices can add behavior without replacing persistence. Only
the `documents` table is used in Phase 1; issue, event, model-run, and preference tables are empty.

The `packages/model-adapters` boundary is present because it is part of the fixed workspace, but
its model interface and implementations intentionally begin in Phase 2.
