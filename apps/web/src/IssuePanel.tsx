import type { IssueRecord } from "@openloop/shared";
import { useMemo, useState } from "react";

type Filter = "open" | "resolved" | "dismissed";

const statusGroups: Record<Filter, IssueRecord["status"][]> = {
  open: ["open", "snoozed", "needs_review"],
  resolved: ["resolved"],
  dismissed: ["dismissed", "invalidated"],
};

function label(value: string): string {
  return value.replaceAll("_", " ");
}

export function IssuePanel(props: {
  issues: IssueRecord[];
  onSelect: (issue?: IssueRecord) => void;
  selectedIssue?: IssueRecord;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const filtered = useMemo(
    () =>
      props.issues.filter((issue) =>
        statusGroups[filter].includes(issue.status),
      ),
    [filter, props.issues],
  );

  return (
    <aside className="issue-panel" aria-label="Open loops">
      <div>
        <p className="eyebrow">Writing ledger</p>
        <h2>Open loops</h2>
      </div>
      <div className="issue-filters" role="tablist" aria-label="Issue filters">
        {(["open", "resolved", "dismissed"] as const).map((value) => (
          <button
            aria-selected={filter === value}
            className={filter === value ? "active" : undefined}
            key={value}
            onClick={() => setFilter(value)}
            role="tab"
            type="button"
          >
            {value}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-ledger">
          <span aria-hidden="true">○</span>
          <p>No {filter} issues.</p>
          <small>The critic only records consequential objections.</small>
        </div>
      ) : (
        <ul className="issue-list">
          {filtered.map((issue) => (
            <li key={issue.id}>
              <button
                aria-current={props.selectedIssue?.id === issue.id}
                onClick={() => props.onSelect(issue)}
                type="button"
              >
                <span className="issue-list-heading">
                  <span>{label(issue.type)}</span>
                  <span>Severity {issue.severity}</span>
                </span>
                <strong>{issue.question.split("\n")[0]}</strong>
                <small>“{issue.anchor.quote}”</small>
                <span className="issue-list-meta">
                  {label(issue.status)} · shown {issue.shownCount} ·{" "}
                  {new Date(issue.updatedAt).toLocaleTimeString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
