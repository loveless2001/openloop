#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  compileDatasets,
  loadSourceDocuments,
  loadTraceRecords,
  sha256,
} from "./compiler.js";
import { evaluateDeploymentGates } from "./gates.js";
import { buildPlannedStageManifest, TrainingStageSchema } from "./manifest.js";
import {
  AutocompleteMetricsSchema,
  PipelineConfigSchema,
  type PipelineConfig,
} from "./schemas.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing required option ${name}.`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function loadConfig(path: string): Promise<PipelineConfig> {
  return PipelineConfigSchema.parse(await readJson(path));
}

function jsonl(records: unknown[]): string {
  return (
    records.map((record) => JSON.stringify(record)).join("\n") +
    (records.length ? "\n" : "")
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function compile(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  const [records, documents] = await Promise.all([
    loadTraceRecords(config.data.tracePaths),
    loadSourceDocuments(config.data.corpusPaths),
  ]);
  const compiled = compileDatasets({ config, records, documents });
  const outputDirectory = resolve(config.data.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const outputs = {
    cpt: jsonl(compiled.cpt),
    continuations: jsonl(compiled.continuations),
    preferences: jsonl(compiled.preferences),
  };
  await Promise.all([
    writeFile(resolve(outputDirectory, "cpt.jsonl"), outputs.cpt, "utf8"),
    writeFile(
      resolve(outputDirectory, "continuation-sft.jsonl"),
      outputs.continuations,
      "utf8",
    ),
    writeFile(
      resolve(outputDirectory, "preferences.jsonl"),
      outputs.preferences,
      "utf8",
    ),
  ]);
  const manifest = {
    schemaVersion: 1,
    compilerVersion: "openloop.training.v1",
    experimentName: config.experimentName,
    configHash: sha256(JSON.stringify(config)),
    sourceDigest: sha256(
      JSON.stringify({
        traces: records,
        documents: documents.map((document) => ({
          sourceId: document.sourceId,
          contentHash: sha256(document.text),
        })),
      }),
    ),
    sources: {
      traceRecords: records.length,
      documents: documents.map((document) => ({
        sourceId: document.sourceId,
        contentHash: sha256(document.text),
      })),
    },
    datasets: {
      cpt: { count: compiled.cpt.length, hash: sha256(outputs.cpt) },
      continuations: {
        count: compiled.continuations.length,
        hash: sha256(outputs.continuations),
      },
      preferences: {
        count: compiled.preferences.length,
        hash: sha256(outputs.preferences),
      },
    },
    warnings: compiled.warnings,
  };
  await writeJson(resolve(outputDirectory, "manifest.json"), manifest);
  process.stdout.write(
    `${JSON.stringify({ outputDirectory, manifest }, null, 2)}\n`,
  );
}

async function planStage(
  configPath: string,
  stageValue: string,
  datasetManifestPath: string,
  outputPath: string,
): Promise<void> {
  const config = await loadConfig(configPath);
  const stage = TrainingStageSchema.parse(stageValue);
  const datasetManifest = await readFile(resolve(datasetManifestPath), "utf8");
  const manifest = buildPlannedStageManifest({
    config,
    datasetManifestHash: sha256(datasetManifest),
    stage,
  });
  await writeJson(outputPath, manifest);
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: resolve(outputPath),
        message:
          "Plan created. Execution is deliberately disabled in this architecture-only implementation.",
        manifest,
      },
      null,
      2,
    )}\n`,
  );
}

async function gate(
  configPath: string,
  baselinePath: string,
  candidatePath: string,
  outputPath: string,
): Promise<void> {
  const config = await loadConfig(configPath);
  const [baseline, candidate] = await Promise.all([
    readJson(baselinePath).then((value) =>
      AutocompleteMetricsSchema.parse(value),
    ),
    readJson(candidatePath).then((value) =>
      AutocompleteMetricsSchema.parse(value),
    ),
  ]);
  const report = evaluateDeploymentGates({
    baseline,
    candidate,
    gates: config.gates,
  });
  await writeJson(outputPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict === "fail") process.exitCode = 2;
}

function usage(): string {
  return `OpenLoop offline training architecture

Commands:
  compile --config <pipeline.json>
  plan --config <pipeline.json> --stage <cpt|sft|preference|export> --dataset-manifest <manifest.json> --output <plan.json>
  gate --config <pipeline.json> --baseline <metrics.json> --candidate <metrics.json> --output <report.json>

The plan command never executes training or deployment.`;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "compile") {
    await compile(requiredOption("--config"));
    return;
  }
  if (command === "plan") {
    await planStage(
      requiredOption("--config"),
      requiredOption("--stage"),
      requiredOption("--dataset-manifest"),
      requiredOption("--output"),
    );
    return;
  }
  if (command === "gate") {
    await gate(
      requiredOption("--config"),
      requiredOption("--baseline"),
      requiredOption("--candidate"),
      requiredOption("--output"),
    );
    return;
  }
  process.stdout.write(`${usage()}\n`);
  if (command && command !== "help" && command !== "--help") {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
