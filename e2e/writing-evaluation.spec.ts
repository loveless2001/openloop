import { expect, test } from "@playwright/test";

test("creates a rubric and evaluates document and exact selection snapshots", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("writing-evaluation-test-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("writing-evaluation-test-ready", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Evaluate document" }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("A claim because a reason.");

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

  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Changed after selection.");
  await page.getByRole("button", { name: "Prepare preview" }).click();
  await expect(page.getByRole("alert")).toContainText("Select the text again");

  await page.getByRole("tab", { name: "Open loops" }).click();
  await expect(page.getByText("No open issues.")).toBeVisible();
});

test("does not restore a delayed preview after selection context changes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("writing-evaluation-test-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("writing-evaluation-test-ready", "true");
  });
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Alpha beta gamma.");
  await page.getByRole("button", { name: "Evaluate document" }).click();
  await page.getByRole("button", { name: "Use starter rubric" }).click();
  await page.getByRole("button", { name: "Save rubric" }).click();

  await page.evaluate(() => {
    const textNode = document.querySelector(".ProseMirror p")?.firstChild;
    if (!textNode) throw new Error("Editor text was not rendered.");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 10);
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
    .getByRole("button", { name: "Evaluate" })
    .click();
  await page.getByLabel("Include nearby context").check();

  let releasePreview!: () => void;
  const previewGate = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  let previewIntercepted = false;
  await page.route(/\/evaluations\/preview$/, async (route) => {
    previewIntercepted = true;
    const response = await route.fetch();
    await previewGate;
    await route.fulfill({ response }).catch(() => undefined);
  });

  await page.getByRole("button", { name: "Prepare preview" }).click();
  await expect.poll(() => previewIntercepted).toBe(true);
  await page.getByLabel("Selected text only").check();
  releasePreview();

  await expect(page.getByText("Exact evaluation target")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Prepare preview" }),
  ).toBeEnabled();
});

test("recovers a lost submit response with one stable idempotent request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("writing-evaluation-test-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("writing-evaluation-test-ready", "true");
  });
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("A claim because a reason.");
  await page.getByRole("button", { name: "Evaluate document" }).click();
  await page.getByRole("button", { name: "Use starter rubric" }).click();
  await page.getByRole("button", { name: "Save rubric" }).click();
  await page.getByRole("button", { name: "Prepare preview" }).click();

  const submissions: Array<Record<string, unknown>> = [];
  let acceptedRunId = "";
  await page.route(/\/v1\/documents\/[^/]+\/evaluations$/, async (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      const response = await route.fetch();
      acceptedRunId = ((await response.json()) as { id: string }).id;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Evaluate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry submission" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry submission" }).click();
  await expect(page.locator(".evaluation-criterion-card")).toHaveCount(3);

  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  const persisted = await page.evaluate(async (requestId) => {
    const documentId = window.localStorage.getItem("openloop.documentId");
    if (!documentId) throw new Error("No active document.");
    const response = await fetch(
      `/v1/documents/${documentId}/evaluations?limit=20`,
    );
    const payload = (await response.json()) as {
      runs: Array<{ id: string; requestId: string }>;
    };
    return payload.runs.filter((run) => run.requestId === requestId);
  }, submissions[0]?.requestId);
  expect(persisted).toHaveLength(1);
  expect(persisted[0]?.id).toBe(acceptedRunId);
});

test("shows save-barrier failures without taking the draft away", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("writing-evaluation-test-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("writing-evaluation-test-ready", "true");
  });
  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean(window.localStorage.getItem("openloop.documentId")),
  );
  const documentId = await page.evaluate(() =>
    window.localStorage.getItem("openloop.documentId"),
  );
  if (!documentId) throw new Error("No active document.");
  await page.route(`/v1/documents/${documentId}`, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "TEST_SAVE_FAILURE",
          message: "Offline save failure",
          requestId: "playwright-save-failure",
        },
      }),
    });
  });
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Draft remains editable.");
  await page.getByRole("button", { name: "Evaluate document" }).click();
  await page.getByRole("button", { name: "Use starter rubric" }).click();
  await page.getByRole("button", { name: "Save rubric" }).click();
  await page.getByRole("button", { name: "Prepare preview" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Writing evaluation" })
      .getByRole("alert"),
  ).toContainText("Offline save failure");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Recovery is still available.");
  await expect(editor).toContainText("Recovery is still available.");
});

test("shows an all-incompatible completed run immediately without provider provenance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("writing-evaluation-test-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("writing-evaluation-test-ready", "true");
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const response = await fetch("/v1/writing-rubrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Selection-only rubric",
        purpose: "Assess a selected sentence.",
        audience: "Readers",
        criteria: [
          {
            id: crypto.randomUUID(),
            name: "Local sentence",
            question: "Does this selected sentence stand alone?",
            allowedScopes: ["selection"],
            levels: [
              { label: "Low", description: "It does not stand alone." },
              { label: "Some", description: "It partly stands alone." },
              { label: "Strong", description: "It clearly stands alone." },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("Could not create test rubric.");
  });
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Complete document text.");
  await page.getByRole("button", { name: "Evaluate document" }).click();
  await page
    .getByLabel("Rubric")
    .selectOption({ label: "Selection-only rubric · revision 1" });
  await page.getByRole("button", { name: "Prepare preview" }).click();
  await page.getByRole("button", { name: "Evaluate", exact: true }).click();

  await expect(page.getByText("Not available for this scope")).toBeVisible();
  const run = await page.evaluate(async () => {
    const documentId = window.localStorage.getItem("openloop.documentId");
    if (!documentId) throw new Error("No active document.");
    const list = (await (
      await fetch(`/v1/documents/${documentId}/evaluations?limit=1`)
    ).json()) as { runs: Array<{ id: string }> };
    const runId = list.runs[0]?.id;
    if (!runId) throw new Error("No evaluation run.");
    return (await (await fetch(`/v1/evaluations/${runId}`)).json()) as {
      providerCalled: boolean;
      returnedModel?: string;
      status: string;
      usage: { inputTokens: number; outputTokens: number };
    };
  });
  expect(run).toMatchObject({
    status: "completed",
    providerCalled: false,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  expect(run.returnedModel).toBeUndefined();
});
