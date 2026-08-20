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
- macOS or Linux, tmux, and an authenticated Codex or Claude CLI when using
  `CRITIC_PROVIDER=cli-agent` (Windows users can run this optional mode inside WSL)

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
one-word acceptance shortcut. Accepting a full suggestion selects the inserted text and opens a
small **Critique / Keep** toolbar, so generated prose is immediately visible and reviewable rather
than silently becoming ordinary text.

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

On macOS or Linux, criticism can instead use a locally authenticated Codex or Claude CLI through
OpenLoop's reverse-MCP bridge. Native Windows users can run OpenLoop inside WSL for this optional
mode. Copy `.env.cli-agent.example` to `.env`, start the app, then click **Start codex CLI** (or
configure `CRITIC_AGENT=claude`). OpenLoop launches one detached tmux session named
`openloop-critic`; attach with `tmux attach -t openloop-critic` if the CLI needs sign-in or you want
to inspect it. `CRITIC_AGENT_COMMAND` can select a non-default executable and
`CRITIC_AGENT_JOB_TIMEOUT_MS` controls the job lease.

For Claude Code, authenticate once with `claude auth login`, then set
`CRITIC_PROVIDER=cli-agent` and `CRITIC_AGENT=claude` in `.env`. The header button will become
**Start claude CLI**.

Claude Code receives its own launch contract rather than Codex flags: only the generated OpenLoop
MCP configuration is loaded, all built-in tools are removed, and exactly the seven bridge tools are
preapproved. User/project settings sources, hooks, auto-memory, Git instructions, and Chrome
integration are disabled for the managed session. Claude Code's normal account authentication is
still used; run `claude auth login` before launching the managed critic if necessary.

The managed critic starts in a private temporary runtime directory rather than the Git workspace,
because document context arrives only through MCP. Codex startup update checks are disabled for this
managed session so an update or repository-trust prompt cannot masquerade as a ready worker. Login
remains user-owned and may still require attaching once.

The server gives the CLI seven bearer-authenticated MCP tools: four for bounded document criticism
(claim, nearby context, submit candidates, and fail) and three for issue chat (claim, submit a reply,
and fail). The Codex launch allowlists and preapproves exactly those tools, avoiding interactive MCP
permission prompts without disabling its read-only sandbox. Claude uses the corresponding native
Claude Code restrictions described above. Context expansion is lease-bound,
limited to two requests and six blocks per side, and never exposes a general document or ledger
reader. Each claimed critic job contains the selected or changed blocks and only the relevant
open/snoozed ledger issues. Chat jobs contain one issue and at most twenty persisted messages. The
CLI cannot mutate the document, ledger, or issue status; normal server-side validation and
persistence still apply.

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
**Critique now** analyzes the currently accumulated changed blocks, including short passages.
Highlighting text opens a focused toolbar, and **Critique selection** sends only that exact review
scope. Selections over 1,000 words show a confirmation warning by default; the threshold is
adjustable under **Settings**, alongside automatic triggers, idle delay, word threshold,
autocomplete delay, and autosave delay. The server sends only the focused blocks initially; an
interactive CLI critic may request bounded neighboring blocks when needed.

The deterministic mock critic creates an ambiguity issue when changed text contains
`any model will work equally well`. The first issue opens in the right-hand ledger and receives a
keyboard-focusable gutter marker. Its persisted chat opens in the same panel; only one issue chat is
current at a time, and it can be collapsed without losing the current issue. Switching issues sends
`/clear` to the managed CLI before the next turn, while reopening the same issue does not. Highlight
document text and choose **Add to chat** to attach it to the composer; attachments remain editable
and are not sent until **Send**. The critic can ask for a focused clarification, and the chat header
offers Apply rewrite, Later, Dismiss, Resolve, or Reopen without granting the critic status authority.
Issue state, events, messages, and attachments already sent survive refresh.

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
actions/history, MCP bearer and lease enforcement, CLI job routing, stale-result rejection, and
gutter rendering. The Playwright workflow is reserved for Phase 6, so
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
