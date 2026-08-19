import type {
  CriticTrigger,
  DocumentRecord,
  EditorChangeBatch,
} from "@openloop/shared";
import { useCallback, useEffect, useRef } from "react";

import { submitCriticJob } from "./api.js";
import type { AppSettings } from "./app-settings.js";
import { mergeChangeBatches } from "./editor/change-tracker.js";

interface CriticSchedulerOptions {
  settings: AppSettings;
  flushDocument: () => Promise<void>;
  getDocument: () => DocumentRecord | null;
  getDocumentVersion: () => number;
  isBlocked: () => boolean;
  reportStatus: (message?: string, durationMs?: number) => void;
}

export function useCriticScheduler(options: CriticSchedulerOptions) {
  const optionsRef = useRef(options);
  const pendingRef = useRef<EditorChangeBatch | null>(null);
  const composingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const accumulatedWordsRef = useRef(0);
  const submitRef = useRef<(trigger: CriticTrigger) => Promise<void>>(
    async () => undefined,
  );
  optionsRef.current = options;

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback(() => {
    cancelTimer();
    const settings = optionsRef.current.settings;
    if (
      !settings.criticIdleEnabled ||
      composingRef.current ||
      !pendingRef.current
    )
      return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void submitRef.current("idle");
    }, settings.criticIdleDelayMs);
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);

  useEffect(() => {
    schedule();
  }, [
    options.settings.criticIdleDelayMs,
    options.settings.criticIdleEnabled,
    schedule,
  ]);

  submitRef.current = async (trigger) => {
    const activeOptions = optionsRef.current;
    const settings = activeOptions.settings;
    if (
      (trigger === "idle" && !settings.criticIdleEnabled) ||
      (trigger === "paragraph_end" && !settings.criticParagraphEndEnabled) ||
      (trigger === "heading_created" &&
        !settings.criticHeadingCreatedEnabled) ||
      (trigger === "word_threshold" && !settings.criticWordThresholdEnabled)
    ) {
      return;
    }
    const document = activeOptions.getDocument();
    const pending = pendingRef.current;
    if (!document || activeOptions.isBlocked()) return;
    if (pending && pending.documentId !== document.id) {
      pendingRef.current = null;
      accumulatedWordsRef.current = 0;
      return;
    }
    if (!pending) {
      if (trigger === "manual") {
        activeOptions.reportStatus("No changed text to critique", 1_500);
      }
      return;
    }
    if (composingRef.current) {
      schedule();
      return;
    }

    cancelTimer();
    pendingRef.current = null;
    const submittedWordCount = accumulatedWordsRef.current;
    accumulatedWordsRef.current = 0;
    await activeOptions.flushDocument();
    if (activeOptions.isBlocked()) {
      if (pending) {
        pendingRef.current = pending;
        accumulatedWordsRef.current += submittedWordCount;
      }
      return;
    }
    try {
      await submitCriticJob(document.id, {
        requestId: crypto.randomUUID(),
        documentVersion: activeOptions.getDocumentVersion(),
        trigger,
        changedBlocks: pending.changedBlocks,
      });
      activeOptions.reportStatus("Critic queued…", 1_200);
    } catch (error) {
      if (pending) {
        pendingRef.current = mergeChangeBatches(
          pending,
          pendingRef.current ?? pending,
        );
        accumulatedWordsRef.current += submittedWordCount;
      }
      activeOptions.reportStatus(
        error instanceof Error ? error.message : "Critic unavailable",
        2_500,
      );
    }
  };

  const queueChange = useCallback(
    (batch: EditorChangeBatch) => {
      const meaningfulBlocks = batch.changedBlocks.filter(
        (block) =>
          block.text.replace(/\s/g, "") !==
          (block.previousText ?? "").replace(/\s/g, ""),
      );
      if (meaningfulBlocks.length === 0) return;
      if (
        pendingRef.current &&
        pendingRef.current.documentId !== batch.documentId
      ) {
        accumulatedWordsRef.current = 0;
      }
      pendingRef.current = mergeChangeBatches(pendingRef.current, {
        ...batch,
        changedBlocks: meaningfulBlocks,
      });
      accumulatedWordsRef.current += meaningfulBlocks.reduce(
        (total, block) =>
          total +
          Math.max(
            0,
            countWords(block.text) - countWords(block.previousText ?? ""),
          ),
        0,
      );
      const settings = optionsRef.current.settings;
      if (
        settings.criticWordThresholdEnabled &&
        accumulatedWordsRef.current >= settings.criticWordThreshold
      ) {
        void submitRef.current("word_threshold");
        return;
      }
      schedule();
    },
    [schedule],
  );

  const request = useCallback((trigger: CriticTrigger) => {
    void submitRef.current(trigger);
  }, []);

  const setComposing = useCallback(
    (composing: boolean) => {
      composingRef.current = composing;
      if (composing) cancelTimer();
      else schedule();
    },
    [cancelTimer, schedule],
  );

  return { queueChange, request, setComposing };
}

export function countWords(value: string): number {
  return (
    value.match(
      /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu,
    )?.length ?? 0
  );
}
