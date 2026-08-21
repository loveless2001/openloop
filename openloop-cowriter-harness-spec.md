# OpenLoop — Stateful LLM Co-writer Harness MVP

**Status:** implementation-ready specification  
**Primary target:** local web application  
**Primary user:** one writer using one browser on one machine  
**Implementation language:** TypeScript  
**Working principle:** model calls are replaceable; document state, issue state, interruption policy, and interaction history belong to the harness.

---

## 0. Codex execution instructions

Implement this specification as written. Do not reopen design choices already fixed below unless a choice is technically impossible.

Work in vertical slices. Do not begin with a large test-first rewrite, a generic agent framework, or an abstraction layer that has no immediate caller. Add targeted tests after each vertical slice. Keep the application runnable at the end of every phase.

The first usable milestone is:

1. A browser editor accepts text.
2. A mock provider produces inline ghost-text completion.
3. A mock critic creates an anchored issue.
4. The user can choose **Apply**, **Later**, **Dismiss**, or **Resolve**.
5. The issue remains in an open-loop ledger and can resurface after a deterministic trigger.

When a requirement is ambiguous, choose the simplest implementation consistent with the product behavior and document the choice in `DECISIONS.md`.

Do not add:

- multi-agent orchestration;
- a vector database;
- fine-tuning code;
- authentication;
- cloud deployment configuration;
- Google Docs, Microsoft Word, or browser-extension integration;
- collaborative editing;
- CRDTs;
- a generalized workflow engine;
- an autonomous web-browsing agent.

---

## 1. Product summary

OpenLoop is a stateful LLM co-writer. It combines four behaviors:

1. **Fast inline completion** — predicts a short continuation at the cursor.
2. **Slow editorial criticism** — notices consequential problems and asks a focused question or proposes a local rewrite.
3. **Persistent issue memory** — treats an objection as a stateful object rather than disposable model output.
4. **Contextual resurfacing** — brings an unresolved objection back only when the document makes it relevant again.

The model generates candidate text and candidate objections. The harness decides:

- whether the output is valid;
- where it is anchored;
- whether it duplicates an existing issue;
- whether the issue is still alive after edits;
- whether the user deferred, rejected, ignored, or resolved it;
- whether and when it is allowed to interrupt again.

The defining lifecycle is:

```text
detected
  -> validated
  -> anchored
  -> shown
  -> applied | snoozed | dismissed | silently ignored
  -> open
  -> reconciled after edits
  -> resolved | invalidated | still open
  -> resurfaced when eligible
```

---

## 2. Product objective

Build a local-first editor that feels like autocomplete plus a demanding editor who remembers unfinished arguments.

A successful MVP must demonstrate that an issue can survive across document revisions without being repeatedly regenerated as a new, unrelated comment.

### Core product promise

> The system remembers what it objected to, tracks whether the text actually answered the objection, and asks again only when the objection becomes relevant.

### MVP user story

1. The user types: “The whole system is model agnostic, so any model will work equally well.”
2. Inline completion may suggest a continuation.
3. After the user pauses, the critic creates an issue anchored to that sentence:
   - question: “Do you mean API-compatible, or equivalent in behavior and quality?”
   - type: `ambiguity`
4. The user selects **Later**.
5. The user continues writing and later relies on the same claim in a conclusion.
6. The scheduler resurfaces the original issue as **Still open**, rather than creating a duplicate.
7. The user revises the sentence to distinguish integration portability from output quality.
8. Reconciliation marks the issue `resolved`.

---

## 3. Scope

### 3.1 In scope

- Single-user browser editor.
- Local persistence in SQLite.
- Rich-text document stored as TipTap JSON.
- Stable IDs on text-block nodes.
- Inline ghost-text completion.
- Anchored critic issues.
- Open-loop panel showing active and historical issues.
- Issue actions: Apply rewrite, Later, Dismiss, Resolve.
- Silent-ignore tracking as a weak signal.
- Deterministic interruption scheduler.
- Reconciliation of issues after related text changes.
- OpenAI-compatible model adapter.
- Deterministic mock model adapter.
- Separate fast and smart model configuration.
- Markdown export with a pre-export unresolved-issues review.
- Unit, integration, and minimal end-to-end tests.

### 3.2 Explicit non-goals

- Perfect semantic tracking through arbitrary document rewrites.
- Real-time collaborative editing.
- Long-term cross-document personalization.
- Training or fine-tuning models.
- Fully autonomous rewriting.
- Automatic factual verification against the web.
- Citation management.
- Voice input.
- Mobile layout.
- Offline local-model installation.
- Plugin integration with third-party editors.

---

## 4. UX specification

## 4.1 Main layout

Desktop layout only:

```text
+---------------------------------------------------------------+
| OpenLoop | document title | provider status | Export          |
+---------------------------------------------+-----------------+
|                                             | Open loops      |
|                  Editor                     |                 |
|                                             | active issues   |
|     inline ghost completion                 | history filter  |
|     paragraph gutter issue marker           | event details   |
|                                             |                 |
+---------------------------------------------+-----------------+
| non-blocking status: saved / thinking / error                 |
+---------------------------------------------------------------+
```

Recommended widths:

- Editor: flexible, minimum 720 px.
- Right panel: 340–420 px.
- Maximum readable editor column: 760 px.

## 4.2 Inline completion behavior

Trigger completion only when all conditions are true:

- editor has focus;
- selection is collapsed;
- cursor is at the end of a text block;
- current node is a paragraph, heading, or blockquote;
- at least three non-whitespace characters have been added since the last request;
- user has been idle for `COMPLETION_DEBOUNCE_MS`, default 300 ms;
- no composition event is active;
- no modal or issue popover is open.

Behavior:

- Cancel the previous request with `AbortController` when the user types again.
- Stream plain text when the provider supports streaming.
- Render completion as a ProseMirror decoration, not as document content.
- Press `Tab` to accept the whole completion.
- Press `ArrowRight` to accept one word.
- Press `Escape` to dismiss.
- Any normal text input dismisses the current completion.
- Never show more than one completion.
- Never insert completion automatically.
- Do not request a completion inside code blocks or empty headings.

Record these events:

- `completion_requested`
- `completion_shown`
- `completion_accepted_full`
- `completion_accepted_word`
- `completion_dismissed`
- `completion_stale`
- `completion_error`

## 4.3 Critic issue behavior

