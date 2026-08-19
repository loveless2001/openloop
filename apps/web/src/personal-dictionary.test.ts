import { describe, expect, it } from "vitest";

import {
  findPersonalDictionarySuggestion,
  formatPersonalDictionary,
  parsePersonalDictionary,
} from "./personal-dictionary.js";

describe("personal dictionary", () => {
  it("completes names, terminology, and phrases from a partial suffix", () => {
    expect(
      findPersonalDictionarySuggestion("We instrument with OpenT", [
        { trigger: "OpenTelemetry", replacement: "OpenTelemetry" },
      ]),
    ).toMatchObject({
      displayText: "elemetry",
      insertText: "elemetry",
      replaceCharacters: 0,
    });

    expect(
      findPersonalDictionarySuggestion("This uses a large lang", [
        {
          trigger: "large language model",
          replacement: "large language model",
        },
      ])?.insertText,
    ).toBe("uage model");
  });

  it("expands an exact abbreviation and prefers the longest trigger", () => {
    expect(
      findPersonalDictionarySuggestion("Ship it btw", [
        { trigger: "bt", replacement: "backtrack" },
        { trigger: "btw", replacement: "by the way" },
      ]),
    ).toMatchObject({
      displayText: " → by the way",
      insertText: "by the way",
      replaceCharacters: 3,
    });
  });

  it("parses plain entries and shortcut expansions without duplicates", () => {
    const entries = parsePersonalDictionary(
      "OpenTelemetry\nbtw => by the way\nopenTelemetry\n",
    );
    expect(entries).toEqual([
      { trigger: "OpenTelemetry", replacement: "OpenTelemetry" },
      { trigger: "btw", replacement: "by the way" },
    ]);
    expect(formatPersonalDictionary(entries)).toBe(
      "OpenTelemetry\nbtw => by the way",
    );
  });

  it("rejects incomplete expansion lines", () => {
    expect(() => parsePersonalDictionary("btw => ")).toThrow(
      "Dictionary line 1 is incomplete.",
    );
  });
});
