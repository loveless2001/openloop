import type { IssueChatMessage } from "@openloop/shared";
import { describe, expect, it } from "vitest";

import { boundedIssueChatMessages } from "./issue-chat-service.js";

function message(
  index: number,
  content = `message ${index}`,
): IssueChatMessage {
  return {
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    issueId: "ab9adf5e-03a8-4c8b-a15c-779478f9b228",
    role: index % 2 ? "critic" : "user",
    kind: "message",
    content,
    attachments: [],
    createdAt: new Date(1_787_176_800_000 + index).toISOString(),
  };
}

describe("boundedIssueChatMessages", () => {
  it("keeps the newest twenty messages and always includes the latest turn", () => {
    const messages = Array.from({ length: 24 }, (_, index) => message(index));
    expect(
      boundedIssueChatMessages(messages).map((entry) => entry.content),
    ).toEqual(messages.slice(-20).map((entry) => entry.content));

    const large = [
      message(1, "a".repeat(80_000)),
      message(2, "b".repeat(80_000)),
    ];
    expect(boundedIssueChatMessages(large)).toEqual([large[1]]);
  });
});
