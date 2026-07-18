"use client";

/**
 * Report + Export TanStack Query hooks (spec §4.2, §10.4, §10.5). Kept in a
 * dedicated module (not the WP1 `hooks.ts`) so the WP4 Report/Export surface
 * stays additive. TanStack Query owns server-state; it is never copied into a
 * hand-rolled global store (spec §3.2). Each query hook unwraps the `{ data }`
 * envelope so consumers read the entity directly.
 *
 * The DTOs below are hand-authored to mirror the OpenAPI `Report`, `ExportBundle`,
 * `AsyncRun`, `Finding`, `Action`, and `Artifact` schemas (the endpoint contract
 * is the authority). Fields are `readonly`: fetched server state is cached and
 * must never be mutated in place (repo convention: 一切不可变).
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiGet, apiSend, type ApiError } from "./client";
import type { Coverage, DataEnvelope, Project } from "./types";

// ------------------------------------------------------------- Enum unions ---

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type RunKind = "collection" | "diagnostic" | "artifact_generation" | "export";
export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low" | "inconclusive";
export type PriorityBand = "critical" | "high" | "medium" | "low";
export type RoadmapLane = "now" | "next" | "later";
export type ActionStatus =
  | "candidate"
  | "planned"
  | "in_progress"
  | "blocked"
  | "done"
  | "dismissed";
export type ArtifactType = "content_brief" | "metadata_rewrite" | "technical_ticket";
export type ArtifactStatus = "generating" | "draft" | "ready" | "failed" | "archived";
export type FindingReviewState =
  | "unreviewed"
  | "confirmed"
  | "ignored"
  | "needs_more_data";
export type ExportKind = "service_bundle" | "client_bundle";
export type EvidenceGrade = "A" | "B" | "C";

// -------------------------------------------------------------------- DTOs ---

/** A concrete subject an evidence/finding is about (OpenAPI `SubjectRef`). */
export interface SubjectRef {
  readonly type: string;
  readonly value: string;
}

/** A single evidence record backing a finding (OpenAPI `Evidence`, minimal). */
export interface Evidence {
  readonly id: string;
  readonly sourceProvider: string;
  readonly grade: EvidenceGrade;
  readonly availability: "available" | "partial" | "unavailable";
  readonly support: "supports" | "contradicts" | "context";
  readonly claim: string;
  readonly limitation: string;
  readonly subjectRefs: readonly SubjectRef[];
  readonly observedAt: string;
}

/** A confirmed diagnostic finding (OpenAPI `Finding`, minimal). */
export interface Finding {
  readonly id: string;
  readonly ruleId: string;
  readonly domain: string;
  readonly titleKey: string;
  readonly summary: string;
  readonly summaryLocale: string;
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly reviewState: FindingReviewState;
  readonly active: boolean;
  readonly subjectRefs: readonly SubjectRef[];
  readonly evidence: readonly Evidence[];
}

/** A remediation action on the roadmap (OpenAPI `Action`, minimal). */
export interface Action {
  readonly id: string;
  readonly findingId: string;
  readonly title: string;
  readonly description: string;
  readonly contentLocale: string;
  readonly priorityBand: PriorityBand;
  readonly roadmapLane: RoadmapLane;
  readonly status: ActionStatus;
  readonly effort: "small" | "medium" | "large";
  readonly risk: "low" | "medium" | "high";
  readonly expectedOutcome: string;
}

/** An execution artifact projection (OpenAPI `Artifact`, minimal). */
export interface Artifact {
  readonly id: string;
  readonly actionId: string;
  readonly artifactType: ArtifactType;
  readonly status: ArtifactStatus;
  readonly outputLocale: string;
  readonly currentRevision: number;
  readonly validationState: "pending" | "valid" | "invalid";
  readonly updatedAt: string;
}

/** Progress payload carried by an in-flight run (OpenAPI `AsyncRun.progress`). */
export interface AsyncRunProgress {
  readonly phase: string;
  readonly current: number;
  readonly total: number | null;
  readonly messageKey: string;
}

/** A terminal run failure summary (OpenAPI `AsyncRun.lastError`). */
export interface AsyncRunError {
  readonly code: string;
  readonly summary: string;
}

/** A pointer to a domain resource produced by a run. */
export interface ResourceRef {
  readonly type: string;
  readonly id: string;
}

