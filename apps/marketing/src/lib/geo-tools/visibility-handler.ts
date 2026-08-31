// @input  -- same-origin authenticated POSTs: list frozen versions, start a run, poll one
// @output -- the choices a run can be started from, a sealed run pointer, or the finished report
// @pos    -- the HTTP boundary of the visibility check; the run itself lives in Workflow

import {
  authenticateAccountRequest,
  privateError,
  privateJson,
  readAccountMutationJson,
} from "../account-websites/route-http.ts";
import { open, seal } from "../auth/sealed-cookie.ts";
import { randomUUID } from "node:crypto";
import { parseVisibilityEngines } from "./visibility-engines.ts";
import { isVisibilityReportV2, type AnyVisibilityReport } from "./visibility-v2-contract.ts";
import { encodeVisibilityWire, VISIBILITY_MAX_WIRE_SLOTS } from "./visibility-wire.ts";
import {
  VISIBILITY_DAILY_WINDOW_SECONDS,
  VISIBILITY_RUNS_PER_DAY,
  VISIBILITY_SAMPLES_OPTIONS,
  type VisibilityErrorCode,
} from "./visibility-contract.ts";

const LIST_BODY_LIMIT_BYTES = 1_024;
const START_BODY_LIMIT_BYTES = 2_048;

/**
 * How long a browser may hold a run pointer.
 *
 * A run takes about a quarter of an hour, so the pointer has to outlive a
 * reload and a coffee. It is not a session: it names one run and is bound to
 * the subject that started it.
 */
const RUN_POINTER_TTL_SECONDS = 24 * 60 * 60;
/** The workflow reads its inputs once, at the start. */
const INPUT_TTL_SECONDS = 60 * 60;

export interface VisibilityFrozenChoice {
  readonly kbId: string;
  readonly host: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly questionCount: number;
  readonly retrievalCount: number;
  readonly language?: string;
  readonly marketCode?: string;
}

export type VisibilityStoreOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reason: string };

export type VisibilityRunRead =
  | { readonly kind: "missing" }
  | { readonly kind: "queued" | "running" }
  | { readonly kind: "completed"; readonly report: AnyVisibilityReport }
  | { readonly kind: "failed"; readonly code: VisibilityErrorCode };

export interface VisibilityHandlerDependencies {
  readonly authenticate: typeof authenticateAccountRequest;
  readonly listFrozen: (
    userId: string,
  ) => Promise<VisibilityStoreOutcome<readonly VisibilityFrozenChoice[]>>;
  /** Spends one of the day's runs. Returns false when the day is used up. */
  readonly consumeDailyRun: (userId: string) => Promise<boolean>;
  readonly providerConfigured: () => boolean;
  readonly startRun: (inputToken: string) => Promise<{ readonly runId: string }>;
  readonly readRun: (runId: string) => Promise<VisibilityRunRead>;
  readonly now: () => number;
}

interface RunPointer {
  readonly sub: string;
  readonly runId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const present = Object.keys(value);
  return (
    present.length === keys.length && keys.every((key) => present.includes(key))
  );
}

export async function handleVisibilityLoad(
  request: Request,
  dependencies: VisibilityHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, LIST_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, [])) return privateError("invalid_request", 400);

  const frozen = await dependencies.listFrozen(auth.userId);
  if (frozen.kind === "unavailable") {
    return privateError("store_unavailable", 503);
  }
  // One shape for both outcomes. An account with nothing frozen used to get a
  // payload missing `runsPerDay` and `providerConfigured`, which was harmless
  // only because that case happens to render an empty state with no button to
  // gate. A reader cannot see that coincidence, and the next person to add a
  // control to the empty state would inherit two undefined fields.
  return privateJson({
    data: {
      choices: frozen.kind === "not_found" ? [] : frozen.value,
      runsPerDay: VISIBILITY_RUNS_PER_DAY,
      // Configuration is reported rather than discovered on the paid path: a
      // visitor should not spend a click to learn the credentials are missing.
      providerConfigured: dependencies.providerConfigured(),
    },
  });
}

