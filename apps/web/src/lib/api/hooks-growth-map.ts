"use client";

import {
  BeginTopicModelDraftRequest as BeginTopicModelDraftRequestSchema,
  CompetitorMonitorConfig as CompetitorMonitorConfigSchema,
  CompetitorMonitorResponse as CompetitorMonitorResponseSchema,
  ConfirmTopicModelRequest as ConfirmTopicModelRequestSchema,
  DecideKeywordRelationRequest as DecideKeywordRelationRequestSchema,
  GrowthMapCompetitorDetailResponse,
  GrowthMapCompetitorLibraryResponse,
  GrowthMapInternalLinkMap as GrowthMapInternalLinkMapSchema,
  GrowthMapKeywordDetailResponse,
  GrowthMapTopicModelInsights as GrowthMapTopicModelInsightsSchema,
  KeywordRelationDecisionResult,
  KeywordRelationListResponse,
  KeywordRelationRefreshResponse,
  PatchTopicModelDraftRequest as PatchTopicModelDraftRequestSchema,
  ReviewKeywordRequest as ReviewKeywordRequestSchema,
  TopicModelWorkspaceProjection as TopicModelWorkspaceProjectionSchema,
  UpdateCompetitorMonitorRequest as UpdateCompetitorMonitorRequestSchema,
  GrowthMapKeywordRankHistory,
  GrowthMapKeywordLibraryResponse,
  GrowthMapUrlDetailResponse,
  GrowthMapUrlPortfolioResponse,
  ReviewCompetitorRequest as ReviewCompetitorRequestSchema,
  type BeginTopicModelDraftRequest,
  type CompetitorMonitorConfig as CompetitorMonitorConfigDto,
  type CompetitorMonitorResponse as CompetitorMonitorResponseDto,
  type ConfirmTopicModelRequest,
  type GrowthMapCompetitorDetailResponse as GrowthMapCompetitorDetailResponseDto,
  type GrowthMapCompetitorLibraryResponse as GrowthMapCompetitorLibraryResponseDto,
  type GrowthMapInternalLinkMap as GrowthMapInternalLinkMapDto,
  type GrowthMapKeywordDetailResponse as GrowthMapKeywordDetailResponseDto,
  type GrowthMapTopicModelInsights as GrowthMapTopicModelInsightsDto,
  type DecideKeywordRelationRequest,
  type KeywordRelationDecisionResult as KeywordRelationDecisionResultDto,
  type KeywordRelationListResponse as KeywordRelationListResponseDto,
  type KeywordRelationRefreshResponse as KeywordRelationRefreshResponseDto,
  type PatchTopicModelDraftRequest,
  type ReviewKeywordRequest,
  type TopicModelWorkspaceProjection as TopicModelWorkspaceProjectionDto,
  type UpdateCompetitorMonitorRequest,
  type GrowthMapKeywordRankHistory as GrowthMapKeywordRankHistoryDto,
  type GrowthMapKeywordLibraryResponse as GrowthMapKeywordLibraryResponseDto,
  type GrowthMapKeywordSourceKind as GrowthMapKeywordSourceKindDto,
  type GrowthMapUrlDetailResponse as GrowthMapUrlDetailResponseDto,
  type GrowthMapUrlPortfolioResponse as GrowthMapUrlPortfolioResponseDto,
  type ReviewCompetitorRequest,
} from "@sf/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { apiGet, apiSend, type ApiError } from "./client";
import type { DataEnvelope } from "./types";

export const DEFAULT_GROWTH_MAP_URL_LIMIT = 50;
export const DEFAULT_GROWTH_MAP_KEYWORD_LIMIT = 50;
export const DEFAULT_GROWTH_MAP_KEYWORD_RELATION_LIMIT = 100;
export const DEFAULT_GROWTH_MAP_COMPETITOR_LIMIT = 50;
export const MAX_GROWTH_MAP_SEARCH_LENGTH = 256;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface GrowthMapUrlsQuery {
  readonly search?: string | null;
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly diagnosticRunId?: string | null;
}

interface NormalizedGrowthMapUrlsQuery {
  readonly search: string | null;
  readonly cursor: string | null;
  readonly limit: number;
  readonly diagnosticRunId: string | null;
}

export interface GrowthMapKeywordsQuery {
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly diagnosticRunId?: string | null;
  readonly sourceKind?: GrowthMapKeywordSourceKindDto | null;
}

export interface GrowthMapKeywordRelationsQuery {
  readonly keywordIds: readonly string[];
  readonly cursor?: string | null;
  readonly limit?: number;
}

interface NormalizedGrowthMapKeywordsQuery {
  readonly cursor: string | null;
  readonly limit: number;
  readonly diagnosticRunId: string | null;
  readonly sourceKind: GrowthMapKeywordSourceKindDto | null;
}

interface NormalizedGrowthMapKeywordRelationsQuery {
  readonly keywordIds: readonly string[];
  readonly cursor: string | null;
  readonly limit: number;
}

export interface DecideGrowthMapKeywordRelationVars {
  readonly relationId: string;
  readonly body: DecideKeywordRelationRequest;
}

export interface GrowthMapCompetitorsQuery {
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly diagnosticRunId?: string | null;
}

interface NormalizedGrowthMapCompetitorsQuery {
  readonly cursor: string | null;
  readonly limit: number;
  readonly diagnosticRunId: string | null;
}

function normalizeGrowthMapDiagnosticRunId(
  value: string | null | undefined,
): string | null {
  const diagnosticRunId = value === "" || value == null ? null : value;
  if (
    diagnosticRunId !== null &&
    (!CANONICAL_UUID.test(diagnosticRunId) ||
      diagnosticRunId !== diagnosticRunId.trim())
  ) {
    throw new RangeError(
      "Growth Map diagnosticRunId must be a canonical lowercase UUID.",
    );
  }
  return diagnosticRunId;
}

