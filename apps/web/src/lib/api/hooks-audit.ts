"use client";

/**
 * Growth Audit TanStack Query v5 hook over the typed API client. A Growth Audit
 * freezes URL/ICP/snapshot inputs and queues a versioned full audit; the caller
 * polls the returned run with {@link useProjectRun}. Hard-gate failures (422
 * CONTEXT_INCOMPLETE / CRAWL_SNAPSHOT_REQUIRED, 409 RUN_ALREADY_ACTIVE) surface
 * as a typed `ApiError` for the screen to translate.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { apiSend, type ApiError } from "./client";
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
): UseMutationResult<GrowthAuditRunAccepted, ApiError, CreateGrowthAuditRunRequest> {
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
