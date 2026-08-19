import { useCallback, useEffect, useRef, useState } from "react";

import { loadModelStatus } from "./api.js";
import { CriticAgentControl } from "./CriticAgentControl.js";
import {
  OpenLoopEditor,
  type OpenLoopEditorHandle,
} from "./editor/OpenLoopEditor.js";
import type { EditorCriticSelection } from "./editor/critic-selection.js";
import { IssuePanel } from "./IssuePanel.js";
import { IssueChatDrawer } from "./IssueChatDrawer.js";
import { FileMenu, markdownFilename } from "./FileMenu.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { selectionRequiresWarning } from "./selection-policy.js";
import { useAppSettings } from "./use-app-settings.js";
import { useDocumentSession } from "./use-document-session.js";
import { useIssueLedger } from "./use-issue-ledger.js";
import { useIssueChat } from "./use-issue-chat.js";

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
  const [activeSelection, setActiveSelection] =
    useState<EditorCriticSelection | null>(null);
  const [oversizedSelection, setOversizedSelection] = useState<{
    action: "critique" | "attach";
    selection: EditorCriticSelection;
    totalWordCount: number;
  } | null>(null);
  const ledger = useIssueLedger({
    documentId: session.document?.id,
    documentVersion: session.version,
    onStatus: session.reportTransientStatus,
  });
  const chat = useIssueChat({
    documentId: session.document?.id,
    documentVersion: session.version,
    issueId: ledger.selectedIssueId,
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

  const requestSelectionCritique = useCallback(
    (selection: EditorCriticSelection, confirmed = false) => {
      if (
        !confirmed &&
        selectionRequiresWarning(
          selection.wordCount,
          appSettings.settings.manualCriticWordLimit,
        )
      ) {
        setOversizedSelection({
          action: "critique",
          selection,
          totalWordCount: selection.wordCount,
        });
        return;
      }
      setOversizedSelection(null);
      session.requestCritic("manual", selection);
    },
    [appSettings.settings.manualCriticWordLimit, session.requestCritic],
  );

  const addSelectionToChat = useCallback(
    (selection: EditorCriticSelection, confirmed = false) => {
      if (!ledger.selectedIssueId) return;
      if (chat.attachments.length >= 8) {
        session.reportTransientStatus(
          "A chat message can include up to eight text attachments.",
          4_000,
        );
        return;
      }
      const totalWordCount = chat.attachmentWordCount + selection.wordCount;
      if (totalWordCount > 20_000) {
        session.reportTransientStatus(
          "Issue-chat attachments are limited to 20,000 words per message.",
          4_000,
        );
        return;
      }
      const totalCharacters =
        chat.attachments.reduce(
          (total, attachment) => total + attachment.text.length,
          0,
        ) + selection.text.length;
      if (totalCharacters > 120_000) {
        session.reportTransientStatus(
          "Issue-chat attachments are limited to 120,000 characters per message.",
          4_000,
        );
        return;
      }
      if (
        !confirmed &&
        selectionRequiresWarning(
          totalWordCount,
          appSettings.settings.manualCriticWordLimit,
        )
      ) {
        setOversizedSelection({ action: "attach", selection, totalWordCount });
        return;
      }
      setOversizedSelection(null);
      chat.addSelection(selection);
      session.reportTransientStatus(
        "Added highlighted text to the chat.",
        1_800,
      );
    },
    [
      appSettings.settings.manualCriticWordLimit,
      chat.addSelection,
      chat.attachmentWordCount,
      chat.attachments,
      ledger.selectedIssueId,
      session.reportTransientStatus,
    ],
  );

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
          <CriticAgentControl onMessage={session.reportTransientStatus} />
          <button
            className="critique-button"
            onClick={() => {
              if (activeSelection) requestSelectionCritique(activeSelection);
              else session.requestCritic("manual");
            }}
            title={
              activeSelection
                ? "Critique only the highlighted text"
                : "Critique changed text"
            }
            type="button"
          >
            {activeSelection ? "Critique selection" : "Critique now"}
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
              activeChatIssueId={ledger.selectedIssueId}
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
              onCritiqueSelection={requestSelectionCritique}
              onAddSelectionToChat={addSelectionToChat}
              onChange={session.queueEditorChange}
              onSelectIssue={(issueId) => {
                const issue = ledger.issues.find(
                  (entry) => entry.id === issueId,
                );
                ledger.selectIssue(issueId);
                if (issue) editorRef.current?.focusIssue(issue);
              }}
              onSelectionChange={setActiveSelection}
              ref={editorRef}
              selectedIssueId={ledger.selectedIssueId}
            />
          </div>
        </section>
        <IssuePanel
          issues={ledger.issues}
          onSelect={(issue) => {
            ledger.selectIssue(issue?.id);
            if (issue) editorRef.current?.focusIssue(issue);
          }}
          selectedIssue={ledger.selectedIssue}
        />
      </main>

      {ledger.selectedIssue ? (
        <IssueChatDrawer
          actionPending={ledger.actionPending}
          attachments={chat.attachments}
          collapsed={chat.collapsed}
          content={chat.content}
          events={ledger.events}
          issue={ledger.selectedIssue}
          loading={chat.loading}
          messages={chat.messages}
          onAction={(issue, action) => {
            void ledger.act(issue, action).then((result) => {
              const operation = result?.editorOperation;
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
              if (
                result &&
                (result.issue.status === "resolved" ||
                  result.issue.status === "dismissed")
              ) {
                ledger.selectIssue(undefined);
              }
            });
          }}
          onClose={() => ledger.selectIssue(undefined)}
          onCollapse={chat.setCollapsed}
          onContentChange={chat.setContent}
          onRemoveAttachment={chat.removeAttachment}
          onSend={() => void chat.send()}
          thread={chat.thread}
          unread={chat.unread}
        />
      ) : null}

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

      {oversizedSelection ? (
        <div className="dialog-backdrop selection-warning-backdrop">
          <section
            aria-describedby="selection-warning-description"
            aria-labelledby="selection-warning-title"
            aria-modal="true"
            className="selection-warning-dialog"
            role="alertdialog"
          >
            <p className="eyebrow">Large review scope</p>
            <h2 id="selection-warning-title">
              {oversizedSelection.action === "critique" ? "Critique" : "Attach"}{" "}
              {oversizedSelection.totalWordCount.toLocaleString()} words?
            </h2>
            <p id="selection-warning-description">
              Your warning threshold is{" "}
              {appSettings.settings.manualCriticWordLimit.toLocaleString()}{" "}
              words. A larger context can make the critique less focused and may
              use substantially more model context.
            </p>
            <div className="dialog-actions">
              <button onClick={() => setOversizedSelection(null)} type="button">
                Go back
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  if (oversizedSelection.action === "critique") {
                    requestSelectionCritique(
                      oversizedSelection.selection,
                      true,
                    );
                  } else {
                    addSelectionToChat(oversizedSelection.selection, true);
                  }
                }}
                type="button"
              >
                {oversizedSelection.action === "critique"
                  ? "Critique anyway"
                  : "Attach anyway"}
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
