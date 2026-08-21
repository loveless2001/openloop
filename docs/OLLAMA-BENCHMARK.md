# Ollama autocomplete benchmark

Measured on 2026-08-22 with Ollama 0.18.3 and an NVIDIA GeForce RTX 3060 Laptop
GPU with 6 GB VRAM. The selected model is the 1.9 GB Q4_K_M community GGUF of
[`HuggingFaceTB/SmolLM3-3B-Base`](https://huggingface.co/HuggingFaceTB/SmolLM3-3B-Base),
served from
[`mradermacher/SmolLM3-3B-Base-GGUF`](https://huggingface.co/mradermacher/SmolLM3-3B-Base-GGUF).

## Deployed request contract

- Native Ollama `/api/generate` for warm-up and streaming
- `raw: true` with the literal trailing document prefix
- No system prompt, chat template, synthetic blank, or prefix-echo filter
- 2,048-token context and a 12-token application limit
- Greedy decoding (`temperature: 0`) with a double-newline stop
- One generated warm-up token and `keep_alive: 30m`

The causal model ignores suffix metadata. This matches the editor eligibility rule: automatic
completion is requested only at the end of a text block.

## Results

The first timing pass used five realistic short prose prefixes twice, for ten requests. Median time
to first visible text was 175 ms and median total generation time was 291 ms. Nine immediately
repeated hot requests settled at 153–181 ms to first text, with a 157 ms median; their median total
time was 279 ms. The first request after a short gap took 506 ms.

After integration, a live request through `OllamaModelAdapter` following its one-token warm-up
returned ` it is needed. It should be able to provide help when` in 343 ms, with first text at
231 ms. Two requests through the full Fastify and SSE path returned the same 12-token continuation
with first text at 297–305 ms and total time of 482–586 ms. These verify the deployed contract but
are smoke measurements, not a latency distribution.

One request in the initial pass stalled during prompt evaluation and took 6.3 seconds to first
text. The stall did not recur in ten focused repetitions. A smaller Qwen base checkpoint had shown
a similar isolated multi-second stall, so the serving/runtime path remains the leading suspect, but
this is an inference rather than a confirmed cause. Production telemetry should retain p95/p99
latency rather than reporting only warm medians.

Three held-out README prefixes completed as:

| Prefix ending                 | Continuation                                                               | First text |
| ----------------------------- | -------------------------------------------------------------------------- | ---------: |
| `an objection may interrupt`  | ` the flow of writing.`                                                    |     210 ms |
| `export review remains`       | ` to be implemented.`                                                      |     169 ms |
| `the editor should pause for` | ` a moment before firing off the completion. This is especially important` |     178 ms |

The model still guesses generic prose rather than repository facts. It also hallucinated a
“Patchwork database” on one short prompt. Suggestions therefore remain provisional ghost text that
the writer must accept; they are not a source of project truth.

## Model comparison

The previous `Qwen3-1.7B-Base` Q4 benchmark reached 153 ms median first text and 237 ms median total
time in its stable pass. SmolLM3 is modestly slower but produced cleaner general-language
continuations and avoided Qwen's stray classification and multilingual artifacts. The older
`qwen2.5:0.5b` instruct-via-chat path is not a valid comparison for trace collection because its
prompt format differed from the deployed causal contract.

## Verdict

SmolLM3-3B-Base Q4_K_M is the default development autocomplete model. Its hot latency is adequate
for an integrated trial, and its prose quality is better than the tested smaller base model. It is
not production-certified until the full OpenLoop path has enough traces to measure acceptance,
p95/p99 latency, repeated-prefix rate, and unwanted paragraph breaks.
