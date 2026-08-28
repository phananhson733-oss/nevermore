// @input  -- one sealed run request naming a frozen knowledge-base version and a sample count
// @output -- a finished visibility report, or a typed failure
// @pos    -- the durable orchestrator; every provider call and every read happens inside a step

import {
  visibilityAssembleStep,
  visibilityPrepareStep,
  visibilitySampleStep,
  type GeoVisibilityWorkflowInput,
  type GeoVisibilityWorkflowOutput,
  type VisibilitySamplePlanItem,
} from "./visibility-workflow-steps.ts";
import {
  VISIBILITY_CONCURRENCY,
  type VisibilitySample,
} from "./visibility-contract.ts";

export type {
  GeoVisibilityWorkflowInput,
  GeoVisibilityWorkflowOutput,
} from "./visibility-workflow-steps.ts";

function waves<T>(
  items: readonly T[],
  width: number,
): readonly (readonly T[])[] {
  const result: (readonly T[])[] = [];
  for (let index = 0; index < items.length; index += width) {
    result.push(items.slice(index, index + width));
  }
  return result;
}

/**
 * One provider call per step.
 *
 * A step per question would batch five paid calls behind one retry boundary,
 * and a step that dies at call four has to repeat the three that succeeded.
 * At this granularity a repeat costs one call, and the orchestration itself
 * has no wall-clock limit - which matters, because a full run is a quarter of
 * an hour and no single function may be held open for it.
 */
export async function geoVisibilityWorkflow(
  input: GeoVisibilityWorkflowInput,
): Promise<GeoVisibilityWorkflowOutput> {
  "use workflow";

  const prepared = await visibilityPrepareStep(input);
  if (prepared.status === "failed") {
    return { kind: "failed", code: prepared.code };
  }

  const collected: VisibilitySample[] = [];
  for (const wave of waves<VisibilitySamplePlanItem>(
    prepared.plan,
    VISIBILITY_CONCURRENCY,
  )) {
    const settled = await Promise.all(
      wave.map((item) => visibilitySampleStep(prepared.context, item)),
    );
    for (const sample of settled) collected.push(sample);
  }

  return visibilityAssembleStep(input, prepared, collected);
}
