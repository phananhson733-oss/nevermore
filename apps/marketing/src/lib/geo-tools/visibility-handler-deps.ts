// @input  -- the knowledge-base store, the shared quota, the provider's configuration, and Workflow
// @output -- the dependency set the three visibility routes run with
// @pos    -- the wiring seam; it translates store and Workflow states into HTTP-shaped ones

import { authenticateAccountRequest } from "../account-websites/route-http.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";
import {
  listGeoKnowledgeBases,
  readFrozenGeoKb,
} from "./kb-store.ts";
import {
  VISIBILITY_DAILY_WINDOW_SECONDS,
  VISIBILITY_RUNS_PER_DAY,
} from "./visibility-contract.ts";
import type {
  VisibilityFrozenChoice,
  VisibilityHandlerDependencies,
  VisibilityRunRead,
  VisibilityStoreOutcome,
} from "./visibility-handler.ts";
import type { GeoVisibilityWorkflowOutput } from "./visibility-workflow-steps.ts";

export {
  handleVisibilityLoad,
  handleVisibilityStart,
  handleVisibilityStatus,
} from "./visibility-handler.ts";

/**
 * Every frozen version this account could run against.
 *
 * The question count comes from reading the frozen set rather than from a
 * column, because the number the page prints the cost from has to be the
 * number the run will actually ask.
 */
async function listFrozenVersions(
  userId: string,
): Promise<VisibilityStoreOutcome<readonly VisibilityFrozenChoice[]>> {
  const list = await listGeoKnowledgeBases({ userId });
  if (list.kind !== "ok") {
    return list.kind === "missing"
      ? { kind: "ok", value: [] }
      : { kind: "unavailable", reason: "store unavailable" };
  }

  const choices: VisibilityFrozenChoice[] = [];
  for (const summary of list.value) {
    if (summary.frozen === null) continue;
    const frozen = await readFrozenGeoKb({ userId, kbId: summary.kbId });
    if (frozen.kind !== "ok") continue;
    choices.push({
      kbId: summary.kbId,
      host: summary.host,
      snapshotId: frozen.value.snapshotId,
      revision: frozen.value.revision,
      frozenAt: frozen.value.frozenAt,
      questionCount: frozen.value.questionSet.questions.length,
      retrievalCount: frozen.value.questionSet.questions.filter(
        (question) => question.mode === "retrieval",
      ).length,
    });
  }
  return { kind: "ok", value: choices };
}

/**
 * The safety valve.
 *
 * Not a budget - the Owner lifted that for this work - but a runaway loop at
 * a few dollars a run is still a runaway loop, and the store is the only
 * counter that survives a cold start.
 */
async function consumeDailyRun(userId: string): Promise<boolean> {
  const outcome = await consumePublicToolQuota(
    `geo-visibility:user:${userId}`,
    VISIBILITY_RUNS_PER_DAY,
    VISIBILITY_DAILY_WINDOW_SECONDS,
  );
  // Fail closed: an unmetered paid loop is worse than a tool that is briefly
  // unavailable, which is the same call every other paid path here makes.
  return outcome.kind === "allowed";
}

function providerConfigured(): boolean {
  return (
    (process.env["DATAFORSEO_LOGIN"] ?? "") !== "" &&
    (process.env["DATAFORSEO_PASSWORD"] ?? "") !== ""
  );
}

function isWorkflowOutput(value: unknown): value is GeoVisibilityWorkflowOutput {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === "completed" || kind === "failed";
}

async function readRun(runId: string): Promise<VisibilityRunRead> {
  try {
    const { getRun } = await import("workflow/api");
    const run = getRun<GeoVisibilityWorkflowOutput>(runId);
    if (!(await run.exists)) return { kind: "missing" };
    const status = await run.status;
    if (status === "pending") return { kind: "queued" };
    if (status === "running") return { kind: "running" };
    if (status === "cancelled" || status === "failed") {
      return { kind: "failed", code: "run_unavailable" };
    }

    const output: unknown = await run.returnValue;
    if (!isWorkflowOutput(output)) {
      return { kind: "failed", code: "internal_error" };
    }
    return output.kind === "completed"
      ? { kind: "completed", report: output.report }
      : { kind: "failed", code: output.code };
  } catch (error) {
    const errors = await import("workflow/internal/errors");
    if (errors.WorkflowRunNotFoundError.is(error)) return { kind: "missing" };
    return { kind: "failed", code: "run_unavailable" };
  }
}

export const DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES: VisibilityHandlerDependencies =
  {
    authenticate: authenticateAccountRequest,
    listFrozen: listFrozenVersions,
    consumeDailyRun,
    providerConfigured,
    // Replaced by the start route, which holds the static workflow import.
    startRun: () => {
      throw new Error("startRun must be provided by the route");
    },
    readRun,
    now: Date.now,
  };
