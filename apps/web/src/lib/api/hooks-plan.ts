"use client";

/**
 * TanStack Query hooks for the 30/60/90 Plan screen (spec §9.3). Mirrors the
 * conventions in ./hooks.ts: TanStack Query owns server-state (never copied into
 * a hand-rolled global store, spec §3.2) and each hook unwraps the `{ data }`
 * envelope. The `Action` DTO is hand-authored and fully `readonly` — cached
 * server state is never mutated in place (repo convention: 一切不可变).
 *
 * Kept out of ./hooks.ts (and off the `@/lib/api` barrel) so the Plan feature is
 * self-contained; import from `@/lib/api/hooks-plan`.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiGet, apiSend, type ApiError } from "./client";
import type { DataEnvelope, ListEnvelope } from "./types";
import { cursorPageUrl, nextCursorPageParam } from "./cursor-pages";

export type PriorityBand = "critical" | "high" | "medium" | "low";
export type RoadmapLane = "now" | "next" | "later";
export type ActionStatus =
  | "candidate"
  | "planned"
  | "in_progress"
  | "done"
  | "blocked"
  | "dismissed";
export type ActionEffort = "small" | "medium" | "large";
export type ActionRisk = "low" | "medium" | "high";

/**
 * A deterministic 30/60/90 action (OpenAPI `Action`, spec §9). `revision` is the
 * optimistic-concurrency token carried back on every override PATCH.
 */
export interface Action {
  readonly id: string;
  readonly findingId: string;
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly contentLocale: string;
  readonly priorityBand: PriorityBand;
  readonly roadmapLane: RoadmapLane;
  readonly status: ActionStatus;
  readonly effort: ActionEffort;
  readonly risk: ActionRisk;
  readonly expectedOutcome: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Query key for a project's action list; shared by the list hook + invalidation. */
export function actionsQueryKey(projectId: string) {
  return ["actions", projectId] as const;
}

/** List a project's 30/60/90 actions as bounded cursor pages. */
export function useProjectActions(
  projectId: string,
): UseInfiniteQueryResult<
  InfiniteData<ListEnvelope<Action>, string | null>,
  ApiError
> {
  return useInfiniteQuery({
    queryKey: actionsQueryKey(projectId),
    queryFn: ({ pageParam }) =>
      apiGet<ListEnvelope<Action>>(
        cursorPageUrl(`/projects/${projectId}/actions`, pageParam),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursorPageParam,
    enabled: projectId.length > 0,
  });
}

/**
 * Body of a manual override PATCH. A `reason` is ALWAYS required (spec §9.3);
 * at least one of `status` / `priorityBand` / `roadmapLane` must be present.
 */
export interface UpdateActionInput {
  readonly baseRevision: number;
  readonly reason: string;
  readonly status?: ActionStatus;
  readonly priorityBand?: PriorityBand;
  readonly roadmapLane?: RoadmapLane;
  readonly note?: string;
}

/** Variables for {@link useUpdateAction}: which action, and the override body. */
export interface UpdateActionVariables {
  readonly actionId: string;
  readonly body: UpdateActionInput;
}

/**
 * Apply a manual status/priority/lane override to one action. `baseRevision`
 * guards concurrency: a 409 surfaces as an `ApiError` with `code`
 * `"VERSION_CONFLICT"` that the caller handles by refetching + informing. On
 * success the action list is invalidated so the card moves to its new lane.
 */
export function useUpdateAction(
  projectId: string,
): UseMutationResult<Action, ApiError, UpdateActionVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, body }: UpdateActionVariables) => {
      const res = await apiSend<DataEnvelope<Action>>(
        "PATCH",
        `/projects/${projectId}/actions/${actionId}`,
        { body },
      );
      return res.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: actionsQueryKey(projectId) }),
  });
}
