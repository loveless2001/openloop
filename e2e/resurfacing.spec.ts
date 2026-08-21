import { expect, test } from "@playwright/test";

test("deferred issue resurfaces once with the same id after claim reuse", async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Any model will work equally well in this draft.");
  await page.getByRole("button", { name: "Critique now" }).click();
  await expect(page.getByLabel("Current issue chat")).toBeVisible();

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
  await page.keyboard.type(
    "Any model will work equally well because interface quality is identical.",
  );
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");

  await expect.poll(() => resurfaceRequests, { timeout: 5_000 }).toBe(1);
  await expect(page.locator(".issue-list-meta")).toContainText("Still open");
  await expect(page.getByLabel("Current issue chat")).toBeVisible();

  await page.waitForTimeout(1_500);
  expect(resurfaceRequests).toBe(1);
});
