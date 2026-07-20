export type ArtifactStatus =
  | "generating"
  | "draft"
  | "ready"
  | "failed"
  | "archived";

export type ManualArtifactStatus = "draft" | "ready" | "archived";

const CONTENT_EDITABLE_STATUSES = new Set<ArtifactStatus>(["draft", "ready"]);

const MANUAL_STATUS_TRANSITIONS: Readonly<
  Record<ArtifactStatus, readonly ManualArtifactStatus[]>
> = {
  generating: [],
  draft: ["ready", "archived"],
  ready: ["archived"],
  failed: [],
  archived: [],
};

/** Manual revisions are legal only for operator-owned draft/ready artifacts. */
export function isArtifactContentEditAllowed(status: string): boolean {
  return CONTENT_EDITABLE_STATUSES.has(status as ArtifactStatus);
}

/**
 * Frozen manual edges from implementation spec v0.2 §5.2. Idempotent
 * same-status requests are handled by the service before this function.
 */
export function isManualArtifactStatusTransitionAllowed(
  current: string,
  requested: ManualArtifactStatus,
): boolean {
  if (!Object.hasOwn(MANUAL_STATUS_TRANSITIONS, current)) return false;
  return MANUAL_STATUS_TRANSITIONS[current as ArtifactStatus].includes(
    requested,
  );
}
