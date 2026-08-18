import { Extension, type JSONContent } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const NODE_TYPES = new Set(["paragraph", "heading", "blockquote"]);
const stableNodeIdKey = new PluginKey("stableNodeId");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export interface NormalizedContent {
  content: JSONContent;
  changed: boolean;
}

export function ensureStableNodeIds(
  input: JSONContent,
  createId: () => string = () => crypto.randomUUID(),
): NormalizedContent {
  const seen = new Set<string>();
  let changed = false;

  function visit(node: JSONContent): JSONContent {
    const next: JSONContent = { ...node };

    if (node.type && NODE_TYPES.has(node.type)) {
      const existingId = isUuid(node.attrs?.nodeId)
        ? node.attrs.nodeId
        : undefined;
      const nodeId =
        existingId && !seen.has(existingId) ? existingId : createId();
      seen.add(nodeId);
      if (nodeId !== existingId) changed = true;
      next.attrs = { ...node.attrs, nodeId };
    }

    if (node.content) next.content = node.content.map(visit);
    return next;
  }

  return { content: visit(input), changed };
}

export const StableNodeId = Extension.create({
  name: "stableNodeId",
  priority: 1_000,

  addGlobalAttributes() {
    return [
      {
        types: [...NODE_TYPES],
        attributes: {
          nodeId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-node-id"),
            renderHTML: (attributes) =>
              typeof attributes.nodeId === "string"
                ? { "data-node-id": attributes.nodeId }
                : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: stableNodeIdKey,
        appendTransaction: (_transactions, _oldState, newState) => {
          const seen = new Set<string>();
          const replacements: Array<{ position: number; nodeId: string }> = [];

          newState.doc.descendants((node, position) => {
            if (!NODE_TYPES.has(node.type.name)) return;
            const current = isUuid(node.attrs.nodeId)
              ? node.attrs.nodeId
              : undefined;
            if (!current || seen.has(current)) {
              replacements.push({ position, nodeId: crypto.randomUUID() });
            } else {
              seen.add(current);
            }
          });

          if (replacements.length === 0) return null;
          const transaction = newState.tr;
          for (const replacement of replacements) {
            const node = transaction.doc.nodeAt(replacement.position);
            if (!node) continue;
            transaction.setNodeMarkup(replacement.position, undefined, {
              ...node.attrs,
              nodeId: replacement.nodeId,
            });
          }
          return transaction.setMeta(stableNodeIdKey, true);
        },
      }),
    ];
  },
});
