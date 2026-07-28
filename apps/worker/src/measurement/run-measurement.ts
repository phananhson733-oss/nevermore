import {
  MeasurementTarget,
  MeasurementWindow,
  MeasurementWindowInterval,
  PublicationChangeReceipt,
  PublicationDeliveryReceipt,
  Uuid,
  type MeasurementWindow as MeasurementWindowValue,
  type PublicationChangeReceipt as PublicationChangeReceiptValue,
  type PublicationDeliveryReceipt as PublicationDeliveryReceiptValue,
} from "@sf/contracts";
import {
  AsyncRunsRepository,
  toRunAttempt,
  type MeasurementProviderEvidence,
  type ProjectScope,
  type RunAttempt,
} from "@sf/db";
import { z } from "zod";
import type { WorkerContext } from "../context.ts";
import { createDbMeasurementExecutionDependencies } from "./db-authority.ts";
import { projectMeasurementDimensions } from "./project-measurement.ts";

export const MEASUREMENT_CONTRACT_VERSION = "measurement.0.1.0";
const MEASUREMENT_PROVIDER_SETTLEMENT_DELAY_MS =
  4 * 24 * 60 * 60 * 1_000;
const MEASUREMENT_WINDOW_MS = 28 * 24 * 60 * 60 * 1_000;
const Checksum = z.string().regex(/^[a-f0-9]{64}$/u);

export interface MeasurementJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contractVersion?: string;
}

const FrozenFactsObject = z
  .object({
    workspaceId: Uuid,
    projectId: Uuid,
    changeReceiptId: Uuid,
    publicationAttemptId: Uuid,
    siteId: Uuid,
    sitePageId: Uuid,
    target: MeasurementTarget,
    actionId: Uuid,
    artifactId: Uuid,
    artifactRevisionId: Uuid,
    artifactRevision: z.number().int().positive(),
    artifactContentHash: Checksum,
    contentChecksum: Checksum,
    timelineDeliveryReceiptId: Uuid.nullable(),
    url: z.string().url().max(2048),
    canonicalUrl: z.string().url().max(2048),
    beforeWindow: MeasurementWindowInterval,
    afterWindow: MeasurementWindowInterval,
    timezone: z.literal("UTC"),
    interpretation: z.literal("observational_non_causal"),
    startAfter: z.string().datetime(),
  })
  .strict();

const FrozenRunRequest = z
  .object({
    operation: z.literal("measurement_window"),
    idempotencyKey: z.string().trim().min(1).max(255),
    requestHash: Checksum,
    frozenFacts: FrozenFactsObject,
  })
  .strict()
  .superRefine((request, ctx) => {
    const facts = request.frozenFacts;
    const beforeStart = Date.parse(facts.beforeWindow.startAt);
    const beforeEnd = Date.parse(facts.beforeWindow.endAt);
    const afterStart = Date.parse(facts.afterWindow.startAt);
    const afterEnd = Date.parse(facts.afterWindow.endAt);
    const startAfter = Date.parse(facts.startAfter);
    if (
      beforeEnd - beforeStart !== MEASUREMENT_WINDOW_MS ||
      afterEnd - afterStart !== MEASUREMENT_WINDOW_MS ||
      beforeEnd !== afterStart ||
      startAfter !==
        afterEnd + MEASUREMENT_PROVIDER_SETTLEMENT_DELAY_MS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["frozenFacts", "beforeWindow"],
        message:
          "Measurement phases and provider settlement deadline are invalid",
      });
    }
    if (
      facts.target.sitePageId !== facts.sitePageId ||
      facts.target.targetRef !== `site-page://${facts.sitePageId}`
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["frozenFacts", "target"],
        message: "Measurement target does not match its SitePage",
      });
    }
  });

export type MeasurementFrozenFacts = z.infer<
  typeof FrozenFactsObject
>;

export interface MeasurementExecutionEvidence {
  readonly verifiedChangeReceipt: PublicationChangeReceiptValue;
  readonly timelineDeliveryReceipt: PublicationDeliveryReceiptValue | null;
  readonly providerEvidence: readonly MeasurementProviderEvidence[];
}

