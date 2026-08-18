import type {
  DocumentRecord,
  EditorChangeBatch,
  JsonValue,
} from "@openloop/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiClientError,
  createDocument,
  loadDocument,
  saveDocument,
} from "./api.js";
import { mergeChangeBatches } from "./editor/change-tracker.js";
import { useCriticScheduler } from "./use-critic-scheduler.js";

const DOCUMENT_STORAGE_KEY = "openloop.documentId";

export type SaveStatus =
  "loading" | "saved" | "dirty" | "saving" | "error" | "conflict";

function blankDocumentContent(): Record<string, JsonValue> {
  return {
    type: "doc",
    content: [{ type: "paragraph", attrs: { nodeId: crypto.randomUUID() } }],
  };
}

function emptyChangeBatch(
  documentId: string,
  baseVersion: number,
  sequence: number,
): EditorChangeBatch {
  return {
    documentId,
    baseVersion,
    clientSequence: sequence,
    changedBlocks: [],
    removedNodeIds: [],
    mergedNodeMap: {},
    reason: "format",
  };
}

export function useDocumentSession() {
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [message, setMessage] = useState("Opening local document…");
  const [transientStatus, setTransientStatus] = useState<string | undefined>();

  const documentRef = useRef<DocumentRecord | null>(null);
  const titleRef = useRef(title);
  const contentRef = useRef<Record<string, JsonValue>>(blankDocumentContent());
  const plainTextRef = useRef("");
  const versionRef = useRef(0);
  const pendingRef = useRef<EditorChangeBatch | null>(null);
  const sequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const transientTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const saveCompletionRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);
  const remoteDocumentRef = useRef<DocumentRecord | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

  const activateDocument = useCallback((nextDocument: DocumentRecord) => {
    window.localStorage.setItem(DOCUMENT_STORAGE_KEY, nextDocument.id);
    conflictRef.current = false;
    remoteDocumentRef.current = null;
    pendingRef.current = null;
    documentRef.current = nextDocument;
    titleRef.current = nextDocument.title;
    contentRef.current = nextDocument.contentJson;
    plainTextRef.current = nextDocument.plainText;
    versionRef.current = nextDocument.version;
    setDocument(nextDocument);
    setTitle(nextDocument.title);
    setVersion(nextDocument.version);
    setStatus("saved");
    setMessage("Saved locally");
  }, []);

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => void flushRef.current(),
      __AUTOSAVE_DEBOUNCE_MS__,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function openLocalDocument() {
      try {
        const storedId = window.localStorage.getItem(DOCUMENT_STORAGE_KEY);
        let loaded: DocumentRecord;
        if (storedId) {
          try {
            loaded = await loadDocument(storedId);
          } catch (error) {
            if (
              !(error instanceof ApiClientError) ||
              error.code !== "DOCUMENT_NOT_FOUND"
            ) {
              throw error;
            }
            window.localStorage.removeItem(DOCUMENT_STORAGE_KEY);
            loaded = await createDocument("Untitled", blankDocumentContent());
          }
        } else {
          loaded = await createDocument("Untitled", blankDocumentContent());
        }
        if (cancelled) return;

        activateDocument(loaded);
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not open the document.",
        );
      }
    }

    void openLocalDocument();
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (transientTimerRef.current !== null) {
        window.clearTimeout(transientTimerRef.current);
      }
    };
  }, [activateDocument]);

  const reportTransientStatus = useCallback(
    (nextMessage?: string, durationMs?: number) => {
      if (transientTimerRef.current !== null) {
        window.clearTimeout(transientTimerRef.current);
        transientTimerRef.current = null;
      }
      setTransientStatus(nextMessage);
      if (nextMessage && durationMs) {
        transientTimerRef.current = window.setTimeout(() => {
          setTransientStatus(undefined);
          transientTimerRef.current = null;
        }, durationMs);
      }
    },
    [],
  );

  flushRef.current = async () => {
    const activeDocument = documentRef.current;
    const pending = pendingRef.current;
    if (!activeDocument || conflictRef.current) return;
    if (saveInFlightRef.current) {
      await saveCompletionRef.current;
      if (pendingRef.current && !conflictRef.current) {
        await flushRef.current();
      }
      return;
    }
    if (!pending) return;

    pendingRef.current = null;
    saveInFlightRef.current = true;
    let finishSave: () => void = () => undefined;
    saveCompletionRef.current = new Promise((resolve) => {
      finishSave = resolve;
    });
    setStatus("saving");
    setMessage("Saving…");
    const submitted = { ...pending, baseVersion: versionRef.current };

    try {
      const saved = await saveDocument({
        documentId: activeDocument.id,
        baseVersion: versionRef.current,
        title: titleRef.current,
        contentJson: contentRef.current,
        plainText: plainTextRef.current,
        changeBatch: submitted,
      });
      documentRef.current = saved;
      versionRef.current = saved.version;
      setVersion(saved.version);
      if (pendingRef.current) {
        setStatus("dirty");
        setMessage("Unsaved changes");
        scheduleSave();
      } else {
        setStatus("saved");
        setMessage("Saved locally");
      }
    } catch (error) {
      pendingRef.current = mergeChangeBatches(
        submitted,
        pendingRef.current ?? submitted,
      );
      if (
        error instanceof ApiClientError &&
        error.code === "DOCUMENT_VERSION_CONFLICT"
      ) {
        conflictRef.current = true;
        try {
          const latest = await loadDocument(activeDocument.id);
          remoteDocumentRef.current = latest;
          versionRef.current = latest.version;
          setVersion(latest.version);
        } catch {
          // Preserve the original conflict; the writer's local draft remains untouched.
        }
        setStatus("conflict");
        setMessage(
          "A newer saved version exists. Your local draft was not overwritten.",
        );
      } else {
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Save failed. Your draft is retained.",
        );
      }
    } finally {
      saveInFlightRef.current = false;
      finishSave();
      saveCompletionRef.current = null;
    }
  };

  const critic = useCriticScheduler({
    flushDocument: () => flushRef.current(),
    getDocument: () => documentRef.current,
    getDocumentVersion: () => versionRef.current,
    isBlocked: () => conflictRef.current,
    reportStatus: reportTransientStatus,
  });

  const queueEditorChange = useCallback(
    (
      content: Record<string, JsonValue>,
      plainText: string,
      batch: EditorChangeBatch,
    ) => {
      contentRef.current = content;
      plainTextRef.current = plainText;
      pendingRef.current = mergeChangeBatches(pendingRef.current, batch);
      critic.queueChange(batch);
      setStatus("dirty");
      setMessage("Unsaved changes");
      scheduleSave();
    },
    [critic, scheduleSave],
  );

  const updateTitle = (nextTitle: string) => {
    const activeDocument = documentRef.current;
    setTitle(nextTitle);
    titleRef.current = nextTitle;
    if (!activeDocument || !nextTitle.trim()) return;
    sequenceRef.current += 1;
    pendingRef.current = mergeChangeBatches(
      pendingRef.current,
      emptyChangeBatch(
        activeDocument.id,
        versionRef.current,
        sequenceRef.current,
      ),
    );
    setStatus("dirty");
    setMessage("Unsaved changes");
    scheduleSave();
  };

  const reloadSavedVersion = () => {
    const latest = remoteDocumentRef.current;
    if (!latest) return;
    conflictRef.current = false;
    remoteDocumentRef.current = null;
    pendingRef.current = null;
    documentRef.current = latest;
    contentRef.current = latest.contentJson;
    plainTextRef.current = latest.plainText;
    titleRef.current = latest.title;
    versionRef.current = latest.version;
    setDocument(latest);
    setTitle(latest.title);
    setVersion(latest.version);
    setStatus("saved");
    setMessage("Reloaded the saved version");
  };

  const saveLocalDraftAfterConflict = () => {
    conflictRef.current = false;
    remoteDocumentRef.current = null;
    setStatus("dirty");
    setMessage("Unsaved changes");
    scheduleSave();
  };

  const createFreshDocument = useCallback(
    async (nextTitle: string, contentJson: Record<string, JsonValue>) => {
      try {
        await flushRef.current();
        const created = await createDocument(nextTitle, contentJson);
        activateDocument(created);
        return created;
      } catch (error) {
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not create the document.",
        );
        throw error;
      }
    },
    [activateDocument],
  );

  const saveNow = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await flushRef.current();
    reportTransientStatus("Saved locally", 1_500);
  }, [reportTransientStatus]);

  return {
    document,
    createFreshDocument,
    message: transientStatus ?? message,
    queueEditorChange,
    reportTransientStatus,
    requestCritic: critic.request,
    reloadSavedVersion,
    saveLocalDraftAfterConflict,
    saveNow,
    status,
    setCriticComposing: critic.setComposing,
    title,
    updateTitle,
    version,
  };
}
