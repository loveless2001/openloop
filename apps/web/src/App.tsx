import { OpenLoopEditor } from "./editor/OpenLoopEditor.js";
import { useDocumentSession } from "./use-document-session.js";

export function App() {
  const session = useDocumentSession();

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
        <div className="brand">
          <span className="brand-mark">O</span>
          <span>OpenLoop</span>
        </div>
        <input
          aria-label="Document title"
          className="document-title"
          maxLength={200}
          onChange={(event) => session.updateTitle(event.target.value)}
          value={session.title}
        />
        <span className="phase-badge">Local · Phase 1</span>
      </header>

      <main className="workspace">
        <section className="editor-pane" aria-label="Editor pane">
          <div className="paper">
            <OpenLoopEditor
              baseVersion={session.version}
              content={session.document.contentJson}
              documentId={session.document.id}
              key={`${session.document.id}:${session.document.updatedAt}`}
              onChange={session.queueEditorChange}
            />
          </div>
        </section>
        <aside className="issue-panel" aria-label="Open loops">
          <div>
            <p className="eyebrow">Writing ledger</p>
            <h2>Open loops</h2>
          </div>
          <div className="empty-ledger">
            <span aria-hidden="true">○</span>
            <p>No issues yet.</p>
            <small>Editorial issue memory arrives in Phase 3.</small>
          </div>
        </aside>
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
    </div>
  );
}
