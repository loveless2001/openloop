import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { chromium, expect } from "@playwright/test";
import { z } from "../apps/server/node_modules/zod/index.js";
import { buildServer } from "../apps/server/src/app.js";
import { loadEnvironment } from "../apps/server/src/config/env.js";
import { findWorkspaceRoot } from "../apps/server/src/config/workspace.js";
import { TypeSafeWritingEvaluator } from "../packages/model-adapters/src/index.js";
import {
  EvaluationPreviewSchema,
  WritingEvaluationExportSchema,
  WritingEvaluationRunSchema,
  WritingRubricContentSchema,
  WritingRubricSchema,
} from "../packages/shared/src/index.js";

const CaseSchema = z.object({
  id: z.string().regex(/^[a-z-]+$/),
  scope: z.enum(["selection", "document"]),
  unit: z.enum(["sentence", "paragraph", "whole"]),
  contextMode: z.enum(["none", "nearby"]),
  targetText: z.string().optional(),
});
const FixtureSchema = z.object({
  schemaVersion: z.literal("jev-article-scope-test.v1"),
  articleFile: z.string(),
  languageHint: z.literal("en"),
  rubric: WritingRubricContentSchema,
  cases: z.array(CaseSchema).length(5),
  expectationsBeforeRun: z.record(z.string(), z.string()),
  expectationProvenance: z.string(),
});
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    provider: { type: "string", default: "mock" },
    output: { type: "string" },
    "allow-remote": { type: "boolean", default: false },
  },
});
assert(
  values.provider === "mock" || values.provider === "typesafe",
  "Choose mock or typesafe.",
);
assert(
  values.provider !== "typesafe" || values["allow-remote"],
  "Remote tests require --allow-remote.",
);
assert(values.output, "Specify a new --output directory under data/.");
const root = findWorkspaceRoot();
const output = resolve(root, values.output);
const relativeOutput = relative(resolve(root, "data"), output);
assert(
  relativeOutput &&
    !relativeOutput.startsWith("..") &&
    !isAbsolute(relativeOutput),
);
const fixtureText = await readFile(
  resolve(root, "docs/fixtures/jev-scope-article.json"),
  "utf8",
);
const fixture = FixtureSchema.parse(JSON.parse(fixtureText));
assert.deepEqual(
  fixture.cases.map((entry) => entry.id),
  [
    "sentence-none",
    "sentence-nearby",
    "paragraph-none",
    "paragraph-nearby",
    "whole-document",
  ],
);
const articlePath = resolve(root, fixture.articleFile);
const article = await readFile(articlePath, "utf8");
const expectedWhole = article
  .trim()
  .split(/\n\n+/)
  .map((block) => block.replace(/^# /, ""))
  .join("\n");
const loaded = loadEnvironment();
const provider = values.provider;
if (provider === "typesafe")
  assert(loaded.TYPESAFE_API_KEY.trim(), "TYPESAFE_API_KEY is required.");
const configuredUrl = new URL(loaded.JEV_API_BASE_URL);
assert(
  !configuredUrl.username &&
    !configuredUrl.password &&
    !configuredUrl.search &&
    !configuredUrl.hash,
);
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Exclusive directory creation prevents accidental re-execution into a prior run.
const sourceFiles = [
  "scripts/test-jev-article-scopes.ts",
  "packages/core/src/writing-evaluation.ts",
  "packages/model-adapters/src/typesafe-writing-evaluator.ts",
  "apps/server/src/writing-evaluation-service.ts",
  "packages/shared/src/writing-evaluation.ts",
  "apps/web/src/use-writing-evaluation.ts",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [
      file,
      sha256(await readFile(resolve(root, file), "utf8")),
    ]),
  ),
);
const allowedRequestHashes = new Set<string>();
let actualCalls = 0;
let finished = 0;
let documentId: string | undefined;
let rubricId: string | undefined;
let runFailure: string | undefined;
const startedAt = new Date().toISOString();
const manifest = {
  schemaVersion: "jev-article-scope-run.v1",
  startedAt,
  provider,
  requestedModel:
    provider === "typesafe" ? loaded.JEV_MODEL : "mock-writing-fixtures-v1",
  endpoint:
    provider === "typesafe"
      ? `${configuredUrl.origin}${configuredUrl.pathname.replace(/\/$/, "")}/systemone`
      : "mock://local",
  timeoutMs: loaded.JEV_TIMEOUT_MS,
  completionEnabled: false,
  criticProvider: "mock",
  trainingTraceCapture: false,
  fixtureSha256: sha256(fixtureText),
  articleSha256: sha256(article),
  sourceHashes,
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  worktreeState:
    "J3 implementation is uncommitted; sourceHashes identify the tested implementation.",
  maximumRemoteCalls: 5,
  retries: 0,
};
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(resolve(output, "fixture.json"), fixtureText);
await writeFile(resolve(output, "article.md"), article);
const writingEvaluator =
  provider === "typesafe"
    ? new TypeSafeWritingEvaluator({
        apiKey: loaded.TYPESAFE_API_KEY,
        baseUrl: loaded.JEV_API_BASE_URL,
        timeoutMs: loaded.JEV_TIMEOUT_MS,
        fetchImplementation: async (input, init) => {
          const body = String(init?.body);
          assert(
            allowedRequestHashes.has(sha256(body)),
            "Only preflighted synthetic article requests may leave the process.",
          );
          assert(actualCalls < 5, "Remote call bound exceeded.");
          actualCalls += 1;
          await appendFile(
            resolve(output, "attempts.jsonl"),
            JSON.stringify({
              attempt: actualCalls,
              at: new Date().toISOString(),
              requestBodySha256: sha256(body),
            }) + "\n",
          );
          return fetch(input, init);
        },
      })
    : undefined;
