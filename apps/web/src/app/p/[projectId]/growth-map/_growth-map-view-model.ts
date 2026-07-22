import type {
  GrowthMapFindingTargetRelation,
  GrowthMapExecutionRef,
  GrowthMapUrlFinding,
  GrowthMapUrlIdentitySource,
  GrowthMapUrlMetricObservation,
} from "@sf/contracts";
import { GrowthMapExecutionRef as GrowthMapExecutionRefSchema } from "@sf/contracts";
import { ApiError } from "@/lib/api";
import type {
  ReviewFindingRequest,
  ReviewFindingVars,
} from "@/lib/api/hooks-diagnosis";

export const GROWTH_MAP_OBJECT_MODES = [
  "pages",
  "keywords",
  "competitors",
] as const;

export type GrowthMapObjectMode = (typeof GROWTH_MAP_OBJECT_MODES)[number];

export const GROWTH_MAP_DETAIL_STATES = [
  "audit_evidence",
  "opportunity_review",
] as const;

export type GrowthMapDetailState = (typeof GROWTH_MAP_DETAIL_STATES)[number];

/** Confirmation is a property of Opportunity Review, never Audit Evidence. */
export function growthMapDetailAllowsFindingReview(
  state: GrowthMapDetailState,
): boolean {
  return state === "opportunity_review";
}

export function normalizeGrowthMapObjectMode(
  value: string | null | undefined,
): GrowthMapObjectMode {
  return GROWTH_MAP_OBJECT_MODES.includes(value as GrowthMapObjectMode)
    ? (value as GrowthMapObjectMode)
    : "pages";
}

/**
 * A selected detail must always correspond to a row in the visible bounded
 * page. Stale/filter-mismatched URL state resolves to the first visible row.
 */
export function resolveVisibleSitePageSelection(
  requestedSitePageId: string | null | undefined,
  visibleSitePageIds: readonly string[],
): string | null {
  if (
    requestedSitePageId != null &&
    visibleSitePageIds.includes(requestedSitePageId)
  ) {
    return requestedSitePageId;
  }
  return visibleSitePageIds[0] ?? null;
}

/**
 * Finding deep links select their exact visible owning URL unless the user has
 * already made an explicit, valid URL choice. The caller may narrow the list
 * with the Finding's canonical URL so the owner is not hidden by pagination.
 */
export function resolveVisibleSitePageSelectionForFinding(
  requestedSitePageId: string | null | undefined,
  requestedFindingId: string | null | undefined,
  visibleItems: readonly {
    readonly sitePageId: string;
    readonly findingIds: readonly string[];
  }[],
): string | null {
  const ids = visibleItems.map((item) => item.sitePageId);
  if (
    requestedSitePageId != null &&
    ids.includes(requestedSitePageId)
  ) {
    return requestedSitePageId;
  }
  if (requestedFindingId) {
    const owner = visibleItems.find((item) =>
      item.findingIds.includes(requestedFindingId),
    );
    if (owner) return owner.sitePageId;
  }
  return ids[0] ?? null;
}

interface GrowthMapLocationPatch {
  readonly mode?: GrowthMapObjectMode;
  readonly selectedSitePageId?: string | null;
  readonly selectedFindingId?: string | null;
  readonly search?: string | null;
  readonly cursor?: string | null;
}

/**
 * Build a stable Growth Map deep link. Selecting a URL replaces the canonical
 * `selectedSitePageId` value on every click; object-mode changes intentionally
 * clear page-only state so a hidden selection never controls another view.
 */
