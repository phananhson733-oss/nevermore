"use client";

/**
 * Content Shadow read hooks (Slice 2 Task 7).
 *
 * Two reads, and the split is the contract's, not a convenience: the index
 * carries no run state at all, so the screen has to ask for the detail before
 * it can say anything about a phase, a verdict or a research pack. That is what
 * keeps a list page from reporting a lifecycle nobody read.
 *
 * DTOs mirror the OpenAPI `ContentShadowRunSummary` / `ContentShadowRunResponse`
 * schemas and are hand-kept alongside the other Studio hooks.
 */

import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  apiGet,
  type ApiError,
  type DataEnvelope,
  type ListEnvelope,
} from "@/lib/api";
import { cursorPageUrl, nextCursorPageParam } from "@/lib/api/cursor-pages";

export type ContentShadowPhase =
  | "queued"
  | "research"
  | "draft"
  | "qa"
  | "complete"
  | "failed";

export type ContentShadowRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type ContentShadowQaVerdict = "passed" | "needs_review" | "blocked";
export type ContentShadowQaSeverity = "blocking" | "review" | "advisory";
export type ContentShadowQaStatus = "passed" | "failed" | "unevaluated";
export type ContentShadowQaKind =
  | "red_line"
  | "structure"
  | "citability"
  | "coverage";

export interface ContentShadowRunSource {
  readonly findingId: string;
  readonly actionId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
}

/** One row of the index. Deliberately state-free — see the OpenAPI note. */
export interface ContentShadowRunSummary {
  readonly flowShadowRunId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly asyncRunId: string;
  readonly contentHash: string;
  readonly projectionVersion: string;
  readonly flowAdapterVersion: string;
  readonly outputLocale: string;
  readonly createdAt: string;
  readonly source: ContentShadowRunSource;
}

export interface ContentShadowQaClaim {
  readonly claimId: string;
  readonly kind: ContentShadowQaKind;
  readonly severity: ContentShadowQaSeverity;
  readonly status: ContentShadowQaStatus;
  readonly detail: string;
}

export interface ContentShadowQaGate {
  readonly gateId: string;
  readonly verdict: ContentShadowQaVerdict;
  readonly evaluatedArtifactId: string;
  readonly evaluatedRevision: number;
  readonly claims: readonly ContentShadowQaClaim[];
  readonly evaluatedAt: string;
}

export interface ContentShadowAuthoritySource {
  readonly kind:
    | "content_brief"
    | "search_query"
    | "generative_query"
    | "competitor"
    | "first_party_site"
    | "first_party_conversion";
  readonly ref: string;
  readonly authorityTier: "A" | "B" | "C" | "D";
  readonly limitation: string | null;
}

export interface ContentShadowResearch {
  readonly packId: string;
  readonly sources: readonly ContentShadowAuthoritySource[];
  readonly limitations: readonly string[];
  readonly generatedAt: string;
}

export interface ContentShadowDraft {
  readonly artifactId: string;
  readonly status: "generating" | "draft" | "ready" | "failed" | "archived";
  readonly currentRevision: number;
  readonly contentText: string | null;
}

export interface ContentShadowBriefOutline {
  readonly briefSections: readonly string[];
  readonly targetKeywords: readonly string[];
  readonly pageAssignment:
    | "existing_page"
    | "new_asset"
    | "mixed"
    | "unassigned";
}

export interface ContentShadowFrozenInputs {
  readonly primaryFindingId: string;
  readonly sourceDiagnosticRunId: string;
  readonly competitorEntityIds: readonly string[];
  readonly searchCluster: {
    readonly clusterKey: string;
    readonly keywordEntityIds: readonly string[];
  };
  readonly generativeQueryEntityIds: readonly string[];
  readonly firstParty: {
    readonly siteOrigin: string;
    readonly icpPrimaryConversionUrl: string | null;
  };
  readonly contentBriefOutline: ContentShadowBriefOutline;
}

export interface ContentShadowRun {
  readonly flowShadowRunId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly asyncRunId: string;
  readonly status: ContentShadowRunStatus;
  readonly phase: ContentShadowPhase;
  readonly contentHash: string;
  readonly projectionVersion: string;
  readonly flowAdapterVersion: string;
  readonly outputLocale: string;
  readonly createdAt: string;
  readonly source: ContentShadowRunSource;
  readonly frozenInputs: ContentShadowFrozenInputs;
  readonly research: ContentShadowResearch | null;
  readonly draft: ContentShadowDraft | null;
  readonly qa: ContentShadowQaGate | null;
}

/** The project's Content Shadow runs, newest first, as bounded cursor pages. */
export function useContentShadowRuns(
  projectId: string,
): UseInfiniteQueryResult<
  InfiniteData<ListEnvelope<ContentShadowRunSummary>, string | null>,
  ApiError
> {
  return useInfiniteQuery({
    queryKey: ["content-shadow-runs", projectId],
    queryFn: ({ pageParam }) =>
      apiGet<ListEnvelope<ContentShadowRunSummary>>(
        cursorPageUrl(`/projects/${projectId}/content-shadow-runs`, pageParam),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursorPageParam,
    enabled: projectId.length > 0,
  });
}

/**
 * One run's full projection. Polls while the run is still moving; a run whose
 * phase is terminal is read once and left alone.
 */
export function useContentShadowRun(
  projectId: string,
  flowShadowRunId: string | null,
): UseQueryResult<ContentShadowRun, ApiError> {
  return useQuery({
    queryKey: ["content-shadow-run", projectId, flowShadowRunId],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<ContentShadowRun>>(
        `/projects/${projectId}/content-shadow-runs/${flowShadowRunId}`,
      );
      return res.data;
    },
    enabled:
      projectId.length > 0 &&
      flowShadowRunId !== null &&
      flowShadowRunId.length > 0,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const phase = query.state.data?.phase;
      if (phase === undefined) return 2000;
      return phase === "complete" || phase === "failed" ? false : 4000;
    },
    refetchIntervalInBackground: false,
  });
}
