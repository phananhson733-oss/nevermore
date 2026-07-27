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
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
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
import { cursorPageUrl, nextCursorPageParam } from "@/lib/api/cursor-pages";
import type { Artifact } from "@/lib/api/hooks-studio";

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
    | "first_party_conversion"
    | "first_party_page"
    | "external_page";
  readonly ref: string;
  readonly label: string;
  readonly url: string | null;
  readonly availability: "available" | "partial" | "unavailable";
  readonly authorityTier: "A" | "B" | "C";
  readonly capturedAt: string | null;
  readonly contentHash: string | null;
  readonly contentHashMethod:
    | "sha256_canonical_extract"
    | "sha256_normalized_text"
    | null;
  readonly contentTruncated: boolean;
  readonly excerpt: string | null;
  readonly excerptTruncated: boolean;
  readonly metrics: {
    readonly status: number | null;
    readonly contentType: string | null;
    readonly bodyBytes: number | null;
    readonly wordCount: number | null;
    readonly responseMs: number | null;
    readonly redirectChain: readonly string[];
  } | null;
  readonly evidenceRefs: readonly string[];
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
  readonly revisionHistory: readonly {
    readonly revision: number;
    readonly contentHash: string;
    readonly generatedBy: string;
    readonly editorId: string | null;
    readonly note: string | null;
    readonly validationErrorCount: number;
    readonly createdAt: string;
  }[];
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

export interface ContentShadowFirstPartyPageSnapshotIdentity {
  readonly pageSnapshotId: string;
  readonly dataSnapshotId: string;
  readonly url: string;
  readonly urlHash: string;
  readonly contentHash: string;
  readonly capturedAt: string;
}

export interface ContentShadowKeywordFact {
  readonly id: string;
  readonly display: string;
  readonly market: string;
  readonly language: string;
  readonly intent: string | null;
  readonly buyerStage: string | null;
  readonly cluster: string | null;
  readonly mapping: {
    readonly decision: "unassigned" | "existing_page" | "new_asset";
    readonly mappedSitePageId: string | null;
    readonly reviewState: "unreviewed" | "confirmed";
    readonly revision: number;
  };
  readonly lastSeen: string;
  readonly evidenceRefs: readonly string[];
}

export interface ContentShadowCompetitorFact {
  readonly id: string;
  readonly domain: string;
  readonly name: string | null;
  readonly status: "candidate" | "approved" | "excluded";
  readonly relationship:
    | "direct"
    | "indirect"
    | "status_quo"
    | "benchmark"
    | "publisher"
    | null;
  readonly scopes: readonly (
    | "positioning"
    | "product_capability"
    | "keyword_gap"
    | "content"
    | "serp_visibility"
  )[];
  readonly revision: number;
}

export interface ContentShadowResearchContext {
  readonly firstPartyPageSnapshots: readonly ContentShadowFirstPartyPageSnapshotIdentity[];
  readonly searchKeywordFacts: readonly ContentShadowKeywordFact[];
  readonly generativeKeywordFacts: readonly ContentShadowKeywordFact[];
  readonly competitorFacts: readonly ContentShadowCompetitorFact[];
  readonly externalTargets: readonly {
    readonly ref: string;
    readonly kind: string;
    readonly url: string;
    readonly label: string;
  }[];
  readonly contentPolicy: {
    readonly brandConstraints: readonly string[];
    readonly complianceConstraints: readonly string[];
    readonly prohibitedTerms: readonly string[];
    readonly claimRestrictions: readonly string[];
  };
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
  readonly researchContext: ContentShadowResearchContext;
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

/**
 * One artifact revision, read by number.
 *
 * The side-by-side review reads the brief revision this run FROZE, not the
 * brief's current text: the draft was written against the frozen one, and
 * comparing against a brief that has since moved would let a reviewer credit or
 * fault the draft for words it never saw.
 */
export function useArtifactRevision(
  projectId: string,
  artifactId: string | null,
  revision: number | null,
): UseQueryResult<Artifact, ApiError> {
  return useQuery({
    queryKey: ["artifact-revision", projectId, artifactId, revision],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<Artifact>>(
        `/projects/${projectId}/artifacts/${artifactId}?revision=${revision}`,
      );
      return res.data;
    },
    enabled:
      projectId.length > 0 &&
      artifactId !== null &&
      artifactId.length > 0 &&
      revision !== null &&
      revision >= 1,
  });
}

export interface ContentShadowReviewRequest {
  readonly baseRevision: number;
  readonly acknowledgeFindings?: boolean;
}

export interface ContentShadowReviewReceipt {
  readonly flowShadowRunId: string;
  readonly artifactId: string;
  readonly reviewedRevision: number;
  readonly artifactStatus: ContentShadowDraft["status"];
  readonly verdict: ContentShadowQaVerdict;
  readonly claimCounts: {
    readonly passed: number;
    readonly failed: number;
    readonly unevaluated: number;
  };
  readonly contentHash: string;
  readonly reviewedAt: string;
  /** Only ever `"none"`; the negative is a field, not a sentence. */
  readonly externalPublishingWrite: "none";
}

/**
 * Record a human review of the draft revision this run produced.
 *
 * `baseRevision` is not optimistic-concurrency plumbing here, it is the point:
 * it names the revision the reviewer read. A 409 must be surfaced as a refusal
 * with nothing written — never retried against the newer revision, which would
 * record a review of text the person never saw.
 */
export function useReviewContentShadowRevision(
  projectId: string,
  flowShadowRunId: string | null,
): UseMutationResult<
  ContentShadowReviewReceipt,
  ApiError,
  ContentShadowReviewRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ContentShadowReviewRequest) => {
      const res = await apiSend<DataEnvelope<ContentShadowReviewReceipt>>(
        "POST",
        `/projects/${projectId}/content-shadow-runs/${flowShadowRunId}/review`,
        { body },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["content-shadow-run", projectId, flowShadowRunId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["artifacts", projectId],
      });
    },
  });
}
