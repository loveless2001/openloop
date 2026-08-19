import { expect, test } from "@playwright/test";

test("highlights exact text and submits a focused critic job", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("alpha beta gamma");

  const selectedText = await page.evaluate(() => {
    const textNode = document.querySelector(".ProseMirror p")?.firstChild;
    if (!textNode) throw new Error("Editor text was not rendered.");
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 10);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    textNode.parentElement?.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
    return selection?.toString();
  });
  expect(selectedText).toBe("beta");

  const toolbar = page.getByRole("toolbar", { name: "Selected text actions" });
  await expect(toolbar).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Critique selection" }),
  ).toBeVisible();

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/critic-jobs"),
  );
  await toolbar.getByRole("button", { name: "Critique" }).click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toMatchObject({
    trigger: "manual",
    scope: { kind: "selection", source: "user", wordCount: 1 },
    changedBlocks: [
      {
        nodeType: "paragraph",
        text: "beta",
        selectionStart: 6,
        selectionEnd: 10,
      },
    ],
  });
});
