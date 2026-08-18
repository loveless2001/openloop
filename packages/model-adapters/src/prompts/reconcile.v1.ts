import type { ReconcileInput } from "../types.js";

export const RECONCILE_PROMPT_VERSION = "reconcile.v1";

export const reconcileSystemPrompt = `You are checking whether a previously recorded editorial objection still applies after the author edited the relevant passage.
Classify only one of:
- persists: the same underlying problem remains;
- resolved: the new text directly addresses the objection;
- invalidated: the claim or passage no longer exists and the objection is no longer relevant;
- uncertain: the available local context is insufficient.
Do not create a new objection.
If the issue persists but moved, return an exact newAnchorQuote from the current text.
Return strict JSON matching the supplied schema.`;

export function buildReconcilePrompt(input: ReconcileInput): string {
  return JSON.stringify(input);
}
