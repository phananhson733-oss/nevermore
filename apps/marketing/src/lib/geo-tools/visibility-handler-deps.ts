// @input  -- the knowledge-base store, the shared quota, the provider's configuration, and Workflow
// @output -- the dependency set the three visibility routes run with
// @pos    -- the wiring seam; it translates store and Workflow states into HTTP-shaped ones

import { authenticateAccountRequest } from "../account-websites/route-http.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";
import { listFrozenGeoKbVersions } from "./kb-history.ts";
import { countGeoCitationQuestions } from "./kb-consumer-projection.ts";
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
  const list = await listFrozenGeoKbVersions({ userId });
  if (list.kind !== "ok") {
    return { kind: "unavailable", reason: "frozen_history_unavailable" };
  }

  const choices: VisibilityFrozenChoice[] = [];
  for (const { host, snapshot } of list.value) {
    // A v3 version may be published with no question set at all. This tool asks
    // that version's frozen questions, so such a version is not a choice: it is
    // left out rather than offered with a question count of zero, which would
    // price a run at nothing and then measure nothing.
    //
    // Left out of the *choices*, not out of the account's state. This list is
    // what the start endpoint validates a paid run against, so an unrunnable
    // version must not appear in it; the version itself is reported by
    // `/context` as `frozen: { kind: "unreadable" }`, which is what stops the
    // form from calling such an account "no frozen version yet".
    //
    // The test is `questionSet === null`, deliberately not `is v3`: a v3
    // version that does carry a question set is runnable -- the workflow reads
    // every payload version through `geoVersionedPayloadIdentity` -- and
    // excluding it here would take a working version away.
    if (snapshot.questionSet === null) continue;
    const questionSet = snapshot.questionSet;
    let retrievalCount: number;
    try { retrievalCount = countGeoCitationQuestions(questionSet); }
    catch { return { kind: "unavailable", reason: "frozen_question_policy_unavailable" }; }
    choices.push({
      kbId: snapshot.kbId,
      host,
      snapshotId: snapshot.snapshotId,
      revision: snapshot.revision,
      frozenAt: snapshot.frozenAt,
      questionCount: questionSet.questions.length,
      retrievalCount,
      language: questionSet.language,
      marketCode: questionSet.country,
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