function normalizeGrowthMapUrlsQuery(
  query: GrowthMapUrlsQuery = {},
): NormalizedGrowthMapUrlsQuery {
  const search = query.search?.trim() || null;
  const cursor = query.cursor === "" || query.cursor == null ? null : query.cursor;
  const limit = query.limit ?? DEFAULT_GROWTH_MAP_URL_LIMIT;
  const diagnosticRunId = normalizeGrowthMapDiagnosticRunId(
    query.diagnosticRunId,
  );

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Growth Map URL limit must be an integer from 1 to 100.");
  }
  if (search !== null && search.length > MAX_GROWTH_MAP_SEARCH_LENGTH) {
    throw new RangeError(
      `Growth Map URL search must be at most ${MAX_GROWTH_MAP_SEARCH_LENGTH} characters.`,
    );
  }

  return { search, cursor, limit, diagnosticRunId };
}

function normalizeGrowthMapKeywordsQuery(
  query: GrowthMapKeywordsQuery = {},
): NormalizedGrowthMapKeywordsQuery {
  const cursor = query.cursor === "" || query.cursor == null ? null : query.cursor;
  const limit = query.limit ?? DEFAULT_GROWTH_MAP_KEYWORD_LIMIT;
  const diagnosticRunId = normalizeGrowthMapDiagnosticRunId(
    query.diagnosticRunId,
  );
  const sourceKind = query.sourceKind ?? null;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(
      "Growth Map Keyword limit must be an integer from 1 to 100.",
    );
  }
  return { cursor, limit, diagnosticRunId, sourceKind };
}

function normalizeGrowthMapKeywordRelationsQuery(
  query: GrowthMapKeywordRelationsQuery,
): NormalizedGrowthMapKeywordRelationsQuery {
  const keywordIds = [...query.keywordIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const cursor =
    query.cursor === "" || query.cursor == null ? null : query.cursor;
  const limit =
    query.limit ?? DEFAULT_GROWTH_MAP_KEYWORD_RELATION_LIMIT;
  if (
    keywordIds.length > 50 ||
    new Set(keywordIds).size !== keywordIds.length ||
    keywordIds.some((keywordId) => keywordId.length === 0)
  ) {
    throw new RangeError(
      "Growth Map Keyword Relation lookup requires at most 50 unique Keyword IDs.",
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(
      "Growth Map Keyword Relation limit must be an integer from 1 to 100.",
    );
  }
  return { keywordIds, cursor, limit };
}

function normalizeGrowthMapCompetitorsQuery(
  query: GrowthMapCompetitorsQuery = {},
): NormalizedGrowthMapCompetitorsQuery {
  const cursor = query.cursor === "" || query.cursor == null ? null : query.cursor;
  const limit = query.limit ?? DEFAULT_GROWTH_MAP_COMPETITOR_LIMIT;
  const diagnosticRunId = normalizeGrowthMapDiagnosticRunId(
    query.diagnosticRunId,
  );

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(
      "Growth Map Competitor limit must be an integer from 1 to 100.",
    );
  }

  return { cursor, limit, diagnosticRunId };
}

export function growthMapUrlsQueryKey(
  projectId: string,
  uiLocale: string,
  query: GrowthMapUrlsQuery = {},
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "urls",
    normalizeGrowthMapUrlsQuery(query),
  ] as const;
}

export function growthMapUrlDetailQueryKey(
  projectId: string,
  uiLocale: string,
  sitePageId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "url",
    sitePageId || null,
    diagnosticRunId || null,
  ] as const;
}

export function growthMapInternalLinkMapQueryKey(
  projectId: string,
  uiLocale: string,
  sitePageId: string | null | undefined,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "internal-link-map",
    sitePageId || null,
  ] as const;
}

export function growthMapKeywordsQueryKey(
  projectId: string,
  uiLocale: string,
  query: GrowthMapKeywordsQuery = {},
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "keywords",
    normalizeGrowthMapKeywordsQuery(query),
  ] as const;
}

export function growthMapKeywordDetailQueryKey(
  projectId: string,
  uiLocale: string,
  keywordId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "keyword",
    keywordId || null,
    diagnosticRunId || null,
  ] as const;
}

export function growthMapKeywordReviewDetailQueryKey(
  projectId: string,
  uiLocale: string,
  keywordId: string | null | undefined,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "keyword-review",
    keywordId || null,
  ] as const;
}

export function growthMapKeywordRankHistoryQueryKey(
  projectId: string,
  uiLocale: string,
  keywordId: string | null | undefined,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "keyword",
    keywordId || null,
    "rank-history",
  ] as const;
}

export function growthMapKeywordRelationsQueryKey(
  projectId: string,
  uiLocale: string,
  query: GrowthMapKeywordRelationsQuery,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "keyword-relations",
    normalizeGrowthMapKeywordRelationsQuery(query),
  ] as const;
}

export function growthMapCompetitorsQueryKey(
  projectId: string,
  uiLocale: string,
  query: GrowthMapCompetitorsQuery = {},
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "competitors",
    normalizeGrowthMapCompetitorsQuery(query),
  ] as const;
}

export function growthMapCompetitorDetailQueryKey(
  projectId: string,
  uiLocale: string,
  competitorId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "competitor",
    competitorId || null,
    diagnosticRunId || null,
  ] as const;
}

export function growthMapCompetitorReviewDetailQueryKey(
  projectId: string,
  uiLocale: string,
  competitorId: string | null | undefined,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "competitor-review",
    competitorId || null,
  ] as const;
}

export function growthMapCompetitorMonitorQueryKey(
  projectId: string,
  uiLocale: string,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "competitor-monitor",
  ] as const;
}

export function growthMapTopicModelWorkspaceQueryKey(
  projectId: string,
  uiLocale: string,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "topic-model",
    "workspace",
  ] as const;
}

