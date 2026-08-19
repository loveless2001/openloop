import type { IssueRecord } from "@openloop/core";
import type {
  CriticScope,
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
  scope: CriticScope;
  changedBlocks: TextBlockSnapshot[];
  contextPolicy: {
    canRequestMore: boolean;
    maxRequests: number;
    maxBlocksPerSide: number;
  };
  openIssues: Array<{
    id: string;
    type: string;
    question: string;
    anchorQuote: string;
    status: string;
  }>;
}

export interface CriticContextRequest {
  beforeBlocks: number;
  afterBlocks: number;
}

export interface CriticContextResponse {
  beforeBlocks: TextBlockSnapshot[];
  afterBlocks: TextBlockSnapshot[];
}

export type CriticContextProvider = (
  request: CriticContextRequest,
  signal: AbortSignal,
) => Promise<CriticContextResponse>;

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
    contextProvider?: CriticContextProvider,
  ): Promise<Array<z.infer<typeof IssueCandidateSchema>>>;

  reconcile(
    input: ReconcileInput,
    signal: AbortSignal,
  ): Promise<z.infer<typeof ReconcileResultSchema>>;
}
