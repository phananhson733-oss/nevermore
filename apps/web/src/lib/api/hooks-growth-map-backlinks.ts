"use client";

import {
  GrowthMapBacklinkReadModel,
  type GrowthMapBacklinkReadModel as GrowthMapBacklinkReadModelDto,
} from "@sf/contracts";
import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { apiGet, type ApiError } from "./client";
import type { DataEnvelope } from "./types";

export function growthMapBacklinksQueryKey(
  projectId: string,
  uiLocale: string,
) {
  return ["growth-map", projectId, uiLocale, "backlinks"] as const;
}
export async function getGrowthMapBacklinks(
  projectId: string,
): Promise<GrowthMapBacklinkReadModelDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/backlinks`,
  );
  return GrowthMapBacklinkReadModel.parse(response.data);
}

export function buildGrowthMapBacklinksQueryOptions(
  projectId: string,
  uiLocale: string,
): UseQueryOptions<GrowthMapBacklinkReadModelDto, ApiError> {
  return {
    queryKey: growthMapBacklinksQueryKey(projectId, uiLocale),
    queryFn: () => getGrowthMapBacklinks(projectId),
    enabled: projectId.length > 0,
  };
}

export function useGrowthMapBacklinks(
  projectId: string,
): UseQueryResult<GrowthMapBacklinkReadModelDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildGrowthMapBacklinksQueryOptions(projectId, uiLocale),
  );
}