export function growthMapTopicModelInsightsQueryKey(
  projectId: string,
  uiLocale: string,
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "topic-model",
    "insights",
  ] as const;
}

/**
 * A Finding review changes the portfolio review count/priority, the selected
 * URL's canonical Finding projection, and persisted Finding/Action references
 * exposed by that URL's Internal Link Map. Refresh those three exact reads;
 * other SitePage details remain untouched.
 */
export async function refreshGrowthMapAfterFindingReview(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
  sitePageId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["growth-map", projectId, uiLocale, "urls"],
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      // Match every cached generation for this URL. The customer-facing
      // detail is pinned to a Diagnostic run, while the review mutation is
      // live governance; invalidating the unpinned key alone would miss the
      // active pinned query.
      queryKey: ["growth-map", projectId, uiLocale, "url", sitePageId],
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: growthMapInternalLinkMapQueryKey(
        projectId,
        uiLocale,
        sitePageId,
      ),
      refetchType: "active",
    }),
  ]);
}

function growthMapUrlsPath(
  projectId: string,
  query: NormalizedGrowthMapUrlsQuery,
): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  if (query.search !== null) params.set("search", query.search);
  if (query.diagnosticRunId !== null) {
    params.set("diagnosticRunId", query.diagnosticRunId);
  }
  return `/projects/${projectId}/audit/urls?${params.toString()}`;
}

function growthMapKeywordsPath(
  projectId: string,
  query: NormalizedGrowthMapKeywordsQuery,
): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  if (query.diagnosticRunId !== null) {
    params.set("diagnosticRunId", query.diagnosticRunId);
  }
  if (query.sourceKind !== null) params.set("sourceKind", query.sourceKind);
  return `/projects/${projectId}/audit/keywords?${params.toString()}`;
}

function growthMapKeywordRelationsPath(
  projectId: string,
  query: NormalizedGrowthMapKeywordRelationsQuery,
): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  for (const keywordId of query.keywordIds) {
    params.append("keywordId", keywordId);
  }
  return `/projects/${projectId}/audit/keyword-relations?${params.toString()}`;
}

function growthMapCompetitorsPath(
  projectId: string,
  query: NormalizedGrowthMapCompetitorsQuery,
): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  if (query.diagnosticRunId !== null) {
    params.set("diagnosticRunId", query.diagnosticRunId);
  }
  return `/projects/${projectId}/audit/competitors?${params.toString()}`;
}

/** Fetch and re-validate the complete traceable portfolio contract. */
export async function getGrowthMapUrls(
  projectId: string,
  query: GrowthMapUrlsQuery = {},
): Promise<GrowthMapUrlPortfolioResponseDto> {
  const normalized = normalizeGrowthMapUrlsQuery(query);
  const response = await apiGet<DataEnvelope<unknown>>(
    growthMapUrlsPath(projectId, normalized),
  );
  return GrowthMapUrlPortfolioResponse.parse(response.data);
}

/** Fetch and re-validate the exact selected SitePage contract. */
export async function getGrowthMapUrlDetail(
  projectId: string,
  sitePageId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): Promise<GrowthMapUrlDetailResponseDto> {
  if (!sitePageId) {
    throw new Error("A sitePageId is required to fetch Growth Map URL detail.");
  }
  const normalizedDiagnosticRunId =
    normalizeGrowthMapDiagnosticRunId(diagnosticRunId);
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/urls/${encodeURIComponent(sitePageId)}${
      normalizedDiagnosticRunId === null
        ? ""
        : `?${new URLSearchParams({
            diagnosticRunId: normalizedDiagnosticRunId,
          }).toString()}`
    }`,
  );
  return GrowthMapUrlDetailResponse.parse(response.data);
}

/** Read the frozen site graph and the exact selected SitePage's link facts. */
export async function getGrowthMapInternalLinkMap(
  projectId: string,
  sitePageId: string | null | undefined,
): Promise<GrowthMapInternalLinkMapDto> {
  const selectedPageQuery =
    sitePageId === null || sitePageId === undefined || sitePageId === ""
      ? ""
      : `?${new URLSearchParams({ sitePageId }).toString()}`;
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/internal-link-map${selectedPageQuery}`,
  );
  return GrowthMapInternalLinkMapSchema.parse(response.data);
}

/** Fetch and re-validate one bounded page of traceable Keyword entities. */
export async function getGrowthMapKeywords(
  projectId: string,
  query: GrowthMapKeywordsQuery = {},
): Promise<GrowthMapKeywordLibraryResponseDto> {
  const normalized = normalizeGrowthMapKeywordsQuery(query);
  const response = await apiGet<DataEnvelope<unknown>>(
    growthMapKeywordsPath(projectId, normalized),
  );
  return GrowthMapKeywordLibraryResponse.parse(response.data);
}

/** Fetch and re-validate the exact selected Keyword entity projection. */
export async function getGrowthMapKeywordDetail(
  projectId: string,
  keywordId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): Promise<GrowthMapKeywordDetailResponseDto> {
  if (!keywordId) {
    throw new Error("A keywordId is required to fetch Growth Map Keyword detail.");
  }
  const normalizedDiagnosticRunId =
    normalizeGrowthMapDiagnosticRunId(diagnosticRunId);
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/keywords/${encodeURIComponent(keywordId)}${
      normalizedDiagnosticRunId === null
        ? ""
        : `?${new URLSearchParams({
            diagnosticRunId: normalizedDiagnosticRunId,
          }).toString()}`
    }`,
  );
  return GrowthMapKeywordDetailResponse.parse(response.data);
}

/** Fetch and re-validate the live review authority for one selected Keyword. */
export async function getGrowthMapKeywordReviewDetail(
  projectId: string,
  keywordId: string | null | undefined,
): Promise<GrowthMapKeywordDetailResponseDto> {
  if (!keywordId) {
    throw new Error(
      "A keywordId is required to fetch Growth Map Keyword review detail.",
    );
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/keywords/${encodeURIComponent(keywordId)}?view=review`,
  );
  return GrowthMapKeywordDetailResponse.parse(response.data);
}

