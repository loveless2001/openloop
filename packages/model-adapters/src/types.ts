import type { IssueRecord } from "@openloop/core";
import type {
  IssueCandidateSchema,
  ReconcileResultSchema,
  TextBlockSnapshot,
} from "@openloop/shared";
import type { z } from "zod";

export interface CompletionInput {
  requestId: string;
  languageHint?: string;
  documentTitle?: string;
  headingPath: string[];
  prefix: string;
  suffix?: string;
  maxOutputTokens: number;
}

export interface CompletionChunk {
  textDelta: string;
  done: boolean;
}

export interface CriticInput {
  requestId: string;
  documentTitle: string;
  documentVersion: number;
  changedBlocks: TextBlockSnapshot[];
  openIssues: Array<{
    id: string;
    type: string;
    question: string;
    anchorQuote: string;
    status: string;
  }>;
}

export interface ReconcileInput {
  requestId: string;
  documentVersion: number;
  issue: IssueRecord;
  currentBlock?: TextBlockSnapshot;
  nearbyBlocks: TextBlockSnapshot[];
}

export interface ModelAdapter {
  readonly providerId: string;
  readonly capabilities: {
    streaming: boolean;
    jsonSchema: boolean;
    cancellation: boolean;
  };

  streamCompletion(
    input: CompletionInput,
    signal: AbortSignal,
  ): AsyncIterable<CompletionChunk>;

  critique(
    input: CriticInput,
    signal: AbortSignal,
  ): Promise<Array<z.infer<typeof IssueCandidateSchema>>>;

  reconcile(
    input: ReconcileInput,
    signal: AbortSignal,
  ): Promise<z.infer<typeof ReconcileResultSchema>>;
}
