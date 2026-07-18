"use client";

/**
 * Diagnosis-screen TanStack Query v5 hooks over the typed API client (spec §4.2,
 * §8, §9.1). TanStack Query owns server-state; it is never copied into a
 * hand-rolled global store (spec §3.2). These DTOs are hand-authored and mirror
 * the OpenAPI `Finding` / `Evidence` / `DiagnosticRuleResult` / `AsyncRun` /
 * `DataSnapshot` / `Action` schemas — fields are `readonly` because fetched
 * server state is cached and must never be mutated in place.
 *
 * Kept separate from `./hooks` so the diagnosis surface can evolve without
 * touching the WP0/WP1 hook file (which is a shared contract owner).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiGet, apiSend, type ApiError } from "./client";
import type { Coverage, DataEnvelope, ListEnvelope } from "./types";

/* --------------------------------------------------------------- enums ----- */

export type DiagnosticDomain =
  | "technical_seo"
  | "search_performance"
  | "content_intent"
  | "conversion_journey"
  | "geo_ai";

export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low" | "inconclusive";
export type FindingReviewState =
  | "unreviewed"
  | "confirmed"
  | "ignored"
  | "needs_more_data";
export type EvidenceGrade = "A" | "B" | "C";
export type Availability = "available" | "partial" | "unavailable";
export type RuleStatus = "pass" | "candidate" | "skipped" | "inconclusive";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type RunKind = "collection" | "diagnostic" | "artifact_generation" | "export";
export type Provider = "crawl" | "gsc" | "ga4" | "csv" | "dataforseo";

/* ----------------------------------------------------------------- DTOs ---- */

/** A resource a finding or its evidence points at (URL, keyword cluster, …). */
export interface SubjectRef {
  readonly type: string;
  readonly value: string;
}

/** One evidence row backing a finding. `availability` is honest — an
 * unavailable measure is `"unavailable"`, never coerced to 0 (spec §1.3). */
export interface Evidence {
  readonly id: string;
  readonly sourceProvider: string;
  readonly origin: string;
  readonly method: string;
  readonly grade: EvidenceGrade;
  readonly availability: Availability;
  readonly support: string;
  readonly claim: string;
  readonly subjectRefs: readonly SubjectRef[];
  readonly observedAt: string;
  readonly limitation: string;
}

/** A diagnostic finding with its evidence summary (OpenAPI `Finding`). */
export interface Finding {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly domain: DiagnosticDomain;
  readonly titleKey: string;
  readonly titleArgs: Record<string, unknown>;
  readonly summary: string;
  readonly summaryLocale: string;
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly reviewState: FindingReviewState;
  readonly reviewRevision: number;
  readonly active: boolean;
  readonly regressed: boolean;
  readonly subjectRefs: readonly SubjectRef[];
  readonly evidence: readonly Evidence[];
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly resolvedAt: string | null;
}

/**
 * The per-rule outcome of a run (OpenAPI `DiagnosticRuleResult`). `status`
 * distinguishes a healthy `pass` (no finding) from a `skipped` / `inconclusive`
 * rule that never produced a verdict — the UI must never render the latter as
 * "healthy" (spec §8: honest coverage).
 */
export interface DiagnosticRuleResult {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly domain: DiagnosticDomain;
  readonly status: RuleStatus;
  readonly reason: string | null;
  readonly durationMs: number;
}

export interface RunProgress {
  readonly phase: string;
  readonly current: number;
  readonly total: number | null;
  readonly messageKey: string;
}

export interface RunError {
  readonly code: string;
  readonly summary: string;
}

export interface RunResourceRef {
  readonly type: string;
  readonly id: string;
}

