"use client";

/**
 * Studio (execution artifacts) TanStack Query hooks over the typed API client
 * (spec §4.2, §10.1, §10.3). Server-state is owned by TanStack Query and never
 * copied into a hand-rolled store (spec §3.2). Local `readonly` DTOs mirror the
 * OpenAPI `Artifact`, `ArtifactRevision`, `Action`, and `AsyncRun` schemas; the
 * endpoint contract is the authority (these are hand-kept, not generated, so the
 * Studio screen stays decoupled from `@sf/contracts`).
 *
 * This module lives alongside `hooks.ts` but is kept separate so the shared
 * client module (`lib/api/{client,hooks,types}`) is not touched.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  apiGet,
  apiSend,
  type ApiError,
  type DataEnvelope,
  type ListEnvelope,
} from "@/lib/api";

// --------------------------------------------------------------- DTOs --------

export type ArtifactType =
  | "content_brief"
  | "metadata_rewrite"
  | "technical_ticket";
export type ArtifactStatus =
  | "generating"
  | "draft"
  | "ready"
  | "failed"
  | "archived";
export type GenerationMode = "template" | "structured_llm";
export type ContentFormat = "markdown" | "json" | "csv";
export type ValidationState = "pending" | "valid" | "invalid";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type ActionStatus =
  | "candidate"
  | "planned"
  | "in_progress"
  | "blocked"
  | "done"
  | "dismissed";
export type PriorityBand = "critical" | "high" | "medium" | "low";
export type RoadmapLane = "now" | "next" | "later";

/** Revision content is a string (markdown/csv) or a JSON object (metadata). */
export type ArtifactContent = string | Record<string, unknown>;

/** An immutable artifact revision (OpenAPI `ArtifactRevision`). */
export interface ArtifactRevision {
  readonly id: string;
  readonly revision: number;
  readonly contentFormat: ContentFormat;
  readonly content: ArtifactContent;
  readonly contentHash: string;
  readonly validationErrors: readonly string[];
  readonly note: string | null;
  readonly createdAt: string;
}

export interface AsyncRunProgress {
  readonly phase: string;
  readonly current: number;
  readonly total: number | null;
  readonly messageKey: string;
}

export interface AsyncRunError {
  readonly code: string;
  readonly summary: string;
}

export interface AsyncRunResultRef {
  readonly type: "collection_run" | "diagnostic_run" | "artifact" | "export";
  readonly id: string;
}

