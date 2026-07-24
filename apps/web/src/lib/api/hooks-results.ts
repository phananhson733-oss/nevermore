"use client";

/**
 * Recheck Results TanStack Query v5 hooks (Slice 1, Task 8). A recheck queues a
 * fresh immutable audit run for one confirmed Action; the Results query then
 * compares the prior and current run strictly on the technical rule condition.
 * The read surface never claims traffic, rank, revenue, or AI-citation movement.
 */

import {
  ActionRecheckResultsResponse,
  type ActionRecheckResultsResponse as ActionRecheckResultsResponseDto,
  type CreateActionRecheckRequest,
} from "@sf/contracts";
import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { apiGet, apiSend, type ApiError } from "./client";
import type { DataEnvelope } from "./types";
import type { AsyncRun, RunResourceRef } from "./hooks-diagnosis";

export interface ActionRecheckAccepted {
  readonly run: AsyncRun;
  readonly statusUrl: string;
  readonly resourceRef: RunResourceRef | null;
}

/**
 * Queue a recheck for one confirmed Action. Generates a fresh `Idempotency-Key`
 * per attempt and returns the 202 accepted body.
 */
export function useCreateActionRecheck(
  projectId: string,
): UseMutationResult<ActionRecheckAccepted, ApiError, CreateActionRecheckRequest> {
  return useMutation({
    mutationFn: async (body: CreateActionRecheckRequest) => {
      const res = await apiSend<DataEnvelope<ActionRecheckAccepted>>(
        "POST",
        `/projects/${projectId}/actions/${body.actionId}/recheck`,
        { body, idempotencyKey: crypto.randomUUID() },
      );
      return res.data;
    },
  });
}

/* --------------------------------------------------- read projection (Slice 1) */

export function projectResultsQueryKey(projectId: string, uiLocale: string) {
  return ["recheck-results", projectId, uiLocale] as const;
}

/** Fetch and re-validate the recheck Results comparison contract. */
export async function getProjectResults(
  projectId: string,
): Promise<ActionRecheckResultsResponseDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/results`,
  );
  return ActionRecheckResultsResponse.parse(response.data);
}

export function buildProjectResultsQueryOptions(
  projectId: string,
  uiLocale: string,
): UseQueryOptions<ActionRecheckResultsResponseDto, ApiError> {
  return {
    queryKey: projectResultsQueryKey(projectId, uiLocale),
    queryFn: () => getProjectResults(projectId),
    enabled: projectId.length > 0,
  };
}

export function useProjectResults(
  projectId: string,
): UseQueryResult<ActionRecheckResultsResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(buildProjectResultsQueryOptions(projectId, uiLocale));
}