export interface MeasurementFinalizationInput {
  readonly scope: ProjectScope;
  readonly attempt: RunAttempt;
  readonly window: MeasurementWindowValue;
  readonly observationLineage: {
    readonly gsc: {
      readonly baselineObservationId: string | null;
      readonly outcomeObservationId: string | null;
    };
    readonly ga4: {
      readonly baselineObservationId: string | null;
      readonly outcomeObservationId: string | null;
    };
    readonly geo: {
      readonly baselineObservationId: string | null;
      readonly outcomeObservationId: string | null;
    };
  };
}

export interface MeasurementExecutionDependencies {
  now(): Date;
  loadEvidence(input: {
    readonly scope: ProjectScope;
    readonly facts: MeasurementFrozenFacts;
  }): Promise<MeasurementExecutionEvidence>;
  finalize(input: MeasurementFinalizationInput): Promise<boolean>;
}

export class MeasurementNotDueError extends Error {
  readonly code = "MEASUREMENT_NOT_DUE";

  constructor() {
    super(
      "The fixed outcome window is still waiting for provider settlement.",
    );
    this.name = "MeasurementNotDueError";
  }
}

export class MeasurementAuthorityError extends Error {
  readonly code = "MEASUREMENT_AUTHORITY_INVALID";

  constructor() {
    super(
      "The immutable Measurement Window authority failed validation.",
    );
    this.name = "MeasurementAuthorityError";
  }
}

/**
 * Materialize one immutable before/after result from canonical observations.
 * Queue data carries only correlation ids; every authority fact is re-read or
 * checked against the server-frozen run payload before finalization.
 */
export async function runMeasurement(
  ctx: WorkerContext,
  payload: MeasurementJobPayload,
  dependencies: MeasurementExecutionDependencies =
    createDbMeasurementExecutionDependencies(ctx),
): Promise<void> {
  const scope: ProjectScope = {
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
  };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(scope, payload.runId);
  if (!claimed) return;
  const attempt = toRunAttempt(claimed);

  const request = FrozenRunRequest.safeParse(claimed.request_payload);
  if (
    !request.success ||
    claimed.id !== payload.runId ||
    claimed.workspace_id !== payload.workspaceId ||
    claimed.project_id !== payload.projectId ||
    claimed.kind !== "measurement" ||
    claimed.contract_version !== MEASUREMENT_CONTRACT_VERSION ||
    payload.contractVersion !== MEASUREMENT_CONTRACT_VERSION ||
    claimed.result_type !== "measurement_window" ||
    !Uuid.safeParse(claimed.result_id).success ||
    (request.success &&
      (request.data.frozenFacts.workspaceId !== payload.workspaceId ||
        request.data.frozenFacts.projectId !== payload.projectId))
  ) {
    await failInvalidAuthority(runs, attempt);
    return;
  }

  const facts = request.data.frozenFacts;
  const executionNow = dependencies.now();
  if (
    !Number.isFinite(executionNow.getTime()) ||
    executionNow.getTime() < Date.parse(facts.startAfter)
  ) {
    const error = new MeasurementNotDueError();
    await runs.resetToQueued(attempt, {
      code: error.code,
      summary: error.message,
    });
    throw error;
  }

  try {
    const evidence = await dependencies.loadEvidence({ scope, facts });
    const verifiedChangeReceipt = PublicationChangeReceipt.parse(
      evidence.verifiedChangeReceipt,
    );
    const timelineDeliveryReceipt =
      evidence.timelineDeliveryReceipt === null
        ? null
        : PublicationDeliveryReceipt.parse(
            evidence.timelineDeliveryReceipt,
          );
    assertEvidenceMatchesFrozenFacts(
      facts,
      verifiedChangeReceipt,
      timelineDeliveryReceipt,
    );

    const projected = projectMeasurementDimensions({
      siteId: facts.siteId,
      sitePageId: facts.sitePageId,
      beforeWindow: facts.beforeWindow,
      afterWindow: facts.afterWindow,
      recordedAt: executionNow.toISOString(),
      providerEvidence: evidence.providerEvidence,
    });
    const aggregateState = measurementState(projected.dimensions);
    const window = MeasurementWindow.parse({
      measurementWindowId: claimed.result_id,
      projectId: facts.projectId,
      siteId: facts.siteId,
      target: facts.target,
      actionId: facts.actionId,
      artifactId: facts.artifactId,
      artifactRevisionId: facts.artifactRevisionId,
      artifactRevision: facts.artifactRevision,
      artifactContentHash: facts.artifactContentHash,
      publicationAttemptId: facts.publicationAttemptId,
      verifiedChangeReceipt,
      timelineDeliveryReceipt,
      beforeWindow: facts.beforeWindow,
      afterWindow: facts.afterWindow,
      timezone: facts.timezone,
      url: facts.url,
      canonicalUrl: facts.canonicalUrl,
      interpretation: facts.interpretation,
      state: aggregateState,
      // A verified Change Receipt proves the deployment clock, not a separate
      // technical recheck. Keep this null until a canonical recheck writer
      // supplies an exact immutable reference.
      technicalVerificationRef: null,
      limitation:
        aggregateState === "observed"
          ? null
          : aggregateLimitation(projected.dimensions),
      dimensions: projected.dimensions,
      recordedAt: executionNow.toISOString(),
    });

    const committed = await dependencies.finalize({
      scope,
      attempt,
      window,
      observationLineage: projected.observationLineage,
    });
    if (committed) {
      ctx.logger.info("measurement_done", {
        runId: payload.runId,
        state: window.state,
      });
    }
  } catch (error) {
    if (
      error instanceof MeasurementAuthorityError ||
      error instanceof z.ZodError
    ) {
      await failInvalidAuthority(runs, attempt);
      return;
    }
    await runs.resetToQueued(attempt, {
      code: "MEASUREMENT_DEPENDENCY_UNAVAILABLE",
      summary: "Measurement evidence could not be read or committed.",
    });
    throw error;
  }
}