/** Append one strict compare-and-swap review for an exact Keyword identity. */
export async function reviewGrowthMapKeyword(
  projectId: string,
  keywordId: string,
  input: ReviewKeywordRequest,
): Promise<GrowthMapKeywordDetailResponseDto> {
  if (keywordId.length === 0) {
    throw new Error("A keywordId is required to review a Growth Map Keyword.");
  }
  const body = ReviewKeywordRequestSchema.parse(input);
  const response = await apiSend<DataEnvelope<unknown>>(
    "PATCH",
    `/projects/${projectId}/audit/keywords/${encodeURIComponent(keywordId)}`,
    { body },
  );
  return GrowthMapKeywordDetailResponse.parse(response.data);
}

/** Fetch and re-validate one Keyword's fixed trailing 90-day rank history. */
export async function getGrowthMapKeywordRankHistory(
  projectId: string,
  keywordId: string | null | undefined,
): Promise<GrowthMapKeywordRankHistoryDto> {
  if (!keywordId) {
    throw new Error(
      "A keywordId is required to fetch Growth Map Keyword rank history.",
    );
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/keywords/${encodeURIComponent(keywordId)}/rank-history`,
  );
  return GrowthMapKeywordRankHistory.parse(response.data);
}

/** Batch-read duplicate governance for one visible Keyword Library page. */
export async function getGrowthMapKeywordRelations(
  projectId: string,
  query: GrowthMapKeywordRelationsQuery,
): Promise<KeywordRelationListResponseDto> {
  const normalized = normalizeGrowthMapKeywordRelationsQuery(query);
  if (normalized.keywordIds.length === 0) {
    throw new Error(
      "At least one keywordId is required to fetch Growth Map Keyword Relations.",
    );
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    growthMapKeywordRelationsPath(projectId, normalized),
  );
  return KeywordRelationListResponse.parse(response.data);
}

/** Ask the server to append any newly eligible immutable candidates. */
export async function refreshGrowthMapKeywordRelations(
  projectId: string,
): Promise<KeywordRelationRefreshResponseDto> {
  const response = await apiSend<DataEnvelope<unknown>>(
    "POST",
    `/projects/${projectId}/audit/keyword-relations`,
  );
  return KeywordRelationRefreshResponse.parse(response.data);
}

/** Append one strict compare-and-swap duplicate-governance decision. */
export async function decideGrowthMapKeywordRelation(
  projectId: string,
  variables: DecideGrowthMapKeywordRelationVars,
): Promise<KeywordRelationDecisionResultDto> {
  if (variables.relationId.length === 0) {
    throw new Error(
      "A relationId is required to decide a Growth Map Keyword Relation.",
    );
  }
  const body = DecideKeywordRelationRequestSchema.parse(variables.body);
  const response = await apiSend<DataEnvelope<unknown>>(
    "PATCH",
    `/projects/${projectId}/audit/keyword-relations/${encodeURIComponent(variables.relationId)}`,
    { body },
  );
  return KeywordRelationDecisionResult.parse(response.data);
}

/** Fetch and re-validate one bounded page of traceable Competitor entities. */
export async function getGrowthMapCompetitors(
  projectId: string,
  query: GrowthMapCompetitorsQuery = {},
): Promise<GrowthMapCompetitorLibraryResponseDto> {
  const normalized = normalizeGrowthMapCompetitorsQuery(query);
  const response = await apiGet<DataEnvelope<unknown>>(
    growthMapCompetitorsPath(projectId, normalized),
  );
  return GrowthMapCompetitorLibraryResponse.parse(response.data);
}

/** Fetch and re-validate the exact selected Competitor entity projection. */
export async function getGrowthMapCompetitorDetail(
  projectId: string,
  competitorId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): Promise<GrowthMapCompetitorDetailResponseDto> {
  if (!competitorId) {
    throw new Error(
      "A competitorId is required to fetch Growth Map Competitor detail.",
    );
  }
  const normalizedDiagnosticRunId =
    normalizeGrowthMapDiagnosticRunId(diagnosticRunId);
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/competitors/${encodeURIComponent(competitorId)}${
      normalizedDiagnosticRunId === null
        ? ""
        : `?${new URLSearchParams({
            diagnosticRunId: normalizedDiagnosticRunId,
          }).toString()}`
    }`,
  );
  return GrowthMapCompetitorDetailResponse.parse(response.data);
}

/** Fetch the live governance authority for one selected Competitor. */
export async function getGrowthMapCompetitorReviewDetail(
  projectId: string,
  competitorId: string | null | undefined,
): Promise<GrowthMapCompetitorDetailResponseDto> {
  if (!competitorId) {
    throw new Error(
      "A competitorId is required to fetch Growth Map Competitor review detail.",
    );
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/competitors/${encodeURIComponent(competitorId)}?view=review`,
  );
  return GrowthMapCompetitorDetailResponse.parse(response.data);
}

/** Append one strict compare-and-swap governance review for a Competitor. */
export async function reviewGrowthMapCompetitor(
  projectId: string,
  competitorId: string,
  input: ReviewCompetitorRequest,
): Promise<GrowthMapCompetitorDetailResponseDto> {
  if (competitorId.length === 0) {
    throw new Error(
      "A competitorId is required to review a Growth Map Competitor.",
    );
  }
  const body = ReviewCompetitorRequestSchema.parse(input);
  const response = await apiSend<DataEnvelope<unknown>>(
    "PATCH",
    `/projects/${projectId}/audit/competitors/${encodeURIComponent(competitorId)}`,
    { body },
  );
  return GrowthMapCompetitorDetailResponse.parse(response.data);
}

/** Read monthly competitor evidence already governed inside Competitor Library. */
export async function getGrowthMapCompetitorMonitor(
  projectId: string,
): Promise<CompetitorMonitorResponseDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/competitor-monitor`,
  );
  return CompetitorMonitorResponseSchema.parse(response.data);
}

