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

  const documentRef = useRef<DocumentRecord | null>(null);
  const titleRef = useRef(title);
  const contentRef = useRef<Record<string, JsonValue>>(blankDocumentContent());
  const plainTextRef = useRef("");
  const versionRef = useRef(0);
  const pendingRef = useRef<EditorChangeBatch | null>(null);
  const sequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const conflictRef = useRef(false);
  const remoteDocumentRef = useRef<DocumentRecord | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

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

        window.localStorage.setItem(DOCUMENT_STORAGE_KEY, loaded.id);
        documentRef.current = loaded;
        titleRef.current = loaded.title;
        contentRef.current = loaded.contentJson;
        plainTextRef.current = loaded.plainText;
        versionRef.current = loaded.version;
        setDocument(loaded);
        setTitle(loaded.title);
        setVersion(loaded.version);
        setStatus("saved");
        setMessage("Saved locally");
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
    };
  }, []);

  flushRef.current = async () => {
    const activeDocument = documentRef.current;
    const pending = pendingRef.current;
    if (!activeDocument || !pending || conflictRef.current) return;
    if (saveInFlightRef.current) {
      scheduleSave();
      return;
    }

    pendingRef.current = null;
    saveInFlightRef.current = true;
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
    }
  };

  const queueEditorChange = useCallback(
    (
      content: Record<string, JsonValue>,
      plainText: string,
      batch: EditorChangeBatch,
    ) => {
      contentRef.current = content;
      plainTextRef.current = plainText;
      pendingRef.current = mergeChangeBatches(pendingRef.current, batch);
      setStatus("dirty");
      setMessage("Unsaved changes");
      scheduleSave();
    },
    [scheduleSave],
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

  return {
    document,
    message,
    queueEditorChange,
    reloadSavedVersion,
    saveLocalDraftAfterConflict,
    status,
    title,
    updateTitle,
    version,
  };
}