export async function handleVisibilityStart(
  request: Request,
  dependencies: VisibilityHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, START_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  const legacy = exactKeys(body.value, ["kbId", "snapshotId", "samplesPerQuestion"]);
  if (!legacy && !exactKeys(body.value, ["kbId", "snapshotId", "samplesPerQuestion", "engines"])) {
    return privateError("invalid_request", 400);
  }
  const record = body.value as {
    readonly kbId: unknown;
    readonly snapshotId: unknown;
    readonly samplesPerQuestion: unknown;
    readonly engines?: unknown;
  };
  const engines = legacy ? null : parseVisibilityEngines(record.engines);
  if (!legacy && engines === null) return privateError("invalid_request", 400);
  const samples = record.samplesPerQuestion;
  if (
    typeof record.kbId !== "string" ||
    typeof record.snapshotId !== "string" ||
    typeof samples !== "number" ||
    !VISIBILITY_SAMPLES_OPTIONS.includes(
      samples as (typeof VISIBILITY_SAMPLES_OPTIONS)[number],
    )
  ) {
    return privateError("invalid_request", 400);
  }

  if (!dependencies.providerConfigured()) {
    return privateError("provider_unconfigured", 503);
  }

  // The frozen version has to belong to this account before anything is
  // charged; the workflow re-reads it under the same user id, so this is the
  // early refusal rather than the boundary.
  const frozen = await dependencies.listFrozen(auth.userId);
  if (frozen.kind === "unavailable") {
    return privateError("store_unavailable", 503);
  }
  const choice =
    frozen.kind === "ok"
      ? frozen.value.find(
          (entry) =>
            entry.kbId === record.kbId && entry.snapshotId === record.snapshotId,
        )
      : undefined;
  if (choice === undefined) return privateError("not_found", 404);
  if (engines !== null && choice.questionCount * samples * engines.length > VISIBILITY_MAX_WIRE_SLOTS) return privateError("invalid_request", 400);

  const allowed = await dependencies.consumeDailyRun(auth.userId);
  if (!allowed) {
    return privateJson(
      {
        error: { code: "daily_limit" },
        limit: VISIBILITY_RUNS_PER_DAY,
        windowSeconds: VISIBILITY_DAILY_WINDOW_SECONDS,
      },
      429,
    );
  }

  const inputToken = seal(
    "gg_geo_visibility_input",
    {
      sub: auth.userId,
      kbId: record.kbId,
      snapshotId: record.snapshotId,
      revision: choice.revision,
      samplesPerQuestion: samples,
      ...(engines === null ? {} : { engines, recordRunId: randomUUID() }),
      startedAt: new Date(dependencies.now()).toISOString(),
    },
    INPUT_TTL_SECONDS,
    dependencies.now,
  );

  let runId: string;
  try {
    runId = (await dependencies.startRun(inputToken)).runId;
  } catch {
    return privateError("run_unavailable", 503);
  }

  return privateJson({
    data: {
      status: "running",
      runToken: seal(
        "gg_geo_visibility_run",
        { sub: auth.userId, runId },
        RUN_POINTER_TTL_SECONDS,
        dependencies.now,
      ),
      questionCount: choice.questionCount,
      samplesPerQuestion: samples,
      ...(engines === null ? {} : { engines, calls: choice.questionCount * samples * engines.length }),
    },
  });
}

export async function handleVisibilityStatus(
  request: Request,
  dependencies: VisibilityHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, START_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["runToken"])) {
    return privateError("invalid_request", 400);
  }
  const runToken = (body.value as { runToken: unknown }).runToken;
  if (typeof runToken !== "string") {
    return privateError("invalid_request", 400);
  }

  let pointer: RunPointer | null = null;
  try {
    pointer = open<RunPointer>(
      "gg_geo_visibility_run",
      runToken,
      dependencies.now,
    );
  } catch {
    return privateError("run_unavailable", 503);
  }
  // A pointer that names someone else's run is indistinguishable from one that
  // has expired, deliberately: neither tells the caller a run exists.
  if (pointer === null || pointer.sub !== auth.userId) {
    return privateError("not_found", 404);
  }

  let read: VisibilityRunRead;
  try {
    read = await dependencies.readRun(pointer.runId);
  } catch {
    return privateError("run_unavailable", 503);
  }

  switch (read.kind) {
    case "missing":
      return privateError("not_found", 404);
    case "queued":
    case "running":
      // The client starts from this and caps itself at five seconds. Polling
      // a quarter-hour run every second is a thousand requests for one answer.
      return privateJson({
        data: { status: read.kind, runToken, retryAfterSeconds: 5 },
      });
    case "failed":
      return privateError(read.code, 502);
    case "completed":
      return privateJson({ data: { status: "completed", report: isVisibilityReportV2(read.report) ? encodeVisibilityWire(read.report) : read.report } });
  }
}
