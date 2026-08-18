import type {
  CriticTrigger,
  DocumentRecord,
  EditorChangeBatch,
} from "@openloop/shared";
import { useCallback, useEffect, useRef } from "react";

import { submitCriticJob } from "./api.js";
import { mergeChangeBatches } from "./editor/change-tracker.js";

interface CriticSchedulerOptions {
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
    if (composingRef.current || !pendingRef.current) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void submitRef.current("idle");
    }, __CRITIC_IDLE_MS__);
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);

  submitRef.current = async (trigger) => {
    const activeOptions = optionsRef.current;
    const document = activeOptions.getDocument();
    const pending = pendingRef.current;
    if (!document || activeOptions.isBlocked()) return;
    if (pending && pending.documentId !== document.id) {
      pendingRef.current = null;
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
    await activeOptions.flushDocument();
    if (activeOptions.isBlocked()) {
      if (pending) pendingRef.current = pending;
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
      pendingRef.current = mergeChangeBatches(pendingRef.current, {
        ...batch,
        changedBlocks: meaningfulBlocks,
      });
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
