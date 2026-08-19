export interface PersonalDictionaryEntry {
  trigger: string;
  replacement: string;
}

export interface PersonalDictionarySuggestion {
  displayText: string;
  insertText: string;
  key: string;
  replaceCharacters: number;
}

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

function isBoundary(value: string, position: number): boolean {
  return position === 0 || !WORD_CHARACTER.test(value[position - 1] ?? "");
}

function endsWithTrigger(prefix: string, trigger: string): boolean {
  if (trigger.length > prefix.length) return false;
  const start = prefix.length - trigger.length;
  return (
    isBoundary(prefix, start) &&
    prefix.slice(start).toLocaleLowerCase() === trigger.toLocaleLowerCase()
  );
}

function longestReplacementPrefix(prefix: string, replacement: string): number {
  const minimumStart = Math.max(0, prefix.length - replacement.length);
  const normalizedReplacement = replacement.toLocaleLowerCase();
  let longest = 0;
  for (let start = minimumStart; start < prefix.length; start += 1) {
    if (!isBoundary(prefix, start)) continue;
    const fragment = prefix.slice(start);
    if (
      fragment.length >= 2 &&
      normalizedReplacement.startsWith(fragment.toLocaleLowerCase()) &&
      fragment.length < replacement.length
    ) {
      longest = Math.max(longest, fragment.length);
    }
  }
  return longest;
}

export function findPersonalDictionarySuggestion(
  prefix: string,
  entries: PersonalDictionaryEntry[],
): PersonalDictionarySuggestion | null {
  const normalizedEntries = entries.filter(
    (entry) => entry.trigger.trim() && entry.replacement.trim(),
  );

  const expansion = normalizedEntries
    .filter(
      (entry) =>
        entry.trigger.toLocaleLowerCase() !==
          entry.replacement.toLocaleLowerCase() &&
        endsWithTrigger(prefix, entry.trigger),
    )
    .sort((left, right) => right.trigger.length - left.trigger.length)[0];
  if (expansion) {
    return {
      displayText: ` → ${expansion.replacement}`,
      insertText: expansion.replacement,
      key: `${expansion.trigger}\u0000${expansion.replacement}`,
      replaceCharacters: expansion.trigger.length,
    };
  }

  let best:
    { entry: PersonalDictionaryEntry; matchedCharacters: number } | undefined;
  for (const entry of normalizedEntries) {
    const matchedCharacters = longestReplacementPrefix(
      prefix,
      entry.replacement,
    );
    if (
      matchedCharacters > 0 &&
      (!best || matchedCharacters > best.matchedCharacters)
    ) {
      best = { entry, matchedCharacters };
    }
  }
  if (!best) return null;
  return {
    displayText: best.entry.replacement.slice(best.matchedCharacters),
    insertText: best.entry.replacement.slice(best.matchedCharacters),
    key: `${best.entry.trigger}\u0000${best.entry.replacement}`,
    replaceCharacters: 0,
  };
}

export function parsePersonalDictionary(
  value: string,
): PersonalDictionaryEntry[] {
  const entries: PersonalDictionaryEntry[] = [];
  const seen = new Set<string>();
  for (const [index, rawLine] of value.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=>");
    const trigger = (separator < 0 ? line : line.slice(0, separator)).trim();
    const replacement = (
      separator < 0 ? line : line.slice(separator + 2)
    ).trim();
    if (!trigger || !replacement) {
      throw new Error(`Dictionary line ${index + 1} is incomplete.`);
    }
    if (trigger.length > 80 || replacement.length > 240) {
      throw new Error(`Dictionary line ${index + 1} is too long.`);
    }
    const key = `${trigger.toLocaleLowerCase()}\u0000${replacement.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ trigger, replacement });
    if (entries.length > 500) {
      throw new Error("The personal dictionary supports up to 500 entries.");
    }
  }
  return entries;
}

export function formatPersonalDictionary(
  entries: PersonalDictionaryEntry[],
): string {
  return entries
    .map((entry) =>
      entry.trigger === entry.replacement
        ? entry.trigger
        : `${entry.trigger} => ${entry.replacement}`,
    )
    .join("\n");
}