Run the critic when any of these triggers occurs:

- user is idle for `CRITIC_IDLE_MS`, default 1800 ms, and there are changed text blocks;
- user presses Enter after a non-empty paragraph;
- user creates a new heading;
- user requests manual critique from the toolbar.

Do not run the critic when:

- the document contains fewer than 40 visible characters, except manual critique;
- a critic request for the same document version is already queued;
- only whitespace or formatting changed;
- the user is actively composing text with an IME.

The critic may return zero to three issue candidates. The harness must validate, deduplicate, anchor, and filter them before display.

Display rules:

- Show at most one new interruption card at a time.
- Attach a small gutter marker to the anchor node.
- Clicking the marker opens the issue popover.
- Also list the issue in the right panel.
- A newly detected issue may be stored without immediately interrupting if scheduler policy rejects interruption.

Issue popover contents:

- type label;
- question or concise objection;
- one-sentence rationale;
- optional suggested rewrite;
- status and previous interaction history;
- actions.

Actions:

- **Apply rewrite** — available only when `suggestedRewrite` exists and the anchor is still valid.
- **Later** — set status to `snoozed`; default snooze is until the next eligible semantic trigger, with a minimum time cooldown.
- **Dismiss** — permanently dismiss this issue instance and reduce future display weight for its type.
- **Resolve** — manually mark resolved.

When an issue resurfaces, label it **Still open** and preserve its original creation time and event history.

## 4.4 Silent ignore

Silent ignore must not be treated as a clear rejection.

Record `silent_ignore` only if all are true:

- issue was visibly expanded or its interruption card was shown;
- user took no explicit action for at least 30 seconds;
- user made a meaningful edit in another node or moved the cursor at least two text blocks away;
- issue is still open.

Effects:

- increment `silentIgnoreCount`;
- add a weak negative preference signal;
- do not dismiss the issue;
- do not resurface it solely because time passed;
- apply a larger cooldown before the next interruption.

## 4.5 Open-loop panel

The panel contains three filters:

- **Open** — `open`, `snoozed`, `needs_review`.
- **Resolved** — `resolved`.
- **Dismissed** — `dismissed`, `invalidated`.

Each item shows:

- issue type;
- first line of question;
- anchor excerpt;
- severity;
- current status;
- number of times shown;
- last activity.

Clicking an item scrolls to and highlights its anchor. If the anchor no longer exists, show the stored excerpt and mark the item as detached.

## 4.6 Export flow

Export format for MVP: Markdown.

When the user clicks Export:

1. Reconcile any open issues whose anchors were affected by unsaved edits.
2. Show a modal listing unresolved issues with severity 4 or 5.
3. Allow:
   - return to document;
   - export anyway.
4. Export only document content, not issue comments.
5. Record `document_exported` with unresolved issue counts, but do not log document text.

---

## 5. Technical architecture

Use a pnpm workspace with four packages.

```text
openloop/
  apps/
    web/                 React + Vite + TipTap client
    server/              Fastify API and background queues
  packages/
    core/                domain types, state machine, scheduler, anchoring
    model-adapters/      model interface, mock adapter, OpenAI-compatible adapter
    shared/              Zod request/response schemas and utilities
  data/                  local SQLite database; gitignored
  docs/
    ARCHITECTURE.md
    DECISIONS.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .env.example
  README.md
```

### 5.1 Required stack

- TypeScript with `strict: true`.
- React.
- Vite.
- TipTap / ProseMirror.
- Fastify.
- SQLite.
- Drizzle ORM.
- Zod for all process and network boundaries.
- `p-queue` or an equivalent minimal in-process queue.
- Vitest for unit and integration tests.
- Playwright for one end-to-end happy path.

Do not introduce Redux unless local component state plus a small store becomes clearly insufficient. A lightweight store such as Zustand is acceptable for editor/session state.

### 5.2 Runtime boundaries

The browser owns:

- editor state;
- cursor and selection;
- node-level change detection;
- ghost-text rendering;
- cancellation of stale completion requests;
- local UI state;
- sending save and analysis events.

The server owns:

- API keys;
- model calls;
- document persistence;
- issue persistence;
- issue validation and deduplication;
- state transitions;
- reconciliation;
- interruption eligibility and ranking;
- model-run metadata;
- preference weights.

The model must never be allowed to mutate state directly. It only returns candidate outputs which the server validates.

---

## 6. Domain model

All IDs are UUID strings. All timestamps are ISO 8601 in API responses and integer milliseconds or database-native timestamps internally.

## 6.1 Enums

```ts
export const IssueType = z.enum([
  "unsupported_claim",
  "ambiguity",
  "contradiction",
  "missing_definition",
  "scope_jump",
  "evidence_gap",
  "causal_gap",
  "structure",
  "tone_mismatch",
  "other",
]);

export const IssueStatus = z.enum([
  "open",
  "snoozed",
  "needs_review",
  "resolved",
  "dismissed",
  "invalidated",
]);

export const IssueAction = z.enum([
  "show",
  "apply_rewrite",
  "snooze",
  "dismiss",
  "resolve",
  "silent_ignore",
  "reopen",
  "anchor_remapped",
  "reconciled_persists",
  "reconciled_resolved",
  "reconciled_invalidated",
  "reconciled_uncertain",
]);

export const ResurfaceTrigger = z.enum([
  "claim_reused",
  "section_end",
  "before_export",
  "severity_escalated",
  "manual_review",
]);
```

## 6.2 Document