function assertEvidenceMatchesFrozenFacts(
  facts: MeasurementFrozenFacts,
  change: PublicationChangeReceiptValue,
  delivery: PublicationDeliveryReceiptValue | null,
): void {
  const changeAt = Date.parse(change.observedAt);
  if (
    change.id !== facts.changeReceiptId ||
    change.receiptKind !== "change_receipt" ||
    change.verificationState !== "verified_live" ||
    change.liveCanonicalUrl !== facts.canonicalUrl ||
    change.artifactContentHash !== facts.artifactContentHash ||
    change.contentChecksum !== facts.contentChecksum ||
    changeAt !== Date.parse(facts.beforeWindow.endAt) ||
    changeAt !== Date.parse(facts.afterWindow.startAt) ||
    (facts.timelineDeliveryReceiptId === null) !==
      (delivery === null)
  ) {
    throw new MeasurementAuthorityError();
  }
  if (
    delivery !== null &&
    (delivery.id !== facts.timelineDeliveryReceiptId ||
      delivery.id !== change.predecessorDeliveryReceiptId ||
      delivery.providerKind !== change.providerKind ||
      delivery.remoteScopeRef !== change.remoteScopeRef ||
      delivery.artifactContentHash !== change.artifactContentHash ||
      delivery.contentChecksum !== change.contentChecksum ||
      Date.parse(delivery.observedAt) >= changeAt)
  ) {
    throw new MeasurementAuthorityError();
  }
}

function measurementState(
  dimensions: MeasurementWindowValue["dimensions"],
): "observed" | "insufficient_data" | "unavailable" | "regressed" {
  const states = Object.values(dimensions).map(
    (dimension) => dimension.state,
  );
  if (states.includes("regressed")) return "regressed";
  if (states.includes("observed")) return "observed";
  if (states.includes("insufficient_data")) {
    return "insufficient_data";
  }
  return "unavailable";
}

function aggregateLimitation(
  dimensions: MeasurementWindowValue["dimensions"],
): string {
  const limitations = [
    ...new Set(
      Object.values(dimensions)
        .map((dimension) => dimension.limitation)
        .filter((value): value is string => value !== null),
    ),
  ];
  return limitations.join(" ").slice(0, 4_000);
}

async function failInvalidAuthority(
  runs: AsyncRunsRepository,
  attempt: RunAttempt,
): Promise<void> {
  await runs.setTerminal(attempt, {
    status: "failed",
    lastErrorCode: "MEASUREMENT_FROZEN_FACTS_INVALID",
    lastErrorSummary:
      "The immutable Measurement Window authority failed validation.",
  });
}
