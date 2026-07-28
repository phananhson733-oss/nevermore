"use client";

import {
  GeoCitationEvidenceResponse,
  type GeoCitationEvidenceResponse as GeoCitationEvidenceResponseDto,
} from "@sf/contracts";
import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";

import { apiGet, type ApiError } from "./client";
import type { DataEnvelope } from "./types";

export function measurementGeoCitationsQueryKey(
  projectId: string,
  measurementWindowId: string,
  uiLocale: string,
) {
  return [
    "measurement-window",
    "geo-citations",
    projectId,
    measurementWindowId,
    uiLocale,
  ] as const;
}

/** Read immutable GEO evidence for one measured URL and its fixed windows. */
export async function getMeasurementGeoCitations(
  projectId: string,
  measurementWindowId: string,
): Promise<GeoCitationEvidenceResponseDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/measurement-windows/${measurementWindowId}/geo-citations`,
  );
  return GeoCitationEvidenceResponse.parse(response.data);
}

export function buildMeasurementGeoCitationsQueryOptions(
  projectId: string,
  measurementWindowId: string,
  uiLocale: string,
): UseQueryOptions<GeoCitationEvidenceResponseDto, ApiError> {
  return {
    queryKey: measurementGeoCitationsQueryKey(
      projectId,
      measurementWindowId,
      uiLocale,
    ),
    queryFn: () =>
      getMeasurementGeoCitations(
        projectId,
        measurementWindowId,
      ),
    enabled:
      projectId.length > 0 && measurementWindowId.length > 0,
  };
}

export function useMeasurementGeoCitations(
  projectId: string,
  measurementWindowId: string,
): UseQueryResult<GeoCitationEvidenceResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(
    buildMeasurementGeoCitationsQueryOptions(
      projectId,
      measurementWindowId,
      uiLocale,
    ),
  );
}
