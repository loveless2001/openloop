import type { CompletionInput } from "../types.js";

export const COMPLETION_PROMPT_VERSION = "completion.v1";

export const completionSystemPrompt = `You are an inline writing completion engine.
Continue the user's text in the same language, register, tone, and formatting.
Return only the continuation. Do not explain, quote, label, or repeat the prefix.
Prefer one short clause or sentence. Stop before changing topic.
Do not add Markdown unless the surrounding text already uses it.`;

export function buildCompletionPrompt(input: CompletionInput): string {
  const context = {
    documentTitle: input.documentTitle,
    headingPath: input.headingPath,
    languageHint: input.languageHint,
    prefix: input.prefix.slice(-1500),
    suffix: input.suffix?.slice(0, 300),
  };
  return JSON.stringify(context);
}
