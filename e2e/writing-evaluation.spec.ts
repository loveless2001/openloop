import { expect, test } from "@playwright/test";

test("creates a rubric and evaluates document and exact selection snapshots", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("A claim because a reason.");

  await page.getByRole("button", { name: "Evaluate document" }).click();
  const evaluationTab = page.getByRole("tab", { name: "Evaluation" });
  const openLoopsTab = page.getByRole("tab", { name: "Open loops" });
  await expect(evaluationTab).toHaveCSS(
    "border-bottom-color",
    "rgb(157, 187, 173)",
  );
  await expect(evaluationTab).toHaveCSS("border-bottom-left-radius", "7px");
  await expect(openLoopsTab).toHaveCSS("border-bottom-left-radius", "7px");
  await expect(
    page.getByRole("complementary", { name: "Writing evaluation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use starter rubric" }).click();
  await page.getByRole("button", { name: "Save rubric" }).click();
  await page.getByRole("button", { name: "Prepare preview" }).click();
  await expect(page.getByText("Exact evaluation target")).toBeVisible();
  await expect(page.locator(".evaluation-preview pre").first()).toContainText(
    "A claim because a reason.",
  );
  await page.getByRole("button", { name: "Evaluate", exact: true }).click();
  await expect(page.getByText("Current snapshot")).toBeVisible();
  await expect(page.locator(".evaluation-criterion-card")).toHaveCount(3);

  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  await expect(page.getByText("Draft changed since evaluation")).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".status-bar .version")).toHaveText("Version 2");

  await page.reload();
  await page.getByRole("tab", { name: "Evaluation" }).click();
  await expect(page.getByText("Draft changed since evaluation")).toBeVisible();

  const selectedText = await page.evaluate(() => {
    const textNode = document.querySelector(".ProseMirror p")?.firstChild;
    if (!textNode) throw new Error("Editor text was not rendered.");
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.setEnd(textNode, 7);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    textNode.parentElement?.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
    return selection?.toString();
  });
  expect(selectedText).toBe("claim");
  const toolbar = page.getByRole("toolbar", { name: "Selected text actions" });
  await toolbar.getByRole("button", { name: "Evaluate" }).click();
  await page.getByRole("button", { name: "Prepare preview" }).click();
  await expect(page.locator(".evaluation-preview pre").first()).toHaveText(
    "claim",
  );

  await page.getByRole("tab", { name: "Open loops" }).click();
  await expect(page.getByText("No open issues.")).toBeVisible();
});
