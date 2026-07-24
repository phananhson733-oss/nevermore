"use client";

/**
 * Growth Opportunity TanStack Query v5 hooks (Slice 1). These read the
 * traceable Opportunity projection and reuse the existing Finding review
 * mutation to confirm: confirmation always flows through
 * `PATCH .../findings/{primaryFindingId}`, never a new confirm endpoint. On a
 * successful confirm both the opportunities and findings caches invalidate.
 */

import {
  GrowthOpportunity,
  type GrowthOpportunity as GrowthOpportunityDto,
} from "@sf/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { apiGet, apiSend, type ApiError } from "./client";
import type { ReviewFindingResult } from "./hooks-diagnosis";
import type { DataEnvelope } from "./types";

export const DEFAULT_OPPORTUNITY_LIMIT = 50;
export const MAX_OPPORTUNITY_LIMIT = 100;

export interface OpportunitiesQuery {
  readonly cursor?: string | null;
  readonly limit?: number;
}

interface NormalizedOpportunitiesQuery {
  readonly cursor: string | null;
  readonly limit: number;
}

export interface OpportunityListResponse {
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly data: readonly GrowthOpportunityDto[];
  readonly meta: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasNext: boolean;
  };
}

export interface OpportunityDetailResponse {
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly data: GrowthOpportunityDto;
}

export interface ConfirmOpportunityVars {
  readonly primaryFindingId: string;
  readonly baseRevision: number;
  readonly note?: string;
}

function normalizeOpportunitiesQuery(
  query: OpportunitiesQuery = {},
): NormalizedOpportunitiesQuery {
  const cursor =
    query.cursor === "" || query.cursor == null ? null : query.cursor;
  const limit = query.limit ?? DEFAULT_OPPORTUNITY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OPPORTUNITY_LIMIT) {
    throw new RangeError(
      `Opportunity limit must be an integer from 1 to ${MAX_OPPORTUNITY_LIMIT}.`,
    );
  }
  return { cursor, limit };
}

export function opportunitiesQueryKey(
  projectId: string,
  uiLocale: string,
  query: OpportunitiesQuery = {},
) {
  return [
    "opportunities",
    projectId,
    uiLocale,
    "list",
    normalizeOpportunitiesQuery(query),
  ] as const;
}

export function opportunityDetailQueryKey(
  projectId: string,
  uiLocale: string,
  opportunityId: string | null | undefined,
) {
  return [
    "opportunities",
    projectId,
    uiLocale,
    "detail",
    opportunityId || null,
  ] as const;
}

function opportunitiesPath(
  projectId: string,
  query: NormalizedOpportunitiesQuery,
): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  return `/projects/${projectId}/opportunities?${params.toString()}`;
}

function isEnvelope(value: unknown): value is {
  projectId: string;
  siteId: string;
  diagnosticRunId: string;
  meta?: unknown;
  data: unknown;
} {
  return typeof value === "object" && value !== null && "data" in value;
}

/** Re-validate every Opportunity item against the contract before use. */
export async function getProjectOpportunities(
  projectId: string,
  query: OpportunitiesQuery = {},
): Promise<OpportunityListResponse> {
  const normalized = normalizeOpportunitiesQuery(query);
  const response = await apiGet<DataEnvelope<unknown>>(
    opportunitiesPath(projectId, normalized),
  );
  const body = response.data;
  if (!isEnvelope(body) || !Array.isArray(body.data)) {
    throw new Error("Malformed opportunities list response.");
  }
  const data = body.data.map((item) => GrowthOpportunity.parse(item));
  return {
    projectId: body.projectId,
    siteId: body.siteId,
    diagnosticRunId: body.diagnosticRunId,
    data,
    meta: body.meta as OpportunityListResponse["meta"],
  };
}

/** Re-validate the selected Opportunity against the contract before use. */
export async function getProjectOpportunityDetail(
  projectId: string,
  opportunityId: string | null | undefined,
): Promise<OpportunityDetailResponse> {
  if (!opportunityId) {
    throw new Error("An opportunityId is required to fetch Opportunity detail.");
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/opportunities/${encodeURIComponent(opportunityId)}`,
  );
  const body = response.data;
  if (!isEnvelope(body)) {
    throw new Error("Malformed opportunity detail response.");
  }
  return {
    projectId: body.projectId,
    siteId: body.siteId,
    diagnosticRunId: body.diagnosticRunId,
    data: GrowthOpportunity.parse(body.data),
  };
}

export function buildOpportunitiesQueryOptions(
  projectId: string,
  uiLocale: string,
  query: OpportunitiesQuery = {},
): UseQueryOptions<OpportunityListResponse, ApiError> {
  const normalized = normalizeOpportunitiesQuery(query);
  return {
    queryKey: opportunitiesQueryKey(projectId, uiLocale, normalized),
    queryFn: () => getProjectOpportunities(projectId, normalized),
    enabled: projectId.length > 0,
  };
}

export function buildOpportunityDetailQueryOptions(
  projectId: string,
  uiLocale: string,
  opportunityId: string | null | undefined,
): UseQueryOptions<OpportunityDetailResponse, ApiError> {
  return {
    queryKey: opportunityDetailQueryKey(projectId, uiLocale, opportunityId),
    queryFn: () => getProjectOpportunityDetail(projectId, opportunityId),
    enabled: projectId.length > 0 && Boolean(opportunityId),
  };
}

export function useProjectOpportunities(
  projectId: string,
  query: OpportunitiesQuery = {},
): UseQueryResult<OpportunityListResponse, ApiError> {
  const uiLocale = useLocale();
  return useQuery(buildOpportunitiesQueryOptions(projectId, uiLocale, query));
}

export function useProjectOpportunity(
  projectId: string,
  opportunityId: string | null | undefined,
): UseQueryResult<OpportunityDetailResponse, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildOpportunityDetailQueryOptions(projectId, uiLocale, opportunityId),
  );
}

/**
 * Confirm an Opportunity through the canonical Finding review mutation. This
 * targets the exact same `PATCH .../findings/{primaryFindingId}` endpoint as
 * {@link useReviewFinding}; on success both the opportunities and findings
 * caches invalidate so the newly confirmed Action projects everywhere.
 */
export function useConfirmOpportunity(
  projectId: string,
): UseMutationResult<ReviewFindingResult, ApiError, ConfirmOpportunityVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      primaryFindingId,
      baseRevision,
      note,
    }: ConfirmOpportunityVars) => {
      const res = await apiSend<DataEnvelope<ReviewFindingResult>>(
        "PATCH",
        `/projects/${projectId}/findings/${primaryFindingId}`,
        { body: { reviewState: "confirmed", baseRevision, note } },
      );
      return res.data;
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["opportunities", projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["findings", projectId] }),
      ]),
  });
}
