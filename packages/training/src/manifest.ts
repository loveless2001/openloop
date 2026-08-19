import { z } from "zod";

import type { PipelineConfig } from "./schemas.js";
import { sha256 } from "./compiler.js";

export const TrainingStageSchema = z.enum([
  "cpt",
  "sft",
  "preference",
  "export",
]);
export type TrainingStage = z.infer<typeof TrainingStageSchema>;

export interface PlannedStageManifest {
  schemaVersion: 1;
  experimentName: string;
  stage: TrainingStage;
  status: "planned";
  executionEnabled: false;
  configHash: string;
  datasetManifestHash: string;
  baseModel: PipelineConfig["baseModel"];
  stageConfig:
    | PipelineConfig["stages"][keyof PipelineConfig["stages"]]
    | PipelineConfig["deployment"];
  outputModel?: string;
  prerequisites: string[];
}

export function buildPlannedStageManifest(input: {
  config: PipelineConfig;
  datasetManifestHash: string;
  stage: TrainingStage;
}): PlannedStageManifest {
  const prerequisites: Record<TrainingStage, string[]> = {
    cpt: ["frozen baseline", "cpt dataset", "privacy review"],
    sft: ["frozen baseline", "continuation SFT dataset"],
    preference: [
      "winning supervised checkpoint",
      "minimum clean preference examples",
    ],
    export: ["passing deployment gate", "selected merged checkpoint"],
  };
  return {
    schemaVersion: 1,
    experimentName: input.config.experimentName,
    stage: input.stage,
    status: "planned",
    executionEnabled: false,
    configHash: sha256(JSON.stringify(input.config)),
    datasetManifestHash: input.datasetManifestHash,
    baseModel: input.config.baseModel,
    stageConfig:
      input.stage === "export"
        ? input.config.deployment
        : input.config.stages[input.stage],
    ...(input.stage === "export"
      ? { outputModel: input.config.deployment.ollamaModelName }
      : {}),
    prerequisites: prerequisites[input.stage],
  };
}
