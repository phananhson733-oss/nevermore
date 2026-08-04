"use client";

/**
 * Growth Audit TanStack Query v5 hook over the typed API client. A Growth Audit
 * freezes URL/ICP/snapshot inputs and queues a versioned full audit; the caller
 * polls the returned run with {@link useProjectRun}. Hard-gate failures (422
 * CONTEXT_INCOMPLETE / CRAWL_SNAPSHOT_REQUIRED, 409 RUN_ALREADY_ACTIVE) surface
 * as a typed `ApiError` for the screen to translate.
 */

import {
  AuditModuleSummary,
  GrowthAuditResponse,
  type AuditModuleId as AuditModuleIdType,
  type AuditModuleSummary as AuditModuleSummaryDto,
  type GrowthAuditResponse as GrowthAuditResponseDto,
} from "@sf/contracts";
import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { ApiError, apiGet, apiSend } from "./client";
import type { DataEnvelope } from "./types";
import type { AsyncRun, RunResourceRef } from "./hooks-diagnosis";

export const GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION =
  "growth-audit.0.3.0" as const;

export type GrowthAuditScope =
  | { readonly kind: "site" }
  | { readonly kind: "template"; readonly targetRefs: readonly string[] }
  | { readonly kind: "url"; readonly targetRefs: readonly string[] };

export interface CreateGrowthAuditRunRequest {
  readonly siteId: string;
  readonly icpProfileId: string;
  readonly scope: GrowthAuditScope;
  readonly outputLocale: string;
  readonly capabilityContractVersion: typeof GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION;
}

export interface GrowthAuditRunAccepted {
  readonly run: AsyncRun;
  readonly statusUrl: string;
  readonly resourceRef: RunResourceRef | null;
}

/**
 * Queue a versioned full Growth Audit for a Site. Generates a fresh
 * `Idempotency-Key` per attempt and returns the 202 accepted body.
 */
export function useCreateGrowthAuditRun(
  projectId: string,
): UseMutationResult<
  GrowthAuditRunAccepted,
  ApiError,
  CreateGrowthAuditRunRequest
> {
  return useMutation({
    mutationFn: async (body: CreateGrowthAuditRunRequest) => {
      const res = await apiSend<DataEnvelope<GrowthAuditRunAccepted>>(
        "POST",
        `/projects/${projectId}/audit-runs`,
        { body, idempotencyKey: crypto.randomUUID() },
      );
      return res.data;
    },
  });
}

/* ----------------------------------------------- read projections (Slice 1) */

export function growthAuditQueryKey(projectId: string, uiLocale: string) {
  return ["growth-audit", projectId, uiLocale, "audit"] as const;
}

export function auditModuleQueryKey(
  projectId: string,
  uiLocale: string,
  moduleId: AuditModuleIdType | null | undefined,
) {
  return [
    "growth-audit",
    projectId,
    uiLocale,
    "module",
    moduleId ?? null,
  ] as const;
}

/** Fetch and re-validate the complete Growth Audit projection contract. */
export async function getProjectGrowthAudit(
  projectId: string,
): Promise<GrowthAuditResponseDto> {
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit`,
  );
  return GrowthAuditResponse.parse(response.data);
}

/** Fetch and re-validate one audit module's coverage summary. */
export async function getProjectAuditModule(
  projectId: string,
  moduleId: AuditModuleIdType | null | undefined,
): Promise<AuditModuleSummaryDto> {
  if (!moduleId) {
    throw new Error("A moduleId is required to fetch an audit module.");
  }
  const response = await apiGet<DataEnvelope<unknown>>(
    `/projects/${projectId}/audit/modules/${encodeURIComponent(moduleId)}`,
  );
  return AuditModuleSummary.parse(response.data);
}

export function buildGrowthAuditQueryOptions(
  projectId: string,
  uiLocale: string,
): UseQueryOptions<GrowthAuditResponseDto, ApiError> {
  return {
    queryKey: growthAuditQueryKey(projectId, uiLocale),
    queryFn: () => getProjectGrowthAudit(projectId),
    enabled: projectId.length > 0,
  };
}

export function buildAuditModuleQueryOptions(
  projectId: string,
  uiLocale: string,
  moduleId: AuditModuleIdType | null | undefined,
): UseQueryOptions<AuditModuleSummaryDto, ApiError> {
  return {
    queryKey: auditModuleQueryKey(projectId, uiLocale, moduleId),
    queryFn: () => getProjectAuditModule(projectId, moduleId),
    enabled: projectId.length > 0 && Boolean(moduleId),
  };
}

/**
 * A 404 from the audit projection means no Growth Audit has ever been run for
 * the project, which is an honest `no_data` state for a read-only summary and
 * not a failure. Callers that render a summary block use this to terminate on
 * an empty state instead of a problem state; callers that own the audit screen
 * itself keep treating it as the error it is for them.
 */
export function isGrowthAuditAbsent(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function useProjectGrowthAudit(
  projectId: string,
): UseQueryResult<GrowthAuditResponseDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(buildGrowthAuditQueryOptions(projectId, uiLocale));
}

export function useProjectAuditModule(
  projectId: string,
  moduleId: AuditModuleIdType | null | undefined,
): UseQueryResult<AuditModuleSummaryDto, ApiError> {
  const uiLocale = useLocale();
  return useQuery(buildAuditModuleQueryOptions(projectId, uiLocale, moduleId));
}
