# Local autocomplete training traces

Training trace capture is disabled by default because records contain raw document text and model
suggestions. To opt in, set the following in `.env` and restart OpenLoop:

```dotenv
CAPTURE_TRAINING_TRACES=true
TRAINING_TRACE_PATH=data/training/completion-traces.jsonl
```

The path is resolved from the workspace root unless it is absolute. The default `data/` location is
excluded from Git.

## Record format

The file is append-only JSONL with schema version 2. Candidate and feedback records are joined by
`candidateId` (currently equal to the completion `requestId`):

- `completion_candidate` contains source, provider, model and model artifact, prompt version,
  decoding settings, document/node provenance, cursor prefix and suffix, generated suggestion, and
  completion status.
- `completion_feedback` contains document/node provenance, an interaction outcome, and an optional
  accepted-character count. Outcomes include requested, shown, accepted word, accepted full,
  explicit rejection, implicit dismissal, stale, and error.
- `completion_replacement` is reserved for the bounded text a writer enters after explicitly
  rejecting a candidate.
- `natural_continuation` is reserved for separately sampled user-authored continuation windows.

The server currently emits the first two record types when capture is enabled. The v2 schemas and
writer interfaces for replacement and natural-continuation records are implemented for the offline
pipeline, but their UI collectors are deliberately not active yet.

Word-by-word acceptance creates multiple feedback records for one candidate. A dataset compiler can
sum accepted spans and treat a later explicit rejection as rejection of only the remaining suffix.
Implicit dismissal, stale, and error outcomes should not be treated as strong negative preferences.

## Offline compiler

The `@openloop/training` package validates every trace, joins interaction records, assigns whole
documents to deterministic train/validation/test splits, and writes independent CPT/FIM,
continuation-SFT, and paired-preference datasets with a content-hashed manifest. Generated datasets
remain under ignored local storage.

```bash
pnpm training:compile -- --config training/configs/personal-qwen.example.json
```

The example expects opted-in traces at `data/training/completion-traces.jsonl` and explicitly
approved Markdown or text corpus files under `data/training/corpus/`.

## Training recommendation

Keep capture local and provide a deletion/export control before enabling it for users outside this
development environment. Build a held-out evaluation split before fine-tuning. Start with offline
LoRA or preference tuning from accepted versus explicitly rejected continuations; do not update the
live model after individual events because acceptance is noisy and context-dependent.

The current live collector does not yet capture what the writer types after rejecting a suggestion,
so ordinary app use cannot yet construct strong chosen-versus-rejected pairs. See
[the autocomplete adaptation pipeline](AUTOCOMPLETE-TRAINING-PIPELINE.md) for the trace-v2 contract,
CPT/FIM, continuation SFT, preference-tuning gates, and Ollama deployment sequence.