/** Apply one strict compare-and-swap update to the monthly monitor config. */
export async function updateGrowthMapCompetitorMonitor(
  projectId: string,
  input: UpdateCompetitorMonitorRequest,
): Promise<CompetitorMonitorConfigDto> {
  const body = UpdateCompetitorMonitorRequestSchema.parse(input);
  const response = await apiSend<DataEnvelope<unknown>>(
    "PUT",
    `/projects/${projectId}/audit/competitor-monitor`,
    { body },
  );
  return CompetitorMonitorConfigSchema.parse(response.data);
}

/** Read confirmed Topic authority and the sole editable successor draft. */
export async function getGrowthMapTopicModelWorkspace(
  projectId: string,
): Promise<TopicModelWorkspaceProjectionDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/topic-model`,
  );
  return TopicModelWorkspaceProjectionSchema.parse(response.data);
}

/**
 * Read Keyword/content coverage from the latest confirmed Topic Model only.
 * An editable draft intentionally cannot change this projection.
 */
export async function getGrowthMapTopicModelInsights(
  projectId: string,
): Promise<GrowthMapTopicModelInsightsDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/topic-model/insights`,
  );
  return GrowthMapTopicModelInsightsSchema.parse(response.data);
}

/** Begin the unique next Topic Model draft from an exact confirmed revision. */
export async function beginGrowthMapTopicModelDraft(
  projectId: string,
  input: BeginTopicModelDraftRequest,
): Promise<TopicModelWorkspaceProjectionDto> {
  const body = BeginTopicModelDraftRequestSchema.parse(input);
  const response = await apiSend<DataEnvelope<unknown>>(
    "POST",
    `/projects/${projectId}/audit/topic-model/draft`,
    { body },
  );
  return TopicModelWorkspaceProjectionSchema.parse(response.data);
}

/** Apply one strict compare-and-swap batch to the editable Topic draft. */
export async function patchGrowthMapTopicModelDraft(
  projectId: string,
  input: PatchTopicModelDraftRequest,
): Promise<TopicModelWorkspaceProjectionDto> {
  const body = PatchTopicModelDraftRequestSchema.parse(input);
  const response = await apiSend<DataEnvelope<unknown>>(
    "PATCH",
    `/projects/${projectId}/audit/topic-model/draft`,
    { body },
  );
  return TopicModelWorkspaceProjectionSchema.parse(response.data);
}

/** Publish one exact draft edit revision as immutable confirmed authority. */
export async function confirmGrowthMapTopicModelDraft(
  projectId: string,
  input: ConfirmTopicModelRequest,
): Promise<TopicModelWorkspaceProjectionDto> {
  const body = ConfirmTopicModelRequestSchema.parse(input);
  const response = await apiSend<DataEnvelope<unknown>>(
    "POST",
    `/projects/${projectId}/audit/topic-model/draft/confirm`,
    { body },
  );
  return TopicModelWorkspaceProjectionSchema.parse(response.data);
}

export function buildGrowthMapUrlsQueryOptions(
  projectId: string,
  uiLocale: string,
  query: GrowthMapUrlsQuery = {},
): UseQueryOptions<GrowthMapUrlPortfolioResponseDto, ApiError> {
  const normalized = normalizeGrowthMapUrlsQuery(query);
  return {
    queryKey: growthMapUrlsQueryKey(projectId, uiLocale, normalized),
    queryFn: () => getGrowthMapUrls(projectId, normalized),
    enabled: projectId.length > 0,
  };
}

export function buildGrowthMapUrlDetailQueryOptions(
  projectId: string,
  uiLocale: string,
  sitePageId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): UseQueryOptions<GrowthMapUrlDetailResponseDto, ApiError> {
  return {
    queryKey: growthMapUrlDetailQueryKey(
      projectId,
      uiLocale,
      sitePageId,
      diagnosticRunId,
    ),
    queryFn: () =>
      getGrowthMapUrlDetail(projectId, sitePageId, diagnosticRunId),
    enabled: projectId.length > 0 && Boolean(sitePageId),
  };
}

export function buildGrowthMapInternalLinkMapQueryOptions(
  projectId: string,
  uiLocale: string,
  sitePageId: string | null | undefined,
): UseQueryOptions<GrowthMapInternalLinkMapDto, ApiError> {
  return {
    queryKey: growthMapInternalLinkMapQueryKey(
      projectId,
      uiLocale,
      sitePageId,
    ),
    queryFn: () => getGrowthMapInternalLinkMap(projectId, sitePageId),
    enabled: projectId.length > 0,
    // Graph facts are frozen, but Finding/Action references are live. Re-read
    // whenever an exact URL selection becomes active again.
    staleTime: 0,
  };
}

export function buildGrowthMapKeywordsQueryOptions(
  projectId: string,
  uiLocale: string,
  query: GrowthMapKeywordsQuery = {},
): UseQueryOptions<GrowthMapKeywordLibraryResponseDto, ApiError> {
  const normalized = normalizeGrowthMapKeywordsQuery(query);
  return {
    queryKey: growthMapKeywordsQueryKey(projectId, uiLocale, normalized),
    queryFn: () => getGrowthMapKeywords(projectId, normalized),
    enabled: projectId.length > 0,
  };
}

export function buildGrowthMapKeywordDetailQueryOptions(
  projectId: string,
  uiLocale: string,
  keywordId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): UseQueryOptions<GrowthMapKeywordDetailResponseDto, ApiError> {
  return {
    queryKey: growthMapKeywordDetailQueryKey(
      projectId,
      uiLocale,
      keywordId,
      diagnosticRunId,
    ),
    queryFn: () =>
      getGrowthMapKeywordDetail(projectId, keywordId, diagnosticRunId),
    enabled: projectId.length > 0 && Boolean(keywordId),
  };
}

