import type { ExportReviewResponse } from "@openloop/shared";

export function ExportReviewDialog(props: {
  exporting: boolean;
  onCancel: () => void;
  onExport: () => void;
  review?: ExportReviewResponse;
}) {
  if (!props.review) return null;
  const blockingCount = props.review.blockingIssues.length;
  return (
    <div className="dialog-backdrop export-review-backdrop">
      <section
        aria-describedby="export-review-description"
        aria-labelledby="export-review-title"
        aria-modal="true"
        className="export-review-dialog"
        role="alertdialog"
      >
        <p className="eyebrow">Export review</p>
        <h2 id="export-review-title">
          {blockingCount === 1
            ? "1 high-severity loop is still open"
            : `${blockingCount} high-severity loops are still open`}
        </h2>
        <p id="export-review-description">
          The Markdown contains only your document, never issue comments. These
          obligations remain in the local ledger if you export anyway.
        </p>
        {props.review.needsReconciliation ? (
          <p className="export-review-warning" role="status">
            At least one anchor still needs review after reconciliation.
          </p>
        ) : null}
        <ul className="export-review-list">
          {props.review.blockingIssues.map((issue) => (
            <li key={issue.id}>
              <span>Severity {issue.severity}</span>
              <strong>{issue.question}</strong>
              <small>“{issue.anchor.quote}”</small>
            </li>
          ))}
        </ul>
        <p className="export-review-count">
          {props.review.openIssueCount} total open issue
          {props.review.openIssueCount === 1 ? "" : "s"} in the ledger.
        </p>
        <div className="dialog-actions">
          <button
            disabled={props.exporting}
            onClick={props.onCancel}
            type="button"
          >
            Return to document
          </button>
          <button
            className="primary-button"
            disabled={props.exporting}
            onClick={props.onExport}
            type="button"
          >
            {props.exporting ? "Exporting…" : "Export anyway"}
          </button>
        </div>
      </section>
    </div>
  );
}
