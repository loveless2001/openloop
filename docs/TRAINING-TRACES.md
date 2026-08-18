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

The file is append-only JSONL with schema version 1. Records are joined by `requestId`:

- `completion_candidate` contains the provider, model, document title, heading path, cursor prefix,
  cursor suffix, generated suggestion, and completion status.
- `completion_feedback` contains an interaction outcome and optional accepted-character count.
  Outcomes include requested, shown, accepted word, accepted full, explicit rejection, implicit
  dismissal, stale, and error.

Word-by-word acceptance creates multiple feedback records for one candidate. A dataset compiler can
sum accepted spans and treat a later explicit rejection as rejection of only the remaining suffix.
Implicit dismissal, stale, and error outcomes should not be treated as strong negative preferences.

## Training recommendation

Keep capture local and provide a deletion/export control before enabling it for users outside this
development environment. Build a held-out evaluation split before fine-tuning. Start with offline
LoRA or preference tuning from accepted versus explicitly rejected continuations; do not update the
live model after individual events because acceptance is noisy and context-dependent.
