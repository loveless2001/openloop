import { useCallback, useEffect, useRef, useState } from "react";

import { loadModelStatus } from "./api.js";
import {
  OpenLoopEditor,
  type OpenLoopEditorHandle,
} from "./editor/OpenLoopEditor.js";
import { IssuePanel } from "./IssuePanel.js";
import { FileMenu, markdownFilename } from "./FileMenu.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { useAppSettings } from "./use-app-settings.js";
import { useDocumentSession } from "./use-document-session.js";
import { useIssueLedger } from "./use-issue-ledger.js";

export function App() {
  const appSettings = useAppSettings();
  const session = useDocumentSession(appSettings.settings);
  const editorRef = useRef<OpenLoopEditorHandle>(null);
  const [modelLabel, setModelLabel] = useState("Checking model…");
  const [modelStatus, setModelStatus] = useState<Awaited<
    ReturnType<typeof loadModelStatus>
  > | null>(null);
  const [completionReady, setCompletionReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ledger = useIssueLedger({
    documentId: session.document?.id,
    documentVersion: session.version,
    onStatus: session.reportTransientStatus,
  });

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const check = async () => {
      try {
        const status = await loadModelStatus();
        if (!active) return;
        setModelStatus(status);
        setCompletionReady(status.state === "ready");
        const providerLabel =
          status.mode === "offline"
            ? "Mock · offline"
            : status.mode === "local"
              ? `Local · ${status.completionModel}`
              : `${status.provider} · ${status.completionModel}`;
        setModelLabel(
          status.state === "ready"
            ? providerLabel
            : status.state === "warming"
              ? `${providerLabel} · warming`
              : `${providerLabel} · unavailable`,
        );
        if (status.state !== "ready") {
          timer = window.setTimeout(
            () => void check(),
            status.state === "warming" ? 1_000 : 3_000,
          );
        }
      } catch {
        if (active) {
          setCompletionReady(false);
          setModelLabel("Model unavailable");
        }
      }
    };
    void check();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const newDocument = useCallback(async () => {
    await session.createFreshDocument("Untitled", {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: crypto.randomUUID() } }],
    });
  }, [session.createFreshDocument]);

  const openMarkdown = useCallback(
    async (file: File) => {
      const markdown = await file.text();
      const content = editorRef.current?.parseMarkdown(markdown);
      if (!content) throw new Error("The editor is not ready.");
      const title = file.name.replace(/\.(?:md|markdown)$/i, "") || "Untitled";
      await session.createFreshDocument(title, content);
      session.reportTransientStatus(`Opened ${file.name}`, 2_000);
    },
    [session.createFreshDocument, session.reportTransientStatus],
  );

  const downloadMarkdown = useCallback(() => {
    const markdown = editorRef.current?.getMarkdown();
    if (markdown === undefined) return;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = markdownFilename(session.title);
    link.click();
    URL.revokeObjectURL(url);
    session.reportTransientStatus(`Downloaded ${link.download}`, 2_000);
  }, [session.reportTransientStatus, session.title]);

  if (!session.document) {
    return (
      <main className="loading-shell" role="status">
        <span className="brand-mark">O</span>
        <p>{session.message}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-area">
          <div className="brand">
            <span className="brand-mark">O</span>
            <span>OpenLoop</span>
          </div>
          <FileMenu
            documentTitle={session.title}
            onDownload={downloadMarkdown}
            onNew={newDocument}
            onOpen={openMarkdown}
            onSave={session.saveNow}
          />
        </div>
        <input
          aria-label="Document title"
          className="document-title"
          maxLength={200}
          onChange={(event) => session.updateTitle(event.target.value)}
          value={session.title}
        />
        <div className="top-actions">
          <button
            className="critique-button"
            onClick={() => session.requestCritic("manual")}
            type="button"
          >
            Critique now
          </button>
          <button
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            Settings
          </button>
          <span className="phase-badge" title="Active autocomplete provider">
            {modelLabel}
          </span>
        </div>
      </header>

      <main className="workspace">
        <section className="editor-pane" aria-label="Editor pane">
          <div className="paper">
            <OpenLoopEditor
              baseVersion={session.version}
              completionDebounceMs={appSettings.settings.completionDebounceMs}
              completionBlocked={
                session.status === "conflict" || !completionReady
              }
              content={session.document.contentJson}
              dictionaryEnabled={appSettings.settings.dictionaryEnabled}
              dictionaryEntries={appSettings.settings.dictionaryEntries}
              documentId={session.document.id}
              issues={ledger.issues}
              key={`${session.document.id}:${session.document.updatedAt}`}
              onCompletionStatus={session.reportTransientStatus}
              onCompositionChange={session.setCriticComposing}
              onCriticTrigger={session.requestCritic}
              onChange={session.queueEditorChange}
              onSelectIssue={(issueId) => {
                const issue = ledger.issues.find(
                  (entry) => entry.id === issueId,
                );
                ledger.selectIssue(issueId);
                if (issue) editorRef.current?.focusIssue(issue);
              }}
              ref={editorRef}
              selectedIssueId={ledger.selectedIssueId}
            />
          </div>
        </section>
        <IssuePanel
          actionPending={ledger.actionPending}
          events={ledger.events}
          issues={ledger.issues}
          onAction={(issue, action) => {
            void ledger.act(issue, action).then((operation) => {
              if (
                operation &&
                !editorRef.current?.applyOperation(
                  operation,
                  issue.anchor.quote,
                )
              ) {
                session.reportTransientStatus(
                  "The anchored text changed before the rewrite could be applied.",
                  2_500,
                );
              }
            });
          }}
          onSelect={(issue) => {
            ledger.selectIssue(issue?.id);
            if (issue) editorRef.current?.focusIssue(issue);
          }}
          selectedIssue={ledger.selectedIssue}
        />
      </main>

      <footer className="status-bar" data-status={session.status}>
        <span className="status-dot" aria-hidden="true" />
        <span
          role={
            session.status === "error" || session.status === "conflict"
              ? "alert"
              : "status"
          }
        >
          {session.message}
        </span>
        <span className="version">Version {session.version}</span>
      </footer>

      {session.status === "conflict" ? (
        <div className="dialog-backdrop">
          <section
            aria-describedby="conflict-description"
            aria-labelledby="conflict-title"
            aria-modal="true"
            className="conflict-dialog"
            role="dialog"
          >
            <p className="eyebrow">Save conflict</p>
            <h2 id="conflict-title">A newer saved version exists</h2>
            <p id="conflict-description">
              Your local draft is still intact. Reload the saved version, or
              explicitly save this local draft as the next version.
            </p>
            <div className="dialog-actions">
              <button onClick={session.reloadSavedVersion} type="button">
                Reload saved version
              </button>
              <button
                className="primary-button"
                onClick={session.saveLocalDraftAfterConflict}
                type="button"
              >
                Save local draft
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <SettingsDialog
        modelStatus={modelStatus}
        onClose={() => setSettingsOpen(false)}
        onReset={appSettings.resetSettings}
        onSave={appSettings.setSettings}
        open={settingsOpen}
        settings={appSettings.settings}
      />
    </div>
  );
}