export function buildGrowthMapKeywordReviewDetailQueryOptions(
  projectId: string,
  uiLocale: string,
  keywordId: string | null | undefined,
  enabled = true,
): UseQueryOptions<GrowthMapKeywordDetailResponseDto, ApiError> {
  return {
    queryKey: growthMapKeywordReviewDetailQueryKey(
      projectId,
      uiLocale,
      keywordId,
    ),
    queryFn: () => getGrowthMapKeywordReviewDetail(projectId, keywordId),
    enabled: enabled && projectId.length > 0 && Boolean(keywordId),
    staleTime: 0,
  };
}

export function buildGrowthMapKeywordRankHistoryQueryOptions(
  projectId: string,
  uiLocale: string,
  keywordId: string | null | undefined,
): UseQueryOptions<GrowthMapKeywordRankHistoryDto, ApiError> {
  return {
    queryKey: growthMapKeywordRankHistoryQueryKey(
      projectId,
      uiLocale,
      keywordId,
    ),
    queryFn: () => getGrowthMapKeywordRankHistory(projectId, keywordId),
    enabled: projectId.length > 0 && Boolean(keywordId),
  };
}

export function buildGrowthMapKeywordRelationsQueryOptions(
  projectId: string,
  uiLocale: string,
  query: GrowthMapKeywordRelationsQuery,
): UseQueryOptions<KeywordRelationListResponseDto, ApiError> {
  const normalized = normalizeGrowthMapKeywordRelationsQuery(query);
  return {
    queryKey: growthMapKeywordRelationsQueryKey(
      projectId,
      uiLocale,
      normalized,
    ),
    queryFn: () => getGrowthMapKeywordRelations(projectId, normalized),
    enabled:
      projectId.length > 0 && normalized.keywordIds.length > 0,
  };
}

export function buildGrowthMapCompetitorsQueryOptions(
  projectId: string,
  uiLocale: string,
  query: GrowthMapCompetitorsQuery = {},
): UseQueryOptions<GrowthMapCompetitorLibraryResponseDto, ApiError> {
  const normalized = normalizeGrowthMapCompetitorsQuery(query);
  return {
    queryKey: growthMapCompetitorsQueryKey(projectId, uiLocale, normalized),
    queryFn: () => getGrowthMapCompetitors(projectId, normalized),
    enabled: projectId.length > 0,
  };
}

export function buildGrowthMapCompetitorDetailQueryOptions(
  projectId: string,
  uiLocale: string,
  competitorId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): UseQueryOptions<GrowthMapCompetitorDetailResponseDto, ApiError> {
  return {
    queryKey: growthMapCompetitorDetailQueryKey(
      projectId,
      uiLocale,
      competitorId,
      diagnosticRunId,
    ),
    queryFn: () =>
      getGrowthMapCompetitorDetail(
        projectId,
        competitorId,
        diagnosticRunId,
      ),
    enabled: projectId.length > 0 && Boolean(competitorId),
  };
}

export function buildGrowthMapCompetitorReviewDetailQueryOptions(
  projectId: string,
  uiLocale: string,
  competitorId: string | null | undefined,
  enabled = true,
): UseQueryOptions<GrowthMapCompetitorDetailResponseDto, ApiError> {
  return {
    queryKey: growthMapCompetitorReviewDetailQueryKey(
      projectId,
      uiLocale,
      competitorId,
    ),
    queryFn: () =>
      getGrowthMapCompetitorReviewDetail(projectId, competitorId),
    enabled: enabled && projectId.length > 0 && Boolean(competitorId),
    staleTime: 0,
  };
}

export async function invalidateGrowthMapAfterCompetitorReview(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
  competitorId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: growthMapCompetitorReviewDetailQueryKey(
      projectId,
      uiLocale,
      competitorId,
    ),
    refetchType: "active",
  });
}

export function buildReviewGrowthMapCompetitorMutationOptions(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
  competitorId: string,
): UseMutationOptions<
  GrowthMapCompetitorDetailResponseDto,
  ApiError,
  ReviewCompetitorRequest
> {
  return {
    mutationFn: (body) =>
      reviewGrowthMapCompetitor(projectId, competitorId, body),
    onSuccess: (result) =>
      queryClient.setQueryData(
        growthMapCompetitorReviewDetailQueryKey(
          projectId,
          uiLocale,
          competitorId,
        ),
        result,
      ),
    onError: (error) =>
      error.status === 409
        ? invalidateGrowthMapAfterCompetitorReview(
            queryClient,
            projectId,
            uiLocale,
            competitorId,
          )
        : undefined,
  };
}

export function buildGrowthMapCompetitorMonitorQueryOptions(
  projectId: string,
  uiLocale: string,
): UseQueryOptions<CompetitorMonitorResponseDto, ApiError> {
  return {
    queryKey: growthMapCompetitorMonitorQueryKey(projectId, uiLocale),
    queryFn: () => getGrowthMapCompetitorMonitor(projectId),
    enabled: projectId.length > 0,
  };
}

export async function invalidateGrowthMapCompetitorMonitor(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: growthMapCompetitorMonitorQueryKey(projectId, uiLocale),
    refetchType: "active",
  });
}

export function buildGrowthMapCompetitorMonitorMutationOptions(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
): UseMutationOptions<
  CompetitorMonitorConfigDto,
  ApiError,
  UpdateCompetitorMonitorRequest
