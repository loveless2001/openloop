import type { AutocompleteMetrics, PipelineConfig } from "./schemas.js";

export interface GateCheck {
  name: string;
  passed: boolean;
  baseline?: number | boolean;
  candidate?: number | boolean;
}

export interface GateReport {
  schemaVersion: 1;
  verdict: "pass" | "fail";
  checks: GateCheck[];
}

export function evaluateDeploymentGates(input: {
  baseline: AutocompleteMetrics;
  candidate: AutocompleteMetrics;
  gates: PipelineConfig["gates"];
}): GateReport {
  const checks: GateCheck[] = [
    {
      name: "frozen_dataset_manifest",
      passed:
        input.candidate.datasetManifestHash ===
        input.baseline.datasetManifestHash,
    },
    {
      name: "held_out_utility",
      passed:
        !input.gates.requireUtilityImprovement ||
        input.candidate.heldOutUtility > input.baseline.heldOutUtility,
      baseline: input.baseline.heldOutUtility,
      candidate: input.candidate.heldOutUtility,
    },
    {
      name: "p95_time_to_first_token",
      passed:
        input.candidate.p95TimeToFirstTokenMs <=
        input.baseline.p95TimeToFirstTokenMs *
          (1 + input.gates.maximumP95TtftRegression),
      baseline: input.baseline.p95TimeToFirstTokenMs,
      candidate: input.candidate.p95TimeToFirstTokenMs,
    },
    ...(
      [
        ["malformed_rate", "malformedRate"],
        ["repeated_prefix_rate", "repeatedPrefixRate"],
        ["unwanted_newline_rate", "unwantedNewlineRate"],
      ] as const
    ).map(([name, key]) => ({
      name,
      passed: input.candidate[key] <= input.baseline[key],
      baseline: input.baseline[key],
      candidate: input.candidate[key],
    })),
    {
      name: "memorization_screen",
      passed:
        !input.gates.rejectMemorizationFlag ||
        !input.candidate.memorizationFlag,
      candidate: input.candidate.memorizationFlag,
    },
    {
      name: "warm_residency_contract",
      passed: input.candidate.warmResidencyVerified,
      baseline: input.baseline.warmResidencyVerified,
      candidate: input.candidate.warmResidencyVerified,
    },
  ];
  return {
    schemaVersion: 1,
    verdict: checks.every((check) => check.passed) ? "pass" : "fail",
    checks,
  };
}
