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
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseMutationResult,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiGet, apiSend, type ApiError } from "./client";
import type { Coverage, DataEnvelope, ListEnvelope } from "./types";
import {
  collectAllCursorItems,
  cursorPageUrl,
  nextCursorPageParam,
  uniqueCursorItems,
} from "./cursor-pages";

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
export type EvidenceSupport = "supports" | "contradicts" | "context";
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
export type EvidenceSourceProvider = Provider | "system" | "llm";

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
  readonly sourceProvider: EvidenceSourceProvider;
  readonly origin: string;
  readonly method: string;
  readonly grade: EvidenceGrade;
  readonly availability: Availability;
  readonly support: EvidenceSupport;
  readonly claim: string;
  readonly subjectRefs: readonly SubjectRef[];
  readonly observedAt: string;
  readonly limitation: string;
  readonly snapshotId: string | null;
  readonly analysisInvocationId: string | null;
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
  readonly siteId: string;
  readonly provider: Provider;
  readonly datasetKey: string;
  readonly methodVersion: string;
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
const CURRENT_DIAGNOSTIC_CRAWL_METHOD_VERSION = "crawl.site_graph.v2";
const DIAGNOSTIC_PROVIDER_ORDER: readonly Provider[] = [
  "crawl",
  "gsc",
  "ga4",
  "csv",
  "dataforseo",
];

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
 * The snapshot ids a diagnostic run should freeze. The newest usable snapshot
 * produced by the current crawl method determines the exact Site; every other
 * provider is then selected only from that Site. CSV and DataForSEO may coexist:
 * each prefers its latest usable snapshot, falling back to its latest
 * unavailable snapshot when needed to preserve coverage lineage. Returning an
 * empty selection when no current crawl exists keeps the UI aligned with the
 * server's `CRAWL_SNAPSHOT_REQUIRED` hard gate.
 */
export function selectLatestSnapshotIds(
  snapshots: readonly DataSnapshot[],
): readonly string[] {
  const currentCrawl = latestSnapshot(
    snapshots.filter(isCurrentUsableCrawlSnapshot),
  );
  if (currentCrawl === undefined) return [];

  const selected: DataSnapshot[] = [currentCrawl];
  const siteSnapshots = snapshots.filter(
    (snapshot) => snapshot.siteId === currentCrawl.siteId,
  );

  for (const provider of DIAGNOSTIC_PROVIDER_ORDER) {
    if (provider === "crawl") continue;
    const providerSnapshots = siteSnapshots.filter(
      (snapshot) => snapshot.provider === provider,
    );
    const candidates =
      provider === "csv" || provider === "dataforseo"
        ? usableSnapshotsOrAll(providerSnapshots)
        : providerSnapshots;
    const latest = latestSnapshot(candidates);
    if (latest !== undefined) selected.push(latest);
  }

  return selected.map((snapshot) => snapshot.id);
}

function isUsableSnapshot(snapshot: DataSnapshot): boolean {
  return (
    snapshot.availability === "available" || snapshot.availability === "partial"
  );
}

function isCurrentUsableCrawlSnapshot(snapshot: DataSnapshot): boolean {
  return (
    snapshot.provider === "crawl" &&
    snapshot.methodVersion === CURRENT_DIAGNOSTIC_CRAWL_METHOD_VERSION &&
    isUsableSnapshot(snapshot)
  );
}

function usableSnapshotsOrAll(
  snapshots: readonly DataSnapshot[],
): readonly DataSnapshot[] {
  const usable = snapshots.filter(isUsableSnapshot);
  return usable.length > 0 ? usable : snapshots;
}

function latestSnapshot(
  snapshots: readonly DataSnapshot[],
): DataSnapshot | undefined {
  let latest: DataSnapshot | undefined;
  for (const snapshot of snapshots) {
    if (
      latest === undefined ||
      snapshot.capturedAt > latest.capturedAt ||
      (snapshot.capturedAt === latest.capturedAt && snapshot.id < latest.id)
    ) {
      latest = snapshot;
    }
  }
  return latest;
}

/** Whether a usable current crawl can anchor a single-Site diagnosis. */
export function hasCrawlSnapshot(snapshots: readonly DataSnapshot[]): boolean {
  return snapshots.some(isCurrentUsableCrawlSnapshot);
}

/**
 * Merge loaded findings while keeping the first page's run/coverage/rule-board
 * sidecar canonical. Later pages contribute findings and current pagination
 * fields only; they cannot replace the run/coverage/rule projection that
 * described the list read which opened the screen.
 */
export function mergeFindingPages(
  data: InfiniteData<FindingListEnvelope, string | null> | undefined,
): FindingListEnvelope | undefined {
  const pages = data?.pages;
  if (pages === undefined) return undefined;
  const first = pages[0];
  if (first === undefined) return undefined;
  const last = pages.at(-1) ?? first;
  return {
    data: uniqueCursorItems(data),
    meta: {
      ...first.meta,
      nextCursor: last.meta.nextCursor,
      hasNext: last.meta.hasNext,
    },
  };
}

/* ---------------------------------------------------------------- hooks ---- */

/**
 * List findings with their run/coverage/rule-board sidecar. Each bounded page
 * keeps its `{ data, meta }` envelope; {@link mergeFindingPages} preserves the
 * first canonical sidecar while combining the loaded finding rows.
 */
export function useProjectFindings(
  projectId: string,
): UseInfiniteQueryResult<
  InfiniteData<FindingListEnvelope, string | null>,
  ApiError
> {
  return useInfiniteQuery({
    queryKey: ["findings", projectId],
    queryFn: ({ pageParam }) =>
      apiGet<FindingListEnvelope>(
        cursorPageUrl(`/projects/${projectId}/findings`, pageParam),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursorPageParam,
    enabled: projectId.length > 0,
  });
}

/**
 * Load the complete immutable snapshot chain before selecting diagnostic input.
 * The list cursor is ordered by persistence time, while diagnosis chooses by
 * `capturedAt`; exhausting every bounded page is therefore the only client-side
 * way to prove that no provider's newest captured snapshot was omitted.
 */
export function useProjectSnapshots(
  projectId: string,
): UseQueryResult<readonly DataSnapshot[], ApiError> {
  return useQuery({
    queryKey: ["snapshots", projectId, "complete-for-diagnosis"],
    queryFn: () =>
      collectAllCursorItems((cursor) =>
        apiGet<ListEnvelope<DataSnapshot>>(
          cursorPageUrl(`/projects/${projectId}/snapshots`, cursor),
        ),
      ),
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
      // Stop polling if the status query itself errors (401/404/5xx) — otherwise
      // dataUpdateCount stays 0 and the 1s poll would loop forever (spec §11.1).
      if (query.state.status === "error") return false;
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