const server = buildServer({
  environment: {
    ...loaded,
    DATABASE_URL: `file:${resolve(output, "session.sqlite")}`,
    COMPLETION_ENABLED: false,
    COMPLETION_PROVIDER: "mock",
    CRITIC_PROVIDER: "mock",
    EVALUATOR_PROVIDER: provider,
    CAPTURE_TRAINING_TRACES: false,
    LOG_DOCUMENT_CONTENT: false,
    LOG_MODEL_CONTENT: false,
  },
  logger: false,
  writingEvaluator,
  mcpBearerToken: "synthetic-scope-session-only",
});
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const { createServer } = await import(
  pathToFileURL(webRequire.resolve("vite")).href
);
const react = (
  await import(pathToFileURL(webRequire.resolve("@vitejs/plugin-react")).href)
).default;
let web: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  assert(address && typeof address !== "string");
  web = await createServer({
    configFile: false,
    root: resolve(root, "apps/web"),
    envDir: false,
    plugins: [react()],
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: { "/v1": `http://127.0.0.1:${address.port}` },
    },
  });
  await web.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(10_000);
  await page.goto("http://127.0.0.1:5174");
  await expect(
    page.getByText("Autocomplete off", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Open Markdown file").setInputFiles(articlePath);
  await expect(page.locator(".ProseMirror")).toContainText("Maya and Arun");
  documentId = await page.evaluate(
    () => localStorage.getItem("openloop.documentId") ?? undefined,
  );
  assert(documentId);
  await page.getByRole("button", { name: "Evaluate document" }).click();
  await page.getByRole("button", { name: "Create blank rubric" }).click();
  await page
    .getByRole("textbox", { name: "Rubric title", exact: true })
    .fill(fixture.rubric.title);
  await page
    .getByRole("textbox", { name: "Purpose", exact: true })
    .fill(fixture.rubric.purpose);
  await page
    .getByRole("textbox", { name: "Audience", exact: true })
    .fill(fixture.rubric.audience);
  for (const [index, criterion] of fixture.rubric.criteria.entries()) {
    if (index)
      await page
        .getByRole("button", { name: "Add criterion", exact: true })
        .click();
    const field = page.locator(".rubric-criterion-editor").nth(index);
    await field
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(criterion.name);
    await field
      .getByRole("textbox", { name: "One-dimension question", exact: true })
      .fill(criterion.question);
    for (const scope of ["selection", "document"] as const)
      await field
        .getByRole("checkbox", { name: scope, exact: true })
        .setChecked(criterion.allowedScopes.includes(scope));
    for (const [levelIndex, level] of criterion.levels.entries()) {
      const row = field.locator(".rubric-level-row").nth(levelIndex);
      await row
        .getByRole("textbox", {
          name: `Level ${levelIndex} label`,
          exact: true,
        })
        .fill(level.label);
      await row
        .getByRole("textbox", { name: "Observable description", exact: true })
        .fill(level.description);
    }
  }
  const savedRubricResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/writing-rubrics") &&
      response.request().method() === "POST",
  );
  const [rubricResponse] = await Promise.all([
    savedRubricResponse,
    page.getByRole("button", { name: "Save rubric", exact: true }).click(),
  ]);
  const savedRubric = WritingRubricSchema.parse(await rubricResponse.json());
  rubricId = savedRubric.id;
  const stripIds = (rubric: z.infer<typeof WritingRubricContentSchema>) => ({
    ...rubric,
    criteria: rubric.criteria.map((criterion) => ({
      name: criterion.name,
      question: criterion.question,
      allowedScopes: criterion.allowedScopes,
      levels: criterion.levels,
    })),
  });
  assert.deepEqual(
    stripIds(WritingRubricContentSchema.parse(savedRubric)),
    stripIds(fixture.rubric),
  );
  await writeFile(
    resolve(output, "saved-rubric.json"),
    JSON.stringify(savedRubric, null, 2) + "\n",
  );
  await page
    .getByRole("combobox", { name: "Language hint", exact: true })
    .selectOption("en");
  async function prepare(entry: z.infer<typeof CaseSchema>) {
    if (entry.scope === "document") {
      await page
        .getByRole("button", { name: "Evaluate document", exact: true })
        .click();
    } else {
      assert(entry.targetText);
      await page.evaluate((target) => {
        const paragraph = Array.from(
          document.querySelectorAll(".ProseMirror p"),
        ).find((element) => element.textContent?.includes(target));
        if (!paragraph) throw new Error("Synthetic target not found.");
        const start = paragraph.textContent!.indexOf(target);
        const end = start + target.length;
        const walker = document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT,
        );
        const range = document.createRange();
        let offset = 0;
        let started = false;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const length = node.textContent?.length ?? 0;
          if (!started && start < offset + length) {
            range.setStart(node, start - offset);
            started = true;
          }
          if (started && end <= offset + length) {
            range.setEnd(node, end - offset);
            break;
          }
          offset += length;
        }
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        if (selection?.toString() !== target)
          throw new Error("Selection differs from the synthetic target.");
      }, entry.targetText);
      await page
        .getByRole("toolbar", { name: "Selected text actions" })
        .getByRole("button", { name: "Evaluate", exact: true })
        .click();
      await page
        .getByLabel(
          entry.contextMode === "none"
            ? "Selected text only"
            : "Include nearby context",
          { exact: true },
        )
        .check();
    }
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/evaluations/preview") &&
        response.request().method() === "POST",
    );
    const [response] = await Promise.all([
      responsePromise,
      page
        .getByRole("button", { name: "Prepare preview", exact: true })
        .click(),
    ]);
    assert.equal(response.status(), 200);
    const preview = EvaluationPreviewSchema.parse(await response.json());
    assert.equal(preview.snapshot.documentId, documentId);
    assert.equal(preview.snapshot.rubricSnapshot.id, rubricId);
    assert.equal(
      preview.snapshot.targetText,
      entry.targetText ?? expectedWhole,
    );
    assert.equal(preview.snapshot.context.mode, entry.contextMode);
    return preview;
  }
  const preflight = [];
  for (const entry of fixture.cases) {
    const preview = await prepare(entry);
    allowedRequestHashes.add(sha256(JSON.stringify(preview.compiledRequest)));
    preflight.push({ case: entry, preview });
  }
  assert.equal(actualCalls, 0);
  await writeFile(
    resolve(output, "preflight.json"),
    JSON.stringify(preflight, null, 2) + "\n",
  );
  process.stdout.write(
    JSON.stringify({
      phase: "preflight",
      provider,
      cases: preflight.map(({ case: entry, preview }) => ({
        id: entry.id,
        bytes: preview.byteCount,
        targetCharacters: preview.snapshot.targetText.length,
        questionCount: Object.keys(preview.compiledRequest.questions).length,
      })),
    }) + "\n",
  );
  for (const { case: entry, preview: reviewed } of preflight) {
    const preview = await prepare(entry);
    assert.equal(preview.inputHash, reviewed.inputHash);
    if (provider === "typesafe")
      await page
        .getByRole("checkbox", { name: /^Send this reviewed text/ })
        .check();
    const submissionPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/v1/documents/${documentId}/evaluations`) &&
        response.request().method() === "POST",
    );
    const [submission] = await Promise.all([
      submissionPromise,
      page
        .getByRole("complementary", { name: "Writing evaluation" })
        .getByRole("button", { name: "Evaluate", exact: true })
        .click(),
    ]);
    assert.equal(submission.status(), 202);
    let run = WritingEvaluationRunSchema.parse(await submission.json());
    const deadline = Date.now() + loaded.JEV_TIMEOUT_MS + 5_000;
    while (
      ["queued", "running"].includes(run.status) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      run = WritingEvaluationRunSchema.parse(
        await (
          await page.request.get(
            `http://127.0.0.1:5174/v1/evaluations/${run.id}`,
          )
        ).json(),
      );
    }
    if (["queued", "running"].includes(run.status))
      throw new Error(
        "Evaluation did not become terminal; do not retry automatically.",
      );
    const record = WritingEvaluationExportSchema.parse(
      await (
        await page.request.get(
          `http://127.0.0.1:5174/v1/evaluations/${run.id}/export`,
        )
      ).json(),
    );
    assert.equal(record.run.inputHash, preview.inputHash);
    await writeFile(
      resolve(output, `${entry.id}.json`),
      JSON.stringify(record, null, 2) + "\n",
    );
    await appendFile(
      resolve(output, "results.jsonl"),
      JSON.stringify({
        caseId: entry.id,
        unit: entry.unit,
        contextMode: entry.contextMode,
        preparedBytes: preview.byteCount,
        questionCount: Object.keys(preview.compiledRequest.questions).length,
        evaluation: record,
      }) + "\n",
    );
    finished += 1;
    process.stdout.write(
      JSON.stringify({
        caseId: entry.id,
        status: run.status,
        returnedModel: run.returnedModel,
        durationMs: run.durationMs,
        usage: run.usage,
        failure: run.failure,
      }) + "\n",
    );
    if (run.status !== "completed") {
      runFailure = run.failure?.code ?? run.status;
      break;
    }
    await expect(page.locator(".evaluation-result-provenance")).toContainText(
      run.returnedModel!,
    );
    await expect(page.locator(".historical-snapshot small")).toHaveText(
      `Input hash ${run.inputHash}`,
    );
    await expect(page.locator(".evaluation-criterion-card")).toHaveCount(4);
    await page
      .locator(".evaluation-results")
      .screenshot({ path: resolve(output, `${entry.id}.png`) });
  }
  if (!runFailure) assert.equal(finished, 5);
} catch (error) {
  runFailure = error instanceof Error ? error.name : "UnknownError";
  // Framework errors are local diagnostics; do not log response bodies or configuration.
  process.stderr.write(
    `Scope test stopped (${runFailure}). Inspect saved preflight/run artifacts; no automatic retry.\n`,
  );
  if (provider === "mock" && error instanceof Error)
    process.stderr.write(error.message + "\n");
} finally {
  await browser?.close();
  await web?.close();
  await server.close();
  await writeFile(
    resolve(output, "manifest.json"),
    JSON.stringify(
      {
        ...manifest,
        finishedAt: new Date().toISOString(),
        documentId,
        rubricId,
        actualRemoteCalls: actualCalls,
        terminalRuns: finished,
        unattemptedCases: 5 - finished,
        status: runFailure ? "stopped" : "completed",
        ...(runFailure ? { failure: runFailure } : {}),
      },
      null,
      2,
    ) + "\n",
  );
}
if (runFailure) process.exitCode = 1;
