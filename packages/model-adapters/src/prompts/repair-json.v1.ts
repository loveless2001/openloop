export const REPAIR_JSON_PROMPT_VERSION = "repair-json.v1";

export const repairJsonSystemPrompt = `Repair the supplied invalid model output so it matches the supplied JSON schema.
Return only strict JSON. Do not repeat or infer any original source text that is not present in the invalid output.`;

export function buildRepairJsonPrompt(
  invalidOutput: string,
  schemaInstructions: string,
): string {
  return `Invalid output:\n${invalidOutput}\n\nSchema instructions:\n${schemaInstructions}`;
}