> {
  return {
    mutationFn: (body) =>
      updateGrowthMapCompetitorMonitor(projectId, body),
    onSuccess: () =>
      invalidateGrowthMapCompetitorMonitor(
        queryClient,
        projectId,
        uiLocale,
      ),
    onError: (error) =>
      error.status === 409
        ? invalidateGrowthMapCompetitorMonitor(
            queryClient,
            projectId,
            uiLocale,
          )
        : undefined,
  };
}

export function buildGrowthMapTopicModelWorkspaceQueryOptions(
  projectId: string,
  uiLocale: string,
): UseQueryOptions<TopicModelWorkspaceProjectionDto, ApiError> {
  return {
    queryKey: growthMapTopicModelWorkspaceQueryKey(projectId, uiLocale),
    queryFn: () => getGrowthMapTopicModelWorkspace(projectId),
    enabled: projectId.length > 0,
  };
}

export function buildGrowthMapTopicModelInsightsQueryOptions(
  projectId: string,
  uiLocale: string,
): UseQueryOptions<GrowthMapTopicModelInsightsDto, ApiError> {
  return {
    queryKey: growthMapTopicModelInsightsQueryKey(projectId, uiLocale),
    queryFn: () => getGrowthMapTopicModelInsights(projectId),
    enabled: projectId.length > 0,
  };
}

export function useGrowthMapUrls(
  projectId: string,
  query: GrowthMapUrlsQuery = {},
): UseQueryResult<GrowthMapUrlPortfolioResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(buildGrowthMapUrlsQueryOptions(projectId, uiLocale, query));
}

export function useGrowthMapUrlDetail(
  projectId: string,
  sitePageId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): UseQueryResult<GrowthMapUrlDetailResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapUrlDetailQueryOptions(
      projectId,
      uiLocale,
      sitePageId,
      diagnosticRunId,
    ),
  );
}

export function useGrowthMapInternalLinkMap(
  projectId: string,
  sitePageId: string | null | undefined,
): UseQueryResult<GrowthMapInternalLinkMapDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapInternalLinkMapQueryOptions(
      projectId,
      uiLocale,
      sitePageId,
    ),
  );
}

export function useGrowthMapKeywords(
  projectId: string,
  query: GrowthMapKeywordsQuery = {},
): UseQueryResult<GrowthMapKeywordLibraryResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapKeywordsQueryOptions(projectId, uiLocale, query),
  );
}

export function useGrowthMapKeywordDetail(
  projectId: string,
  keywordId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): UseQueryResult<GrowthMapKeywordDetailResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapKeywordDetailQueryOptions(
      projectId,
      uiLocale,
      keywordId,
      diagnosticRunId,
    ),
  );
}

export function useGrowthMapKeywordReviewDetail(
  projectId: string,
  keywordId: string | null | undefined,
  enabled = true,
): UseQueryResult<GrowthMapKeywordDetailResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapKeywordReviewDetailQueryOptions(
      projectId,
      uiLocale,
      keywordId,
      enabled,
    ),
  );
}

/**
 * A Keyword review can change the visible row, exact detail, Topic coverage,
 * and duplicate-governance eligibility. Refresh all four customer reads after
 * success and after a CAS conflict so the editor never keeps stale authority.
 */
export async function invalidateGrowthMapAfterKeywordReview(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
  keywordId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: growthMapKeywordReviewDetailQueryKey(
      projectId,
      uiLocale,
      keywordId,
    ),
    refetchType: "active",
  });
}

export function useReviewGrowthMapKeyword(
  projectId: string,
  keywordId: string,
): UseMutationResult<
  GrowthMapKeywordDetailResponseDto,
  ApiError,
  ReviewKeywordRequest
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      reviewGrowthMapKeyword(projectId, keywordId, input),
    onSuccess: (result) =>
      queryClient.setQueryData(
        growthMapKeywordReviewDetailQueryKey(
          projectId,
          uiLocale,
          keywordId,
        ),
        result,
      ),
    onError: (error) =>
      error.status === 409
        ? invalidateGrowthMapAfterKeywordReview(
            queryClient,
            projectId,
            uiLocale,
            keywordId,
          )
        : undefined,
  });
}

export function useGrowthMapKeywordRankHistory(
  projectId: string,
  keywordId: string | null | undefined,
): UseQueryResult<GrowthMapKeywordRankHistoryDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapKeywordRankHistoryQueryOptions(
      projectId,
      uiLocale,
      keywordId,
    ),
  );
}

export function useGrowthMapKeywordRelations(
  projectId: string,
  query: GrowthMapKeywordRelationsQuery,
): UseQueryResult<KeywordRelationListResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapKeywordRelationsQueryOptions(
      projectId,
      uiLocale,
      query,
    ),
  );
}

export async function invalidateGrowthMapKeywordRelations(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [
      "growth-map",
      projectId,
      uiLocale,
      "keyword-relations",
    ],
    refetchType: "active",
  });
}

export function useRefreshGrowthMapKeywordRelations(
  projectId: string,
): UseMutationResult<
  KeywordRelationRefreshResponseDto,
  ApiError,
  void
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshGrowthMapKeywordRelations(projectId),
    onSuccess: () =>
      invalidateGrowthMapKeywordRelations(
        queryClient,
        projectId,
        uiLocale,
      ),
  });
}

export function useDecideGrowthMapKeywordRelation(
  projectId: string,
): UseMutationResult<
  KeywordRelationDecisionResultDto,
  ApiError,
  DecideGrowthMapKeywordRelationVars
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) =>
      decideGrowthMapKeywordRelation(projectId, variables),
    onSuccess: () =>
      invalidateGrowthMapKeywordRelations(
        queryClient,
        projectId,
        uiLocale,
      ),
    onError: (error) =>
      error.status === 409
        ? invalidateGrowthMapKeywordRelations(
            queryClient,
            projectId,
            uiLocale,
          )
        : undefined,
  });
}