/** An async job projection (OpenAPI `AsyncRun`). */
export interface AsyncRun {
  readonly id: string;
  readonly projectId: string;
  readonly kind: "collection" | "diagnostic" | "artifact_generation" | "export";
  readonly status: RunStatus;
  readonly progress: AsyncRunProgress;
  readonly lastError: AsyncRunError | null;
  readonly resultRef: AsyncRunResultRef | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/** An execution artifact with its current revision metadata (OpenAPI `Artifact`). */
export interface Artifact {
  readonly id: string;
  readonly actionId: string;
  readonly artifactType: ArtifactType;
  readonly status: ArtifactStatus;
  readonly generationMode: GenerationMode;
  readonly outputLocale: string;
  readonly currentRevision: number;
  readonly validationState: ValidationState;
  readonly current: ArtifactRevision | null;
  readonly activeRun: AsyncRun | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A 30/60/90 plan action (OpenAPI `Action`); artifacts are generated from it. */
export interface ArtifactAction {
  readonly id: string;
  readonly findingId: string;
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly contentLocale: string;
  readonly priorityBand: PriorityBand;
  readonly roadmapLane: RoadmapLane;
  readonly status: ActionStatus;
  readonly effort: "small" | "medium" | "large";
  readonly risk: "low" | "medium" | "high";
  readonly expectedOutcome: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The `202 Accepted` payload for a queued artifact run (OpenAPI envelope). */
export interface AsyncAcceptedData {
  readonly run: AsyncRun;
  readonly statusUrl: string;
  readonly resourceRef: AsyncRunResultRef | null;
}

export interface CreateArtifactRequest {
  readonly artifactType: ArtifactType;
  readonly generationMode: GenerationMode;
  readonly outputLocale: string;
  readonly operatorInstructions?: string | null;
}

/** A manual revision edit, or a validated status transition (OpenAPI union). */
export type UpdateArtifactRequest =
  | {
      readonly baseRevision: number;
      readonly contentFormat: ContentFormat;
      readonly content: ArtifactContent;
      readonly editorNote?: string | null;
    }
  | {
      readonly baseRevision: number;
      readonly status: "draft" | "ready" | "archived";
    };

// ------------------------------------------------ Template → artifact type ---

/**
 * The frozen ActionTemplate registry mapping (spec §10.1): each template emits
 * exactly one artifact type. `createActionArtifact` 422s (`ACTION_NOT_EXECUTABLE`)
 * when the requested `artifactType` does not match — so the UI always offers the
 * action's expected type, derived here.
 */
const TEMPLATE_ARTIFACT_TYPE: Readonly<Record<string, ArtifactType>> = {
  "fix_http_status.v1": "technical_ticket",
  "normalize_canonical.v1": "technical_ticket",
  "strengthen_internal_links.v1": "technical_ticket",
  "rewrite_search_metadata.v1": "metadata_rewrite",
  "refresh_decaying_content.v1": "content_brief",
  "create_priority_content.v1": "content_brief",
  "create_gap_content.v1": "content_brief",
  "connect_conversion_path.v1": "technical_ticket",
  "improve_landing_conversion.v1": "content_brief",
  "add_entity_and_proof.v1": "technical_ticket",
  "review_ai_crawler_access.v1": "technical_ticket",
};

/** The artifact type an action generates, or `null` for an unknown template. */
export function expectedArtifactType(action: ArtifactAction): ArtifactType | null {
  return TEMPLATE_ARTIFACT_TYPE[action.templateId] ?? null;
}

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

/** True once a run has reached a terminal state (polling should stop). */
export function isTerminalRun(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

// -------------------------------------------------------------- Hooks --------

/** List the project's execution artifacts (with current-revision metadata). */
export function useProjectArtifacts(
  projectId: string,
): UseQueryResult<ListEnvelope<Artifact>, ApiError> {
  return useQuery({
    queryKey: ["artifacts", projectId],
    queryFn: () =>
      apiGet<ListEnvelope<Artifact>>(`/projects/${projectId}/artifacts`),
    enabled: projectId.length > 0,
  });
}

/** List the project's plan actions (the source of "generate artifact"). */
export function useProjectActions(
  projectId: string,
): UseQueryResult<ListEnvelope<ArtifactAction>, ApiError> {
  return useQuery({
    queryKey: ["actions", projectId],
    queryFn: () =>
      apiGet<ListEnvelope<ArtifactAction>>(`/projects/${projectId}/actions`),
    enabled: projectId.length > 0,
  });
}

/**
 * Queue creation (or regeneration) of an artifact for one action. A fresh
 * `Idempotency-Key` is generated per attempt; the queued `AsyncRun` is returned
 * (202). On success the artifacts list is invalidated so the new `generating`
 * artifact appears immediately.
 */
export function useCreateArtifact(
  projectId: string,
  actionId: string,
): UseMutationResult<AsyncAcceptedData, ApiError, CreateArtifactRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateArtifactRequest) => {
      const res = await apiSend<DataEnvelope<AsyncAcceptedData>>(
        "POST",
        `/projects/${projectId}/actions/${actionId}/artifacts`,
        { body, idempotencyKey: crypto.randomUUID() },
      );
      return res.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["artifacts", projectId] }),
  });
}

/**
 * Create an immutable manual revision (`{ baseRevision, contentFormat, content }`)
 * or change the validated status (`{ baseRevision, status }`). Optimistic
 * concurrency rides on `baseRevision`: a 409 `STALE_REVISION` must be surfaced
 * and the list refetched; `ready` requires an empty `validationErrors` set or the
 * server 422s `ARTIFACT_VALIDATION_FAILED`.
 */
export function useUpdateArtifact(
  projectId: string,
  artifactId: string,
): UseMutationResult<Artifact, ApiError, UpdateArtifactRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateArtifactRequest) => {
      const res = await apiSend<DataEnvelope<Artifact>>(
        "PATCH",
        `/projects/${projectId}/artifacts/${artifactId}`,
        { body },
      );
      return res.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["artifacts", projectId] }),
  });
}

/** Escalating poll cadence (ms): 1s → 2s → 4s, then a 5s steady state. */
const POLL_SCHEDULE: readonly number[] = [1000, 2000, 4000];

/**
 * Poll any run until it reaches a terminal state. Cadence escalates
 * 1s → 2s → 4s → 5s; `refetchIntervalInBackground: false` pauses polling while
 * the tab is hidden. Disabled when `runId` is `null`.
 */
export function useProjectRun(
  projectId: string,
  runId: string | null,
): UseQueryResult<AsyncRun, ApiError> {
  return useQuery({
    queryKey: ["run", projectId, runId],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<AsyncRun>>(
        `/projects/${projectId}/runs/${runId}`,
      );
      return res.data;
    },
    enabled: projectId.length > 0 && runId !== null && runId.length > 0,
    refetchInterval: (query) => {
      // Stop polling if the status query itself errors (401/404/5xx) — otherwise
      // dataUpdateCount stays 0 and the 1s poll would loop forever (spec §11.1).
      if (query.state.status === "error") return false;
      const run = query.state.data;
      if (run && isTerminalRun(run.status)) return false;
      const index = query.state.dataUpdateCount - 1;
      if (index < 0) return POLL_SCHEDULE[0] ?? 1000;
      return POLL_SCHEDULE[index] ?? 5000;
    },
    refetchIntervalInBackground: false,
  });
}
