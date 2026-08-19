import { expect, test } from "@playwright/test";

test("adds highlighted text to the single active issue chat before sending", async ({
  page,
}) => {
  const documentId = "504c7d3d-b87f-4b05-a303-a7bab6099828";
  const timestamp = "2026-08-20T00:00:00.000Z";
  await page.route(/\/v1\/issues\/[^/]+\/chat\/activate$/, async (route) => {
    const issueId = route.request().url().split("/").at(-3)!;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        thread: {
          issueId,
          documentId,
          state: "idle",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        messages: [],
      }),
    });
  });
  await page.route(/\/v1\/issues\/[^/]+\/chat\/messages$/, async (route) => {
    const issueId = route.request().url().split("/").at(-3)!;
    const request = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        thread: {
          issueId,
          documentId,
          state: "waiting_on_critic",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        message: {
          id: "03a29e1d-8baa-4056-8878-78b2f5371e22",
          issueId,
          role: "user",
          kind: "message",
          content: request.content,
          attachments: request.attachments.map(
            (attachment: Record<string, unknown>, index: number) => ({
              id:
                index === 0
                  ? "54c33011-3e81-43f6-88d9-c4c9b7cb80b8"
                  : "3b2b5a86-e76b-4c56-b664-f7c722247f06",
              ...attachment,
            }),
          ),
          createdAt: timestamp,
        },
      }),
    });
  });

  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Any model will work equally well in this draft.");
  await page.getByRole("button", { name: "Critique now" }).click();
  const chatWindow = page.getByLabel("Current issue chat");
  await expect(chatWindow).toBeVisible();
  await expect(
    page.locator(".issue-panel").getByLabel("Current issue chat"),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      chatWindow.evaluate((element) => getComputedStyle(element).position),
    )
    .toBe("fixed");
  const [chatBox, ledgerBox] = await Promise.all([
    chatWindow.boundingBox(),
    page.locator(".issue-panel").boundingBox(),
  ]);
  expect(chatBox).not.toBeNull();
  expect(ledgerBox).not.toBeNull();
  expect(chatBox!.x + chatBox!.width).toBeLessThanOrEqual(ledgerBox!.x);

  await page.evaluate(() => {
    const paragraph = document.querySelector(".ProseMirror p");
    const walker = paragraph
      ? document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      : undefined;
    let textNode: Node | null = null;
    while (walker && (textNode = walker.nextNode())) {
      if (textNode.textContent?.startsWith("Any model")) break;
    }
    if (!textNode) throw new Error("Editor text was not rendered.");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 9);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    textNode.parentElement?.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
  });

  await page
    .getByRole("toolbar", { name: "Selected text actions" })
    .getByRole("button", { name: "Add to chat" })
    .click();
  await expect(page.getByLabel("Attached text")).toContainText("Any model");

  await page.getByLabel("Reply to critic").fill("Does this context help?");
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/chat/messages"),
  );
  await page.getByRole("button", { name: "Send" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    content: "Does this context help?",
    attachments: [
      {
        source: "user",
        text: "Any model",
        wordCount: 2,
      },
    ],
  });
});