/** A queued/running/terminal async run projection (OpenAPI `AsyncRun`). */
export interface AsyncRun {
  readonly id: string;
  readonly projectId: string;
  readonly kind: RunKind;
  readonly status: RunStatus;
  readonly progress: RunProgress;
  readonly lastError: RunError | null;
  readonly resultRef: RunResourceRef | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/** Findings-list pagination + run/coverage/rule-board sidecar (OpenAPI `FindingListMeta`). */
export interface FindingListMeta {
  readonly nextCursor: string | null;
  readonly hasNext: boolean;
  readonly limit: number;
  readonly latestRun: AsyncRun | null;
  readonly coverage: Coverage | null;
  readonly ruleResults: readonly DiagnosticRuleResult[];
}

export interface FindingListEnvelope {
  readonly data: readonly Finding[];
  readonly meta: FindingListMeta;
}

/** An immutable data snapshot the run reads from (OpenAPI `DataSnapshot`). */
export interface DataSnapshot {
  readonly id: string;
  readonly provider: Provider;
  readonly datasetKey: string;
  readonly capturedAt: string;
  readonly availability: Availability;
  readonly limitation: string;
  readonly rowCount: number;
}

/** An action idempotently created when a finding is confirmed (OpenAPI `Action`). */
export interface Action {
  readonly id: string;
  readonly findingId: string;
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly contentLocale: string;
  readonly priorityBand: Severity;
  readonly roadmapLane: "now" | "next" | "later";
  readonly status: string;
  readonly effort: "small" | "medium" | "large";
  readonly risk: "low" | "medium" | "high";
  readonly expectedOutcome: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ----------------------------------------------------- request/response ---- */

export interface CreateDiagnosticRunRequest {
  readonly snapshotIds: readonly string[];
  readonly outputLocale: string;
}

export interface DiagnosticRunAccepted {
  readonly run: AsyncRun;
  readonly statusUrl: string;
  readonly resourceRef: RunResourceRef | null;
}

/** Discriminated review body — each branch carries exactly what the server requires. */
export type ReviewFindingRequest =
  | { readonly reviewState: "confirmed"; readonly baseRevision: number; readonly note?: string }
  | { readonly reviewState: "ignored"; readonly baseRevision: number; readonly reason: string }
  | { readonly reviewState: "needs_more_data"; readonly baseRevision: number; readonly note: string };

export interface ReviewFindingResult {
  readonly finding: Finding;
  readonly action: Action | null;
}

export interface ReviewFindingVars {
  readonly findingId: string;
  readonly body: ReviewFindingRequest;
}

/* -------------------------------------------------------------- helpers ---- */

/** Poll cadence for a diagnostic run (spec §9.1): 1s → 2s → 4s → 5s (then holds). */
const POLL_SCHEDULE = [1000, 2000, 4000, 5000] as const;

/** A run is terminal once it can no longer transition (no more polling needed). */
export function isRunTerminal(status: RunStatus): boolean {
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "cancelled"
  );
}

/**
 * The snapshot ids a diagnostic run should freeze: the latest snapshot per
 * provider (by `capturedAt`). The crawl snapshot is included when present; the
 * server rejects a run without one (422 `CRAWL_SNAPSHOT_REQUIRED`).
 */
export function selectLatestSnapshotIds(
  snapshots: readonly DataSnapshot[],
): readonly string[] {
  const latest = new Map<Provider, DataSnapshot>();
  for (const snapshot of snapshots) {
    const current = latest.get(snapshot.provider);
    if (current === undefined || snapshot.capturedAt > current.capturedAt) {
      latest.set(snapshot.provider, snapshot);
    }
  }
  return Array.from(latest.values(), (snapshot) => snapshot.id);
}

/** Whether the project has at least one crawl snapshot (a diagnosis precondition). */
export function hasCrawlSnapshot(snapshots: readonly DataSnapshot[]): boolean {
  return snapshots.some((snapshot) => snapshot.provider === "crawl");
}

/* ---------------------------------------------------------------- hooks ---- */

/**
 * List findings with their run/coverage/rule-board sidecar. The full
 * `{ data, meta }` envelope is returned so the screen can read `meta.latestRun`,
 * `meta.coverage`, and `meta.ruleResults` alongside the findings.
 */
export function useProjectFindings(
  projectId: string,
): UseQueryResult<FindingListEnvelope, ApiError> {
  return useQuery({
    queryKey: ["findings", projectId],
    queryFn: () =>
      apiGet<FindingListEnvelope>(`/projects/${projectId}/findings`),
    enabled: projectId.length > 0,
  });
}

/** List immutable snapshots — used to gather the run's `snapshotIds`. */
export function useProjectSnapshots(
  projectId: string,
): UseQueryResult<readonly DataSnapshot[], ApiError> {
  return useQuery({
    queryKey: ["snapshots", projectId],
    queryFn: async () => {
      const res = await apiGet<ListEnvelope<DataSnapshot>>(
        `/projects/${projectId}/snapshots`,
      );
      return res.data;
    },
    enabled: projectId.length > 0,
  });
}

/**
 * Queue a frozen-input diagnostic run. Generates a fresh `Idempotency-Key` per
 * attempt and returns the 202 `{ run, statusUrl, resourceRef }` accepted body.
 * The caller polls `run.id` with {@link useProjectRun}; hard-gate failures
 * (422 `CRAWL_SNAPSHOT_REQUIRED` / `CONTEXT_INCOMPLETE`, 409 `RUN_ALREADY_ACTIVE`)
 * surface as a typed `ApiError` for the screen to translate.
 */
export function useCreateDiagnosticRun(
  projectId: string,
): UseMutationResult<DiagnosticRunAccepted, ApiError, CreateDiagnosticRunRequest> {
  return useMutation({
    mutationFn: async (body: CreateDiagnosticRunRequest) => {
      const res = await apiSend<DataEnvelope<DiagnosticRunAccepted>>(
        "POST",
        `/projects/${projectId}/diagnostic-runs`,
        { body, idempotencyKey: crypto.randomUUID() },
      );
      return res.data;
    },
  });
}

/**
 * Confirm / ignore / request-more-data on a finding. Carries `baseRevision` for
 * optimistic concurrency; a 409 `VERSION_CONFLICT` surfaces as a typed
 * `ApiError` (the screen refetches + informs). On success the findings list is
 * invalidated so the finding's new review state (and any created action) reload.
 */
export function useReviewFinding(
  projectId: string,
): UseMutationResult<ReviewFindingResult, ApiError, ReviewFindingVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ findingId, body }: ReviewFindingVars) => {
      const res = await apiSend<DataEnvelope<ReviewFindingResult>>(
        "PATCH",
        `/projects/${projectId}/findings/${findingId}`,
        { body },
      );
      return res.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["findings", projectId] }),
  });
}

/**
 * Poll one run to completion with an escalating cadence (1s → 2s → 4s → 5s),
 * stopping once the run is terminal and pausing while the tab is unfocused
 * (`refetchIntervalInBackground` stays false). Disabled while `runId` is null.
 */
export function useProjectRun(
  projectId: string,
  runId: string | null,
): UseQueryResult<AsyncRun, ApiError> {
  return useQuery<AsyncRun, ApiError>({
    queryKey: ["run", projectId, runId],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<AsyncRun>>(
        `/projects/${projectId}/runs/${runId ?? ""}`,
      );
      return res.data;
    },
    enabled: projectId.length > 0 && runId !== null && runId.length > 0,
    refetchInterval: (query) => {
      const run = query.state.data;
      if (run === undefined || isRunTerminal(run.status)) return false;
      // dataUpdateCount is 1 after the first successful poll; step through the
      // schedule and hold at the last (longest) interval thereafter.
      const step = Math.min(
        Math.max(query.state.dataUpdateCount - 1, 0),
        POLL_SCHEDULE.length - 1,
      );
      return POLL_SCHEDULE[step] ?? 5000;
    },
  });
}
