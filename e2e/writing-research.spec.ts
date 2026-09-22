import { expect, test } from "@playwright/test";

test("reviews old snapshots, saves feedback, and exports the saved rubric", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const documentResponse = await page.request.post("/v1/documents", {
    data: {
      title: "J3 history test",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: crypto.randomUUID() },
            content: [
              { type: "text", text: "A saved claim because a reason." },
            ],
          },
        ],
      },
    },
  });
  const document = await documentResponse.json();
  const criterionId = crypto.randomUUID();
  const rubricContent = {
    title: "History rubric",
    purpose: "Explain",
    audience: "Readers",
    criteria: [
      {
        id: criterionId,
        name: "Support",
        question: "Is the claim supported?",
        allowedScopes: ["document"],
        levels: [
          { label: "Old low", description: "No reason is supplied." },
          { label: "Old middle", description: "A partial reason is supplied." },
          { label: "Old high", description: "A clear reason is supplied." },
        ],
      },
    ],
  };
  const rubric = await (
    await page.request.post("/v1/writing-rubrics", { data: rubricContent })
  ).json();
  async function evaluate(revision: number) {
    const intent = {
      documentVersion: document.version,
      rubricId: rubric.id,
      rubricRevision: revision,
      scope: { kind: "document" },
      languageHint: "en",
    };
    const preview = await (
      await page.request.post(
        `/v1/documents/${document.id}/evaluations/preview`,
        { data: intent },
      )
    ).json();
    const run = await (
      await page.request.post(`/v1/documents/${document.id}/evaluations`, {
        data: {
          ...intent,
          expectedInputHash: preview.inputHash,
          requestId: crypto.randomUUID(),
          remoteSubmissionConfirmed: false,
        },
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/v1/evaluations/${run.id}`)).json())
            .status,
      )
      .toBe("completed");
    return run.id as string;
  }
  const oldRunId = await evaluate(1);
  const edited = structuredClone(rubricContent);
  edited.criteria[0]!.levels[0]!.label = "New low";
  await page.request.put(`/v1/writing-rubrics/${rubric.id}`, {
    data: { ...edited, baseRevision: 1 },
  });
  await evaluate(2);
  await page.addInitScript((id) => {
    localStorage.setItem("openloop.documentId", id);
  }, document.id);
  await page.goto("/");
  await page.getByRole("tab", { name: "Evaluation" }).click();
  const history = page.getByRole("region", { name: "Evaluation history" });
  let releaseDetail!: () => void;
  const detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  let intercepted = false;
  let delivered = false;
  await page.route(`**/v1/evaluations/${oldRunId}`, async (route) => {
    const response = await route.fetch();
    intercepted = true;
    await detailGate;
    await route.fulfill({ response });
    delivered = true;
  });
  await history.getByRole("button", { name: /rubric r1/ }).click();
  await expect.poll(() => intercepted).toBe(true);
  await history.getByRole("button", { name: /rubric r2/ }).click();
  await expect(
    page.getByText("Current snapshot", { exact: true }),
  ).toBeVisible();
  releaseDetail();
  await expect.poll(() => delivered).toBe(true);
  await expect(page.getByText("Rubric changed", { exact: true })).toHaveCount(
    0,
  );
  await page.unroute(`**/v1/evaluations/${oldRunId}`);
  await history.getByRole("button", { name: /rubric r1/ }).click();
  await expect(page.getByText("Rubric changed", { exact: true })).toBeVisible();
  const snapshot = page.locator(".historical-snapshot");
  await snapshot.locator("summary").click();
  await expect(snapshot).toContainText("A saved claim because a reason.");
  const feedback = page.getByRole("form", { name: "Feedback for Support" });
  await feedback.getByLabel("Verdict").selectOption("disagree");
  await feedback
    .getByLabel("Preferred level (optional)")
    .selectOption({ label: "Old low" });
  await feedback
    .getByLabel("Comment (optional)")
    .fill("This reason is too vague.");
  // Completing a new run must not unmount the historical feedback draft.
  await page
    .getByRole("combobox", { name: "Rubric", exact: true })
    .selectOption(rubric.id);
  await page.getByRole("button", { name: "Prepare preview" }).click();
  await page.getByRole("button", { name: "Evaluate", exact: true }).click();
  await expect(
    history.getByRole("button", { name: /completed.*rubric r2/ }),
  ).toHaveCount(2);
  await expect(feedback.getByLabel("Comment (optional)")).toHaveValue(
    "This reason is too vague.",
  );
  await expect(feedback.getByLabel("Verdict")).toHaveValue("disagree");
  await feedback.getByRole("button", { name: "Save feedback" }).click();
  await expect(feedback).toContainText("Feedback saved.");
  await page.reload();
  await page.getByRole("tab", { name: "Evaluation" }).click();
  await history.getByRole("button", { name: /rubric r1/ }).click();
  await expect(feedback.getByLabel("Verdict")).toHaveValue("disagree");
  await expect(feedback.getByLabel("Comment (optional)")).toHaveValue(
    "This reason is too vague.",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export evaluation JSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let json = "";
  for await (const chunk of stream) json += chunk.toString();
  const record = JSON.parse(json);
  expect(record.schemaVersion).toBe("writing-evaluation-export.v1");
  expect(record.run.id).toBe(oldRunId);
  expect(record.run.rubricRevision).toBe(1);
  expect(record.run.snapshot.rubricSnapshot.criteria[0].levels[0].label).toBe(
    "Old low",
  );
  expect(record.feedback[0]).toMatchObject({
    verdict: "disagree",
    preferredLevel: 0,
    comment: "This reason is too vague.",
  });
  expect(record.signalProvenance.assessment).toBe("mock_fixture");
  const runs = await (
    await page.request.get(`/v1/documents/${document.id}/evaluations`)
  ).json();
  expect(runs.runs).toHaveLength(3);
  await page.locator(".evaluation-result-provenance").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("j3-research.png") });
});

test("disabled autocomplete permits editing without completion requests", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/v1/model-status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), state: "disabled" },
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("/v1/completions/stream")) requests += 1;
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  await expect(
    page.getByText("Autocomplete off", { exact: true }),
  ).toBeVisible();
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Editing works while autocomplete is disabled.");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".status-bar .version")).toHaveText("Version 1");
  await expect(page.locator(".completion-ghost")).toHaveCount(0);
  expect(requests).toBe(0);
});