export function useGrowthMapCompetitors(
  projectId: string,
  query: GrowthMapCompetitorsQuery = {},
): UseQueryResult<GrowthMapCompetitorLibraryResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapCompetitorsQueryOptions(projectId, uiLocale, query),
  );
}

export function useGrowthMapCompetitorDetail(
  projectId: string,
  competitorId: string | null | undefined,
  diagnosticRunId: string | null | undefined = null,
): UseQueryResult<GrowthMapCompetitorDetailResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapCompetitorDetailQueryOptions(
      projectId,
      uiLocale,
      competitorId,
      diagnosticRunId,
    ),
  );
}

export function useGrowthMapCompetitorReviewDetail(
  projectId: string,
  competitorId: string | null | undefined,
  enabled = true,
): UseQueryResult<GrowthMapCompetitorDetailResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapCompetitorReviewDetailQueryOptions(
      projectId,
      uiLocale,
      competitorId,
      enabled,
    ),
  );
}

export function useReviewGrowthMapCompetitor(
  projectId: string,
  competitorId: string,
): UseMutationResult<
  GrowthMapCompetitorDetailResponseDto,
  ApiError,
  ReviewCompetitorRequest
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation(
    buildReviewGrowthMapCompetitorMutationOptions(
      queryClient,
      projectId,
      uiLocale,
      competitorId,
    ),
  );
}

export function useGrowthMapCompetitorMonitor(
  projectId: string,
): UseQueryResult<CompetitorMonitorResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapCompetitorMonitorQueryOptions(projectId, uiLocale),
  );
}

export function useUpdateGrowthMapCompetitorMonitor(
  projectId: string,
): UseMutationResult<
  CompetitorMonitorConfigDto,
  ApiError,
  UpdateCompetitorMonitorRequest
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation(
    buildGrowthMapCompetitorMonitorMutationOptions(
      queryClient,
      projectId,
      uiLocale,
    ),
  );
}

export function useGrowthMapTopicModelWorkspace(
  projectId: string,
): UseQueryResult<TopicModelWorkspaceProjectionDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapTopicModelWorkspaceQueryOptions(projectId, uiLocale),
  );
}

export function useGrowthMapTopicModelInsights(
  projectId: string,
): UseQueryResult<GrowthMapTopicModelInsightsDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapTopicModelInsightsQueryOptions(projectId, uiLocale),
  );
}

export async function invalidateGrowthMapTopicModelDraft(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: growthMapTopicModelWorkspaceQueryKey(projectId, uiLocale),
    refetchType: "active",
  });
}

export async function invalidateGrowthMapTopicModelAfterConflict(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
): Promise<void> {
  await Promise.all([
    invalidateGrowthMapTopicModelDraft(queryClient, projectId, uiLocale),
    queryClient.invalidateQueries({
      queryKey: growthMapTopicModelInsightsQueryKey(projectId, uiLocale),
      refetchType: "active",
    }),
  ]);
}

export async function invalidateGrowthMapAfterTopicModelConfirmation(
  queryClient: QueryClient,
  projectId: string,
  uiLocale: string,
): Promise<void> {
  await Promise.all([
    invalidateGrowthMapTopicModelDraft(queryClient, projectId, uiLocale),
    queryClient.invalidateQueries({
      queryKey: growthMapTopicModelInsightsQueryKey(projectId, uiLocale),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: ["growth-map", projectId, uiLocale, "keywords"],
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: ["growth-map", projectId, uiLocale, "keyword"],
      refetchType: "active",
    }),
    invalidateGrowthMapKeywordRelations(queryClient, projectId, uiLocale),
  ]);
}

export function useBeginGrowthMapTopicModelDraft(
  projectId: string,
): UseMutationResult<
  TopicModelWorkspaceProjectionDto,
  ApiError,
  BeginTopicModelDraftRequest
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => beginGrowthMapTopicModelDraft(projectId, body),
    onSuccess: (workspace) => {
      queryClient.setQueryData(
        growthMapTopicModelWorkspaceQueryKey(projectId, uiLocale),
        workspace,
      );
      return invalidateGrowthMapTopicModelDraft(
        queryClient,
        projectId,
        uiLocale,
      );
    },
    onError: (error) =>
      error.status === 409
        ? invalidateGrowthMapTopicModelAfterConflict(
            queryClient,
            projectId,
            uiLocale,
          )
        : undefined,
  });
}

export function usePatchGrowthMapTopicModelDraft(
  projectId: string,
): UseMutationResult<
  TopicModelWorkspaceProjectionDto,
  ApiError,
  PatchTopicModelDraftRequest
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => patchGrowthMapTopicModelDraft(projectId, body),
    onSuccess: (workspace) => {
      queryClient.setQueryData(
        growthMapTopicModelWorkspaceQueryKey(projectId, uiLocale),
        workspace,
      );
      return invalidateGrowthMapTopicModelDraft(
        queryClient,
        projectId,
        uiLocale,
      );
    },
    onError: (error) =>
      error.status === 409
        ? invalidateGrowthMapTopicModelAfterConflict(
            queryClient,
            projectId,
            uiLocale,
          )
        : undefined,
  });
}

export function useConfirmGrowthMapTopicModelDraft(
  projectId: string,
): UseMutationResult<
  TopicModelWorkspaceProjectionDto,
  ApiError,
  ConfirmTopicModelRequest
> {
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => confirmGrowthMapTopicModelDraft(projectId, body),
    onSuccess: (workspace) => {
      queryClient.setQueryData(
        growthMapTopicModelWorkspaceQueryKey(projectId, uiLocale),
        workspace,
      );
      return invalidateGrowthMapAfterTopicModelConfirmation(
        queryClient,
        projectId,
        uiLocale,
      );
    },
    onError: (error) =>
      error.status === 409
        ? invalidateGrowthMapTopicModelAfterConflict(
            queryClient,
            projectId,
            uiLocale,
          )
        : undefined,
  });
}