export function growthMapLocationHref(
  pathname: string,
  currentSearch: string,
  patch: GrowthMapLocationPatch,
): string {
  const params = new URLSearchParams(currentSearch);

  if (patch.mode !== undefined) {
    if (patch.mode === "pages") params.set("object", "pages");
    else params.set("object", patch.mode);

    if (patch.mode !== "pages") {
      params.delete("q");
      params.delete("cursor");
      params.delete("selectedSitePageId");
      params.delete("findingId");
    }
  }

  if (patch.selectedSitePageId !== undefined) {
    if (patch.selectedSitePageId === null) {
      params.delete("selectedSitePageId");
    } else {
      params.set("selectedSitePageId", patch.selectedSitePageId);
    }
  }

  if (patch.selectedFindingId !== undefined) {
    if (patch.selectedFindingId === null) params.delete("findingId");
    else params.set("findingId", patch.selectedFindingId);
  }

  if (patch.search !== undefined) {
    const normalized = patch.search?.trim() ?? "";
    if (normalized === "") params.delete("q");
    else params.set("q", normalized);
  }

  if (patch.cursor !== undefined) {
    if (patch.cursor === null || patch.cursor === "") params.delete("cursor");
    else params.set("cursor", patch.cursor);
  }

  const query = params.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

export interface MetricSelector {
  readonly provider: GrowthMapUrlMetricObservation["provider"];
  readonly pointer: string;
}

/** Match only one explicit provider + persisted JSON pointer; no fallback guess. */
export function findMetricObservation(
  observations: readonly GrowthMapUrlMetricObservation[],
  selector: MetricSelector,
): GrowthMapUrlMetricObservation | null {
  return (
    observations.find(
      (observation) =>
        observation.provider === selector.provider &&
        observation.valueSource.kind === "value_json" &&
        observation.valueSource.pointer === selector.pointer,
    ) ?? null
  );
}

export type MetricPresentation =
  | { readonly state: "missing" }
  | {
      readonly state: "partial" | "unavailable";
      readonly limitation: string | null;
    }
  | {
      readonly state: "observed";
      readonly value: number;
      readonly unit: string | null;
    };

/** Missing and unavailable values remain distinct from a genuinely observed 0. */
export function metricPresentation(
  observation: GrowthMapUrlMetricObservation | null | undefined,
): MetricPresentation {
  if (observation == null) return { state: "missing" };
  if (observation.availability !== "available") {
    return {
      state: observation.availability,
      limitation: observation.limitation,
    };
  }
  if (observation.value === null) return { state: "unavailable", limitation: null };
  return {
    state: "observed",
    value: observation.value,
    unit: observation.unit,
  };
}

export type MetricValueLabelKey = "noData" | "coverage.partial";

/**
 * Customer-facing empty-state copy is deliberately coarser than provenance:
 * absent and explicitly unavailable observations both read "No data", while
 * partial data keeps its distinct warning and real numeric zero stays visible.
 */
export function metricValueLabelKey(
  presentation: Exclude<MetricPresentation, { readonly state: "observed" }>,
): MetricValueLabelKey;
export function metricValueLabelKey(
  presentation: MetricPresentation,
): MetricValueLabelKey | null;
export function metricValueLabelKey(
  presentation: MetricPresentation,
): MetricValueLabelKey | null {
  switch (presentation.state) {
    case "missing":
    case "unavailable":
      return "noData";
    case "partial":
      return "coverage.partial";
    case "observed":
      return null;
  }
}

export type GrowthMapReviewIntent =
  | { readonly reviewState: "confirmed"; readonly note?: string }
  | { readonly reviewState: "ignored"; readonly reason: string }
  | { readonly reviewState: "needs_more_data"; readonly note: string };

export type GrowthMapFindingReviewMode =
  | "idle"
  | "dismiss"
  | "needs_more_data";

export type GrowthMapReviewProblemPresentation =
  | {
      readonly kind: "canonical";
      readonly code: string;
      readonly title: string;
      readonly detail: string;
      readonly recovery: "refresh" | "resolve_active_action" | "retry";
      readonly executionRef: GrowthMapExecutionRef | null;
    }
  | {
      readonly kind: "fallback";
      readonly recovery: "retry";
      readonly executionRef: null;
    };

const CANONICAL_REVIEW_PROBLEM_CODES: ReadonlySet<string> = new Set([
  "BAD_REQUEST",
  "AUTH_REQUIRED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "FINDING_ACTION_ACTIVE",
  "VALIDATION_ERROR",
  "PROJECT_ARCHIVED",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
]);

function parseExecutionRef(value: unknown): GrowthMapExecutionRef | null {
  const parsed = GrowthMapExecutionRefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function executionRefFromProblemCurrent(
  current: Readonly<Record<string, unknown>> | null | undefined,
): GrowthMapExecutionRef | null {
  if (current == null) return null;
  const nested = parseExecutionRef(current.executionRef);
  if (nested !== null) return nested;
  return parseExecutionRef({
    actionId: current.actionId,
    artifactIds: current.artifactIds ?? [],
  });
}

/**
 * Preserve only registered, customer-safe review Problems. Unknown thrown
 * values and unregistered Problem codes deliberately lose their raw text so a
 * stack, provider response, or secret can never become customer-visible.
 */
export function presentGrowthMapReviewProblem(
  error: unknown,
  findingExecutionRef: GrowthMapExecutionRef | null,
): GrowthMapReviewProblemPresentation {
  if (
    !(error instanceof ApiError) ||
    !CANONICAL_REVIEW_PROBLEM_CODES.has(error.code)
  ) {
    return { kind: "fallback", recovery: "retry", executionRef: null };
  }

  const recovery =
    error.code === "VERSION_CONFLICT"
      ? "refresh"
      : error.code === "FINDING_ACTION_ACTIVE"
        ? "resolve_active_action"
        : "retry";
  const executionRef =
    recovery === "resolve_active_action"
      ? (executionRefFromProblemCurrent(error.problem.current) ??
        parseExecutionRef(findingExecutionRef))
      : null;

  return {
    kind: "canonical",
    code: error.problem.code,
    title: error.problem.title,
    detail: error.problem.detail,
    recovery,
    executionRef,
  };
}

/** Mutation feedback belongs to the review command, not to the form mode. */
export function shouldShowGrowthMapReviewError(
  mode: GrowthMapFindingReviewMode,
  problem: GrowthMapReviewProblemPresentation | null,
): boolean {
  void mode;
  return problem !== null;
}

export type GrowthMapReviewTarget =
  | {
      readonly kind: "observed_evidence";
      readonly evidenceId: string;
    }
  | {
      readonly kind: "finding";
      readonly finding: GrowthMapUrlFinding;
    };

interface GrowthMapReviewCommandInput {
  readonly target: GrowthMapReviewTarget;
  readonly reviewableFindingIds: readonly string[];
  readonly intent: GrowthMapReviewIntent;
}

/**
 * Build the canonical PATCH command for exactly one allow-listed Finding.
 * Audit Evidence has no review command, and the page's other/supporting
 * Finding IDs are intentionally absent from the result.
 */
export function buildGrowthMapReviewCommand({
  target,
  reviewableFindingIds,
  intent,
}: GrowthMapReviewCommandInput): ReviewFindingVars | null {
  if (
    target.kind !== "finding" ||
    !reviewableFindingIds.includes(target.finding.findingId)
  ) {
    return null;
  }

  let body: ReviewFindingRequest;
  switch (intent.reviewState) {
    case "confirmed":
      body = {
        reviewState: "confirmed",
        baseRevision: target.finding.reviewRevision,
        ...(intent.note === undefined ? {} : { note: intent.note }),
      };
      break;
    case "ignored":
      body = {
        reviewState: "ignored",
        baseRevision: target.finding.reviewRevision,
        reason: intent.reason,
      };
      break;
    case "needs_more_data":
      body = {
        reviewState: "needs_more_data",
        baseRevision: target.finding.reviewRevision,
        note: intent.note,
      };
      break;
  }

  return {
    findingId: target.finding.findingId,
    body,
  };
}

/** One Observation may expose several scalar pointers; name the source once. */
export function uniqueMetricSources(
  observations: readonly GrowthMapUrlMetricObservation[],
): readonly GrowthMapUrlMetricObservation[] {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (seen.has(observation.observationId)) return false;
    seen.add(observation.observationId);
    return true;
  });
}

