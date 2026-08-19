export function selectionRequiresWarning(
  wordCount: number,
  warningThreshold: number,
): boolean {
  return wordCount > warningThreshold;
}
