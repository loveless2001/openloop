export { tipTapJsonToPlainText } from "./plain-text.js";
export type { IssueAnchor, IssueRecord } from "./issues.js";
export {
  coreQuestion,
  InvalidIssueTransitionError,
  normalizeIssueText,
  tokenJaccard,
  transitionIssue,
} from "./issues.js";
export type { IssueDomainEvent, IssueTransitionResult } from "./issues.js";
export {
  applyReconciliationResult,
  normalizedLevenshteinSimilarity,
  remapIssueAnchor,
} from "./reconciliation.js";
export type {
  AnchorRemapKind,
  AnchorRemapResult,
  ReconciliationTransitionResult,
} from "./reconciliation.js";
export {
  GLOBAL_INTERRUPTION_COOLDOWN_MS,
  ISSUE_BASE_COOLDOWN_MS,
  MAX_AUTOMATIC_SHOWS_PER_ISSUE,
  rankResurfaceIssues,
  selectResurfaceIssue,
  SILENT_IGNORE_EXTRA_COOLDOWN_MS,
} from "./resurfacing.js";
export type {
  RankedResurfaceIssue,
  ResurfaceSelectionInput,
  ResurfaceTrigger,
} from "./resurfacing.js";
