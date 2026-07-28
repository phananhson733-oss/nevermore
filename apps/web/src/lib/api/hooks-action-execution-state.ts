"use client";

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  ActionExecutionStateBatch as ActionExecutionStateBatchSchema,
  MAX_ACTION_EXECUTION_STATE_BATCH_SIZE,
  type ActionExecutionStateBatch,
  type ActionExecutionStateBatchItem,
  type ActionExecutionStateTimeline,
  type RecordActionExecutionStateResult,
  type UpdateActionExecutionStateRequest,
} from "@sf/contracts";

import { ApiError, apiGet, apiSend } from "./client";
import type { DataEnvelope } from "./types";

export const MAX_ARTIFACT_EXECUTION_STATE_BATCH_SIZE =
  MAX_ACTION_EXECUTION_STATE_BATCH_SIZE;

function canonicalArtifactIds(
  artifactIds: readonly string[],
): string[] {
  return [...new Set(artifactIds)].sort();
}

function artifactIdChunks(
  artifactIds: readonly string[],
): string[][] {
  const canonical = canonicalArtifactIds(artifactIds);
  const chunks: string[][] = [];
  for (
    let offset = 0;
    offset < canonical.length;
    offset += MAX_ARTIFACT_EXECUTION_STATE_BATCH_SIZE
  ) {
    chunks.push(
      canonical.slice(
        offset,
        offset + MAX_ARTIFACT_EXECUTION_STATE_BATCH_SIZE,
      ),
    );
  }
  return chunks;
}

export function artifactExecutionStateBatchUrl(
  projectId: string,
  artifactIds: readonly string[],
): string {
  const query = new URLSearchParams();
  for (const artifactId of canonicalArtifactIds(artifactIds)) {
    query.append("artifactId", artifactId);
  }
  const serialized = query.toString();
  return `/projects/${projectId}/artifacts/execution-states${
    serialized.length === 0 ? "" : `?${serialized}`
  }`;
}

export function artifactExecutionStateBatchQueryKey(
  projectId: string,
  artifactIds: readonly string[],
) {
  return [
    "artifact-execution-state-batch",
    projectId,
    canonicalArtifactIds(artifactIds),
  ] as const;
}

function artifactExecutionBatchUnavailable(): ApiError {
  return new ApiError({
    type: "about:blank",
    title: "Execution state unavailable",
    status: 503,
    code: "DEPENDENCY_UNAVAILABLE",
    detail: "Artifact execution batch failed integrity checks.",
    requestId: "",
  });
}

function sameCanonicalIds(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((artifactId, index) => artifactId === actual[index])
  );
}

/**
 * Validate one untrusted batch response against the exact IDs requested.
 *
 * The schema alone cannot know which Artifact streams the caller asked for.
 * Checking that scope here prevents a malformed successful response from
 * silently hiding one queue card or substituting another project's data.
 */
export function parseArtifactExecutionStateBatch(
  projectId: string,
  requestedArtifactIds: readonly string[],
  value: unknown,
): ActionExecutionStateBatch {
  const parsed = ActionExecutionStateBatchSchema.safeParse(value);
  if (!parsed.success || parsed.data.projectId !== projectId) {
    throw artifactExecutionBatchUnavailable();
  }

  const expected = canonicalArtifactIds(requestedArtifactIds);
  const actual = parsed.data.items
    .map((item) => item.artifactId)
    .sort();
  if (!sameCanonicalIds(expected, actual)) {
    throw artifactExecutionBatchUnavailable();
  }
  return parsed.data;
}

export async function getArtifactExecutionStateBatch(
  projectId: string,
  artifactIds: readonly string[],
): Promise<ActionExecutionStateBatch> {
  const response = await apiGet<DataEnvelope<unknown>>(
    artifactExecutionStateBatchUrl(projectId, artifactIds),
  );
  return parseArtifactExecutionStateBatch(
    projectId,
    artifactIds,
    response.data,
  );
}

export function buildArtifactExecutionStateBatchQueryOptions(
  projectId: string,
  artifactIds: readonly string[],
): UseQueryOptions<ActionExecutionStateBatch, ApiError> {
  const canonical = canonicalArtifactIds(artifactIds);
  if (canonical.length > MAX_ARTIFACT_EXECUTION_STATE_BATCH_SIZE) {
    throw new RangeError("Artifact execution batch exceeds client limit");
  }
  return {
    queryKey: artifactExecutionStateBatchQueryKey(projectId, canonical),
    queryFn: () => getArtifactExecutionStateBatch(projectId, canonical),
    enabled: projectId.length > 0 && canonical.length > 0,
  };
}

export interface ArtifactExecutionStateBatchesResult {
  /**
   * Undefined while any batch is missing or failed. Partial execution truth is
   * never rendered alongside stale/unknown cards.
   */
  readonly items: readonly ActionExecutionStateBatchItem[] | undefined;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: ApiError | null;
  readonly refetch: () => Promise<unknown>;
}

export interface ArtifactExecutionStateBatchResultSnapshot {
  readonly data: ActionExecutionStateBatch | undefined;
  readonly error: ApiError | null;
}

/**
 * Combine only fully validated chunks. One missing, substituted or duplicated
 * stream invalidates the complete queue snapshot instead of yielding a partial
 * mixture of known and unknown execution truth.
 */
