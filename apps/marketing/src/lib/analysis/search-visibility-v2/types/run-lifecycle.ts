// @input  -- V1.3 §10.2 / §20.3 Run lifecycle
// @output -- RunStep / RunStepStatus / RunStatus closed enums
// @pos    -- types/ 拆分，无依赖；被 RunResult / Orchestrator / repository 共用

export const ALL_RUN_STEPS = [
  "fetchGsc",
  "fetchDfs",
  "fetchUrlInspection",
  "buildKeywordUniverse",
  "analyzeAndScore",
] as const;
export type RunStep = (typeof ALL_RUN_STEPS)[number];

export const ALL_RUN_STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;
export type RunStepStatus = (typeof ALL_RUN_STEP_STATUSES)[number];

export const ALL_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof ALL_RUN_STATUSES)[number];