/** An async job projection (OpenAPI `AsyncRun`). */
export interface AsyncRun {
  readonly id: string;
  readonly projectId: string;
  readonly kind: RunKind;
  readonly status: RunStatus;
  readonly progress: AsyncRunProgress;
  readonly lastError: AsyncRunError | null;
  readonly resultRef: ResourceRef | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/** A versioned export bundle projection (OpenAPI `ExportBundle`). */
export interface ExportBundle {
  readonly id: string;
  readonly kind: ExportKind;
  readonly schemaVersion: string;
  readonly outputLocale: string;
  readonly run: AsyncRun;
  readonly checksum: string | null;
  readonly itemCounts: Readonly<Record<string, number>>;
  readonly downloadUrl: string | null;
  readonly downloadExpiresAt: string | null;
  readonly createdAt: string;
}

/** The client-facing report projection (OpenAPI `Report`). */
export interface Report {
  readonly project: Project;
  readonly outputLocale: string;
  readonly generatedAt: string;
  readonly coverage: Coverage;
  readonly findings: readonly Finding[];
  readonly actions: readonly Action[];
  readonly artifacts: readonly Artifact[];
  readonly methodology: string;
  readonly limitations: readonly string[];
}

/** Body for `POST /projects/{id}/exports` (OpenAPI `CreateExportRequest`). */
export interface CreateExportInput {
  readonly kind: ExportKind;
  readonly outputLocale: string;
}

/** The `202` accepted envelope for a queued export (OpenAPI `AsyncAcceptedResponse`). */
export interface AsyncAcceptedData {
  readonly run: AsyncRun;
  readonly statusUrl: string;
  readonly resourceRef: ResourceRef | null;
}

// ------------------------------------------------------------ Poll helpers ---

const TERMINAL_STATUSES: readonly RunStatus[] = [
  "completed",
  "partial",
  "failed",
  "cancelled",
];

/** A run is done when queued/running is behind it (spec §11.1: 终态停止). */
export function isTerminalRun(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Polling cadence per spec §11.1: 1s → 2s → 4s, then a steady 5s. */
const POLL_BACKOFF_MS = [1000, 2000, 4000] as const;
const POLL_STEADY_MS = 5000;

// ------------------------------------------------------------------ Hooks ---

/**
 * Read the client report projection (spec §10.4). `outputLocale` selects the
 * report *content* language independently of the UI locale; omitting it lets the
 * server fall back to the project's delivery locale. `keepPreviousData` keeps the
 * current report on screen while a locale switch refetches (no loading flash).
 */
export function useProjectReport(
  projectId: string,
  outputLocale?: string,
): UseQueryResult<Report, ApiError> {
  return useQuery({
    queryKey: ["report", projectId, outputLocale ?? null],
    queryFn: async () => {
      const suffix = outputLocale
        ? `?outputLocale=${encodeURIComponent(outputLocale)}`
        : "";
      const res = await apiGet<DataEnvelope<Report>>(
        `/projects/${projectId}/report${suffix}`,
      );
      return res.data;
    },
    enabled: projectId.length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * Queue a versioned export (spec §10.5). Generates a fresh `Idempotency-Key` per
 * attempt (mirrors `useCreateProject`) and returns the `202` payload; the caller
 * reads `resourceRef.id` to poll the resulting bundle.
 */
export function useCreateExport(
  projectId: string,
): UseMutationResult<AsyncAcceptedData, ApiError, CreateExportInput> {
  return useMutation({
    mutationFn: async (body: CreateExportInput) => {
      const res = await apiSend<DataEnvelope<AsyncAcceptedData>>(
        "POST",
        `/projects/${projectId}/exports`,
        { body, idempotencyKey: crypto.randomUUID() },
      );
      return res.data;
    },
  });
}

/**
 * Read an export bundle, polling until the run is terminal (spec §11.1). The
 * cadence is 1s → 2s → 4s → steady 5s, derived from the per-query update count so
 * it resets naturally when `exportId` changes. `refetchIntervalInBackground` is
 * left false so polling pauses while the tab is hidden. When completed the bundle
 * carries a 15-minute signed `downloadUrl` + `downloadExpiresAt`.
 */
export function useProjectExport(
  projectId: string,
  exportId: string,
): UseQueryResult<ExportBundle, ApiError> {
  return useQuery({
    queryKey: ["export", projectId, exportId],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<ExportBundle>>(
        `/projects/${projectId}/exports/${exportId}`,
      );
      return res.data;
    },
    enabled: projectId.length > 0 && exportId.length > 0,
    refetchInterval: (query) => {
      const bundle = query.state.data;
      if (bundle !== undefined && isTerminalRun(bundle.run.status)) return false;
      const idx = Math.max(0, query.state.dataUpdateCount - 1);
      return POLL_BACKOFF_MS[idx] ?? POLL_STEADY_MS;
    },
    refetchIntervalInBackground: false,
  });
}