export function combineArtifactExecutionStateBatchResults(
  projectId: string,
  chunks: readonly (readonly string[])[],
  results: readonly ArtifactExecutionStateBatchResultSnapshot[],
): Pick<ArtifactExecutionStateBatchesResult, "items" | "error"> {
  if (results.length !== chunks.length) {
    return {
      items: undefined,
      error: artifactExecutionBatchUnavailable(),
    };
  }

  const requestError =
    results.find((result) => result.error !== null)?.error ?? null;
  if (requestError !== null) {
    return { items: undefined, error: requestError };
  }
  if (results.some((result) => result.data === undefined)) {
    return { items: undefined, error: null };
  }

  try {
    const items = results.flatMap((result, index) => {
      const data = result.data;
      if (data === undefined) throw artifactExecutionBatchUnavailable();
      return parseArtifactExecutionStateBatch(
        projectId,
        chunks[index] ?? [],
        data,
      ).items;
    });
    const expected = chunks.flatMap((chunk) => [...chunk]).sort();
    const actual = items.map((item) => item.artifactId).sort();
    const canonicalExpected = canonicalArtifactIds(expected);
    if (
      canonicalExpected.length !== expected.length ||
      !sameCanonicalIds(expected, actual)
    ) {
      throw artifactExecutionBatchUnavailable();
    }
    return { items, error: null };
  } catch (error) {
    return {
      items: undefined,
      error:
        error instanceof ApiError
          ? error
          : artifactExecutionBatchUnavailable(),
    };
  }
}

export function useArtifactExecutionStateBatches(
  projectId: string,
  artifactIds: readonly string[],
): ArtifactExecutionStateBatchesResult {
  const chunks = artifactIdChunks(artifactIds);
  return useQueries({
    queries: chunks.map((chunk) =>
      buildArtifactExecutionStateBatchQueryOptions(projectId, chunk),
    ),
    combine: (results): ArtifactExecutionStateBatchesResult => {
      const combined = combineArtifactExecutionStateBatchResults(
        projectId,
        chunks,
        results,
      );
      return {
        items: chunks.length === 0 ? [] : combined.items,
        isPending: results.some((result) => result.isPending),
        isFetching: results.some((result) => result.isFetching),
        isError: combined.error !== null,
        error: combined.error,
        refetch: () =>
          Promise.all(results.map((result) => result.refetch())),
      };
    },
  });
}

export function actionExecutionStateUrl(
  projectId: string,
  actionId: string,
  artifactId: string | null,
): string {
  const base = `/projects/${projectId}/actions/${actionId}/execution-state`;
  return artifactId === null
    ? base
    : `${base}?artifactId=${encodeURIComponent(artifactId)}`;
}

export function actionExecutionStateQueryKey(
  projectId: string,
  actionId: string | null,
  artifactId: string | null,
) {
  return [
    "action-execution-state",
    projectId,
    actionId,
    artifactId,
  ] as const;
}

export async function getActionExecutionState(
  projectId: string,
  actionId: string,
  artifactId: string | null,
): Promise<ActionExecutionStateTimeline> {
  const response = await apiGet<DataEnvelope<ActionExecutionStateTimeline>>(
    actionExecutionStateUrl(projectId, actionId, artifactId),
  );
  return response.data;
}

export async function postActionExecutionState(
  projectId: string,
  actionId: string,
  artifactId: string | null,
  idempotencyKey: string,
  body: UpdateActionExecutionStateRequest,
): Promise<RecordActionExecutionStateResult> {
  const response = await apiSend<
    DataEnvelope<RecordActionExecutionStateResult>
  >(
    "POST",
    actionExecutionStateUrl(projectId, actionId, artifactId),
    {
      body,
      idempotencyKey,
    },
  );
  return response.data;
}

export function buildActionExecutionStateQueryOptions(
  projectId: string,
  actionId: string | null,
  artifactId: string | null,
): UseQueryOptions<ActionExecutionStateTimeline, ApiError> {
  return {
    queryKey: actionExecutionStateQueryKey(
      projectId,
      actionId,
      artifactId,
    ),
    queryFn: () =>
      getActionExecutionState(projectId, actionId ?? "", artifactId),
    enabled: projectId.length > 0 && Boolean(actionId),
  };
}

export function useActionExecutionState(
  projectId: string,
  actionId: string | null,
  artifactId: string | null,
): UseQueryResult<ActionExecutionStateTimeline, ApiError> {
  return useQuery(
    buildActionExecutionStateQueryOptions(projectId, actionId, artifactId),
  );
}

export interface UpdateActionExecutionStateVariables {
  readonly actionId: string;
  readonly artifactId: string | null;
  readonly idempotencyKey: string;
  readonly body: UpdateActionExecutionStateRequest;
}

export function useUpdateActionExecutionState(
  projectId: string,
): UseMutationResult<
  RecordActionExecutionStateResult,
  ApiError,
  UpdateActionExecutionStateVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      actionId,
      artifactId,
      idempotencyKey,
      body,
    }) =>
      postActionExecutionState(
        projectId,
        actionId,
        artifactId,
        idempotencyKey,
        body,
      ),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: actionExecutionStateQueryKey(
            projectId,
            variables.actionId,
            variables.artifactId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: ["artifact-execution-state-batch", projectId],
        }),
      ]);
    },
  });
}