export type GrowthMapMetricLabelKey =
  | "crawlStatus"
  | "crawlFinalStatus"
  | "crawlWordCount"
  | "crawlResponseMs"
  | "gscClicks28d"
  | "gscImpressions28d"
  | "gscPosition28d"
  | "gscPreviousClicks28d"
  | "gscPreviousImpressions28d"
  | "gscPreviousPosition28d"
  | "ga4Sessions"
  | "ga4EngagedSessions"
  | "ga4EngagementRate"
  | "ga4KeyEvents"
  | "observedValue";

const METRIC_LABELS: Readonly<Record<string, GrowthMapMetricLabelKey>> = {
  "crawl:/status": "crawlStatus",
  "crawl:/finalStatus": "crawlFinalStatus",
  "crawl:/wordCount": "crawlWordCount",
  "crawl:/responseMs": "crawlResponseMs",
  "gsc:/current28d/clicks": "gscClicks28d",
  "gsc:/current28d/impressions": "gscImpressions28d",
  "gsc:/current28d/position": "gscPosition28d",
  "gsc:/previous28d/clicks": "gscPreviousClicks28d",
  "gsc:/previous28d/impressions": "gscPreviousImpressions28d",
  "gsc:/previous28d/position": "gscPreviousPosition28d",
  "ga4:/sessions": "ga4Sessions",
  "ga4:/engagedSessions": "ga4EngagedSessions",
  "ga4:/engagementRate": "ga4EngagementRate",
  "ga4:/keyEvents": "ga4KeyEvents",
};

