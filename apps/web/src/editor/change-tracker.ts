import type { EditorChangeBatch, TextBlockSnapshot } from "@openloop/shared";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

const TRACKED_TYPES = new Set(["paragraph", "heading", "blockquote"]);

export function textBlockSnapshots(
  document: ProseMirrorNode,
): TextBlockSnapshot[] {
  const blocks: TextBlockSnapshot[] = [];
  let headingPath: string[] = [];

  document.descendants((node, position) => {
    if (node.type.name === "heading") {
      const level = typeof node.attrs.level === "number" ? node.attrs.level : 1;
      headingPath = [...headingPath.slice(0, level - 1), node.textContent];
    }
    if (
      !TRACKED_TYPES.has(node.type.name) ||
      typeof node.attrs.nodeId !== "string"
    )
      return;

    blocks.push({
      nodeId: node.attrs.nodeId,
      nodeType: node.type.name as TextBlockSnapshot["nodeType"],
      text: node.textContent,
      headingPath: [...headingPath],
      startOffset: position + 1,
      endOffset: position + node.nodeSize - 1,
    });
  });

  return blocks.map((block, index) => ({
    ...block,
    previousNodeText: blocks[index - 1]?.text,
    nextNodeText: blocks[index + 1]?.text,
  }));
}

function inferReason(
  transaction: Transaction,
  previousCount: number,
  currentCount: number,
  removedCount: number,
): EditorChangeBatch["reason"] {
  if (
    transaction.getMeta("uiEvent") === "paste" ||
    transaction.getMeta("paste")
  )
    return "paste";
  if (currentCount > previousCount) return "split";
  if (removedCount > 0 && currentCount < previousCount) return "merge";
  if (!transaction.docChanged) return "format";
  return transaction.before.textContent === transaction.doc.textContent
    ? "format"
    : "typing";
}

export function buildChangeBatch(input: {
  transaction: Transaction;
  currentDocument: ProseMirrorNode;
  documentId: string;
  baseVersion: number;
  clientSequence: number;
  reason?: EditorChangeBatch["reason"];
}): EditorChangeBatch {
  const previous = textBlockSnapshots(input.transaction.before);
  const current = textBlockSnapshots(input.currentDocument);
  const previousById = new Map(previous.map((block) => [block.nodeId, block]));
  const currentIds = new Set(current.map((block) => block.nodeId));
  const removedNodeIds = previous
    .filter((block) => !currentIds.has(block.nodeId))
    .map((block) => block.nodeId);
  const reason =
    input.reason ??
    inferReason(
      input.transaction,
      previous.length,
      current.length,
      removedNodeIds.length,
    );

  const changedBlocks = current
    .filter((block) => {
      if (reason === "load") return true;
      const old = previousById.get(block.nodeId);
      return (
        !old ||
        old.text !== block.text ||
        old.nodeType !== block.nodeType ||
        old.headingPath.join("\u0000") !== block.headingPath.join("\u0000")
      );
    })
    .map((block) => ({
      ...block,
      previousText: previousById.get(block.nodeId)?.text,
    }));

  const mergedNodeMap: Record<string, string> = {};
  for (const removedId of removedNodeIds) {
    const removed = previousById.get(removedId);
    if (!removed?.text) continue;
    const survivor = current.find((block) => block.text.includes(removed.text));
    if (survivor) mergedNodeMap[removedId] = survivor.nodeId;
  }

  return {
    documentId: input.documentId,
    baseVersion: input.baseVersion,
    clientSequence: input.clientSequence,
    changedBlocks,
    removedNodeIds,
    mergedNodeMap,
    reason,
  };
}

export function mergeChangeBatches(
  older: EditorChangeBatch | null,
  newer: EditorChangeBatch,
): EditorChangeBatch {
  if (!older || older.documentId !== newer.documentId) return newer;
  const changed = new Map(
    older.changedBlocks.map((block) => [block.nodeId, block]),
  );
  const removed = new Set(older.removedNodeIds);
  for (const block of newer.changedBlocks) {
    changed.set(block.nodeId, block);
    removed.delete(block.nodeId);
  }
  for (const removedId of newer.removedNodeIds) changed.delete(removedId);
  for (const removedId of newer.removedNodeIds) removed.add(removedId);

  const mergedNodeMap = { ...older.mergedNodeMap, ...newer.mergedNodeMap };
  for (const block of newer.changedBlocks) delete mergedNodeMap[block.nodeId];

  return {
    ...newer,
    baseVersion: older.baseVersion,
    changedBlocks: [...changed.values()],
    removedNodeIds: [...removed],
    mergedNodeMap,
  };
}
