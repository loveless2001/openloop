import type { IssueRecord } from "@openloop/shared";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

interface IssueGutterState {
  activeIssueId?: string;
  issues: IssueRecord[];
}

interface IssueGutterOptions {
  onSelect: (issueId?: string) => void;
}

export const issueGutterKey = new PluginKey<IssueGutterState>("issueGutter");

export function setIssueGutterState(
  view: EditorView,
  state: IssueGutterState,
): void {
  view.dispatch(view.state.tr.setMeta(issueGutterKey, state));
}

function decorations(
  document: Parameters<typeof DecorationSet.create>[0],
  state: IssueGutterState,
  onSelect: (issueId?: string) => void,
): DecorationSet {
  const byNode = new Map<string, IssueRecord>();
  for (const issue of state.issues) {
    if (issue.anchor.detached) continue;
    const current = byNode.get(issue.anchor.nodeId);
    if (!current || issue.severity > current.severity) {
      byNode.set(issue.anchor.nodeId, issue);
    }
  }

  const result: Decoration[] = [];
  document.descendants((node, position) => {
    const issue = byNode.get(node.attrs.nodeId as string);
    if (!issue) return;
    result.push(
      Decoration.widget(
        position + 1,
        () => {
          const marker = window.document.createElement("button");
          marker.type = "button";
          marker.className = "issue-gutter-marker";
          marker.dataset.issueId = issue.id;
          marker.setAttribute(
            "aria-label",
            `Open ${issue.type.replaceAll("_", " ")} issue, severity ${issue.severity}`,
          );
          marker.textContent = "!";
          marker.addEventListener("mousedown", (event) =>
            event.preventDefault(),
          );
          marker.addEventListener("click", () => onSelect(issue.id));
          return marker;
        },
        { key: `issue-marker:${issue.id}`, side: -1 },
      ),
    );
    if (issue.id === state.activeIssueId) {
      const quoteStart = node.textContent.indexOf(issue.anchor.quote);
      if (quoteStart >= 0) {
        result.push(
          Decoration.inline(
            position + 1 + quoteStart,
            position + 1 + quoteStart + issue.anchor.quote.length,
            { class: "issue-anchor-highlight" },
          ),
        );
      }
    }
  });
  return DecorationSet.create(document, result);
}

export const IssueGutter = Extension.create<IssueGutterOptions>({
  name: "issueGutter",
  addOptions() {
    return { onSelect: () => undefined };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<IssueGutterState>({
        key: issueGutterKey,
        state: {
          init: () => ({ issues: [] }),
          apply(transaction, current) {
            return transaction.getMeta(issueGutterKey) ?? current;
          },
        },
        props: {
          decorations: (state) =>
            decorations(
              state.doc,
              issueGutterKey.getState(state) ?? { issues: [] },
              this.options.onSelect,
            ),
          handleKeyDown: (_view, event) => {
            const active = issueGutterKey.getState(_view.state)?.activeIssueId;
            if (event.key !== "Escape" || !active) return false;
            event.preventDefault();
            this.options.onSelect();
            return true;
          },
        },
      }),
    ];
  },
});
