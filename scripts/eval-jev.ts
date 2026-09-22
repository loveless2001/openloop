import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  MockWritingEvaluator,
  TypeSafeWritingEvaluator,
} from "../packages/model-adapters/src/index.js";
import { loadEnvironment } from "../apps/server/src/config/env.js";
import { findWorkspaceRoot } from "../apps/server/src/config/workspace.js";
import {
  prepareWritingPilot,
  runWritingPilot,
} from "../apps/server/src/writing-pilot.js";

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      input: { type: "string" },
      output: { type: "string" },
      provider: { type: "string", default: "mock" },
      "allow-remote": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.input || !values.output)
    throw new Error(
      "Specify --input <fixture.json> and --output <data/evaluations/file.jsonl>.",
    );
  if (values.provider !== "mock" && values.provider !== "typesafe")
    throw new Error("Provider must be mock or typesafe.");
  if (values.provider === "typesafe" && !values["allow-remote"])
    throw new Error(
      "Remote pilots require --provider typesafe --allow-remote.",
    );
  const root = findWorkspaceRoot();
  const outputPath = resolve(root, values.output);
  const outputRelative = relative(resolve(root, "data"), outputPath);
  if (
    !outputRelative ||
    outputRelative.startsWith("..") ||
    isAbsolute(outputRelative) ||
    !outputPath.endsWith(".jsonl")
  ) {
    throw new Error(
      "Output must be a .jsonl file under the ignored data/ directory.",
    );
  }
  const source = await readFile(resolve(root, values.input), "utf8");
  const environment = loadEnvironment();
  const provider = values.provider;
  const prepared = prepareWritingPilot(JSON.parse(source), {
    providerId: provider,
    requestedModel:
      provider === "mock" ? "mock-writing-fixtures-v1" : environment.JEV_MODEL,
    endpointIdentity:
      provider === "mock"
        ? "mock://local"
        : `${environment.JEV_API_BASE_URL.replace(/\/$/, "")}/systemone`,
  });
  const evaluator =
    provider === "mock"
      ? new MockWritingEvaluator()
      : new TypeSafeWritingEvaluator({
          apiKey: environment.TYPESAFE_API_KEY,
          baseUrl: environment.JEV_API_BASE_URL,
          timeoutMs: environment.JEV_TIMEOUT_MS,
        });
  await mkdir(dirname(outputPath), { recursive: true });
  const output = await open(outputPath, "wx", 0o600);
  try {
    const summary = await runWritingPilot({
      prepared,
      evaluator,
      allowRemote: values["allow-remote"],
      fixtureSha256: createHash("sha256").update(source).digest("hex"),
      write: async (record) => {
        await output.writeFile(`${JSON.stringify(record)}\n`);
        await output.sync();
      },
    });
    process.stdout.write(`${JSON.stringify({ provider, ...summary })}\n`);
    if (summary.failed) process.exitCode = 1;
  } finally {
    await output.close();
  }
}

void main().catch((error: unknown) => {
  // Never print validator input, endpoint credentials, or provider response bodies.
  process.stderr.write(
    error instanceof Error && error.name === "ZodError"
      ? "Invalid pilot fixtures or configuration. Check the documented schema.\n"
      : error instanceof Error && "code" in error && error.code === "EEXIST"
        ? "Output already exists. Choose a new output filename.\n"
        : "Pilot could not run. Check arguments, fixture size/schema, provider configuration, and output path; remote use requires --allow-remote.\n",
  );
  process.exitCode = 1;
});
