# Autocomplete adaptation pipeline

This plan adapts the local autocomplete model to a writer without turning individual interactions
into live model updates. The personal dictionary remains the immediate path for names, terminology,
phrases, and shortcut expansion. Model training targets longer contextual continuations.

## Architecture status

The non-executing foundation is implemented in `@openloop/training`:

- versioned Zod contracts for trace v2, compiled datasets, pipeline configuration, and metrics;
- deterministic candidate/feedback joins, document-grouped splits, exact deduplication, causal/FIM
  corpus examples, continuation targets, and true rejection/replacement preference pairs;
- content-hashed dataset manifests, reviewable stage-plan manifests, and deployment gate reports;
- CLI entry points for compilation, planning, and gate evaluation; and
- server emission of v2 model-candidate and interaction-feedback records behind the existing local
  opt-in.

The following pieces are intentionally dormant: UI replacement-span capture, natural-continuation
sampling, checkpoint training, model or dataset downloads, GGUF conversion, Ollama registration,
and automatic deployment. The `plan` command writes `executionEnabled: false`; it cannot launch a
trainer or replace the configured autocomplete model.

See [`training/README.md`](../training/README.md) for the implemented commands and artifact layout.

## Training strategy

Use three stages, each admitted only when the preceding stage beats the frozen base-model baseline:

1. **Continued pretraining with FIM augmentation (optional)** learns the distribution of the
   writer's raw prose: vocabulary, register, sentence rhythm, and recurring structure. Start from
   the unquantized Qwen base checkpoint. Mix ordinary left-to-right examples with
   fill-in-the-middle examples because OpenLoop supplies both prefix and suffix context. Continued
   domain/task pretraining and FIM are supported by the approaches in
   [Don't Stop Pretraining](https://aclanthology.org/2020.acl-main.740/) and
   [Efficient Training of Language Models to Fill in the Middle](https://arxiv.org/abs/2207.14255/).
2. **Continuation SFT** teaches the deployed task contract: given the same bounded prefix, suffix,
   title, heading path, and instruction used by OpenLoop, emit only a short continuation. Accepted
   suggestions and actual user-written continuations are positive targets.
3. **Preference tuning (optional)** teaches selection among plausible continuations. Use DPO only
   for true paired examples containing both a chosen continuation and a rejected suggestion.
   Unary accepted/rejected observations may support a separately evaluated KTO pilot, but they are
   not equivalent to preference pairs and should not be called offline RL.

Do not train the quantized model served by Ollama. Train a base or instruction checkpoint with
LoRA/QLoRA, merge only an accepted adapter, then convert and quantize a deployment artifact.

## Phase A — strengthen local trace capture

Upgrade the opt-in trace format to schema version 2 before collecting training data:

- Add a stable `candidateId`, model artifact/version, prompt version, decoding settings, and source
  (`model` or `dictionary`).
- After an explicit model-suggestion rejection, capture the next user-authored span as
  `replacementText`, stopping at 128 characters, a paragraph boundary, document switch, or a
  configurable timeout.
- After no suggestion was accepted, sample natural prefix/suffix/next-span examples from saved
  user-authored text. Keep these separate from interaction feedback.
- Preserve the current distinction between explicit rejection, implicit dismissal, staleness, and
  errors. Only explicit rejection is a negative label.
- Add local export, deletion, retention-window, and capture-status controls before enabling capture
  outside development.

Label interactions as follows:

| Observation                                       | Training use                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Full acceptance                                   | Positive continuation target                                                 |
| Partial acceptance                                | Accepted prefix is positive; untouched remainder is unlabeled                |
| Partial acceptance followed by explicit rejection | Accepted prefix positive; rejected remainder negative                        |
| Explicit rejection plus replacement text          | Pair: chosen replacement, rejected suggestion                                |
| Explicit rejection without replacement            | Unary negative only                                                          |
| Dismissed, stale, aborted, or error               | Telemetry only; never a negative preference                                  |
| Dictionary acceptance                             | Dictionary ranking signal; exclude from model preference training by default |

## Phase B — compile leakage-safe datasets

Create a deterministic local compiler with a versioned manifest and content hashes. Split by
document, or by time for a single long-running document, **before** creating overlapping windows so
near-duplicate passages cannot cross train and evaluation sets.

Produce three independent datasets:

- `cpt.jsonl`: clean user-authored passages with left-to-right and FIM transformations.
- `continuation-sft.jsonl`: production-shaped context and target continuation pairs.
- `preferences.jsonl`: `context`, `chosen`, and `rejected` triples with provenance and label type.

Deduplicate exact and near-exact spans, exclude imported reference material unless explicitly
approved, and report per-document contribution so one document cannot silently dominate. Keep a
frozen evaluation set that is never used for checkpoint selection or preference construction.

## Phase C — establish the baseline

Evaluate the exact currently deployed Qwen artifact and prompt before training. Record:

- continuation negative log-likelihood where available;
- normalized character-prefix match and accepted-character simulation;
- exact long-span overlap with training documents as a memorization screen;
- malformed output, prefix repetition, and unwanted paragraph-break rates;
- time to first token and total generation latency at p50 and p95;
- RAM/VRAM footprint and Ollama warm-residency behavior.

Store prompts, dataset manifest, model digest, runtime versions, and results together. No adapted
checkpoint can ship without comparison to this frozen baseline.

## Phase D — controlled training experiments

Run the smallest informative matrix:

1. Base model plus continuation SFT LoRA.
2. Base model plus CPT/FIM LoRA, then continuation SFT.
3. Best supervised checkpoint plus DPO, only when clean pairs exist.
4. Optional KTO pilot for unary feedback, evaluated separately from DPO.

Use low learning rates, short pilots, checkpointed validation, and a mixture of generic prose or the
original instruction data where licensing permits to limit catastrophic forgetting. Treat CPT as
optional: retain it only if `CPT/FIM -> SFT` beats SFT alone on the frozen continuation evaluation.
Do not infer benefit from training loss alone.

Preference optimization follows
[Direct Preference Optimization](https://arxiv.org/abs/2305.18290/). A KTO experiment follows
[KTO](https://arxiv.org/abs/2402.01306/) but is higher-risk here because its published experiments
do not establish behavior for this 0.5B deployment.

## Phase E — deployment gate

An adapted artifact may replace the current model only when it:

- improves held-out continuation utility over the base model;
- does not regress p95 time to first token by more than 10 percent on the target machine;
- does not increase malformed, repeated-prefix, or unwanted-newline output;
- passes the memorization screen and a manual private-text review;
- preserves the current Ollama boot, warm-up, streaming, cancellation, and keep-alive contract.

Merge the winning adapter, convert it to GGUF, quantize candidate variants, register an explicit
Ollama model name, and rerun the existing cold/warm benchmark. Keep the old model selectable for a
local A/B period and record the served artifact digest in every new trace.

## Artifact layout

```text
training/
  configs/            # tracked, reviewable experiment templates
  manifests/          # ignored generated stage plans
  datasets/           # ignored generated examples
  eval/               # ignored generated metrics and gate reports
  checkpoints/        # ignored future local training outputs
packages/training/    # schemas, compiler, manifests, gates, and CLI
```

The architecture slice covers the trace-v2 contract, compiler, experiment planning, and evaluation
gate. Replacement/natural-text collection and baseline measurement are the next live slices. No GPU
training should begin until those artifacts make data provenance, privacy, and held-out evaluation
auditable.
