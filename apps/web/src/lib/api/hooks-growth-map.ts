"use client";

import {
  GrowthMapKeywordDetailResponse,
  GrowthMapKeywordLibraryResponse,
  GrowthMapUrlDetailResponse,
  GrowthMapUrlPortfolioResponse,
  type GrowthMapKeywordDetailResponse as GrowthMapKeywordDetailResponseDto,
  type GrowthMapKeywordLibraryResponse as GrowthMapKeywordLibraryResponseDto,
  type GrowthMapUrlDetailResponse as GrowthMapUrlDetailResponseDto,
  type GrowthMapUrlPortfolioResponse as GrowthMapUrlPortfolioResponseDto,
} from "@sf/contracts";
import {
  useQuery,
  type QueryClient,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { apiGet, type ApiError } from "./client";
import type { DataEnvelope } from "./types";

export const DEFAULT_GROWTH_MAP_URL_LIMIT = 50;
export const DEFAULT_GROWTH_MAP_KEYWORD_LIMIT = 50;
export const MAX_GROWTH_MAP_SEARCH_LENGTH = 256;

export interface GrowthMapUrlsQuery {
  readonly search?: string | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

interface NormalizedGrowthMapUrlsQuery {
  readonly search: string | null;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface GrowthMapKeywordsQuery {
  readonly cursor?: string | null;
  readonly limit?: number;
}

interface NormalizedGrowthMapKeywordsQuery {
  readonly cursor: string | null;
  readonly limit: number;
}

function normalizeGrowthMapUrlsQuery(
  query: GrowthMapUrlsQuery = {},
): NormalizedGrowthMapUrlsQuery {
  const search = query.search?.trim() || null;
  const cursor = query.cursor === "" || query.cursor == null ? null : query.cursor;
  const limit = query.limit ?? DEFAULT_GROWTH_MAP_URL_LIMIT;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Growth Map URL limit must be an integer from 1 to 100.");
  }
  if (search !== null && search.length > MAX_GROWTH_MAP_SEARCH_LENGTH) {
    throw new RangeError(
      `Growth Map URL search must be at most ${MAX_GROWTH_MAP_SEARCH_LENGTH} characters.`,
    );
  }

  return { search, cursor, limit };
}

function normalizeGrowthMapKeywordsQuery(
  query: GrowthMapKeywordsQuery = {},
): NormalizedGrowthMapKeywordsQuery {
  const cursor = query.cursor === "" || query.cursor == null ? null : query.cursor;
  const limit = query.limit ?? DEFAULT_GROWTH_MAP_KEYWORD_LIMIT;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(
      "Growth Map Keyword limit must be an integer from 1 to 100.",
    );
  }

  return { cursor, limit };
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
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "url",
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
) {
  return [
    "growth-map",
    projectId,
    uiLocale,
    "keyword",
    keywordId || null,
  ] as const;
}

/**
 * A Finding review changes both the portfolio review count/priority and the
 * selected URL's canonical Finding projection. Refresh the two active reads
 * explicitly; other SitePage details remain untouched.
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
      queryKey: growthMapUrlDetailQueryKey(projectId, uiLocale, sitePageId),
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
  return `/projects/${projectId}/audit/urls?${params.toString()}`;
}

function growthMapKeywordsPath(
  projectId: string,
  query: NormalizedGrowthMapKeywordsQuery,
): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  return `/projects/${projectId}/audit/keywords?${params.toString()}`;
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
): Promise<GrowthMapUrlDetailResponseDto> {
  if (!sitePageId) {
    throw new Error("A sitePageId is required to fetch Growth Map URL detail.");
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/urls/${encodeURIComponent(sitePageId)}`,
  );
  return GrowthMapUrlDetailResponse.parse(response.data);
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
): Promise<GrowthMapKeywordDetailResponseDto> {
  if (!keywordId) {
    throw new Error("A keywordId is required to fetch Growth Map Keyword detail.");
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/keywords/${encodeURIComponent(keywordId)}`,
  );
  return GrowthMapKeywordDetailResponse.parse(response.data);
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
): UseQueryOptions<GrowthMapUrlDetailResponseDto, ApiError> {
  return {
    queryKey: growthMapUrlDetailQueryKey(projectId, uiLocale, sitePageId),
    queryFn: () => getGrowthMapUrlDetail(projectId, sitePageId),
    enabled: projectId.length > 0 && Boolean(sitePageId),
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
): UseQueryOptions<GrowthMapKeywordDetailResponseDto, ApiError> {
  return {
    queryKey: growthMapKeywordDetailQueryKey(projectId, uiLocale, keywordId),
    queryFn: () => getGrowthMapKeywordDetail(projectId, keywordId),
    enabled: projectId.length > 0 && Boolean(keywordId),
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
): UseQueryResult<GrowthMapUrlDetailResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapUrlDetailQueryOptions(projectId, uiLocale, sitePageId),
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
): UseQueryResult<GrowthMapKeywordDetailResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapKeywordDetailQueryOptions(projectId, uiLocale, keywordId),
  );
}
