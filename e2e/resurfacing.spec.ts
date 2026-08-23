import { expect, test } from "@playwright/test";

test("one issue survives completion, defer, resurfacing, revision, and export", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await page.getByLabel("Document title").fill("Harness note");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(
    "The whole product is model agnostic, so any model will work equally well.",
  );
  await expect(page.locator(".completion-ghost")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Current issue chat")).toBeVisible({
    timeout: 15_000,
  });

  const persisted = await page.evaluate(async () => {
    const documentId = window.localStorage.getItem("openloop.documentId");
    if (!documentId) throw new Error("No active document.");
    const response = await fetch(`/v1/documents/${documentId}/issues`);
    const payload = (await response.json()) as {
      issues: Array<Record<string, unknown>>;
    };
    const issue = payload.issues[0];
    if (!issue) throw new Error("No persisted issue.");
    return { documentId, issue };
  });

  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.getByLabel("Current issue chat")).toHaveCount(0);

  let resurfaceRequests = 0;
  await page.route(
    `/v1/documents/${persisted.documentId}/resurface`,
    async (route) => {
      resurfaceRequests += 1;
      expect(route.request().postDataJSON()).toMatchObject({
        trigger: "claim_reused",
        attention: {
          completionVisible: false,
          issueCardExpanded: false,
        },
      });
      expect(
        route.request().postDataJSON().attention.userIdleMs,
      ).toBeGreaterThanOrEqual(1_200);
      const now = new Date().toISOString();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          issue: {
            ...persisted.issue,
            status: "open",
            shownCount: 2,
            lastShownAt: now,
            snoozedUntil: undefined,
            updatedAt: now,
          },
        }),
      });
    },
  );

  await editor.click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Conclusion");
  await page.keyboard.press("Control+Alt+Digit1");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(
    "Therefore model choice does not matter to the product.",
  );
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");

  await expect.poll(() => resurfaceRequests, { timeout: 5_000 }).toBe(1);
  await expect(page.locator(".issue-list-meta")).toContainText("Still open");
  await expect(page.getByLabel("Current issue chat")).toBeVisible();

  await page.waitForTimeout(1_500);
  expect(resurfaceRequests).toBe(1);

  await page.getByRole("button", { name: /^File/ }).click();
  await page.getByRole("menuitem", { name: /Export Harness note\.md/ }).click();
  const exportReview = page.getByRole("alertdialog", { name: /still open/ });
  await expect(exportReview).toContainText("Severity 4");
  await expect(exportReview).toContainText(persisted.issue.question as string);
  await exportReview
    .getByRole("button", { name: "Return to document" })
    .click();

  await page.unroute(`/v1/documents/${persisted.documentId}/resurface`);
  const revised =
    "The harness is provider-agnostic at the API boundary, but model choice still changes latency, structured-output reliability, reasoning quality, and cost.";
  await page.evaluate(() => {
    const paragraph = document.querySelector(".ProseMirror p");
    if (!paragraph) throw new Error("Original paragraph was not rendered.");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.keyboard.type(revised);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^File/ }).click();
  await page.getByRole("menuitem", { name: "Save locally" }).click();

  await expect
    .poll(
      async () =>
        page.evaluate(async (issueId) => {
          const response = await fetch(`/v1/issues/${issueId}/events`);
          const payload = (await response.json()) as {
            events: Array<{ action: string }>;
          };
          return payload.events.at(-1)?.action;
        }, persisted.issue.id),
      { timeout: 10_000 },
    )
    .toBe("reconciled_resolved");

  await page.getByRole("tab", { name: "resolved" }).click();
  await page.locator(".issue-list").getByRole("button").click({
    timeout: 5_000,
  });
  const history = page.locator(".issue-chat-history");
  await history.locator("summary").click();
  await expect(history).toContainText("reconciled resolved");

  await page.getByRole("button", { name: /^File/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export Harness note\.md/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Harness note.md");
  const stream = await download.createReadStream();
  let markdown = "";
  for await (const chunk of stream) markdown += chunk.toString();
  expect(markdown).toContain(revised);
  expect(markdown).toContain("# Conclusion");
  expect(markdown).not.toContain("Do you mean");
});
