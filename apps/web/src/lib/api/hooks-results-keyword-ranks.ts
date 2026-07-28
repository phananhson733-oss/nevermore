"use client";

import {
  MeasurementTargetKeywordRanks,
  type MeasurementTargetKeywordRanks as MeasurementTargetKeywordRanksDto,
} from "@sf/contracts";
import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";

import { apiGet, type ApiError } from "./client";
import type { DataEnvelope } from "./types";

export function measurementTargetKeywordRanksQueryKey(
  projectId: string,
  measurementWindowId: string,
  uiLocale: string,
) {
  return [
    "measurement-window",
    "target-keyword-ranks",
    projectId,
    measurementWindowId,
    uiLocale,
  ] as const;
}

/** Read one URL's governed target Keywords in its immutable before/after windows. */
export async function getMeasurementTargetKeywordRanks(
  projectId: string,
  measurementWindowId: string,
): Promise<MeasurementTargetKeywordRanksDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/measurement-windows/${measurementWindowId}/keyword-ranks`,
  );
  return MeasurementTargetKeywordRanks.parse(response.data);
}

export function buildMeasurementTargetKeywordRanksQueryOptions(
  projectId: string,
  measurementWindowId: string,
  uiLocale: string,
): UseQueryOptions<MeasurementTargetKeywordRanksDto, ApiError> {
  return {
    queryKey: measurementTargetKeywordRanksQueryKey(
      projectId,
      measurementWindowId,
      uiLocale,
    ),
    queryFn: () =>
      getMeasurementTargetKeywordRanks(
        projectId,
        measurementWindowId,
      ),
    enabled:
      projectId.length > 0 && measurementWindowId.length > 0,
  };
}

export function useMeasurementTargetKeywordRanks(
  projectId: string,
  measurementWindowId: string,
): UseQueryResult<MeasurementTargetKeywordRanksDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildMeasurementTargetKeywordRanksQueryOptions(
      projectId,
      measurementWindowId,
      uiLocale,
    ),
  );
}