export function metricLabelKey(
  observation: GrowthMapUrlMetricObservation,
): GrowthMapMetricLabelKey {
  const source =
    observation.valueSource.kind === "value_json"
      ? observation.valueSource.pointer
      : "value_numeric";
  return METRIC_LABELS[`${observation.provider}:${source}`] ?? "observedValue";
}

export type FindingTargetLabelKey =
  | "directUrl"
  | "template"
  | "site"
  | "pageSet"
  | "httpStatus"
  | "canonicalIssue"
  | "keywordCluster"
  | "userAgent";

const TARGET_LABELS: Readonly<
  Record<GrowthMapFindingTargetRelation["relation"], FindingTargetLabelKey>
> = {
  direct_url: "directUrl",
  affected_by_template: "template",
  affected_by_site: "site",
  affected_by_page_set: "pageSet",
  affected_by_http_status: "httpStatus",
  affected_by_canonical_issue: "canonicalIssue",
  affected_by_keyword_cluster: "keywordCluster",
  affected_by_user_agent: "userAgent",
};

export function findingTargetLabelKey(
  target: GrowthMapFindingTargetRelation,
): FindingTargetLabelKey {
  return TARGET_LABELS[target.relation];
}

export function identitySourceKey(source: GrowthMapUrlIdentitySource): string {
  return source.kind === "page_snapshot"
    ? `page_snapshot:${source.pageSnapshotId}`
    : `url_observation:${source.observationId}`;
}

/** A readable URL presentation that does not infer page role or page title. */
export function urlPresentation(normalizedUrl: string): {
  readonly hostname: string;
  readonly path: string;
} {
  const url = new URL(normalizedUrl);
  return {
    hostname: url.hostname,
    path: `${url.pathname}${url.search}${url.hash}` || "/",
  };
}

export function safeExternalPageUrl(normalizedUrl: string): string | null {
  const url = new URL(normalizedUrl);
  return url.protocol === "http:" || url.protocol === "https:"
    ? normalizedUrl
    : null;
}
