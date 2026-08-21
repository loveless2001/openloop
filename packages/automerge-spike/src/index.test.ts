import * as Automerge from "@automerge/automerge";
import { describe, expect, it } from "vitest";

import {
  applyTextSuggestion,
  changesSince,
  createCursorAnchor,
  createSpikeDocument,
  forkForCritic,
  mergeCriticBranch,
  resolveCursorAnchor,
  spliceText,
} from "./index.js";

describe("Automerge document substrate spike", () => {
  it("keeps a cursor anchor attached through edits before it and block splits", () => {
    const quote = "any model will work equally well";
    let document = createSpikeDocument(`Claim: ${quote}. Conclusion.`);
    const anchor = createCursorAnchor(
      document,
      document.text.indexOf(quote),
      document.text.indexOf(quote) + quote.length,
    );

    document = spliceText(document, 0, 0, "Draft. ");
    document = spliceText(
      document,
      document.text.indexOf(" Conclusion"),
      1,
      "\n",
    );

    expect(resolveCursorAnchor(document, anchor)).toMatchObject({
      state: "attached",
      currentText: quote,
    });
  });

  it("reports an explicit unanchored state when the selected claim is deleted", () => {
    const quote = "unsupported claim";
    let document = createSpikeDocument(`Before ${quote} after`);
    const start = document.text.indexOf(quote);
    const anchor = createCursorAnchor(document, start, start + quote.length);
    document = spliceText(document, start, quote.length, "revised argument");

    expect(resolveCursorAnchor(document, anchor).state).toBe("unanchored");
  });

  it("isolates critic edits on a fork and records mergeable history", () => {
    const main = createSpikeDocument("The argument is vague.");
    const mainHeads = Automerge.getHeads(main);
    let critic = forkForCritic(main);
    critic = spliceText(critic, 16, 5, "specific", "critic rewrite");

    expect(main.text).toBe("The argument is vague.");
    expect(changesSince(critic, mainHeads)).toHaveLength(1);
    expect(mergeCriticBranch(main, critic).text).toBe(
      "The argument is specific.",
    );
  });

  it("accepts one bot suggestion without merging unrelated branch edits", () => {
    const main = createSpikeDocument("Claim one. Claim two.");
    let critic = forkForCritic(main);
    critic = spliceText(critic, 0, "Claim one".length, "Supported claim one");
    critic = spliceText(
      critic,
      critic.text.indexOf("Claim two"),
      "Claim two".length,
      "Deleted claim two",
    );

    const accepted = applyTextSuggestion(main, {
      expectedText: "Claim one",
      replacement: "Supported claim one",
    });
    expect(accepted.text).toBe("Supported claim one. Claim two.");
    expect(accepted.text).not.toBe(critic.text);
  });
});
