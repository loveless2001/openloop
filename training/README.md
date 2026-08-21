# Offline autocomplete adaptation architecture

This directory contains tracked experiment configuration only. Private traces, compiled datasets,
evaluation outputs, manifests, and future checkpoints are generated under ignored paths.

## What is ready

`@openloop/training` provides:

- strict trace-v2 and dataset validation;
- deterministic document-grouped train/validation/test assignment;
- causal and fill-in-the-middle CPT examples;
- natural and accepted-suggestion continuation examples;
- paired preferences only when an explicit rejection has a captured replacement;
- content hashes for inputs and outputs;
- stage manifests that are reviewable but cannot execute; and
- quality, latency, output-shape, and memorization deployment gates.

All relative paths are resolved from the workspace directory where the command runs.

## Compile local data

First create the paths named by the example config. Only place prose in the corpus directory when
it is intentionally approved for adaptation.

```text
data/training/completion-traces.jsonl
data/training/corpus/*.md
```

Then run:

```bash
pnpm training:compile -- --config training/configs/personal-smollm3.example.json
```

The compiler writes `cpt.jsonl`, `continuation-sft.jsonl`, `preferences.jsonl`, and `manifest.json`
to the configured output directory. Invalid trace records stop compilation with a file and line
number. Interaction outcomes such as dismissal, staleness, and errors never become negative labels.

## Plan without executing

```bash
pnpm training:plan -- --config training/configs/personal-smollm3.example.json \
  --stage sft \
  --dataset-manifest data/training/compiled/personal-smollm3-v1/manifest.json \
  --output data/training/plans/sft.json
```

Valid stages are `cpt`, `sft`, `preference`, and `export`. Every resulting plan is `planned` with
`executionEnabled: false`. There is deliberately no train, merge, convert, register, or deploy
command in this implementation. The plan snapshots the future trainer contract—including learning
rate, epochs, sequence length, batching, LoRA parameters, generic replay ratio, and preference beta—
so those choices can be reviewed before any execution layer exists.

## Evaluate a future candidate

Baseline and candidate metric files must follow `AutocompleteMetricsSchema` in
`packages/training/src/schemas.ts`. Baseline and candidate must carry the same frozen dataset
manifest hash; a mismatch fails the gate.

```bash
pnpm training:gate -- --config training/configs/personal-smollm3.example.json \
  --baseline data/training/eval/baseline.json \
  --candidate data/training/eval/candidate.json \
  --output data/training/eval/gate-report.json
```

A failing gate exits with status 2. A passing report is necessary evidence for a later deployment
decision, not authorization to deploy.

## Deliberately inactive

The server currently captures model candidates and feedback only when
`CAPTURE_TRAINING_TRACES=true`. The schemas and writer ports for replacement text and natural
continuations exist, but no UI collector calls them yet. No GPU process, model download, training
job, GGUF conversion, Ollama registration, or runtime model switch is implemented here.