```ts
export interface DocumentRecord {
  id: string;
  title: string;
  contentJson: JSONValue;
  plainText: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

Rules:

- `version` increments on every persisted content change.
- `contentJson` is canonical.
- `plainText` is a derived search/debug field and must be regenerated on save.
- The server rejects a save with an older version using HTTP 409.

## 6.3 Text block snapshot

The client sends changed blocks in this form:

```ts
export interface TextBlockSnapshot {
  nodeId: string;
  nodeType: "paragraph" | "heading" | "blockquote";
  text: string;
  previousText?: string;
  previousNodeText?: string;
  nextNodeText?: string;
  headingPath: string[];
  startOffset?: number;
  endOffset?: number;
}
```

## 6.4 Anchor

```ts
export interface IssueAnchor {
  nodeId: string;
  quote: string;
  quoteStart?: number;
  quoteEnd?: number;
  leftContext: string;
  rightContext: string;
  normalizedFingerprint: string;
  sourceDocumentVersion: number;
  detached: boolean;
}
```

`quote` must be an exact substring of the node text at creation time.

`normalizedFingerprint` is a stable hash of:

```text
normalize(anchor quote)
+ normalize(left context)
+ normalize(right context)
+ heading path
```

Normalization:

- Unicode NFKC;
- lowercase;
- collapse whitespace;
- remove punctuation except apostrophes inside words;
- trim.

## 6.5 Issue candidate returned by a model

```ts
export const IssueCandidateSchema = z.object({
  type: IssueType,
  anchorQuote: z.string().min(3).max(400),
  question: z.string().min(5).max(500),
  rationale: z.string().min(5).max(600),
  suggestedRewrite: z.string().max(1200).optional(),
  severity: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  interruptWorthiness: z.number().min(0).max(1),
  resurfaceTriggers: z.array(ResurfaceTrigger).max(4),
  keywords: z.array(z.string().min(2).max(80)).max(8).default([]),
});
```

## 6.6 Persisted issue

```ts
export interface IssueRecord {
  id: string;
  documentId: string;
  type: z.infer<typeof IssueType>;
  status: z.infer<typeof IssueStatus>;
  question: string;
  rationale: string;
  suggestedRewrite?: string;
  severity: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  interruptWorthiness: number;
  anchor: IssueAnchor;
  keywords: string[];
  resurfaceTriggers: z.infer<typeof ResurfaceTrigger>[];
  dedupeKey: string;
  shownCount: number;
  silentIgnoreCount: number;
  lastShownAt?: string;
  snoozedUntil?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}
