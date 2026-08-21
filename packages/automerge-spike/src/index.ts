import * as Automerge from "@automerge/automerge";

export interface SpikeDocument {
  [key: string]: unknown;
  text: string;
}

export interface CursorAnchor {
  startCursor: string;
  endCursor: string;
  quote: string;
}

export interface ResolvedCursorAnchor {
  state: "attached" | "unanchored";
  start: number;
  end: number;
  currentText: string;
}

export interface TextSuggestion {
  expectedText: string;
  replacement: string;
}

export function createSpikeDocument(
  text: string,
): Automerge.Doc<SpikeDocument> {
  return Automerge.from<SpikeDocument>({ text });
}

export function createCursorAnchor(
  document: Automerge.Doc<SpikeDocument>,
  start: number,
  end: number,
): CursorAnchor {
  if (start < 0 || end < start || end > document.text.length) {
    throw new RangeError("Anchor range is outside the document.");
  }
  return {
    startCursor: Automerge.getCursor(document, ["text"], start, "after"),
    endCursor: Automerge.getCursor(document, ["text"], end, "before"),
    quote: document.text.slice(start, end),
  };
}

export function resolveCursorAnchor(
  document: Automerge.Doc<SpikeDocument>,
  anchor: CursorAnchor,
): ResolvedCursorAnchor {
  const start = Automerge.getCursorPosition(
    document,
    ["text"],
    anchor.startCursor,
  );
  const end = Automerge.getCursorPosition(document, ["text"], anchor.endCursor);
  const currentText = document.text.slice(start, end);
  return {
    state: currentText === anchor.quote ? "attached" : "unanchored",
    start,
    end,
    currentText,
  };
}

export function spliceText(
  document: Automerge.Doc<SpikeDocument>,
  start: number,
  deleteCount: number,
  insertion: string,
  message = "writer edit",
): Automerge.Doc<SpikeDocument> {
  return Automerge.change(document, message, (draft) => {
    Automerge.splice(draft, ["text"], start, deleteCount, insertion);
  });
}

export function forkForCritic(
  document: Automerge.Doc<SpikeDocument>,
): Automerge.Doc<SpikeDocument> {
  return Automerge.clone(document);
}

export function mergeCriticBranch(
  document: Automerge.Doc<SpikeDocument>,
  criticBranch: Automerge.Doc<SpikeDocument>,
): Automerge.Doc<SpikeDocument> {
  return Automerge.merge(document, criticBranch);
}

/**
 * Selective acceptance is intentionally an application operation. Automerge
 * can merge a whole branch, but accepting one suggestion safely still needs
 * an expected-text precondition and a new change on the writer's branch.
 */
export function applyTextSuggestion(
  document: Automerge.Doc<SpikeDocument>,
  suggestion: TextSuggestion,
): Automerge.Doc<SpikeDocument> {
  const start = document.text.indexOf(suggestion.expectedText);
  if (
    start < 0 ||
    document.text.indexOf(suggestion.expectedText, start + 1) >= 0
  ) {
    throw new Error("Suggestion target is missing or ambiguous.");
  }
  return spliceText(
    document,
    start,
    suggestion.expectedText.length,
    suggestion.replacement,
    "accept critic suggestion",
  );
}

export function changesSince(
  document: Automerge.Doc<SpikeDocument>,
  heads: Automerge.Heads,
): Automerge.Change[] {
  return Automerge.getChangesSince(document, heads);
}
