import { Uuid } from "@sf/contracts";

export const EXECUTION_DEEP_LINK_UUID_MAX_CHARS = 36;

export type ExecutionDeepLinkKey = "actionId" | "artifactId";

export interface ExecutionTarget {
  readonly actionId: string;
  readonly artifactId: string | null;
}

export interface QueuedActionTarget {
  readonly actionId: string;
  readonly runId: string;
  readonly artifactType: string;
  readonly expectedArtifactId: string | null;
  readonly phase: "running" | "settling";
  readonly refreshing: boolean;
  readonly lastRefreshFailed: boolean;
}

export interface QueuedActionProjectionIdentity {
  readonly id: string;
  readonly actionId: string;
  readonly artifactType: string;
  readonly activeRunId: string | null;
}

export type QueuedActionProjectionResolution =
  | { readonly kind: "pending" }
  | { readonly kind: "artifact"; readonly artifactId: string };

export interface ActiveGenerationProjectionIdentity {
  readonly id: string;
  readonly actionId: string;
  readonly artifactType: string;
  readonly artifactLive: boolean;
  readonly liveRunId: string | null;
}

export type ActiveGenerationRecoveryResolution =
  | { readonly kind: "pending" }
  | { readonly kind: "ambiguous"; readonly artifactIds: readonly string[] }
  | {
      readonly kind: "active";
      readonly artifactId: string;
      readonly runId: string;
    };

export type ExecutionDeepLink =
  | { readonly kind: "none" }
  | {
      readonly kind: "invalid";
      readonly invalidKeys: readonly ExecutionDeepLinkKey[];
    }
  | {
      readonly kind: "target";
      readonly actionId: string | null;
      readonly artifactId: string | null;
    };

type ExecutionSearchParams = Readonly<
  Partial<Record<ExecutionDeepLinkKey, string | readonly string[] | undefined>>
>;

function boundedUuid(
  raw: string | readonly string[] | undefined,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length > EXECUTION_DEEP_LINK_UUID_MAX_CHARS) {
    return null;
  }
  const parsed = Uuid.safeParse(raw);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

/** Parse only one bounded canonical UUID for each supported deep-link key. */
export function parseExecutionDeepLink(
  searchParams: ExecutionSearchParams,
): ExecutionDeepLink {
  const actionId = boundedUuid(searchParams.actionId);
  const artifactId = boundedUuid(searchParams.artifactId);
  const invalidKeys: ExecutionDeepLinkKey[] = [];
  if (actionId === null) invalidKeys.push("actionId");
  if (artifactId === null) invalidKeys.push("artifactId");
  if (invalidKeys.length > 0) return { kind: "invalid", invalidKeys };
  if (actionId === undefined && artifactId === undefined) return { kind: "none" };
  return {
    kind: "target",
    actionId: actionId ?? null,
    artifactId: artifactId ?? null,
  };
}

export interface ExecutionArtifactIdentity {
  readonly id: string;
  readonly actionId: string;
}

export interface ExecutionActionIdentity {
  readonly id: string;
}

export type ExecutionDeepLinkResolution =
  | { readonly kind: "default" }
  | { readonly kind: "invalid" }
  | { readonly kind: "pending"; readonly resource: "artifacts" | "actions" }
  | { readonly kind: "artifact"; readonly artifactId: string }
  | { readonly kind: "action"; readonly actionId: string }
  | {
      readonly kind: "ambiguous";
      readonly actionId: string;
      readonly artifactIds: readonly string[];
    }
  | { readonly kind: "not_found" };

/** Resolve a deep link only when the loaded cursor projections prove its identity. */
export function resolveExecutionDeepLink(
  deepLink: ExecutionDeepLink,
  artifacts: readonly ExecutionArtifactIdentity[],
  actions: readonly ExecutionActionIdentity[],
  completeness: {
    readonly artifactsComplete: boolean;
    readonly actionsComplete: boolean;
  },
): ExecutionDeepLinkResolution {
  if (deepLink.kind === "none") return { kind: "default" };
  if (deepLink.kind === "invalid") return { kind: "invalid" };

  if (deepLink.artifactId !== null) {
    const artifact = artifacts.find((item) => item.id === deepLink.artifactId);
    if (artifact !== undefined) {
      if (deepLink.actionId !== null && artifact.actionId !== deepLink.actionId) {
        return { kind: "not_found" };
      }
      return { kind: "artifact", artifactId: artifact.id };
    }
    return completeness.artifactsComplete
      ? { kind: "not_found" }
      : { kind: "pending", resource: "artifacts" };
  }

  const actionId = deepLink.actionId;
  if (actionId === null) return { kind: "invalid" };
  const matches = artifacts.filter((artifact) => artifact.actionId === actionId);
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      actionId,
      artifactIds: matches.map((artifact) => artifact.id),
    };
  }
  if (!completeness.artifactsComplete) {
    return { kind: "pending", resource: "artifacts" };
  }
  if (matches.length === 1) {
    return { kind: "artifact", artifactId: matches[0]!.id };
  }
  if (actions.some((action) => action.id === actionId)) {
    return { kind: "action", actionId };
  }
  return completeness.actionsComplete
    ? { kind: "not_found" }
    : { kind: "pending", resource: "actions" };
}

