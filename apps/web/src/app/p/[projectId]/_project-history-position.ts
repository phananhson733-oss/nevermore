const PROJECT_HISTORY_POSITION = "__sfProjectHistoryPosition";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the monotonic position attached to an in-app project history entry. */
export function projectHistoryPosition(state: unknown): number | null {
  if (!isRecord(state)) return null;
  const value = state[PROJECT_HISTORY_POSITION];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

/** Preserve Next's opaque history fields while adding our traversal position. */
export function withProjectHistoryPosition(
  state: unknown,
  position: number,
): Record<string, unknown> {
  return {
    ...(isRecord(state) ? state : {}),
    [PROJECT_HISTORY_POSITION]: position,
  };
}

/**
 * Return the signed traversal delta. The Navigation API index is a fallback
 * for entries created before the persistent project shell stamped them.
 */
export function projectHistoryTraversalDelta(
  guardedPosition: number | null,
  destinationState: unknown,
  guardedNavigationIndex: number | null,
  destinationNavigationIndex: number | null,
): number | null {
  const destinationPosition = projectHistoryPosition(destinationState);
  if (guardedPosition !== null && destinationPosition !== null) {
    return destinationPosition - guardedPosition;
  }
  if (
    guardedNavigationIndex !== null &&
    destinationNavigationIndex !== null
  ) {
    return destinationNavigationIndex - guardedNavigationIndex;
  }
  return null;
}
