import type { JsonValue } from "@openloop/shared";

type JsonObject = { [key: string]: JsonValue };

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeText(node: JsonValue): string {
  if (!isObject(node)) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(nodeText).join("");
}

export function tipTapJsonToPlainText(content: JsonObject): string {
  if (!Array.isArray(content.content)) return "";

  return content.content.map(nodeText).join("\n");
}
