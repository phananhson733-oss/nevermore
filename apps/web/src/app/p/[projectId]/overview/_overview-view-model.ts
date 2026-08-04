import {
  isProductProfileCompetitorIncludedByDefault,
  type ConfirmedProductProfileRowDto,
  type GrowthMapCoverage,
  type GrowthMapUrlDetail,
  type GrowthMapUrlFinding,
  type GrowthMapUrlPortfolioItem,
  type GrowthMapUrlPortfolioResponse,
} from "@sf/contracts";
import type { OverviewAction } from "@/lib/api";
import type { SourceConnection } from "@/lib/api/hooks-sources";

const PRIORITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const;

const REVIEW_RANK = {
  unreviewed: 0,
  needs_more_data: 1,
  confirmed: 2,
  ignored: 3,
} as const;

/**
 * TanStack Query retains the last successful `data` when a later refetch
 * fails. Growth Map reads are authoritative snapshots, so an errored refetch
 * must hide that retained payload instead of presenting it as current truth.
 */
export function selectAuthoritativeGrowthMapRead<T>(
  data: T | undefined,
  isError: boolean,
): T | undefined {
  return isError ? undefined : data;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portfolioPriority(item: GrowthMapUrlPortfolioItem): number {
  return item.priority.availability === "available"
    ? PRIORITY_RANK[item.priority.value]
    : Number.MAX_SAFE_INTEGER;
}

/** Select one deterministic top URL from the bounded current-run portfolio. */
export function selectTopPortfolioItem(
  items: readonly GrowthMapUrlPortfolioItem[],
): GrowthMapUrlPortfolioItem | null {
  return (
    [...items].sort((left, right) => {
      const priority = portfolioPriority(left) - portfolioPriority(right);
      if (priority !== 0) return priority;
      const reviewable =
        right.reviewableFindingIds.length - left.reviewableFindingIds.length;
      if (reviewable !== 0) return reviewable;
      const findings = right.findingIds.length - left.findingIds.length;
      return findings !== 0
        ? findings
        : compareText(left.normalizedUrl, right.normalizedUrl);
    })[0] ?? null
  );
}

export interface ReviewableFindingTarget {
  readonly sitePageId: string;
  readonly findingId: string;
}

/**
 * The one Finding a "start reviewing" entry point should open, chosen with the
 * same deterministic portfolio ordering the rest of the screen uses. Returns
 * `null` when the loaded page has nothing left to review, so the caller renders
 * plain text instead of a link into an empty queue.
 */
export function selectFirstReviewableFinding(
  items: readonly GrowthMapUrlPortfolioItem[],
): ReviewableFindingTarget | null {
  const item = selectTopPortfolioItem(
    items.filter((candidate) => candidate.reviewableFindingIds.length > 0),
  );
  const findingId = item?.reviewableFindingIds[0];
  if (!item || findingId === undefined) return null;
  return { sitePageId: item.sitePageId, findingId };
}

function compareFindings(
  left: GrowthMapUrlFinding,
  right: GrowthMapUrlFinding,
): number {
  const severity = PRIORITY_RANK[left.severity] - PRIORITY_RANK[right.severity];
  if (severity !== 0) return severity;
  const review = REVIEW_RANK[left.reviewState] - REVIEW_RANK[right.reviewState];
  if (review !== 0) return review;
  const rule = compareText(left.ruleId, right.ruleId);
  return rule !== 0 ? rule : compareText(left.findingId, right.findingId);
}

/** Top Opportunity is always one active Finding from the selected frozen run. */
export function selectTopOpportunityFinding(
  detail: GrowthMapUrlDetail | null | undefined,
  expectedDiagnosticRunId?: string | null,
): GrowthMapUrlFinding | null {
  if (!detail) return null;
  if (
    expectedDiagnosticRunId !== undefined &&
    detail.diagnosticRunId !== expectedDiagnosticRunId
  ) {
    return null;
  }
  return (
    [...detail.findings]
      .filter(
        (finding) =>
          finding.active &&
          finding.diagnosticRunId === detail.diagnosticRunId &&
          finding.reviewState !== "ignored",
      )
      .sort(compareFindings)[0] ?? null
  );
}

/**
 * Project work is safe to render only when both independent reads declare the
 * same exact frozen diagnostic run. A null/mismatched id returns no cards; the
 * client owns the refresh/recovery state instead of mixing audits.
 */
export function selectProjectWorkItemsForFrozenRun(
  actions: readonly OverviewAction[],
  workspaceRunId: string | null | undefined,
  portfolioRunId: string | null | undefined,
): readonly OverviewAction[] {
  if (
    workspaceRunId === null ||
    workspaceRunId === undefined ||
    portfolioRunId === null ||
    portfolioRunId === undefined ||
    workspaceRunId !== portfolioRunId
  ) {
    return [];
  }
  return actions.slice(0, 3);
}

export function shouldRefreshFrozenRunPair(input: {
  readonly workspaceRunId: string | null | undefined;
  readonly portfolioRunId: string | null | undefined;
  readonly workspaceFetching: boolean;
  readonly attemptedPortfolioRunId: string | null;
}): boolean {
  return (
    input.portfolioRunId !== null &&
    input.portfolioRunId !== undefined &&
    input.workspaceRunId !== input.portfolioRunId &&
    !input.workspaceFetching &&
    input.attemptedPortfolioRunId !== input.portfolioRunId
  );
}

export interface OverviewSourceCard {
  readonly provider: "gsc" | "ga4" | "github";
  readonly state: SourceConnection["state"] | "unavailable";
  readonly capturedAt: string | null;
  readonly rawLimitation: string | null;
  readonly reserved: boolean;
}

/**
 * Overview intentionally exposes only the three customer-relevant integration
 * slots. GitHub has no production connector contract yet, so its slot is
 * always explicit and unavailable rather than inferred from unrelated data.
 */
export function buildOverviewSourceCards(
  sources: readonly SourceConnection[],
): OverviewSourceCard[] {
  const byProvider = new Map(
    sources.map((source) => [source.provider, source]),
  );
  const connected = (["gsc", "ga4"] as const).map((provider) => {
    const source = byProvider.get(provider);
    return {
      provider,
      state: source?.state ?? "unavailable",
      capturedAt: source?.latestSnapshot?.capturedAt ?? null,
      rawLimitation: source?.latestSnapshot?.limitation || null,
      reserved: false,
    } satisfies OverviewSourceCard;
  });
  return [
    ...connected,
    {
      provider: "github",
      state: "unavailable",
      capturedAt: null,
      rawLimitation: null,
      reserved: true,
    },
  ];
}

export interface ConfirmedProfileSummary {
  readonly profileId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly confirmedAt: string;
  readonly productName: string;
  readonly oneLiner: string;
  readonly category: string;
  readonly productType: string;
  readonly businessModels: readonly string[];
  readonly primaryMarket: string;
  readonly primaryAudience: string;
  readonly buyerRoles: readonly string[];
  readonly userRoles: readonly string[];
  readonly useCases: readonly string[];
  readonly triggers: readonly string[];
  readonly pains: readonly string[];
  readonly jtbd: readonly string[];
  readonly directCompetitors: number;
  readonly indirectCompetitors: number;
  readonly sourceSiteId: string;
  readonly sourceSnapshotId: string | null;
  readonly generatedAt: string | null;
}

/** Confirmed means the exact append-only row; drafts and legacy context never substitute. */
export function buildConfirmedProfileSummary(
  row: ConfirmedProductProfileRowDto | null | undefined,
): ConfirmedProfileSummary | null {
  if (!row) return null;
  const profile = row.profile;
  const primaryMarket = profile.targetMarkets.find(
    (market) => market.priority === "primary",
  );
  const primaryAudience = profile.targetAudiences.find(
    (audience) => audience.reviewStatus === "primary",
  );
  if (!primaryMarket || !primaryAudience?.targetCompanyOrAudience) return null;
  const included = profile.competitorCandidates.filter(
    isProductProfileCompetitorIncludedByDefault,
  );
  return {
    profileId: row.id,
    version: row.version,
    contentHash: row.contentHash,
    confirmedAt: row.createdAt,
    productName: profile.productName,
    oneLiner: profile.oneLiner,
    category: profile.category,
    productType: profile.productType,
    businessModels: profile.businessModels,
    primaryMarket: primaryMarket.marketCode,
    primaryAudience: primaryAudience.targetCompanyOrAudience,
    buyerRoles: primaryAudience.buyerRoles,
    userRoles: primaryAudience.userRoles,
    useCases: primaryAudience.useCases,
    triggers: primaryAudience.triggers,
    pains: primaryAudience.pains,
    jtbd: primaryAudience.jtbd,
    directCompetitors: included.filter(
      (candidate) => candidate.relationship === "direct",
    ).length,
    indirectCompetitors: included.filter(
      (candidate) => candidate.relationship === "indirect",
    ).length,
    sourceSiteId: profile.sourceSiteId,
    sourceSnapshotId: profile.sourceSnapshotId,
    generatedAt: profile.generatedAt,
  };
}

export interface PortfolioSummary {
  readonly loadedUrlCount: number;
  readonly hasMore: boolean;
  readonly findingCount: number;
  readonly reviewableFindingCount: number;
  readonly opportunityUrlCount: number;
  readonly diagnosticRunId: string;
  readonly coverage: GrowthMapCoverage;
}

export interface VerifiedResultSummary {
  readonly value: "improved" | "unchanged" | "regressed";
  readonly summary: string;
  readonly beforeDiagnosticRunId: string;
  readonly currentDiagnosticRunId: string;
  readonly beforePageSnapshotId: string;
  readonly currentPageSnapshotId: string;
}

/**
 * A recent result exists only when the canonical Growth Map delta carries two
 * immutable comparison anchors. A latest source snapshot alone can never enter
 * this projection.
 */
export function buildVerifiedResultSummary(
  item: GrowthMapUrlPortfolioItem | null | undefined,
): VerifiedResultSummary | null {
  if (!item || item.delta.availability !== "available") return null;
  return {
    value: item.delta.value,
    summary: item.delta.summary,
    beforeDiagnosticRunId: item.delta.basis.before.diagnosticRunId,
    currentDiagnosticRunId: item.delta.basis.current.diagnosticRunId,
    beforePageSnapshotId: item.delta.basis.before.pageSnapshotId,
    currentPageSnapshotId: item.delta.basis.current.pageSnapshotId,
  };
}

/** Counts are explicitly limited to the current bounded response page. */
export function buildPortfolioSummary(
  response: GrowthMapUrlPortfolioResponse,
): PortfolioSummary {
  return {
    loadedUrlCount: response.data.length,
    hasMore: response.meta.hasNext,
    findingCount: new Set(response.data.flatMap((item) => item.findingIds))
      .size,
    reviewableFindingCount: new Set(
      response.data.flatMap((item) => item.reviewableFindingIds),
    ).size,
    opportunityUrlCount: response.data.filter(
      (item) => item.findingIds.length > 0,
    ).length,
    diagnosticRunId: response.diagnosticRunId,
    coverage: response.meta.coverage,
  };
}

export function overviewGrowthMapHref(
  projectId: string,
  sitePageId: string | null,
  findingId: string | null = null,
): string {
  const params = new URLSearchParams({ object: "pages" });
  if (sitePageId) params.set("selectedSitePageId", sitePageId);
  if (findingId) params.set("findingId", findingId);
  return `/p/${projectId}/growth-map?${params.toString()}`;
}

/**
 * Competitor candidates are reviewed in the Growth Map's competitor library.
 * That surface accepts `selectedCompetitorId` and a free-text query but no
 * review-status filter, so this entry targets the library itself instead of
 * promising a pre-filtered candidate queue the URL cannot actually select.
 */
export function overviewCompetitorLibraryHref(projectId: string): string {
  const params = new URLSearchParams({ object: "competitors" });
  return `/p/${projectId}/growth-map?${params.toString()}`;
}
