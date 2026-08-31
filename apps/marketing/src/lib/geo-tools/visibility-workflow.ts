// @input  -- one sealed run request naming a frozen knowledge-base version and a sample count
// @output -- a finished visibility report, or a typed failure
// @pos    -- the durable orchestrator; every provider call and every read happens inside a step

import {
  visibilityAssembleStep,
  visibilityPrepareStep,
  visibilitySampleStep,
  visibilityPersistStep,
  visibilitySiteEvidenceStep,
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
 * One provider call per step, in fixed waves.
 *
 * Fixed waves, and not a shared-cursor scheduler, even though waves cost the
 * slowest member of each wave and a cursor would not. The orchestrator is
 * replayed: the runtime matches step results to calls by the order the calls
 * were made, and a scheduler that hands the next item to whichever lane
 * finished first makes that order depend on provider latency. The second run
 * through would pair results with different calls. The head-of-line cost is
 * real - with per-call latency spread between a few seconds and the ninety
 * second ceiling, waves roughly double the wall clock against a perfect
 * scheduler - and it is the price of a run that can resume.
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

  const output = await visibilityAssembleStep(input, prepared, collected);
  const enriched = await visibilitySiteEvidenceStep(prepared, output);
  return visibilityPersistStep(input, enriched);
}
