import { randomUUID } from "node:crypto";

import type {
  ExportReviewResponse,
  IssueRecord,
  JsonValue,
} from "@openloop/shared";

import type { Database } from "./db/client.js";
import { documentEvents } from "./db/schema.js";
import { getDocument } from "./documents.js";
import { listIssues } from "./issues.js";

const ACTIVE_STATUSES = new Set<IssueRecord["status"]>([
  "open",
  "snoozed",
  "needs_review",
]);

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function children(node: Record<string, JsonValue>): JsonValue[] {
  return Array.isArray(node.content) ? node.content : [];
}

function escapeInline(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function inlineMarkdown(node: Record<string, JsonValue>): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type !== "text") {
    return children(node)
      .map((child) => inlineMarkdown(object(child)))
      .join("");
  }
  let text = escapeInline(typeof node.text === "string" ? node.text : "");
  const marks = Array.isArray(node.marks) ? node.marks.map(object) : [];
  for (const mark of marks) {
    if (mark.type === "code") text = `\`${text.replaceAll("`", "\\`")}\``;
    else if (mark.type === "bold") text = `**${text}**`;
    else if (mark.type === "italic") text = `*${text}*`;
    else if (mark.type === "strike") text = `~~${text}~~`;
    else if (mark.type === "link") {
      const href = object(mark.attrs).href;
      if (typeof href === "string")
        text = `[${text}](${href.replaceAll(")", "\\)")})`;
    }
  }
  return text;
}

function blockMarkdown(node: Record<string, JsonValue>, depth = 0): string {
  const content = children(node);
  if (node.type === "doc") {
    return content
      .map((child) => blockMarkdown(object(child), depth))
      .filter(Boolean)
      .join("\n\n");
  }
  if (node.type === "heading") {
    const level = object(node.attrs).level;
    const prefix = "#".repeat(
      typeof level === "number" ? Math.min(6, Math.max(1, level)) : 1,
    );
    return `${prefix} ${content.map((child) => inlineMarkdown(object(child))).join("")}`;
  }
  if (node.type === "paragraph") {
    return content.map((child) => inlineMarkdown(object(child))).join("");
  }
  if (node.type === "blockquote") {
    return blockMarkdown({ type: "doc", content }, depth)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (node.type === "codeBlock") {
    const language = object(node.attrs).language;
    const body = content
      .map((child) =>
        typeof object(child).text === "string" ? object(child).text : "",
      )
      .join("");
    return `\`\`\`${typeof language === "string" ? language : ""}\n${body}\n\`\`\``;
  }
  if (node.type === "horizontalRule") return "---";
  if (node.type === "bulletList" || node.type === "orderedList") {
    const start = object(node.attrs).start;
    return content
      .map((child, index) => {
        const marker =
          node.type === "orderedList"
            ? `${(typeof start === "number" ? start : 1) + index}. `
            : "- ";
        const body = blockMarkdown(object(child), depth + 1);
        const indentation = "  ".repeat(depth);
        return `${indentation}${marker}${body.replaceAll("\n", `\n${indentation}  `)}`;
      })
      .join("\n");
  }
  if (node.type === "listItem") {
    return content
      .map((child) => blockMarkdown(object(child), depth))
      .join("\n");
  }
  return content.map((child) => blockMarkdown(object(child), depth)).join("\n");
}

export function tipTapJsonToMarkdown(
  content: Record<string, JsonValue>,
): string {
  const markdown = blockMarkdown(content).trimEnd();
  return markdown ? `${markdown}\n` : "";
}

export function reviewExport(
  database: Database,
  documentId: string,
): ExportReviewResponse {
  getDocument(database, documentId);
  const activeIssues = listIssues(database, documentId).filter((issue) =>
    ACTIVE_STATUSES.has(issue.status),
  );
  return {
    blockingIssues: activeIssues.filter((issue) => issue.severity >= 4),
    openIssueCount: activeIssues.length,
    needsReconciliation: activeIssues.some(
      (issue) => issue.status === "needs_review" || issue.anchor.detached,
    ),
  };
}

export function recordDocumentExport(
  database: Database,
  documentId: string,
  review: ExportReviewResponse,
  forced: boolean,
): void {
  const document = getDocument(database, documentId);
  database.orm
    .insert(documentEvents)
    .values({
      id: randomUUID(),
      documentId,
      action: "document_exported",
      documentVersion: document.version,
      payloadJson: JSON.stringify({
        openIssueCount: review.openIssueCount,
        blockingIssueCount: review.blockingIssues.length,
        forced,
      }),
      createdAt: Date.now(),
    })
    .run();
}

export function portableMarkdownFilename(title: string): string {
  const stem = Array.from(title.trim())
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return `${stem || "untitled"}.md`;
}