```

## 6.7 Issue event

```ts
export interface IssueEventRecord {
  id: string;
  issueId: string;
  documentId: string;
  action: z.infer<typeof IssueAction>;
  documentVersion: number;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

The event table is append-only.

## 6.8 Preference weight

Use one local user for MVP.

```ts
export interface PreferenceWeightRecord {
  userId: "local-user";
  issueType: z.infer<typeof IssueType>;
  weight: number;
  explicitDismissals: number;
  applies: number;
  silentIgnores: number;
  updatedAt: string;
}
```

Default `weight = 1.0`, clamped to `[0.5, 1.5]`.

Updates:

- Apply rewrite: `+0.05`.
- Manual resolve after viewing: `+0.03`.
- Dismiss: `-0.12`.
- Silent ignore: `-0.02`.
- Do not let preference weight suppress a severity-5 issue below eligibility.

---

## 7. Database schema

Create migrations for:

### `documents`

- `id` text primary key
- `title` text not null
- `content_json` text not null
- `plain_text` text not null
- `version` integer not null
- `created_at` integer not null
- `updated_at` integer not null

### `issues`

- `id` text primary key
- `document_id` text not null references documents(id)
- `type` text not null
- `status` text not null
- `question` text not null
- `rationale` text not null
- `suggested_rewrite` text nullable
- `severity` integer not null
- `confidence` real not null
- `interrupt_worthiness` real not null
- `anchor_json` text not null
- `keywords_json` text not null
- `resurface_triggers_json` text not null
- `dedupe_key` text not null
- `shown_count` integer not null default 0
- `silent_ignore_count` integer not null default 0
- `last_shown_at` integer nullable
- `snoozed_until` integer nullable
- `created_at` integer not null
- `updated_at` integer not null
- `resolved_at` integer nullable

Indexes:

- `(document_id, status)`
- `(document_id, dedupe_key)`
- `(document_id, updated_at)`

### `issue_events`

- `id` text primary key
- `issue_id` text not null references issues(id)
- `document_id` text not null references documents(id)
- `action` text not null
- `document_version` integer not null
- `payload_json` text not null
- `created_at` integer not null

Indexes:

- `(issue_id, created_at)`
- `(document_id, created_at)`

### `model_runs`

- `id` text primary key
- `request_id` text not null
- `document_id` text nullable
- `kind` text not null: `completion | critic | reconcile | repair`
- `provider` text not null
- `model` text not null
- `input_hash` text not null
- `latency_ms` integer nullable
- `input_tokens` integer nullable
- `output_tokens` integer nullable
- `status` text not null
- `error_code` text nullable
- `created_at` integer not null

Do not persist raw prompts or document content in `model_runs` unless `LOG_MODEL_CONTENT=true`.

### `preference_weights`

- `user_id` text not null
- `issue_type` text not null
- `weight` real not null
- `explicit_dismissals` integer not null default 0
- `applies` integer not null default 0
- `silent_ignores` integer not null default 0
- `updated_at` integer not null

Primary key: `(user_id, issue_type)`.

---

## 8. Stable editor node IDs

Create a TipTap extension that adds a persistent `nodeId` attribute to:

- paragraph;
- heading;
- blockquote.

Rules:

- New block: create `crypto.randomUUID()`.
- Editing text inside a block: preserve ID.
- Splitting a block: original left block keeps ID; new right block receives a new ID.
- Merging blocks: surviving first block keeps ID; client reports removed IDs and surviving ID.
- Copy/paste inside the same document: regenerate duplicate IDs before applying transaction.
- Loading old content without IDs: assign IDs once and persist immediately.

Create a client-side changed-node tracker. For each ProseMirror transaction, emit:

```ts
interface EditorChangeBatch {
  documentId: string;
  baseVersion: number;
  clientSequence: number;
  changedBlocks: TextBlockSnapshot[];
  removedNodeIds: string[];
  mergedNodeMap: Record<string, string>;
  reason: "typing" | "split" | "merge" | "paste" | "format" | "load";
}
```

Do not send the full document for every keystroke. Autosave may send the full TipTap JSON after debounce.

---

## 9. Model abstraction

## 9.1 Interface

```ts
export interface CompletionInput {
  requestId: string;
  languageHint?: string;
  documentTitle?: string;
  headingPath: string[];
  prefix: string;
  suffix?: string;
  maxOutputTokens: number;
}

export interface CompletionChunk {
  textDelta: string;
  done: boolean;
}

export interface CriticInput {
  requestId: string;
  documentTitle: string;
  documentVersion: number;
  changedBlocks: TextBlockSnapshot[];
  openIssues: Array<{
    id: string;
    type: string;
    question: string;
    anchorQuote: string;
    status: string;
  }>;
}

export interface ReconcileInput {
  requestId: string;
  documentVersion: number;
  issue: IssueRecord;
  currentBlock?: TextBlockSnapshot;
  nearbyBlocks: TextBlockSnapshot[];
}

export const ReconcileResultSchema = z.object({
  outcome: z.enum(["persists", "resolved", "invalidated", "uncertain"]),
  reason: z.string().min(3).max(500),
  newAnchorQuote: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1),
});

export interface ModelAdapter {
  readonly providerId: string;
  readonly capabilities: {
    streaming: boolean;
    jsonSchema: boolean;
    cancellation: boolean;
  };

  streamCompletion(
    input: CompletionInput,
    signal: AbortSignal,
  ): AsyncIterable<CompletionChunk>;

  critique(
    input: CriticInput,
    signal: AbortSignal,
  ): Promise<z.infer<typeof IssueCandidateSchema>[]>;

  reconcile(
    input: ReconcileInput,
    signal: AbortSignal,
  ): Promise<z.infer<typeof ReconcileResultSchema>>;
}
```

## 9.2 Providers

Implement three adapters.

### `MockModelAdapter`

Required for development and tests.

Behavior must be deterministic from the input text:

- Completion: append a fixed context-sensitive phrase.
- Critic: if changed text contains a configured trigger phrase such as `any model will work equally well`, return a known ambiguity issue.
- Reconcile: mark resolved if the updated block contains both `API-compatible` and `quality`; mark invalidated if anchor text is absent and no semantically related keywords remain; otherwise persist.

### `OllamaModelAdapter`

Use this completion-only adapter for the default local prose base model. Send the literal final
1,500 prefix characters to Ollama `/api/generate` with `raw: true`; do not add a chat template,
instruction wrapper, synthetic blank, or prefix-echo filter. Use a 2,048-token context, greedy
decoding, a 12-token hard limit, a double-newline stop, and configurable keep-alive. Warm the exact
serving contract by generating one token before reporting the provider ready.

The automatic editor trigger occurs only at the end of a text block, so this causal path does not
consume suffix context. Mid-block completion requires a separately evaluated suffix-aware model
contract.

### `OpenAICompatibleAdapter`

Configuration:

- base URL;
- API key;
- fast model ID;
- smart model ID;
- optional JSON-schema support flag.

Use the fast model for completion. Use the smart model for critic and reconcile.

Requirements:

- API key remains server-side.
- Completion timeout: 8 seconds.
- Critic timeout: 30 seconds.
- Reconcile timeout: 20 seconds.
- No retry for completion.
- One retry for critic/reconcile only when output is malformed or schema validation fails.
- The retry must be a repair request containing only the invalid output and schema instructions, not a second full analysis request.
- Strip Markdown code fences before JSON parsing.
- Reject outputs containing more than three issue candidates.
- Log metadata, not prompt content, by default.

## 9.3 Provider selection

Provider selection is explicit per role:

```text
COMPLETION_PROVIDER=mock | ollama | openai | openai-compatible
CRITIC_PROVIDER=mock | openai | openai-compatible | cli-agent
```

The rest of the application must depend only on `ModelAdapter`.

---

## 10. Prompt contracts

Prompts live in versioned files under:

```text
packages/model-adapters/src/prompts/
  causal-prefix.v1.ts
  completion.v1.ts
  critic.v1.ts
  reconcile.v1.ts
  repair-json.v1.ts
```

Include `promptVersion` in model-run metadata.

## 10.1 Completion contracts

The native Ollama causal path uses `causal-prefix.v1`: the literal bounded prefix and no instruction
text. OpenAI-compatible chat completion uses this behavior, with minor formatting changes allowed:

```text
You are an inline writing completion engine.
Continue the user's text in the same language, register, tone, and formatting.
Return only the continuation. Do not explain, quote, label, or repeat the prefix.
Prefer one short clause or sentence. Stop before changing topic.
Do not add Markdown unless the surrounding text already uses it.
```

Chat-compatible completion context builder:

- up to 1,500 characters before cursor;
- up to 300 characters after cursor;
- current heading path;
- document title;
- hard output limit default 60 tokens.

## 10.2 Critic system prompt

```text
You are a demanding but economical co-writer.
Analyze only the changed text and its immediate context.
Identify consequential reasoning, evidence, definition, contradiction, scope, structure, or intent problems.
Prefer a precise question that forces the author to resolve the problem.
Do not praise the text.
Do not report generic style preferences.
Do not criticize profanity, informality, or voice unless it conflicts with the stated intent.
Return zero issues when nothing is worth interrupting the writer for.
Return no more than three issues.
Every anchorQuote must be an exact substring of one changed block.
A suggestedRewrite is optional and should be present only when a local replacement clearly solves the issue.
Do not duplicate an open issue supplied in context; instead omit it unless the new text materially escalates it.
Return strict JSON matching the supplied schema.
```

Filtering after model response:

- discard if `confidence < 0.55`;
- discard if `interruptWorthiness < 0.55` and severity < 4;
- discard if `anchorQuote` is not an exact substring of a changed block;
- truncate fields only after preserving valid UTF-8 boundaries;
- deduplicate before persistence.

## 10.3 Reconcile system prompt

```text
You are checking whether a previously recorded editorial objection still applies after the author edited the relevant passage.
Classify only one of:
- persists: the same underlying problem remains;
- resolved: the new text directly addresses the objection;
- invalidated: the claim or passage no longer exists and the objection is no longer relevant;
- uncertain: the available local context is insufficient.
Do not create a new objection.
If the issue persists but moved, return an exact newAnchorQuote from the current text.
Return strict JSON matching the supplied schema.
```

---

## 11. Completion workflow

```text
editor transaction
  -> completion eligibility check
  -> debounce 300 ms
  -> build local context
  -> abort previous request
  -> POST /v1/completions/stream
  -> stream text decoration
  -> accept / dismiss / stale
```

Every request includes:

- `requestId`;
- `documentId`;
- current local document version;
- `nodeId`;
- cursor offset;
- prefix and suffix hashes.

Staleness rule:

- discard a chunk if current node ID, cursor position, or prefix hash no longer matches the request;
- record `completion_stale` once per request;
- never try to rebase a completion.

Completion endpoint must not write document content to the database.

---

## 12. Critic workflow

```text
changed-node batch
  -> queue by document
  -> merge adjacent pending batches
  -> build critic context
  -> model critique
  -> schema validation
  -> exact-anchor validation
  -> dedupe
  -> persist issue
  -> scheduler decides show now or store silently
```

### 12.1 Queue behavior

- One critic job at a time per document.
- Merge pending changed blocks by `nodeId`, keeping the newest snapshot.
- Maximum three queued critic jobs globally for MVP.
- If a newer job fully supersedes an unstarted job, discard the older job.
- Do not cancel an in-flight critic request unless the document is deleted.

### 12.2 Context supplied to critic

For each changed block include:

- changed text;
- previous text when available;
- previous and next block text;
- heading path.

Also include summaries of open or snoozed issues whose anchor node or keywords overlap the changed blocks.

Do not send the full document in MVP.

### 12.3 Deduplication

Create:

```text
dedupeKey = sha256(
  issueType
  + normalize(anchorQuote)
  + normalize(coreQuestion)
)
```

`coreQuestion` removes common question framing such as:

- “Are you sure…”
- “Do you mean…”
- “How do you…”

Deduplication rules:

1. Exact `dedupeKey` match among non-terminal issues: update severity/confidence if higher, add `severity_escalated` trigger, do not create a new issue.
2. Same type and same anchor node with token Jaccard similarity >= 0.72: treat as probable duplicate.
3. Same type and keyword overlap >= 0.7 within the same heading path: call deterministic duplicate heuristic; do not call another model for MVP.
4. Terminal dismissed issues may be recreated only after the anchor text materially changes and at least one document version has passed.

---

## 13. Issue state machine

Allowed transitions:

```text
open -> snoozed
open -> resolved
open -> dismissed
open -> invalidated
open -> needs_review

snoozed -> open
snoozed -> resolved
snoozed -> dismissed
snoozed -> invalidated
snoozed -> needs_review

needs_review -> open
needs_review -> resolved
needs_review -> dismissed
needs_review -> invalidated

resolved -> open      only through explicit reopen or a new severity escalation

dismissed -> open     only through explicit user reopen

invalidated -> open   never automatically; create a new issue if a new claim appears
```

Implement transition logic in one pure function in `packages/core`:

```ts
transitionIssue(
  issue: IssueRecord,
  event: IssueDomainEvent,
  now: Date,
): IssueTransitionResult
```

All API actions must call this function. No route may mutate status directly.

Every successful transition appends an issue event in the same database transaction.

---

## 14. Anchor tracking and reconciliation

This is the main harness feature.

## 14.1 Fast deterministic remapping

When changed blocks arrive, inspect issues anchored to affected or removed node IDs.

The remapper adapts Gerrit's ported-comment model rather than treating quote search as the source of
truth. Gerrit computes mappings between the source and target revisions, transforms a comment range
through those edits, and degrades a range comment to a broader file-level location when no exact
position survives. See Gerrit's
[porting behavior](https://gerrit-review.googlesource.com/Documentation/user-porting-comments.html),
[`CommentPorter`](https://gerrit.googlesource.com/gerrit/+/refs/heads/master/java/com/google/gerrit/server/restapi/change/CommentPorter.java),
and
[`GitPositionTransformer`](https://gerrit.googlesource.com/gerrit/+/refs/heads/master/java/com/google/gerrit/server/patch/GitPositionTransformer.java).

OpenLoop's block-text adaptation applies in order:

1. **Transform the stored range through the edit**
   Map `quoteStart` and `quoteEnd` through the old-to-new block edit. Accept the mapped range only
   when it does not intersect changed text and still contains the exact stored quote.

2. **Recover the exact quote with context**
   In the same stable node, match the stored exact quote and use stored left/right context to
   disambiguate repeated occurrences. This follows the W3C
   [`TextQuoteSelector`](https://www.w3.org/TR/annotation-model/#text-quote-selector) shape of
   `exact`, `prefix`, and `suffix`. If two occurrences remain plausible, fail closed.

3. **Bounded fuzzy recovery**
   If the quote itself changed slightly, search small candidate windows in the same node using
   normalized token similarity and surrounding context. If the best score is at least `0.82` and
   meaningfully exceeds the runner-up, remap and append `anchor_remapped`.

4. **Mapped merge survivor, then stable neighbors**
   Search an explicit merge survivor at threshold `0.78`, then the previous and next two surviving
   stable-node neighbors in the same heading path at threshold `0.86`. Both searches require an
   unambiguous best result.

5. **Explicit orphaned state**
   If no bounded mapping is trustworthy, set `anchor.detached = true` and status to `needs_review`,
   retain the stored excerpt, and enqueue model reconciliation. This is OpenLoop's explicit
   orphaned/unanchored equivalent of Gerrit's broader-location fallback; it must never silently pick
   the first textual match.

Suggested similarity score:

```text
0.50 * token Jaccard(anchor quote, candidate)
+ 0.20 * token Jaccard(left context, candidate left context)
+ 0.20 * token Jaccard(right context, candidate right context)
+ 0.10 * heading-path equality
```

Use a small sliding window around the original quote length. Avoid full-document quadratic search.

## 14.2 Reconciliation eligibility

Reconcile an issue when:

- its anchor block changed materially;
- anchor became detached;
- a rewrite was applied;
- export was requested and issue is open;
- a new critic candidate deduplicates into the same issue with changed wording.

Material change means normalized Levenshtein similarity between old and new block text is below 0.92, or the anchor quote itself changed.

Batch reconciliation per document after 2,000 ms idle. Maximum five issues per batch, processed sequentially.

## 14.3 Reconciliation result handling

- `persists`:
  - status becomes `open`, unless still within explicit snooze minimum time;
  - remap anchor if `newAnchorQuote` is valid;
  - append `reconciled_persists`.
- `resolved`:
  - status `resolved`;
  - set `resolvedAt`;
  - append `reconciled_resolved`.
- `invalidated`:
  - status `invalidated`;
  - append `reconciled_invalidated`.
- `uncertain`:
  - status `needs_review`;
  - do not interrupt automatically;
  - append `reconciled_uncertain`.

Never let a low-confidence reconciliation silently close a severity-5 issue. For severity 5, require confidence >= 0.7 for `resolved` or `invalidated`; otherwise map to `uncertain`.

---

## 15. Resurfacing scheduler

The scheduler is deterministic in MVP. Do not ask a model whether to interrupt.

## 15.1 Eligibility gates

An issue is eligible only if:

- status is `open`, or status is `snoozed` and its trigger condition overrides snooze;
- anchor is not detached;
- user has been idle for at least 1,200 ms;
- no completion is visible;
- no issue card is currently expanded;
- global interruption cooldown has elapsed;
- issue-specific cooldown has elapsed;
- issue has not already been shown for the current document version;
- the trigger is listed in `resurfaceTriggers`, except `before_export`, which may include any severity >= 4 issue.

Defaults:

```text
GLOBAL_INTERRUPTION_COOLDOWN_MS = 45_000
ISSUE_BASE_COOLDOWN_MS = 120_000
SILENT_IGNORE_EXTRA_COOLDOWN_MS = 180_000
MAX_VISIBLE_INTERRUPTION_CARDS = 1
MAX_AUTOMATIC_SHOWS_PER_ISSUE = 3
```

After three automatic shows, keep the issue in the panel but do not interrupt again unless severity escalates or the user manually reviews open loops.

## 15.2 Trigger detection

### `section_end`

Fire when:

- user creates a new heading after at least one non-empty block in the previous section; or
- user inserts two consecutive empty paragraphs after a non-empty section.

Eligible issues are those anchored inside the section being left.

### `claim_reused`

Fire when a changed block:

- shares at least two keywords with an open issue; and
- token overlap with the issue anchor or question is >= 0.35; and
- occurs in a different node from the original anchor.

### `severity_escalated`

Fire when a new duplicate critic candidate increases stored severity or interrupt worthiness by at least 0.15.

### `before_export`

Fire inside the export modal, not as an unsolicited inline interruption.

### `manual_review`

Fire when the user opens the Open filter or clicks Review open loops.

## 15.3 Ranking

For each eligible issue:

```text
score =
  severity * 2.0
  + confidence * 1.5
  + interruptWorthiness * 2.0
  + triggerBonus
  + preferenceBonus
  - shownCount * 1.25
  - silentIgnoreCount * 0.75
  - recentPenalty
```

Trigger bonus:

- severity escalated: `+2.0`
- claim reused: `+1.5`
- section end: `+1.0`
- manual review: `+0.5`

Preference bonus:

```text
(weight - 1.0) * 2.0
```

Recent penalty:

- shown within last 5 minutes: `3.0`
- shown within last 30 minutes: `1.5`
- otherwise: `0`

Choose the highest score. Tie-break by higher severity, then oldest creation time.

---

## 16. API specification

Base path: `/v1`.

All JSON endpoints return:

```ts
interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}
```

## 16.1 Documents

### `POST /v1/documents`

Request:

```json
{
  "title": "Untitled",
  "contentJson": { "type": "doc", "content": [] }
}
```

Response: `DocumentRecord`.

### `GET /v1/documents/:documentId`

Response:

```json
{
  "document": {},
  "issues": [],
  "preferences": []
}
```

### `PUT /v1/documents/:documentId`

Request:

```json
{
  "baseVersion": 12,
  "title": "Harness notes",
  "contentJson": {},
  "plainText": "...",
  "changeBatch": {}
}
```

Response includes new version and impacted issue IDs.

Return HTTP 409 with current version when `baseVersion` is stale.

## 16.2 Completion

### `POST /v1/completions/stream`

Use Server-Sent Events or newline-delimited JSON. Pick one and document it. SSE is preferred.

Request:

```json
{
  "requestId": "uuid",
  "documentId": "uuid",
  "documentVersion": 12,
  "nodeId": "uuid",
  "cursorOffset": 114,
  "prefix": "...",
  "suffix": "",
  "headingPath": ["Architecture"],
  "prefixHash": "sha256"
}
```

Events:

```text
event: delta
data: {"text":" continued"}

event: done
data: {"requestId":"..."}

event: error
data: {"code":"MODEL_TIMEOUT","message":"..."}
```

## 16.3 Critic

### `POST /v1/documents/:documentId/critic-jobs`

Request:

```json
{
  "requestId": "uuid",
  "documentVersion": 12,
  "trigger": "idle",
  "changedBlocks": []
}
```

Response HTTP 202:

```json
{
  "jobId": "uuid",
  "status": "queued"
}
```

### `GET /v1/documents/:documentId/critic-events`

Use SSE for job results and scheduler events.

Possible events:

- `issue_created`
- `issue_updated`
- `issue_eligible`
- `issue_resolved`
- `issue_invalidated`
- `critic_error`

The client may fall back to polling every two seconds if SSE disconnects.

## 16.4 Issues

### `GET /v1/documents/:documentId/issues?status=open`

Support comma-separated status values.

### `POST /v1/issues/:issueId/actions`

Request examples:

```json
{ "action": "snooze", "documentVersion": 12 }
```

```json
{ "action": "dismiss", "documentVersion": 12 }
```

```json
{ "action": "resolve", "documentVersion": 13 }
```

```json
{
  "action": "apply_rewrite",
  "documentVersion": 13,
  "expectedAnchorQuote": "original text"
}
```

For `apply_rewrite`, the server validates the expected quote and returns the replacement operation. The client applies the editor transaction, then saves the new document version. Do not let the server mutate document JSON without the client.

Response:

```json
{
  "issue": {},
  "editorOperation": {
    "nodeId": "uuid",
    "from": 10,
    "to": 42,
    "insertText": "replacement"
  }
}
```

### `POST /v1/documents/:documentId/reconcile`

Request:

```json
{
  "documentVersion": 14,
  "issueIds": ["uuid"],
  "changedBlocks": []
}
```

Response HTTP 202 with job ID.

## 16.5 Export

### `POST /v1/documents/:documentId/export-review`

Response:

```json
{
  "blockingIssues": [],
  "openIssueCount": 4,
  "needsReconciliation": false
}
```

### `GET /v1/documents/:documentId/export.md?force=true`

Return Markdown attachment. Require `force=true` only when the review reported blocking issues.

---

## 17. Frontend components

Minimum component tree:

```text
App
  TopBar
    DocumentTitle
    ProviderStatus
    ExportButton
  Workspace
    EditorPane
      OpenLoopEditor
      CompletionDecorationPlugin
      IssueGutterPlugin
      IssuePopover
    IssuePanel
      IssueFilters
      IssueList
      IssueDetail
  StatusBar
  ExportReviewModal
```

## 17.1 Editor state store

Store:

- document ID and version;
- current TipTap JSON;
- dirty state;
- changed-node accumulator;
- current completion request and decoration;
- active issue popover;
- visible interruption issue ID;
- SSE connection status;
- provider status;
- last user activity time.

Do not store complete issue event history in the editor extension. Keep it in application state.

## 17.2 Accessibility and keyboard behavior

- `Tab` accepts completion only when completion is visible; otherwise preserve normal editor behavior.
- `Escape` closes completion or issue popover, in that priority.
- Gutter markers are keyboard focusable.
- All action buttons have accessible labels.
- Do not communicate issue status by color alone.

## 17.3 Error behavior

- Completion failure: silently remove ghost text and show a brief status-bar message.
- Critic failure: preserve document editing and show non-blocking “Critic unavailable”.
- Database save failure: keep dirty state and show persistent error.
- SSE disconnect: retry with exponential backoff capped at 10 seconds; use polling fallback.
- Never block typing because a model or server request is slow.

---

## 18. Persistence and autosave

Autosave after 750 ms idle.

Client sends:

- full TipTap JSON;
- derived plain text;
- accumulated change batch;
- base document version.

On successful save:

- clear only the changes included in that request;
- update local version;
- leave later changes dirty;
- enqueue affected issue reconciliation server-side.

Handle concurrent local requests with monotonically increasing `clientSequence`.

There is only one browser writer in MVP, so conflict handling may be simple:

- on HTTP 409, fetch latest document;
- if latest version originated from the same browser session and sequence, update version and retry;
- otherwise show a conflict dialog and do not auto-merge.

---

## 19. Privacy and logging

Defaults:

```text
LOG_MODEL_CONTENT=false
LOG_DOCUMENT_CONTENT=false
```

Requirements:

- Never log API keys.
- Never include document text in standard request logs.
- Hash model inputs for correlation.
- Store model latency, status, model ID, and token counts when available.
- Keep SQLite under `./data/`, excluded from Git.
- Provide a **Delete local data** action that clears documents, issues, events, model runs, and preferences after confirmation.

No telemetry leaves the machine in MVP except configured model-provider calls.

---

## 20. Configuration

Create `.env.example`:

```dotenv
NODE_ENV=development
WEB_PORT=5173
SERVER_PORT=8787
DATABASE_URL=file:./data/openloop.db

COMPLETION_PROVIDER=ollama
COMPLETION_BASE_URL=http://127.0.0.1:11434/v1
COMPLETION_API_KEY=
COMPLETION_MODEL=hf.co/mradermacher/SmolLM3-3B-Base-GGUF:Q4_K_M
COMPLETION_KEEP_ALIVE=30m

CRITIC_PROVIDER=mock
CRITIC_BASE_URL=http://127.0.0.1:11434/v1
CRITIC_API_KEY=
CRITIC_MODEL=smart-model-id
CRITIC_SUPPORTS_JSON_SCHEMA=false

COMPLETION_DEBOUNCE_MS=300
CRITIC_IDLE_MS=1800
AUTOSAVE_DEBOUNCE_MS=750
GLOBAL_INTERRUPTION_COOLDOWN_MS=45000
ISSUE_BASE_COOLDOWN_MS=120000

LOG_MODEL_CONTENT=false
LOG_DOCUMENT_CONTENT=false
```

Validate environment variables at server startup with Zod. Fail fast for an invalid model configuration, but allow `MODEL_PROVIDER=mock` with no API key.

---

## 21. Tests

Do not create a huge test suite before implementation. Add focused tests for behavior that would be costly to debug manually.

## 21.1 Unit tests in `packages/core`

Required:

1. Every allowed issue-state transition.
2. Rejection of invalid transitions.
3. Preference-weight updates and clamping.
4. Dedupe-key normalization.
5. Exact-anchor remapping.
6. Fuzzy same-node remapping.
7. Merge-node remapping.
8. Detached-anchor behavior.
9. Scheduler eligibility gates.
10. Scheduler cooldown and maximum-show behavior.
11. Ranking tie-breaks.
12. Silent-ignore criteria.

## 21.2 Adapter tests

Using mocked HTTP:

- streams completion deltas;
- abort stops streaming;
- critic JSON validates;
- Markdown fences are stripped;
- malformed JSON triggers one repair attempt;
- second malformed output returns a typed error;
- timeouts return typed errors;
- no raw content is logged by default.

## 21.3 Server integration tests

Use a temporary SQLite database.

Required:

- create/load/save document;
- stale version returns 409;
- critic candidate becomes persisted issue;
- duplicate candidate updates existing issue;
- action and event append occur transactionally;
- reconcile closes an issue;
- export review returns severity-4/5 open issues.

## 21.4 End-to-end Playwright test

Run with mock provider:

1. Open app and create document.
2. Type trigger sentence.
3. See ghost completion.
4. Accept with Tab.
5. Wait for critic issue.
6. Click Later.
7. Type a second sentence reusing the claim.
8. Observe the same issue resurface as Still open.
9. Rewrite text to include API compatibility versus quality distinction.
10. Observe issue move to Resolved.
11. Export Markdown.

One stable E2E test is enough for MVP.

---

## 22. Acceptance criteria

The MVP is complete only when all criteria pass.

### Editor and completion

- User can create, edit, reload, and persist a document.
- Paragraph and heading node IDs survive reloads and ordinary edits.
- Ghost completion appears without modifying document content.
- Tab accepts, Escape dismisses, typing invalidates stale completion.
- A stale completion can never be inserted after the cursor context changes.

### Critic and issue memory

- A critic output is rejected if its anchor quote is not present.
- A valid issue is persisted with an anchor and event history.
- The same model objection is deduplicated into the existing issue.
- Later, Dismiss, Resolve, and Apply rewrite generate valid state transitions.
- Silent ignore is stored as a weak signal and does not dismiss the issue.

### Reconciliation

- Editing the anchor causes deterministic remap or model reconciliation.
- A resolved objection moves to Resolved without creating a new issue.
- Removing the underlying claim invalidates the issue.
- An uncertain reconciliation does not silently close an issue.

### Resurfacing

- A snoozed or silently ignored issue does not immediately reappear.
- Claim reuse or section end can resurface the same issue ID.
- The UI labels a resurfaced issue Still open.
- One issue cannot interrupt automatically more than three times without escalation.
- Only one automatic interruption is visible at once.

### Model portability

- Switching from `mock` to an OpenAI-compatible endpoint requires environment changes only.
- Frontend code contains no provider-specific model logic.
- Completion and critic can use different configured model IDs.

### Reliability

- Model failures never block editing.
- Saves survive page refresh.
- Database and event updates are transactional where specified.
- `pnpm lint`, `pnpm test`, and the E2E test pass.

---

## 23. Implementation phases

## Phase 0 — scaffold

Deliver:

- pnpm workspace;
- TypeScript configs;
- web and server dev scripts;
- shared Zod schemas;
- SQLite connection and migrations;
- health endpoint;
- `.env.example`;
- README startup instructions.

Checkpoint:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

opens an empty application and healthy API.

## Phase 1 — editor persistence

Deliver:

- TipTap editor;
- stable node-ID extension;
- document create/load/save;
- changed-node accumulator;
- autosave;
- local dirty and error states.

Checkpoint: write text, refresh, preserve content and node IDs.

## Phase 2 — inline completion

Deliver:

- model adapter interface;
- mock adapter;
- OpenAI-compatible adapter skeleton;
- completion SSE endpoint;
- ghost-text decoration;
- accept/dismiss/stale behavior;
- completion event logging.

Checkpoint: deterministic mock completion works end to end.

## Phase 3 — critic and issue ledger

Deliver:

- critic queue;
- critic prompt and schema;
- exact-anchor validation;
- issue persistence;
- issue panel and gutter markers;
- state-machine actions;
- issue event history.

Checkpoint: mock trigger sentence creates one anchored issue and actions persist.

## Phase 4 — anchoring and reconciliation

Deliver:

- deterministic remapping;
- impacted-issue detection;
- reconcile queue and prompt;
- resolved/invalidated/uncertain handling;
- detached-anchor UI.

Checkpoint: revising the claim resolves the original issue ID.

## Phase 5 — resurfacing

Deliver:

- trigger detection;
- scheduler gates and scoring;
- cooldowns;
- silent-ignore handling;
- Still open resurfacing UI;
- preference weights.

Checkpoint: deferred issue resurfaces once after claim reuse, not repeatedly.

## Phase 6 — export, polish, and tests

Deliver:

- Markdown export;
- export review modal;
- provider-status UI;
- privacy controls;
- targeted unit/integration tests;
- one Playwright E2E test;
- architecture and decisions documentation.

Checkpoint: all acceptance criteria pass.

---

## 24. Repository scripts

Root `package.json` must provide:

```json
{
  "scripts": {
    "dev": "run web and server concurrently",
    "build": "build all workspace packages",
    "lint": "lint all workspace packages",
    "typecheck": "typecheck all workspace packages",
    "test": "run unit and integration tests",
    "test:e2e": "run Playwright",
    "db:generate": "generate Drizzle migration",
    "db:migrate": "apply migrations",
    "db:reset": "delete local database and migrate",
    "format": "format source files"
  }
}
```

Use a standard concurrency utility rather than a custom shell script so commands work in Windows, WSL, macOS, and Linux.

---

## 25. Code quality constraints

- TypeScript strict mode everywhere.
- No untyped `any` at API or model boundaries.
- Use Zod parsing for environment variables, HTTP payloads, model JSON, and JSON stored in database text columns.
- Domain state transitions are pure functions.
- Database writes involving issue state and issue events occur in one transaction.
- Model-provider code must not import UI or database modules.
- Core scheduler and anchor logic must not import Fastify or React.
- Prefer files below roughly 300 lines; split by responsibility when a file becomes hard to scan.
- No generic `utils.ts` dumping ground.
- Return typed domain errors with stable error codes.
- Add comments for non-obvious invariants, not for obvious syntax.
- Do not perform broad formatting or unrelated refactors in a feature change.

---

## 26. Error codes

At minimum:

```text
DOCUMENT_NOT_FOUND
DOCUMENT_VERSION_CONFLICT
ISSUE_NOT_FOUND
INVALID_ISSUE_TRANSITION
ANCHOR_NOT_FOUND
ANCHOR_STALE
MODEL_CONFIGURATION_INVALID
MODEL_TIMEOUT
MODEL_ABORTED
MODEL_RATE_LIMITED
MODEL_MALFORMED_OUTPUT
MODEL_UNAVAILABLE
CRITIC_JOB_NOT_FOUND
DATABASE_ERROR
EXPORT_REVIEW_REQUIRED
VALIDATION_ERROR
```

Map provider-specific failures into these stable codes.

---

## 27. Manual demo script

Use this exact script with the mock provider.

1. Start with a blank document titled `Harness note`.
2. Type:

   ```text
   The whole product is model agnostic, so any model will work equally well.
   ```

3. Wait for ghost completion and accept it with Tab.
4. Wait for critic issue:

   ```text
   Do you mean that any model can be integrated through the same interface, or that all models will produce equivalent behavior and quality?
   ```

5. Click Later.
6. Add a heading `Conclusion`.
7. Type:

   ```text
   Therefore model choice does not matter to the product.
   ```

8. The same issue ID must resurface as Still open.
9. Replace the original sentence with:

   ```text
   The harness is provider-agnostic at the API boundary, but model choice still changes latency, structured-output reliability, reasoning quality, and cost.
   ```

10. Reconciliation must mark the issue Resolved.
11. Open the Resolved filter and inspect its full event history.
12. Export Markdown.

---

## 28. Future extensions, not part of MVP

Keep architecture compatible with these, but do not implement them now:

- Google Docs and Word adapters.
- Cross-document user preference profiles.
- Learned interruption policy from interaction logs.
- Embedding-assisted semantic anchor recovery.
- Document-level argument graph.
- Fact-checking and source retrieval.
- Multiple critic personas.
- Team collaboration.
- Local desktop packaging.
- Voice comments.
- Fine-tuned small models for completion and issue classification.

---

## 29. Definition of done

The work is done when:

- the application runs locally from a clean clone using documented commands;
- the mock demo script succeeds without external API access;
- an OpenAI-compatible endpoint can replace the mock provider by changing environment variables;
- an objection persists as one stateful issue through defer, resurface, edit, and resolution;
- all acceptance criteria and required tests pass;
- `README.md`, `ARCHITECTURE.md`, and `DECISIONS.md` accurately describe the implementation;
- there are no placeholder TODOs in the critical path.
