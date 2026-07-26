import type { ActionStatus } from "@/lib/api/hooks-plan";

/** Frozen MVP status graph from implementation spec v0.2 §5.2. */
const ACTION_STATUS_TARGETS = {
  candidate: ["planned", "dismissed"],
  planned: ["in_progress", "blocked", "dismissed"],
  in_progress: ["done"],
  blocked: ["in_progress"],
  done: ["planned"],
  dismissed: ["planned"],
} as const satisfies Readonly<
  Record<ActionStatus, readonly ActionStatus[]>
>;

/** Legal next statuses shown by the Plan override control. */
export function allowedActionStatusTargets(
  current: ActionStatus,
): readonly ActionStatus[] {
  return ACTION_STATUS_TARGETS[current];
}