/** Preserve unrelated query state while making the selected identity canonical. */
export function executionUrlWithTarget(
  pathname: string,
  searchParams: { readonly toString: () => string },
  target: ExecutionTarget | null,
): string {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("actionId");
  next.delete("artifactId");
  if (target !== null) {
    next.set("actionId", target.actionId);
    if (target.artifactId !== null) next.set("artifactId", target.artifactId);
  }
  const query = next.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

/** Snapshot the exact accepted location, including unrelated query state. */
export function executionLocationUrl(
  pathname: string,
  searchParams: { readonly toString: () => string },
): string {
  const query = searchParams.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

/** A queued run remains action-addressable until its artifact is projected. */
export function executionTargetAfterQueue(
  actionId: string,
  artifactId: string | null,
): ExecutionTarget {
  return { actionId, artifactId };
}

/** Start a fail-closed fence for a 202 that omitted its artifact identity. */
export function queuedActionTargetAfterQueue(
  actionId: string,
  runId: string,
  artifactType: string,
): QueuedActionTarget {
  return {
    actionId,
    runId,
    artifactType,
    expectedArtifactId: null,
    phase: "running",
    refreshing: false,
    lastRefreshFailed: false,
  };
}

/** Keep every generation affordance fail-closed while a matching fence exists. */
export function queuedActionBlocksGeneration(
  queued: readonly QueuedActionTarget[],
  actionId: string,
  artifactType?: string,
): boolean {
  return queued.some(
    (candidate) =>
      candidate.actionId === actionId &&
      (artifactType === undefined || candidate.artifactType === artifactType),
  );
}

/**
 * Recover a RUN_ALREADY_ACTIVE conflict only from one non-archived projection
 * in a complete bounded cursor set that names its live run. Other action/type
 * matches are stale candidates, not evidence that the unknown winner settled.
 */
export function resolveActiveGenerationRecovery(
  actionId: string,
  artifactType: string,
  artifacts: readonly ActiveGenerationProjectionIdentity[],
  projectionComplete: boolean,
): ActiveGenerationRecoveryResolution {
  if (!projectionComplete) return { kind: "pending" };
  const activeMatches = artifacts.filter(
    (candidate) =>
      candidate.actionId === actionId &&
      candidate.artifactType === artifactType &&
      candidate.artifactLive &&
      candidate.liveRunId !== null,
  );
  if (activeMatches.length === 0) return { kind: "pending" };
  if (activeMatches.length > 1) {
    return {
      kind: "ambiguous",
      artifactIds: activeMatches.map((candidate) => candidate.id),
    };
  }
  const active = activeMatches[0]!;
  const runId = active.liveRunId;
  if (runId === null) return { kind: "pending" };
  return {
    kind: "active",
    artifactId: active.id,
    runId,
  };
}

/** A recovery may canonicalize the URL only while its action-only intent owns it. */
export function recoveryOwnsExecutionTarget(
  actionId: string,
  deepLink: ExecutionDeepLink,
): boolean {
  return (
    deepLink.kind === "target" &&
    deepLink.actionId === actionId &&
    deepLink.artifactId === null
  );
}

/** Guard every post-await recovery mutation with attempt and mounted project. */
export function recoveryAttemptCanCommit(
  expected: { readonly attemptId: number; readonly projectId: string },
  current: {
    readonly attemptId: number | undefined;
    readonly projectId: string | null;
  },
): boolean {
  return (
    current.attemptId === expected.attemptId &&
    current.projectId === expected.projectId
  );
}

/**
 * Failed/cancelled runs can be regenerated. Completed/partial runs remain
 * fenced until the canonical artifact projection proves their exact identity.
 */
export function queuedActionTargetAfterTerminal(
  queued: QueuedActionTarget | null,
  terminal: {
    readonly runId: string;
    readonly status: "completed" | "partial" | "failed" | "cancelled";
    readonly resultArtifactId: string | null;
  },
): QueuedActionTarget | null {
  if (queued === null || queued.runId !== terminal.runId) return queued;
  if (terminal.status === "failed" || terminal.status === "cancelled") {
    return null;
  }
  return {
    ...queued,
    expectedArtifactId:
      terminal.resultArtifactId ?? queued.expectedArtifactId,
    phase: "settling",
    refreshing: true,
    lastRefreshFailed: false,
  };
}

/** A refresh settling never proves identity by itself; it only ends the attempt. */
export function queuedActionTargetAfterRefresh(
  queued: QueuedActionTarget | null,
  runId: string,
  failed: boolean,
): QueuedActionTarget | null {
  if (queued === null || queued.runId !== runId) return queued;
  return {
    ...queued,
    refreshing: false,
    lastRefreshFailed: failed,
  };
}

/**
 * Accept only an exact terminal result id or an artifact projection that names
 * the same active run. A unique or recently changed artifact is not proof.
 */
export function resolveQueuedActionProjection(
  queued: QueuedActionTarget | null,
  artifacts: readonly QueuedActionProjectionIdentity[],
): QueuedActionProjectionResolution {
  if (queued === null) return { kind: "pending" };
  const artifact = artifacts.find(
    (candidate) =>
      candidate.actionId === queued.actionId &&
      candidate.artifactType === queued.artifactType &&
      ((queued.expectedArtifactId !== null &&
        candidate.id === queued.expectedArtifactId) ||
        candidate.activeRunId === queued.runId),
  );
  return artifact === undefined
    ? { kind: "pending" }
    : { kind: "artifact", artifactId: artifact.id };
}

/**
 * Growth Map execution references always identify an action. An artifact is
 * safe to target only when the projection proves there is exactly one.
 */
export function executionHrefForRef(
  projectId: string,
  executionRef: {
    readonly actionId: string;
    readonly artifactIds: readonly string[];
  },
): string {
  return executionUrlWithTarget(
    `/p/${encodeURIComponent(projectId)}/execution`,
    new URLSearchParams(),
    {
      actionId: executionRef.actionId,
      artifactId:
        executionRef.artifactIds.length === 1
          ? executionRef.artifactIds[0]!
          : null,
    },
  );
}
