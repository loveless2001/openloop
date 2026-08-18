# Ollama autocomplete benchmark

Measured on 2026-08-19 with Ollama 0.18.3, an NVIDIA GeForce RTX 3060 Laptop GPU
(6 GB), and an AMD Ryzen 7 5800H. The model was `qwen2.5:0.5b` (Q4_K_M, about
398 MB on disk).

## App configuration

- Native Ollama `/api/generate` warm-up and `/api/chat` streaming
- 2,048-token context for both warm-up and inference
- 32 generated tokens for the direct benchmark
- Temperature 0.2
- `keep_alive: 30m` on warm-up and every inference request

## Results

An initial cold runner start took about 25 seconds. Reconfiguring an already loaded model to the
app's 2K context took 6.952 seconds. Five subsequent native streaming calls measured:

| Run | First response byte |  Total |
| --- | ------------------: | -----: |
| 1   |              193 ms | 459 ms |
| 2   |              114 ms | 500 ms |
| 3   |              120 ms | 428 ms |
| 4   |              113 ms | 476 ms |
| 5   |              130 ms | 427 ms |

Median time to first response byte was 120 ms; median total time was 459 ms. After the run,
`ollama ps` reported 730 MB allocated, 100% GPU execution, a 2,048-token context, and 29 minutes of
residency remaining.

The complete OpenLoop HTTP/SSE path, including prompt evaluation and the stream's prefix-echo
filter, produced the insertable suggestion ` the system is optimized for performance and
efficiency` in 714 ms, with the first visible SSE delta at 385 ms.

## Compatibility-endpoint comparison

Ollama's OpenAI-compatible endpoint used a 4K context for this model. Switching from a native 2K
warm-up to that path forced a 21.1-second reload. Once warm, it delivered 115-135 ms first-byte
latency and 228-414 ms total latency, but its requests reset residency to Ollama's shorter default.
The app therefore uses the native API, where context and keep-alive are explicit and identical
between warm-up and inference.

## Verdict

Ollama is suitable for this development autocomplete path on the measured GPU. Its warm steady
state is responsive enough for inline suggestions, its native API keeps the model resident, and it
provides a simple cross-platform model lifecycle. Cold start is not interactive, so the server
warms in the background and the editor suppresses completion requests until readiness is reported.

The main remaining limitation is model quality, not serving latency. The 0.5B model is fast and
occasionally simplistic. A useful next benchmark is an A/B test against a 1.5B model and a
fill-in-the-middle-tuned base model using real accepted/rejected completion traces.

Direct `llama-server` (version 7100 is installed on this machine) is the strongest serving
alternative when explicit fill-in-the-middle templates, speculative decoding, or tighter process
control matter more than Ollama's lifecycle convenience. Browser WebGPU inference is another
privacy-preserving option, but shifts model download, memory pressure, and runtime variability to
every client.
