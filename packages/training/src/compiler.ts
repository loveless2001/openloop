import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import type {
  CompletionCandidateTraceV2,
  CompletionFeedbackTraceV2,
  CompletionReplacementTraceV2,
  ContinuationExample,
  CptExample,
  DatasetSplit,
  NaturalContinuationTraceV2,
  PipelineConfig,
  PreferenceExample,
  TrainingTraceV2,
} from "./schemas.js";
import { TrainingTraceV2Schema } from "./schemas.js";

export interface SourceDocument {
  sourceId: string;
  text: string;
}

export interface CompiledDatasets {
  cpt: CptExample[];
  continuations: ContinuationExample[];
  preferences: PreferenceExample[];
  warnings: string[];
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function splitForGroup(
  group: string,
  seed: string,
  split: PipelineConfig["data"]["split"],
): DatasetSplit {
  const total = split.train + split.validation + split.test;
  const value = Number.parseInt(
    sha256(`${seed}\u0000${group}`).slice(0, 12),
    16,
  );
  const fraction = value / 0xffffffffffff;
  const trainBoundary = split.train / total;
  const validationBoundary = (split.train + split.validation) / total;
  if (fraction < trainBoundary) return "train";
  if (fraction < validationBoundary) return "validation";
  return "test";
}

function candidateGroups(records: TrainingTraceV2[]) {
  const candidates = new Map<string, CompletionCandidateTraceV2>();
  const feedback = new Map<string, CompletionFeedbackTraceV2[]>();
  const replacements = new Map<string, CompletionReplacementTraceV2>();
  const natural: NaturalContinuationTraceV2[] = [];
  for (const record of records) {
    if (record.type === "completion_candidate") {
      candidates.set(record.candidateId, record);
    } else if (record.type === "completion_feedback") {
      const current = feedback.get(record.candidateId) ?? [];
      current.push(record);
      feedback.set(record.candidateId, current);
    } else if (record.type === "completion_replacement") {
      replacements.set(record.candidateId, record);
    } else {
      natural.push(record);
    }
  }
  return { candidates, feedback, replacements, natural };
}

function acceptedCharacters(events: CompletionFeedbackTraceV2[]): number {
  return events.reduce(
    (total, event) =>
      event.event === "completion_accepted_full" ||
      event.event === "completion_accepted_word"
        ? total + (event.acceptedCharacters ?? 0)
        : total,
    0,
  );
}

function compileTraceRecords(
  records: TrainingTraceV2[],
  config: PipelineConfig,
): Pick<CompiledDatasets, "continuations" | "preferences" | "warnings"> {
  const continuations: ContinuationExample[] = [];
  const preferences: PreferenceExample[] = [];
  const warnings: string[] = [];
  const grouped = candidateGroups(records);

  for (const natural of grouped.natural) {
    continuations.push({
      schemaVersion: 1,
      id: stableId({ type: natural.type, sampleId: natural.sampleId }),
      split: splitForGroup(natural.documentId, config.seed, config.data.split),
      sourceId: natural.sampleId,
      provenance: "natural_continuation",
      documentTitle: natural.documentTitle,
      headingPath: natural.headingPath,
      prefix: natural.prefix,
      suffix: natural.suffix,
      target: natural.continuation,
    });
  }

  for (const [candidateId, candidate] of grouped.candidates) {
    if (
      candidate.source !== "model" ||
      candidate.status !== "completed" ||
      !candidate.suggestion
    ) {
      continue;
    }
    const events = (grouped.feedback.get(candidateId) ?? []).sort(
      (left, right) => left.recordedAt.localeCompare(right.recordedAt),
    );
    const accepted = Math.min(
      acceptedCharacters(events),
      candidate.suggestion.length,
    );
    if (accepted > 0) {
      continuations.push({
        schemaVersion: 1,
        id: stableId({ type: "accepted", candidateId, accepted }),
        split: splitForGroup(
          candidate.documentId,
          config.seed,
          config.data.split,
        ),
        sourceId: candidateId,
        provenance: "accepted_suggestion",
        documentTitle: candidate.documentTitle,
        headingPath: candidate.headingPath,
        prefix: candidate.prefix,
        suffix: candidate.suffix,
        target: candidate.suggestion.slice(0, accepted),
      });
    }

    const rejected = events.some(
      (event) => event.event === "completion_rejected",
    );
    const replacement = grouped.replacements.get(candidateId);
    const rejectedRemainder = candidate.suggestion.slice(accepted);
    if (rejected && replacement && rejectedRemainder.trim()) {
      preferences.push({
        schemaVersion: 1,
        id: stableId({ type: "preference", candidateId }),
        split: splitForGroup(
          candidate.documentId,
          config.seed,
          config.data.split,
        ),
        sourceId: candidateId,
        labelType: "explicit_rejection_with_replacement",
        documentTitle: candidate.documentTitle,
        headingPath: candidate.headingPath,
        prefix: `${candidate.prefix}${candidate.suggestion.slice(0, accepted)}`,
        suffix: candidate.suffix,
        chosen: replacement.replacementText,
        rejected: rejectedRemainder,
      });
    } else if (rejected && !replacement) {
      warnings.push(
        `Candidate ${candidateId} is rejected without replacement text.`,
      );
    }
  }

  for (const candidateId of grouped.feedback.keys()) {
    if (!grouped.candidates.has(candidateId)) {
      warnings.push(`Feedback references missing candidate ${candidateId}.`);
    }
  }

  return { continuations, preferences, warnings };
}

function fimExample(
  sourceId: string,
  split: DatasetSplit,
  text: string,
  chunkIndex: number,
): CptExample {
  const first = Math.floor(text.length / 3);
  const second = Math.floor((text.length * 2) / 3);
  return {
    schemaVersion: 1,
    id: stableId({ sourceId, chunkIndex, objective: "fim", text }),
    split,
    sourceId,
    objective: "fim",
    text,
    prefix: text.slice(0, first),
    middle: text.slice(first, second),
    suffix: text.slice(second),
  };
}

function compileCorpus(
  documents: SourceDocument[],
  config: PipelineConfig,
): Pick<CompiledDatasets, "cpt" | "continuations"> {
  const cpt: CptExample[] = [];
  const continuations: ContinuationExample[] = [];
  const seenChunks = new Set<string>();
  for (const document of documents) {
    const split = splitForGroup(
      document.sourceId,
      config.seed,
      config.data.split,
    );
    const chunkSize = config.data.cptChunkCharacters;
    for (
      let offset = 0, chunkIndex = 0;
      offset < document.text.length;
      offset += chunkSize, chunkIndex += 1
    ) {
      const text = document.text.slice(offset, offset + chunkSize).trim();
      if (!text) continue;
      const contentHash = sha256(text);
      if (seenChunks.has(contentHash)) continue;
      seenChunks.add(contentHash);
      const fimFraction =
        Number.parseInt(
          sha256(
            `${config.seed}\u0000${document.sourceId}\u0000${chunkIndex}`,
          ).slice(0, 12),
          16,
        ) / 0xffffffffffff;
      cpt.push(
        fimFraction < config.data.fimRate && text.length >= 96
          ? fimExample(document.sourceId, split, text, chunkIndex)
          : {
              schemaVersion: 1,
              id: stableId({
                sourceId: document.sourceId,
                chunkIndex,
                objective: "causal",
                text,
              }),
              split,
              sourceId: document.sourceId,
              objective: "causal",
              text,
            },
      );
    }

    const prefixLength = config.data.continuationPrefixCharacters;
    const targetLength = config.data.continuationTargetCharacters;
    for (
      let offset = Math.min(prefixLength, document.text.length);
      offset < document.text.length;
      offset += targetLength
    ) {
      const target = document.text.slice(offset, offset + targetLength).trim();
      if (!target) continue;
      const prefix = document.text.slice(
        Math.max(0, offset - prefixLength),
        offset,
      );
      continuations.push({
        schemaVersion: 1,
        id: stableId({
          type: "corpus-continuation",
          sourceId: document.sourceId,
          offset,
          prefix,
          target,
        }),
        split,
        sourceId: document.sourceId,
        provenance: "natural_continuation",
        documentTitle: basename(document.sourceId, extname(document.sourceId)),
        headingPath: [],
        prefix,
        suffix: "",
        target,
      });
    }
  }
  return { cpt, continuations };
}

export function compileDatasets(input: {
  config: PipelineConfig;
  records: TrainingTraceV2[];
  documents: SourceDocument[];
}): CompiledDatasets {
  const trace = compileTraceRecords(input.records, input.config);
  const corpus = compileCorpus(input.documents, input.config);
  return {
    cpt: corpus.cpt.sort((left, right) => left.id.localeCompare(right.id)),
    continuations: [...trace.continuations, ...corpus.continuations].sort(
      (left, right) => left.id.localeCompare(right.id),
    ),
    preferences: trace.preferences.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    warnings: [...new Set(trace.warnings)].sort(),
  };
}

async function filesUnder(
  path: string,
  extensions: Set<string>,
): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile())
    return extensions.has(extname(path).toLowerCase()) ? [path] : [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => filesUnder(resolve(path, entry.name), extensions)),
  );
  return nested.flat();
}

export async function loadTraceRecords(
  paths: string[],
): Promise<TrainingTraceV2[]> {
  const files = (
    await Promise.all(
      paths.map((path) => filesUnder(resolve(path), new Set([".jsonl"]))),
    )
  ).flat();
  const records: TrainingTraceV2[] = [];
  for (const file of files.sort()) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as unknown;
      const result = TrainingTraceV2Schema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `Invalid trace at ${file}:${index + 1}: ${result.error.message}`,
        );
      }
      records.push(result.data);
    }
  }
  return records;
}

export async function loadSourceDocuments(
  paths: string[],
): Promise<SourceDocument[]> {
  const extensions = new Set([".md", ".markdown", ".txt"]);
  const files = (
    await Promise.all(
      paths.map((path) => filesUnder(resolve(path), extensions)),
    )
  ).flat();
  return Promise.all(
    files.sort().map(async (file) => ({
      sourceId: file,
      text: await readFile(file, "utf8"),
    })),
  );
}
