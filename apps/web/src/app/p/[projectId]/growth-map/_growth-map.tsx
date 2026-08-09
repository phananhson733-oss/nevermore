"use client";

import type {
  CompetitorMonitorItem,
  CompetitorMonitorResponse,
  CompetitorMonitorSignal,
  GrowthMapCoverage,
  GrowthMapCompetitorAiCitationInsight,
  GrowthMapCompetitorLibraryItem,
  GrowthMapCompetitorOriginOccurrence,
  GrowthMapCompetitorRelationship,
  GrowthMapCompetitorReviewStatus,
  GrowthMapCompetitorSerpOverlap,
  GrowthMapKeywordLibraryItem,
  GrowthMapKeywordNumericMetric,
  GrowthMapKeywordRankHistory,
  GrowthMapKeywordRelation,
  GrowthMapKeywordSourceOccurrence,
  GrowthMapKeywordStatus,
  GrowthMapKeywordTextMetric,
  GrowthMapTopicModelInsights,
  GrowthMapTopicNodeInsight,
  GrowthMapTopicInsightsCoverage,
  GrowthOpportunity,
  GrowthMapUrlDetail,
  GrowthMapUrlFinding,
  GrowthMapUrlMetricObservation,
  GrowthMapUrlPortfolioItem,
  KeywordRelationDecisionKind,
  KeywordMappingDecision,
  ProductProfileCompetitorAnalysisScope,
  ReviewCompetitorRequest,
  ReviewKeywordRequest,
  TopicNodeDraftIntent,
  TopicNodeRevision,
  TopicModelWorkspaceProjection,
} from "@sf/contracts";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpenText,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Database,
  FileSearch,
  Globe2,
  Map as MapIcon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  GitMerge,
  GitBranch,
  History,
  Link2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Button,
  EmptyState,
  Field,
  LimitationHint,
  Spinner,
  TextArea,
  TextInput,
  cx,
} from "@/components/ui";
import {
  useReviewFinding,
  type ReviewFindingRequest,
} from "@/lib/api/hooks-diagnosis";
import { ApiError } from "@/lib/api";
import {
  collectAllCursorItems,
  uniqueCursorItems,
} from "@/lib/api/cursor-pages";
import { getProjectOpportunities } from "@/lib/api/hooks-opportunities";
import {
  getGrowthMapUrls,
  getGrowthMapKeywords,
  getGrowthMapKeywordRelations,
  refreshGrowthMapAfterFindingReview,
  useBeginGrowthMapTopicModelDraft,
  useConfirmGrowthMapTopicModelDraft,
  useGrowthMapCompetitorReviewDetail,
  useGrowthMapCompetitorMonitor,
  useGrowthMapCompetitors,
  useGrowthMapKeywordReviewDetail,
  useGrowthMapInternalLinkMap,
  useGrowthMapKeywordRankHistory,
  useGrowthMapKeywords,
  useGrowthMapTopicModelInsights,
  useGrowthMapTopicModelWorkspace,
  useGrowthMapUrlDetail,
  useGrowthMapUrls,
  useDecideGrowthMapKeywordRelation,
  usePatchGrowthMapTopicModelDraft,
  useRefreshGrowthMapKeywordRelations,
  useReviewGrowthMapKeyword,
  useReviewGrowthMapCompetitor,
  useUpdateGrowthMapCompetitorMonitor,
} from "@/lib/api/hooks-growth-map";
import {
  useProjectArtifacts,
  type Artifact,
} from "@/lib/api/hooks-studio";
import { ProblemNotice, ProblemState } from "../_problem-display.tsx";
import { EvidenceRefsDisclosure } from "./_evidence-refs-disclosure.tsx";
import { RunDiagnosis } from "./_run-diagnosis.tsx";
import { executionHrefForRef } from "../execution/_execution-deep-link.ts";
import {
  GROWTH_MAP_OBJECT_MODES,
  GROWTH_MAP_PAGE_VIEWS,
  GROWTH_MAP_KEYWORD_SOURCE_KINDS,
  buildBeginTopicModelDraftCommand,
  buildConfirmTopicModelCommand,
  buildKeywordRankChartModel,
  buildKeywordGovernanceReviewCommand,
  buildKeywordRelationDecisionCommand,
  buildKeywordRelationPageProjection,
  buildGrowthMapKeywordDeliveryProjection,
  buildPatchTopicModelDraftCommand,
  buildTopicMapProjection,
  buildTopicNodeCreateIntent,
  buildTopicNodeMergeIntent,
  buildTopicNodeRenameIntent,
  buildTopicNodeRetireIntent,
  buildTopicNodeSplitIntent,
  buildTopicNodeUpdateIntent,
  buildGrowthMapReviewCommand,
  buildGrowthMapOpportunityViewItems,
  buildGrowthMapTopicClusterView,
  buildInternalLinkMapProjection,
  competitorAiCitationDisplay,
  competitorDetailReadState,
  competitorKeywordGapParticipation,
  competitorMonitorDisplayState,
  competitorOrganicOverlapDisplay,
  competitorLibraryReadState,
  competitorPoolEntryReason,
  competitorSharedKeywordDisplay,
  filterGrowthMapCompetitorItems,
  filterGrowthMapKeywordEntries,
  filterGrowthMapUrlItems,
  findMetricObservation,
  findingTargetLabelKey,
  growthMapDetailAllowsFindingReview,
  growthMapLocationHref,
  growthMapPageTypeFilterOptions,
  growthMapPageTypeLabel,
  growthMapPlatformLimitationKey,
  growthMapPrimaryOpportunity,
  growthMapKeywordReviewPresentation,
  growthMapUncoveredKeywordCountPresentation,
  identitySourceKey,
  keywordDetailReadState,
  keywordTopicNeedsConflictConfirmation,
  keywordLibraryReadState,
  keywordMetricPresentation,
  metricLabelKey,
  metricPresentation,
  metricValueLabelKey,
  normalizeGrowthMapObjectMode,
  normalizeGrowthMapPageView,
  presentGrowthMapReviewProblem,
  rememberGrowthMapCursorPredecessor,
  resolveGrowthMapCursorPredecessor,
  resolveVisibleGrowthMapOpportunitySelection,
  resolveVisibleGrowthMapClusterSelection,
  resolveVisibleGrowthMapUrlSelection,
  resolveVisibleCompetitorSelection,
  resolveVisibleKeywordSelection,
  safeExternalPageUrl,
  selectCompetitorMonitorItem,
  shouldShowGrowthMapReviewError,
  topicNodeAllowedParentIds,
  urlPresentation,
  type GrowthMapMetricLabelKey,
  type CompetitorMonitorDisplayState,
  type GrowthMapDetailState,
  type GrowthMapFindingReviewMode,
  type GrowthMapObjectMode,
  type GrowthMapPageView,
  type GrowthMapOpportunityViewItem,
  type GrowthMapTopicClusterViewRow,
  type GrowthMapKeywordDeliveryProjection,
  type GrowthMapReviewProblemPresentation,
  type GrowthMapReviewIntent,
  type GrowthMapCompetitorStatusFilter,
  type GrowthMapKeywordReviewOriginInput,
  type GrowthMapKeywordSourceFilter,
  type GrowthMapUrlPageTypeFilter,
  type GrowthMapUrlPriorityFilter,
  type KeywordRelationVisibleItem,
  type KeywordGovernanceReviewDraft,
  type TopicMapTreeNode,
} from "./_growth-map-view-model.ts";
import styles from "./growth-map.module.css";
import { BacklinkGrowthPath } from "./_backlink-growth-path.tsx";

const LIST_METRICS = {
  clicks: { provider: "gsc", pointer: "/current28d/clicks" },
  position: { provider: "gsc", pointer: "/current28d/position" },
} as const;

const PRIORITY_CLASS = {
  critical: styles.priorityCritical,
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  low: styles.priorityLow,
} as const;

const PRIORITY_CODE = {
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
} as const;

const COVERAGE_CLASS = {
  available: styles.coverageAvailable,
  partial: styles.coveragePartial,
  stale: styles.coverageStale,
  unavailable: styles.coverageUnavailable,
} as const;

interface CompleteKeywordRelationRecord {
  readonly id: string;
  readonly relation: GrowthMapKeywordRelation;
}

interface CompleteGrowthMapUrlRecord {
  readonly id: string;
  readonly item: GrowthMapUrlPortfolioItem;
}

interface CompleteGrowthMapOpportunityRecord {
  readonly id: string;
  readonly opportunity: GrowthOpportunity;
}

interface CompleteGrowthMapKeywordRecord {
  readonly id: string;
  readonly item: GrowthMapKeywordLibraryItem;
}

interface CompleteGrowthMapKeywordInventory {
  readonly diagnosticRunId: string;
  readonly items: readonly GrowthMapKeywordLibraryItem[];
}

class GrowthMapPageViewScopeMismatchError extends Error {
  override readonly name = "GrowthMapPageViewScopeMismatchError";
}

function isGrowthMapPageViewScopeMismatch(error: unknown): boolean {
  return (
    error instanceof GrowthMapPageViewScopeMismatchError ||
    (error instanceof Error &&
      (error.name === "GrowthMapPageViewScopeMismatchError" ||
        error.message ===
          "Keyword Library diagnostic run identity does not match the requested view."))
  );
}

/**
 * Cluster and Opportunity views group the complete frozen inventory rather
 * than silently treating one cursor page as the project. The shared cursor
 * collector enforces the repository's page, item, and byte ceilings. URL and
 * Opportunity responses are pinned to the exact Diagnostic Run chosen by the
 * Growth Map shell; current Topic authority is labeled separately in the
 * Cluster view.
 */
async function readCompleteGrowthMapUrls(
  projectId: string,
  diagnosticRunId: string,
): Promise<readonly GrowthMapUrlPortfolioItem[]> {
  const records = await collectAllCursorItems<CompleteGrowthMapUrlRecord>(
    async (cursor) => {
      const response = await getGrowthMapUrls(projectId, {
        cursor,
        limit: 100,
        diagnosticRunId,
      });
      if (response.diagnosticRunId !== diagnosticRunId) {
        throw new GrowthMapPageViewScopeMismatchError(
          "Growth Map URL generation changed while grouping views.",
        );
      }
      return {
        data: response.data.map((item) => ({ id: item.sitePageId, item })),
        meta: { nextCursor: response.meta.nextCursor },
      };
    },
  );
  return records.map((record) => record.item);
}

async function readCompleteGrowthMapOpportunities(
  projectId: string,
  diagnosticRunId: string,
): Promise<readonly GrowthOpportunity[]> {
  const records =
    await collectAllCursorItems<CompleteGrowthMapOpportunityRecord>(
      async (cursor) => {
        const response = await getProjectOpportunities(projectId, {
          cursor,
          limit: 100,
        });
        if (response.diagnosticRunId !== diagnosticRunId) {
          throw new GrowthMapPageViewScopeMismatchError(
            "Growth Map Opportunity generation changed while grouping views.",
          );
        }
        return {
          data: response.data.map((opportunity) => ({
            id:
              opportunity.readiness === "candidate"
                ? `candidate:${opportunity.opportunityKey}`
                : `finding:${opportunity.primaryFindingId}`,
            opportunity,
          })),
          meta: { nextCursor: response.meta.nextCursor },
        };
      },
    );
  return records.map((record) => record.opportunity);
}

async function readCompleteGrowthMapKeywords(
  projectId: string,
  diagnosticRunId: string,
): Promise<CompleteGrowthMapKeywordInventory> {
  const records = await collectAllCursorItems<CompleteGrowthMapKeywordRecord>(
    async (cursor) => {
      const response = await getGrowthMapKeywords(projectId, {
        cursor,
        limit: 100,
        diagnosticRunId,
      });
      if (response.diagnosticRunId !== diagnosticRunId) {
        throw new GrowthMapPageViewScopeMismatchError(
          "Growth Map Keyword generation changed while grouping views.",
        );
      }
      if (response.projectId !== projectId) {
        throw new GrowthMapPageViewScopeMismatchError(
          "Growth Map Keyword project changed while grouping views.",
        );
      }
      return {
        data: response.data.map((item) => ({ id: item.keywordId, item })),
        meta: { nextCursor: response.meta.nextCursor },
      };
    },
  );
  return {
    diagnosticRunId,
    items: records.map((record) => record.item),
  };
}

/**
 * Fetch one visible Keyword page's complete relation set as a single atomic
 * query value. Each transport request remains capped at 100 rows; the shared
 * collector follows opaque cursors, de-duplicates page boundaries, and fails
 * closed on cycles or aggregate budgets. Aborted queries stop before starting
 * another cursor request, so a cursor-page change cannot continue an obsolete
 * chain or publish its partial rows into the current projection.
 */
function useCompleteGrowthMapKeywordRelations(
  projectId: string,
  keywordIds: readonly string[],
) {
  const uiLocale = useLocale();
  const normalizedKeywordIds = useMemo(
    () => [...keywordIds].sort((left, right) => left.localeCompare(right)),
    [keywordIds],
  );
  return useQuery({
    queryKey: [
      "growth-map",
      projectId,
      uiLocale,
      "keyword-relations",
      "complete",
      normalizedKeywordIds,
    ],
    queryFn: async ({ signal }) => {
      const records =
        await collectAllCursorItems<CompleteKeywordRelationRecord>(
          async (pageCursor) => {
            signal.throwIfAborted();
            const page = await getGrowthMapKeywordRelations(projectId, {
              keywordIds: normalizedKeywordIds,
              cursor: pageCursor,
              limit: 100,
            });
            signal.throwIfAborted();
            return {
              data: page.data.map((relation) => ({
                id: relation.relationId,
                relation,
              })),
              meta: { nextCursor: page.meta.nextCursor },
            };
          },
        );
      return records.map((record) => record.relation);
    },
    enabled: projectId.length > 0 && normalizedKeywordIds.length > 0,
  });
}

const MODE_ICONS: Readonly<Record<GrowthMapObjectMode, typeof MapIcon>> = {
  pages: MapIcon,
  keywords: BookOpenText,
  competitors: Target,
  backlinks: Link2,
};

const KEYWORD_REVIEW_STATUSES = [
  "candidate",
  "approved",
  "excluded",
  "parked",
] as const satisfies readonly GrowthMapKeywordStatus[];

const KEYWORD_REVIEW_MAPPING_DECISIONS = [
  "unassigned",
  "existing_page",
  "new_asset",
] as const satisfies readonly KeywordMappingDecision[];

const KEYWORD_REVIEW_INTENTS = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;

const KEYWORD_REVIEW_BUYER_STAGES = [
  "awareness",
  "consideration",
  "decision",
  "retention",
] as const;

// Review-dialog decision order mirrors the artifact: approve first.
const COMPETITOR_REVIEW_STATUSES = [
  "approved",
  "candidate",
  "excluded",
] as const satisfies readonly GrowthMapCompetitorReviewStatus[];

const COMPETITOR_REVIEW_RELATIONSHIPS = [
  "direct",
  "indirect",
  "status_quo",
  "benchmark",
  "publisher",
] as const satisfies readonly GrowthMapCompetitorRelationship[];

const COMPETITOR_REVIEW_ANALYSIS_SCOPES = [
  "positioning",
  "product_capability",
  "keyword_gap",
  "content",
  "serp_visibility",
] as const satisfies readonly ProductProfileCompetitorAnalysisScope[];

const URL_PRIORITY_FILTERS = [
  "critical",
  "high",
  "medium",
  "low",
] as const satisfies readonly Exclude<GrowthMapUrlPriorityFilter, "all">[];

const COMPETITOR_STATUS_FILTERS = [
  "candidate",
  "approved",
  "excluded",
] as const satisfies readonly Exclude<GrowthMapCompetitorStatusFilter, "all">[];

interface SourceStripItem {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly tone: "mint" | "amber" | "violet" | "coral" | "cobalt";
}

function SourceStrip({
  label,
  title,
  description,
  items,
  selectedKey,
  onSelect,
  countLabel,
}: {
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly items: readonly SourceStripItem[];
  readonly selectedKey?: string;
  readonly onSelect?: (key: string) => void;
  readonly countLabel: (count: number) => string;
}) {
  return (
    <section className={styles.sourceStrip} aria-label={label}>
      <div className={styles.sourceStripIntro}>
        <span>{label}</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className={styles.sourceStripItems}>
        {items.map((item) => {
          const content = (
            <>
              <i aria-hidden="true" data-tone={item.tone} />
              <span>
                <strong>{item.label}</strong>
                <small>{countLabel(item.count)}</small>
              </span>
            </>
          );
          return onSelect === undefined ? (
            <div className={styles.sourceChip} key={item.key}>
              {content}
            </div>
          ) : (
            <button
              type="button"
              className={cx(
                styles.sourceChip,
                selectedKey === item.key && styles.sourceChipActive,
              )}
              aria-pressed={selectedKey === item.key}
              key={item.key}
              onClick={() => onSelect(item.key)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </section>
  );
}

type GrowthMapNavigationPatch = Parameters<typeof growthMapLocationHref>[2];

interface GrowthMapNavigationController {
  readonly isPending: boolean;
  readonly request: (patch: GrowthMapNavigationPatch) => void;
  readonly replaceCanonicalHref: (href: string) => void;
}

function formatNumber(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatPercentage(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatObservedAt(locale: string, value: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function truncateId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function CoveragePill({ coverage }: { readonly coverage: GrowthMapCoverage }) {
  const t = useTranslations("growthMap.coverage");
  return (
    <span
      className={cx(styles.coveragePill, COVERAGE_CLASS[coverage.availability])}
    >
      <span aria-hidden="true" />
      {t(coverage.availability)}
    </span>
  );
}

function MetricValue({
  observation,
  compact = false,
}: {
  readonly observation: GrowthMapUrlMetricObservation | null | undefined;
  readonly compact?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap");
  const presentation = metricPresentation(observation);

  if (presentation.state !== "observed") {
    const labelKey = metricValueLabelKey(presentation);
    const limitation =
      "limitation" in presentation ? presentation.limitation : null;
    return (
      <span className={styles.missingValue}>
        {t(labelKey)}
        {limitation === null ? null : (
          <LimitationHint label={t("limitations")} limitations={[limitation]} />
        )}
      </span>
    );
  }
  return (
    <span className={cx(styles.observedValue, compact && styles.compactValue)}>
      {formatNumber(locale, presentation.value)}
      {presentation.unit === null ? null : <small>{presentation.unit}</small>}
    </span>
  );
}

/**
 * `pageType` is a read-time `page_type.v1` derivation. A null value means no
 * classification rule matched, which is not the same claim as "the page was
 * not collected", and a slug this build does not know is shown verbatim
 * instead of being relabelled into something the read model never said.
 */
function usePageTypeLabel(): (pageType: string | null) => string {
  const t = useTranslations("growthMap.pageTypeLabel");
  return useCallback(
    (pageType: string | null): string => {
      const label = growthMapPageTypeLabel(pageType);
      if (label.kind === "unclassified") return t("unclassified");
      return label.kind === "known" ? t(label.slug) : label.value;
    },
    [t],
  );
}

function LimitationList({
  limitations,
  label,
  className,
}: {
  readonly limitations: readonly string[];
  readonly label?: string;
  readonly className?: string | undefined;
}) {
  const t = useTranslations("growthMap");
  const tPlatform = useTranslations("growthMap.platformLimitations");
  if (limitations.length === 0) return null;
  const displayLimitations = limitations.map((limitation) => {
    const key = growthMapPlatformLimitationKey(limitation);
    return key === null ? limitation : tPlatform(key);
  });
  return (
    <div className={cx(styles.limitations, className)}>
      <LimitationHint
        label={label ?? t("limitations")}
        limitations={displayLimitations}
      />
    </div>
  );
}

function LibraryCursorPageEmpty({
  icon,
  title,
  description,
  actionLabel,
  onReset,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onReset: () => void;
}) {
  return (
    <section className={styles.cursorPageEmpty} aria-live="polite">
      <EmptyState icon={icon} title={title} description={description} />
      <Button type="button" variant="secondary" size="sm" onClick={onReset}>
        <ArrowLeft aria-hidden="true" size={16} />
        {actionLabel}
      </Button>
    </section>
  );
}

function MetricLedger({
  observations,
}: {
  readonly observations: readonly GrowthMapUrlMetricObservation[];
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap");
  const tProvider = useTranslations("provider");

  if (observations.length === 0) {
    return (
      <p className={styles.inlineEmpty}>
        <CircleDashed aria-hidden="true" size={18} />
        <span>
          <strong>{t("noData")}</strong> · {t("noMetrics")}
        </span>
      </p>
    );
  }

  return (
    <div className={styles.metricLedger}>
      {observations.map((observation) => {
        const sourceKey =
          observation.valueSource.kind === "value_json"
            ? observation.valueSource.pointer
            : "value_numeric";
        return (
          <article
            className={styles.metricRecord}
            key={`${observation.observationId}:${sourceKey}`}
          >
            <div>
              <span
                className={styles.providerMark}
                data-provider={observation.provider}
              >
                {tProvider(observation.provider)}
              </span>
              <strong>
                {t(
                  `metrics.${metricLabelKey(observation)}` as `metrics.${GrowthMapMetricLabelKey}`,
                )}
              </strong>
            </div>
            <MetricValue observation={observation} />
            <dl>
              <div>
                <dt>{t("observedAt")}</dt>
                <dd>{formatObservedAt(locale, observation.observedAt)}</dd>
              </div>
              <div>
                <dt>{t("freshnessLabel")}</dt>
                <dd>{t(`freshness.${observation.freshness}`)}</dd>
              </div>
            </dl>
            {observation.limitation === null ? null : (
              <LimitationList
                className={styles.recordLimitation}
                label={t("sourceOriginalLimitation")}
                limitations={[observation.limitation]}
              />
            )}
            <p className={styles.traceId} title={observation.observationId}>
              {t("ids.observation")} · {truncateId(observation.observationId)}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function ReviewProblemNotice({
  projectId,
  problem,
  message,
  onRefresh,
}: {
  readonly projectId: string;
  readonly problem: GrowthMapReviewProblemPresentation;
  readonly message: string;
  readonly onRefresh: () => void;
}) {
  const t = useTranslations("growthMap");

  if (problem.kind === "fallback") {
    return (
      <p className={styles.reviewError} role="alert">
        {message}
      </p>
    );
  }

  return (
    <div className={styles.reviewProblem} role="alert">
      <p className={styles.reviewProblemLead}>{message}</p>
      <dl
        className={styles.reviewProblemFacts}
        aria-label={t("reviewProblemDetails")}
      >
        <div>
          <dt>{t("reviewProblemCode")}</dt>
          <dd>
            <code>{problem.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t("reviewProblemTitle")}</dt>
          <dd>{problem.title}</dd>
        </div>
        <div>
          <dt>{t("reviewProblemDetail")}</dt>
          <dd>{problem.detail}</dd>
        </div>
      </dl>
      {problem.recovery === "refresh" ? (
        <Button type="button" size="sm" variant="secondary" onClick={onRefresh}>
          {t("refreshLatestFinding")}
        </Button>
      ) : null}
      {problem.recovery === "resolve_active_action" ? (
        <div className={styles.reviewRecovery}>
          <p>{t("reviewActionActiveNextStep")}</p>
          {problem.executionRef === null ? (
            <p className={styles.reviewRecoveryBoundary}>
              {t("reviewActionActiveNoReference")}
            </p>
          ) : (
            <Link
              href={executionHrefForRef(projectId, problem.executionRef)}
              className={styles.reviewRecoveryLink}
            >
              <span>
                {t("openLinkedAction")}
                <code title={problem.executionRef.actionId}>
                  {truncateId(problem.executionRef.actionId)}
                </code>
              </span>
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FindingReviewControls({
  projectId,
  sitePageId,
  finding,
  reviewableFindingIds,
}: {
  readonly projectId: string;
  readonly sitePageId: string;
  readonly finding: GrowthMapUrlFinding;
  readonly reviewableFindingIds: readonly string[];
}) {
  const t = useTranslations("growthMap");
  const tCommon = useTranslations("common");
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  const review = useReviewFinding(projectId);
  const [mode, setMode] = useState<GrowthMapFindingReviewMode>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problemError, setProblemError] =
    useState<GrowthMapReviewProblemPresentation | null>(null);
  const [saved, setSaved] = useState(false);

  async function refreshGrowthMap(): Promise<void> {
    await refreshGrowthMapAfterFindingReview(
      queryClient,
      projectId,
      uiLocale,
      sitePageId,
    );
  }

  async function handleReviewError(err: unknown): Promise<void> {
    setSaved(false);
    const problem = presentGrowthMapReviewProblem(err, finding.executionRef);
    setProblemError(problem);
    setError(
      problem.kind === "canonical" && problem.recovery === "refresh"
        ? t("reviewConflict")
        : problem.kind === "canonical" &&
            problem.recovery === "resolve_active_action"
          ? t("reviewActionActive")
          : t("reviewError"),
    );
    if (problem.kind === "canonical" && problem.recovery === "refresh") {
      try {
        await refreshGrowthMap();
      } catch {
        // Keep the canonical mutation Problem visible. The explicit refresh
        // recovery below remains available if this automatic refresh failed.
      }
    }
  }

  async function refreshAfterConflict(): Promise<void> {
    try {
      await refreshGrowthMap();
      setError(t("reviewConflict"));
    } catch {
      setError(t("reviewConflictRefreshError"));
    }
  }

  async function submit(intent: GrowthMapReviewIntent): Promise<void> {
    setError(null);
    setProblemError(null);
    setSaved(false);
    const command = buildGrowthMapReviewCommand({
      target: { kind: "finding", finding },
      reviewableFindingIds,
      intent,
    });
    if (command === null) {
      setError(t("reviewUnavailable"));
      return;
    }

    try {
      await review.mutateAsync(command);
      setMode("idle");
      setText("");
      try {
        await refreshGrowthMap();
        setError(null);
        setProblemError(null);
        setSaved(true);
      } catch {
        setSaved(false);
        setError(t("reviewRefreshError"));
      }
    } catch (err) {
      await handleReviewError(err);
    }
  }

  function openForm(nextMode: GrowthMapFindingReviewMode): void {
    setMode(nextMode);
    setText("");
    setError(null);
    setProblemError(null);
    setSaved(false);
  }

  function submitTextReview(): void {
    const trimmed = text.trim();
    if (mode === "dismiss") {
      if (trimmed.length < 3) {
        setError(t("reasonTooShort"));
        setProblemError(null);
        return;
      }
      void submit({ reviewState: "ignored", reason: trimmed });
      return;
    }
    if (mode === "needs_more_data") {
      if (trimmed.length < 3) {
        setError(t("noteTooShort"));
        setProblemError(null);
        return;
      }
      void submit({ reviewState: "needs_more_data", note: trimmed });
    }
  }

  const busy = review.isPending;

  return (
    <div
      className={styles.reviewPanel}
      aria-busy={busy}
      data-finding-review={finding.findingId}
    >
      <div className={styles.reviewPanelHeading}>
        <strong>{t("reviewFinding")}</strong>
        <span>{t("singleFindingCommand")}</span>
      </div>
      <div className={styles.reviewButtons}>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => void submit({ reviewState: "confirmed" })}
          disabled={busy}
        >
          {t("confirm")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => openForm("needs_more_data")}
          disabled={busy}
          aria-expanded={mode === "needs_more_data"}
        >
          {t("needsData")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => openForm("dismiss")}
          disabled={busy}
          aria-expanded={mode === "dismiss"}
        >
          {t("dismiss")}
        </Button>
      </div>

      {mode === "idle" ? null : (
        <div className={styles.reviewForm}>
          <Field
            label={mode === "dismiss" ? t("reason") : t("note")}
            help={mode === "dismiss" ? t("reasonHelp") : t("noteHelp")}
            required
            error={error ?? undefined}
          >
            <TextArea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              disabled={busy}
            />
          </Field>
          <div className={styles.reviewFormActions}>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={submitTextReview}
              disabled={busy}
            >
              {busy ? t("savingReview") : t("submitReview")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => openForm("idle")}
              disabled={busy}
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      {error !== null ? (
        shouldShowGrowthMapReviewError(mode, problemError) &&
        problemError !== null ? (
          <ReviewProblemNotice
            projectId={projectId}
            problem={problemError}
            message={error}
            onRefresh={() => void refreshAfterConflict()}
          />
        ) : (
          <p className={styles.reviewError} role="alert">
            {error}
          </p>
        )
      ) : null}
      {mode === "idle" && saved ? (
        <p className={styles.reviewSaved} role="status">
          {t("reviewSaved")}
        </p>
      ) : null}
      {busy ? (
        <p className={styles.reviewPending} role="status">
          {t("savingReview")}
        </p>
      ) : null}
    </div>
  );
}

function FindingCard({
  projectId,
  sitePageId,
  finding,
  reviewableFindingIds,
  reviewEnabled,
}: {
  readonly projectId: string;
  readonly sitePageId: string;
  readonly finding: GrowthMapUrlFinding;
  readonly reviewableFindingIds: readonly string[];
  readonly reviewEnabled: boolean;
}) {
  const t = useTranslations("growthMap");
  const tPriority = useTranslations("priorityBand");
  const tReview = useTranslations("reviewState");
  const execution = finding.executionRef;
  const reviewable = reviewableFindingIds.includes(finding.findingId);

  return (
    <article
      id={`sf-finding-${finding.findingId}`}
      data-finding-card={finding.findingId}
      className={styles.findingCard}
    >
      <div className={styles.findingHeading}>
        <div>
          <span
            className={cx(
              styles.priorityPill,
              PRIORITY_CLASS[finding.severity],
            )}
          >
            {tPriority(finding.severity)}
          </span>
          <span className={styles.reviewState}>
            {tReview(finding.reviewState)}
          </span>
        </div>
        <code>{finding.ruleId}</code>
      </div>
      <h4>{finding.title}</h4>
      <dl className={styles.findingFacts}>
        <div>
          <dt>{t("affectedTarget")}</dt>
          <dd>
            <span>
              {t(`targets.${findingTargetLabelKey(finding.targetRelation)}`)}
            </span>
            <code title={finding.targetRelation.targetRef}>
              {finding.targetRelation.targetRef}
            </code>
          </dd>
        </div>
        <div>
          <dt>{t("evidenceCountLabel")}</dt>
          <dd>{finding.evidenceIds.length}</dd>
        </div>
        <div>
          <dt>{t("ids.finding")}</dt>
          <dd>
            <code title={finding.findingId}>
              {truncateId(finding.findingId)}
            </code>
          </dd>
        </div>
      </dl>
      <EvidenceRefsDisclosure
        findingId={finding.findingId}
        label={t("inspectEvidenceIds")}
      >
        <ul>
          {finding.evidenceIds.map((evidenceId) => (
            <li key={evidenceId}>
              <code title={evidenceId}>
                {t("ids.evidence")} · {truncateId(evidenceId)}
              </code>
            </li>
          ))}
        </ul>
      </EvidenceRefsDisclosure>
      <ExecutionPreviewPanel preview={finding.executionPreview} />
      {!reviewEnabled ? (
        <p className={styles.reviewUnavailable}>{t("evidenceReadOnly")}</p>
      ) : reviewable ? (
        <FindingReviewControls
          projectId={projectId}
          sitePageId={sitePageId}
          finding={finding}
          reviewableFindingIds={reviewableFindingIds}
        />
      ) : (
        <p className={styles.reviewUnavailable}>{t("reviewUnavailable")}</p>
      )}
      {execution === null ? (
        <p className={styles.noExecution}>{t("noExecution")}</p>
      ) : (
        <div className={styles.executionRefs}>
          <Link
            href={executionHrefForRef(projectId, execution)}
            className={styles.executionLink}
          >
            <span>
              {t("openExecution")}
              <code title={execution.actionId}>
                {truncateId(execution.actionId)}
              </code>
            </span>
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
          {execution.artifactIds.length === 0 ? null : (
            <ul className={styles.artifactRefs} aria-label={t("artifactRefs")}>
              {execution.artifactIds.map((artifactId, index) => (
                <li key={artifactId}>
                  <span title={artifactId}>
                    {t("artifactRef", { index: index + 1 })} ·{" "}
                    {truncateId(artifactId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function ExecutionPreviewPanel({
  preview,
}: {
  readonly preview: GrowthMapUrlFinding["executionPreview"];
}) {
  const t = useTranslations("growthMap.executionPreview");

  return (
    <section className={styles.executionPreview} aria-label={t("eyebrow")}>
      <span className={styles.executionPreviewEyebrow}>{t("eyebrow")}</span>
      {preview === null ? (
        <p className={styles.executionPreviewUnavailable}>
          {t("notAvailable")}
        </p>
      ) : (
        <>
          <h5 lang={preview.contentLocale}>{preview.title}</h5>
          <p
            className={styles.executionPreviewDescription}
            lang={preview.contentLocale}
          >
            {preview.description}
          </p>
          <dl className={styles.executionPreviewFacts}>
            <div>
              <dt>{t("artifactType")}</dt>
              <dd>
                <span className={styles.executionPreviewChip}>
                  {t(`artifactTypes.${preview.artifactType}`)}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("effort")}</dt>
              <dd>
                <span className={styles.executionPreviewChip}>
                  {t(`efforts.${preview.effort}`)}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("risk")}</dt>
              <dd>
                <span className={styles.executionPreviewChip}>
                  {t(`risks.${preview.risk}`)}
                </span>
              </dd>
            </div>
          </dl>
          <div className={styles.executionPreviewOutcome}>
            <span>{t("validationTarget")}</span>
            <p lang={preview.contentLocale}>{preview.expectedOutcome}</p>
          </div>
        </>
      )}
    </section>
  );
}

function FindingSection({
  projectId,
  detail,
  state,
}: {
  readonly projectId: string;
  readonly detail: GrowthMapUrlDetail;
  readonly state: GrowthMapDetailState;
}) {
  const t = useTranslations("growthMap");
  const reviewEnabled = growthMapDetailAllowsFindingReview(state);

  return (
    <section className={styles.detailSection}>
      <div className={styles.sectionHeading}>
        <div>
          <span>
            {t(reviewEnabled ? "findingsEyebrow" : "evidenceFindingsEyebrow")}
          </span>
          <h3>
            {t(reviewEnabled ? "findingsTitle" : "evidenceFindingsTitle")}
          </h3>
        </div>
        <span className={styles.sectionCount}>{detail.findings.length}</span>
      </div>
      <p className={styles.sectionBoundaryCopy}>
        {t(
          reviewEnabled
            ? "opportunityReviewDescription"
            : "evidenceFindingsDescription",
        )}
      </p>
      {detail.findings.length === 0 ? (
        <p className={styles.inlineEmpty}>
          <CheckCircle2 aria-hidden="true" size={18} />
          {t("noUrlFindings")}
        </p>
      ) : (
        <div className={styles.findingList}>
          {detail.findings.map((finding) => (
            <FindingCard
              key={finding.findingId}
              projectId={projectId}
              sitePageId={detail.sitePageId}
              finding={finding}
              reviewableFindingIds={detail.reviewableFindingIds}
              reviewEnabled={reviewEnabled}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function IdentityLedger({ detail }: { readonly detail: GrowthMapUrlDetail }) {
  const locale = useLocale();
  const t = useTranslations("growthMap");
  const tProvider = useTranslations("provider");

  return (
    <details className={styles.identityLedger} data-identity-ledger="">
      <summary>
        <span>
          <Database aria-hidden="true" size={18} />
          {t("traceability")}
        </span>
        <small>
          {t("sourceRecordCount", {
            count: detail.identitySources.length,
          })}
        </small>
      </summary>
      <div className={styles.identityBody}>
        <p>{t("traceabilityDescription")}</p>
        <ul>
          {detail.identitySources.map((source) => (
            <li key={identitySourceKey(source)}>
              <span>
                {source.kind === "page_snapshot"
                  ? t("pageSnapshotSource")
                  : tProvider(source.provider)}
              </span>
              <time dateTime={source.observedAt}>
                {formatObservedAt(locale, source.observedAt)}
              </time>
              <code
                title={
                  source.kind === "page_snapshot"
                    ? source.pageSnapshotId
                    : source.observationId
                }
              >
                {source.kind === "page_snapshot"
                  ? `${t("ids.pageSnapshot")} · ${truncateId(source.pageSnapshotId)}`
                  : `${t("ids.observation")} · ${truncateId(source.observationId)}`}
              </code>
              <code title={source.snapshotId}>
                {t("ids.snapshot")} · {truncateId(source.snapshotId)}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function InternalLinkUrl({
  normalizedUrl,
  title,
}: {
  readonly normalizedUrl: string;
  readonly title?: string | null;
}) {
  const presentation = urlPresentation(normalizedUrl);
  return (
    <span className={styles.internalLinkUrl} title={normalizedUrl}>
      {title === null || title === undefined ? null : <strong>{title}</strong>}
      <code>{presentation.path}</code>
      <small>{presentation.hostname}</small>
    </span>
  );
}

function InternalLinkMapSection({
  projectId,
  sitePageId,
}: {
  readonly projectId: string;
  readonly sitePageId: string;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.internalLinkMap");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useGrowthMapInternalLinkMap(projectId, sitePageId);
  const projection = useMemo(
    () =>
      query.data === undefined
        ? null
        : buildInternalLinkMapProjection(query.data, sitePageId),
    [query.data, sitePageId],
  );

  if (query.isPending) {
    return (
      <section
        className={cx(styles.detailSection, styles.internalLinkMap)}
        data-internal-link-map
        data-site-page-id={sitePageId}
        aria-labelledby="sf-internal-link-map-title"
        aria-live="polite"
      >
        <div className={styles.sectionHeading}>
          <div>
            <span>{t("eyebrow")}</span>
            <h3 id="sf-internal-link-map-title">{t("title")}</h3>
          </div>
          <Network aria-hidden="true" size={21} />
        </div>
        <div className={styles.internalLinkMapState} role="status">
          <Spinner label={t("loading")} size="sm" />
          <p>{t("loading")}</p>
        </div>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section
        className={cx(styles.detailSection, styles.internalLinkMap)}
        data-internal-link-map
        data-site-page-id={sitePageId}
        aria-labelledby="sf-internal-link-map-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <span>{t("eyebrow")}</span>
            <h3 id="sf-internal-link-map-title">{t("title")}</h3>
          </div>
          <Network aria-hidden="true" size={21} />
        </div>
        <ProblemNotice
          compact
          error={query.error}
          message={t("error")}
          onRetry={() => void query.refetch()}
        />
      </section>
    );
  }

  if (projection === null) return null;
  if (projection.kind !== "ready") {
    const unavailable =
      projection.kind === "unavailable"
        ? t("unavailable")
        : t("selectionUnavailable");
    return (
      <section
        className={cx(styles.detailSection, styles.internalLinkMap)}
        data-internal-link-map
        data-site-page-id={sitePageId}
        data-link-map-state={projection.kind}
        aria-labelledby="sf-internal-link-map-title"
        aria-live="polite"
      >
        <div className={styles.sectionHeading}>
          <div>
            <span>{t("eyebrow")}</span>
            <h3 id="sf-internal-link-map-title">{t("title")}</h3>
          </div>
          <CoveragePill coverage={projection.coverage} />
        </div>
        <div className={styles.internalLinkMapState}>
          <CircleDashed aria-hidden="true" size={23} />
          <p>{unavailable}</p>
          {projection.kind === "selection_unavailable" ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void query.refetch()}
            >
              {t("retry")}
            </Button>
          ) : null}
        </div>
        <LimitationList limitations={projection.coverage.limitations} />
      </section>
    );
  }

  const countsAvailable = projection.selectedNode.status !== "unknown";
  const inboundEmptyCopy =
    projection.coverage.crawlCompleteness === "complete"
      ? t("inbound.emptyComplete")
      : t("inbound.emptyPartial");

  return (
    <section
      className={cx(styles.detailSection, styles.internalLinkMap)}
      data-internal-link-map
      data-site-page-id={sitePageId}
      data-link-map-state="ready"
      aria-labelledby="sf-internal-link-map-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <span>{t("eyebrow")}</span>
          <h3 id="sf-internal-link-map-title">{t("title")}</h3>
        </div>
        <CoveragePill coverage={projection.coverage} />
      </div>
      <p className={styles.sectionBoundaryCopy}>{t("description")}</p>
      <LimitationList limitations={projection.coverage.limitations} />

      <dl
        className={styles.internalLinkSummary}
        aria-label={t("summary.label")}
      >
        <div>
          <dt>{t("summary.siteNodes")}</dt>
          <dd>{formatNumber(locale, projection.graph.totalNodeCount)}</dd>
        </div>
        <div>
          <dt>{t("summary.observedEdges")}</dt>
          <dd>{formatNumber(locale, projection.graph.totalEdgeCount)}</dd>
        </div>
        <div>
          <dt>{t("summary.inbound")}</dt>
          <dd>
            {countsAvailable
              ? formatNumber(locale, projection.selectedNode.inboundCount)
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("summary.outbound")}</dt>
          <dd>
            {countsAvailable
              ? formatNumber(locale, projection.selectedNode.outboundCount)
              : "—"}
          </dd>
        </div>
      </dl>

      <div className={styles.internalLinkStatusLine}>
        <span>{t("selectedStatus")}</span>
        <strong data-link-node-status={projection.selectedNode.status}>
          {t(`status.${projection.selectedNode.status}`)}
        </strong>
        {countsAvailable ? null : <small>{t("unknownCounts")}</small>}
      </div>

      <div className={styles.internalLinkBlock}>
        <div className={styles.internalLinkBlockHeading}>
          <div>
            <span>{t("graph.eyebrow")}</span>
            <h4>{t("graph.title")}</h4>
          </div>
          <small>
            {t("graph.visible", {
              nodes: projection.neighborhood.nodes.length,
              edges: projection.neighborhood.edges.length,
            })}
          </small>
        </div>
        <ul
          className={styles.internalLinkNodes}
          aria-label={t("graph.nodesLabel")}
        >
          {projection.neighborhood.nodes.map((node) => {
            const selected = node.sitePageIds.includes(sitePageId);
            return (
              <li
                key={node.canonicalUrl}
                data-link-node
                data-selected={selected ? "true" : "false"}
              >
                <InternalLinkUrl
                  normalizedUrl={node.canonicalUrl}
                  title={node.title}
                />
                <span className={styles.internalLinkNodeMeta}>
                  {selected ? <b>{t("graph.selected")}</b> : null}
                  <small>{t(`status.${node.status}`)}</small>
                </span>
              </li>
            );
          })}
        </ul>
        {projection.neighborhood.edges.length === 0 ? (
          <p className={styles.internalLinkEmpty}>
            {projection.coverage.crawlCompleteness === "complete"
              ? t("graph.emptyComplete")
              : t("graph.emptyPartial")}
          </p>
        ) : (
          <ol
            className={styles.internalLinkEdges}
            aria-label={t("graph.edgesLabel")}
          >
            {projection.neighborhood.edges.map((edge) => (
              <li
                key={`${edge.sourceCanonicalUrl}:${edge.targetCanonicalUrl}`}
                data-link-edge
              >
                <InternalLinkUrl normalizedUrl={edge.sourceCanonicalUrl} />
                <span className={styles.internalLinkDirection}>
                  <ArrowRight aria-hidden="true" size={16} />
                  <small>
                    {edge.reciprocal
                      ? t("graph.reciprocal")
                      : t("graph.oneWay")}
                  </small>
                </span>
                <InternalLinkUrl normalizedUrl={edge.targetCanonicalUrl} />
              </li>
            ))}
          </ol>
        )}
        {projection.neighborhood.nodesTruncated ||
        projection.neighborhood.edgesTruncated ||
        projection.graph.edgesTruncated ? (
          <p className={styles.internalLinkTruncation}>
            {t("graph.truncated", {
              nodes: projection.neighborhood.totalNodeCount,
              edges: projection.neighborhood.totalEdgeCount,
            })}
          </p>
        ) : null}
      </div>

      <div className={styles.internalLinkBlock}>
        <div className={styles.internalLinkBlockHeading}>
          <div>
            <span>{t("inbound.eyebrow")}</span>
            <h4>{t("inbound.title")}</h4>
          </div>
          <small>
            {t("inbound.count", {
              count: projection.totalInboundSourceCount,
            })}
          </small>
        </div>
        {projection.inboundSources.length === 0 ? (
          <p className={styles.internalLinkEmpty}>{inboundEmptyCopy}</p>
        ) : (
          <ul
            className={styles.internalLinkInboundList}
            aria-label={t("inbound.listLabel")}
          >
            {projection.inboundSources.map((edge) => (
              <li key={`${edge.sourceCanonicalUrl}:${edge.targetCanonicalUrl}`}>
                <InternalLinkUrl normalizedUrl={edge.sourceCanonicalUrl} />
                <ul className={styles.internalLinkFacts}>
                  {edge.facts.map((fact) => (
                    <li key={fact.observationId}>
                      <span>
                        {fact.anchorText === null
                          ? t("inbound.anchorUnavailable")
                          : t("inbound.anchor", {
                              anchor: fact.anchorText,
                            })}
                      </span>
                      {fact.rel === null ? null : (
                        <code>{t("inbound.rel", { rel: fact.rel })}</code>
                      )}
                      <code title={fact.observationId}>
                        {t("inbound.observation", {
                          id: truncateId(fact.observationId),
                        })}
                      </code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {projection.inboundSourcesTruncated ? (
          <p className={styles.internalLinkTruncation}>
            {t("inbound.truncated", {
              count: projection.totalInboundSourceCount,
            })}
          </p>
        ) : null}
      </div>

      <div className={styles.internalLinkBlock}>
        <div className={styles.internalLinkBlockHeading}>
          <div>
            <span>{t("recommendations.eyebrow")}</span>
            <h4>{t("recommendations.title")}</h4>
          </div>
          <small>
            {t("recommendations.count", {
              count: projection.totalRecommendationCount,
            })}
          </small>
        </div>
        <p className={styles.internalLinkAuthority}>
          {t("recommendations.authority")}
        </p>
        <LimitationList
          limitations={projection.recommendationCoverage.limitations}
        />
        {projection.recommendations.length === 0 ? (
          <p className={styles.internalLinkEmpty}>
            {projection.recommendationCoverage.availability === "unavailable"
              ? t("recommendations.unavailable")
              : t("recommendations.empty")}
          </p>
        ) : (
          <ol
            className={styles.internalLinkRecommendations}
            aria-label={t("recommendations.listLabel")}
          >
            {projection.recommendations.map((recommendation) => (
              <li
                key={`${recommendation.sourceCanonicalUrl}:${recommendation.basis.topicNodeId}`}
                data-link-recommendation
              >
                <div className={styles.internalLinkRecommendationPath}>
                  <InternalLinkUrl
                    normalizedUrl={recommendation.sourceCanonicalUrl}
                  />
                  <span>
                    <ArrowRight aria-hidden="true" size={16} />
                    {t("recommendations.addLink")}
                  </span>
                  <InternalLinkUrl
                    normalizedUrl={recommendation.targetCanonicalUrl}
                  />
                </div>
                <div className={styles.internalLinkTopicBasis}>
                  <strong>{recommendation.basis.topicLabel}</strong>
                  <code>
                    {t("recommendations.topicRevision", {
                      revision: recommendation.basis.topicModelRevision,
                    })}
                  </code>
                </div>
                <p>{recommendation.explanation}</p>
                {recommendation.executionRefs.length === 0 ? (
                  <p className={styles.internalLinkNoExecution}>
                    {t("recommendations.noExecution")}
                  </p>
                ) : (
                  <ul
                    className={styles.internalLinkExecutionRefs}
                    aria-label={t("recommendations.executionRefs")}
                  >
                    {recommendation.executionRefs.map((ref) => (
                      <li
                        key={`${ref.role}:${ref.findingId}:${ref.actionId ?? ""}`}
                      >
                        <span>
                          {t(`recommendations.role.${ref.role}`)}
                          <code title={ref.findingId}>
                            {t("recommendations.findingRef", {
                              id: truncateId(ref.findingId),
                            })}
                          </code>
                        </span>
                        {ref.actionId === null && ref.role === "target" ? (
                          <Link
                            href={(() => {
                              const next = new URLSearchParams(
                                searchParams.toString(),
                              );
                              next.set("object", "pages");
                              next.set("selectedSitePageId", sitePageId);
                              next.set("findingId", ref.findingId);
                              return `${pathname}?${next.toString()}`;
                            })()}
                          >
                            {t("recommendations.reviewFinding")}
                            <ArrowRight aria-hidden="true" size={15} />
                          </Link>
                        ) : ref.actionId === null ? (
                          <small>{t("recommendations.actionPending")}</small>
                        ) : (
                          <Link
                            href={executionHrefForRef(projectId, {
                              actionId: ref.actionId,
                              artifactIds: [],
                            })}
                          >
                            {t("recommendations.openAction")}
                            <code title={ref.actionId}>
                              {truncateId(ref.actionId)}
                            </code>
                            <ArrowRight aria-hidden="true" size={15} />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        {projection.recommendationsTruncated ? (
          <p className={styles.internalLinkTruncation}>
            {t("recommendations.truncated", {
              shown: projection.recommendations.length,
              total: projection.totalRecommendationCount,
            })}
          </p>
        ) : null}
      </div>

      <footer className={styles.internalLinkMapFooter}>
        <span>{t("generatedAt")}</span>
        <time dateTime={query.data.generatedAt}>
          {formatObservedAt(locale, query.data.generatedAt)}
        </time>
      </footer>
    </section>
  );
}

function UrlDetailPanel({
  projectId,
  detail,
  selectedFindingId,
}: {
  readonly projectId: string;
  readonly detail: GrowthMapUrlDetail;
  readonly selectedFindingId: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap");
  const tPriority = useTranslations("priorityBand");
  const tReview = useTranslations("reviewState");
  const [detailState, setDetailState] = useState<GrowthMapDetailState>(
    selectedFindingId === null ? "audit_evidence" : "opportunity_review",
  );
  const [fullDetailOpen, setFullDetailOpen] = useState(
    selectedFindingId !== null,
  );
  const fullDetailRef = useRef<HTMLDetailsElement>(null);
  const url = urlPresentation(detail.normalizedUrl);
  const externalUrl = safeExternalPageUrl(detail.normalizedUrl);
  const clicks = findMetricObservation(
    detail.metricObservations,
    LIST_METRICS.clicks,
  );
  const position = findMetricObservation(
    detail.metricObservations,
    LIST_METRICS.position,
  );
  const pageTypeLabel = usePageTypeLabel();
  // The detail read model orders Findings by canonical id, so the first row is
  // not the most urgent one. Rank by severity instead, then let the selected
  // Finding decide whether the primary action can leave for Execution at all.
  const primaryOpportunity = growthMapPrimaryOpportunity(detail.findings);
  const primaryFindingId =
    primaryOpportunity.kind === "none"
      ? null
      : primaryOpportunity.finding.findingId;
  const compactFindings = useMemo(
    () =>
      [...detail.findings].sort((left, right) => {
        if (left.findingId === primaryFindingId) return -1;
        if (right.findingId === primaryFindingId) return 1;
        return left.findingId.localeCompare(right.findingId);
      }),
    [detail.findings, primaryFindingId],
  );

  function openFullDetail(findingId: string | null): void {
    if (findingId !== null) setDetailState("opportunity_review");
    setFullDetailOpen(true);
    window.requestAnimationFrame(() => {
      const target =
        findingId === null
          ? fullDetailRef.current
          : document.getElementById(`sf-finding-${findingId}`);
      target?.scrollIntoView({ block: "nearest" });
    });
  }

  function reviewPrimaryOpportunity(): void {
    if (primaryOpportunity.kind === "none") return;
    openFullDetail(primaryOpportunity.finding.findingId);
  }

  // Every Finding on this URL is ignored or no longer active, so there is no
  // top opportunity to promote. The panel still takes the operator to the
  // closed signals rather than leaving a control that does nothing.
  function openClosedFindings(): void {
    const first = detail.findings[0];
    openFullDetail(first?.findingId ?? null);
  }

  useEffect(() => {
    if (
      selectedFindingId !== null &&
      detail.findings.some((finding) => finding.findingId === selectedFindingId)
    ) {
      setDetailState("opportunity_review");
      setFullDetailOpen(true);
    }
  }, [detail.findings, selectedFindingId]);

  useEffect(() => {
    if (
      selectedFindingId === null ||
      !fullDetailOpen ||
      detailState !== "opportunity_review"
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`sf-finding-${selectedFindingId}`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailState, fullDetailOpen, selectedFindingId]);

  return (
    <aside className={styles.detailPanel} aria-label={t("selectedUrlDetail")}>
      <header className={styles.detailHeader}>
        <div className={styles.detailEyebrow}>
          <span>
            {t("selectedUrl")} ·{" "}
            {detail.priority.availability === "available"
              ? PRIORITY_CODE[detail.priority.value]
              : "—"}
          </span>
          <CoveragePill coverage={detail.coverage} />
        </div>
        <div className={styles.detailTitleRow}>
          <div>
            <h2 title={detail.normalizedUrl}>{url.path}</h2>
            <p>{detail.title ?? t("titleNotCollected")}</p>
            <span>{url.hostname}</span>
          </div>
          {externalUrl === null ? null : (
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t("openLivePage")}
              title={t("openLivePage")}
            >
              <ArrowUpRight aria-hidden="true" size={20} />
            </a>
          )}
        </div>
        <div className={styles.detailTags}>
          <span>{t("pageType", { value: pageTypeLabel(detail.pageType) })}</span>
          {detail.templateKey === null ? null : (
            <span>{t("templateKey", { value: detail.templateKey })}</span>
          )}
          {detail.clusterKey === null ? null : (
            <span>{t("clusterKey", { value: detail.clusterKey })}</span>
          )}
        </div>
      </header>

      <section className={styles.detailSummary} aria-label={t("pageSummary")}>
        <div>
          <span>{t("columns.clicks")}</span>
          <MetricValue observation={clicks} compact />
        </div>
        <div>
          <span>{t("columns.position")}</span>
          <MetricValue observation={position} compact />
        </div>
        <div>
          <span>{t("cluster")}</span>
          <strong>{detail.clusterKey ?? t("notCollected")}</strong>
        </div>
      </section>

      <LimitationList limitations={detail.coverage.limitations} />
      {detail.priority.limitation === null ? null : (
        <LimitationList
          className={styles.projectionNote}
          limitations={[detail.priority.limitation]}
        />
      )}

      <section
        className={styles.compactOpportunitySection}
        aria-labelledby={`url-opportunities-${detail.sitePageId}`}
      >
        <div className={styles.compactOpportunityHeading}>
          <div>
            <span>{t("currentFindings")}</span>
            <h3 id={`url-opportunities-${detail.sitePageId}`}>
              {t("pageViews.url.currentOpportunities")}
            </h3>
          </div>
          <strong>{detail.findings.length}</strong>
        </div>
        {compactFindings.length === 0 ? (
          <p className={styles.compactOpportunityEmpty}>
            <CheckCircle2 aria-hidden="true" size={18} />
            {t("noUrlFindings")}
          </p>
        ) : (
          <ul className={styles.compactOpportunityList}>
            {compactFindings.map((finding) => (
              <li key={finding.findingId}>
                <button
                  type="button"
                  data-compact-finding={finding.findingId}
                  onClick={() => openFullDetail(finding.findingId)}
                >
                  <span className={styles.compactOpportunityMeta}>
                    <em
                      className={cx(
                        styles.priorityPill,
                        PRIORITY_CLASS[finding.severity],
                      )}
                    >
                      {PRIORITY_CODE[finding.severity]} ·{" "}
                      {tPriority(finding.severity)}
                    </em>
                    <small>{tReview(finding.reviewState)}</small>
                  </span>
                  <strong>{finding.title}</strong>
                  <span>
                    {t(
                      `targets.${findingTargetLabelKey(finding.targetRelation)}`,
                    )}
                    <ArrowRight aria-hidden="true" size={16} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details
        ref={fullDetailRef}
        className={styles.fullDetailDisclosure}
        data-full-evidence-disclosure=""
        open={fullDetailOpen}
        onToggle={(event) => setFullDetailOpen(event.currentTarget.open)}
      >
        <summary>
          <span>
            <FileSearch aria-hidden="true" size={18} />
            {t("pageViews.url.fullEvidence")}
          </span>
          <small>{t("pageViews.url.fullEvidenceDescription")}</small>
        </summary>
        {fullDetailOpen ? (
          <div data-detail-panel="full-evidence-and-review">
            <div
              className={styles.detailStateSwitch}
              role="group"
              aria-label={t("detailStateLabel")}
            >
              <button
                type="button"
                data-detail-state="audit-evidence"
                aria-pressed={detailState === "audit_evidence"}
                className={cx(
                  styles.detailStateButton,
                  detailState === "audit_evidence" &&
                    styles.detailStateButtonActive,
                )}
                onClick={() => setDetailState("audit_evidence")}
              >
                <FileSearch aria-hidden="true" size={18} />
                <span>
                  <strong>{t("auditEvidenceState")}</strong>
                  <small>{t("auditEvidenceStateDescription")}</small>
                </span>
              </button>
              <button
                type="button"
                data-detail-state="opportunity-review"
                aria-pressed={detailState === "opportunity_review"}
                className={cx(
                  styles.detailStateButton,
                  detailState === "opportunity_review" &&
                    styles.detailStateButtonActive,
                )}
                onClick={() => setDetailState("opportunity_review")}
              >
                <CheckCircle2 aria-hidden="true" size={18} />
                <span>
                  <strong>{t("opportunityReviewState")}</strong>
                  <small>{t("opportunityReviewStateDescription")}</small>
                </span>
              </button>
            </div>

            {detailState === "audit_evidence" ? (
              <div data-detail-panel="audit-evidence">
                <FindingSection
                  projectId={projectId}
                  detail={detail}
                  state="audit_evidence"
                />

                <section className={styles.detailSection}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <span>{t("observedMetricsEyebrow")}</span>
                      <h3>{t("observedMetrics")}</h3>
                    </div>
                    <BarChart3 aria-hidden="true" size={21} />
                  </div>
                  <p className={styles.sectionBoundaryCopy}>
                    {t("evidenceBoundaryDescription")}
                  </p>
                  <MetricLedger observations={detail.metricObservations} />
                </section>

                <InternalLinkMapSection
                  projectId={projectId}
                  sitePageId={detail.sitePageId}
                />

                <section className={styles.comparisonStrip}>
                  <div>
                    <span>{t("recheckComparison")}</span>
                    {detail.delta.availability === "available" ? (
                      <strong>{t(`delta.${detail.delta.value}`)}</strong>
                    ) : (
                      <strong>{t("delta.unavailable")}</strong>
                    )}
                  </div>
                  {detail.delta.availability === "available" ? (
                    <p>{detail.delta.summary}</p>
                  ) : (
                    <LimitationList limitations={[detail.delta.limitation]} />
                  )}
                </section>

                <IdentityLedger detail={detail} />
                <footer className={styles.detailFooter}>
                  <span>
                    {t("ids.sitePage")}
                    <code title={detail.sitePageId}>
                      {truncateId(detail.sitePageId)}
                    </code>
                  </span>
                  <span>
                    {t("pageSnapshot")}
                    {detail.pageSnapshotCapturedAt === null ? (
                      <strong>{t("notCollected")}</strong>
                    ) : (
                      <time dateTime={detail.pageSnapshotCapturedAt}>
                        {formatObservedAt(
                          locale,
                          detail.pageSnapshotCapturedAt,
                        )}
                      </time>
                    )}
                  </span>
                </footer>
              </div>
            ) : (
              <div data-detail-panel="opportunity-review">
                <FindingSection
                  projectId={projectId}
                  detail={detail}
                  state="opportunity_review"
                />
              </div>
            )}
          </div>
        ) : null}
      </details>

      {primaryOpportunity.kind === "none" ? (
        primaryOpportunity.reason === "no_findings" ? null : (
          <div className={styles.detailPrimaryAction}>
            <Button
              type="button"
              variant="secondary"
              onClick={openClosedFindings}
            >
              {t("primaryOpportunityClosedAction")}
              <ArrowDown aria-hidden="true" size={17} />
            </Button>
            <p className={styles.detailPrimaryActionHint}>
              {t("primaryOpportunityClosedHint", {
                count: primaryOpportunity.closedFindingCount,
              })}
            </p>
          </div>
        )
      ) : (
        <div className={styles.detailPrimaryAction}>
          {primaryOpportunity.kind === "execution" ? (
            <Link
              className={styles.detailPrimaryActionLink}
              href={executionHrefForRef(
                projectId,
                primaryOpportunity.executionRef,
              )}
            >
              {t("primaryOpportunityAction")}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={reviewPrimaryOpportunity}
              >
                {t("primaryOpportunityReviewAction")}
                <ArrowDown aria-hidden="true" size={17} />
              </Button>
              <p className={styles.detailPrimaryActionHint}>
                {t("primaryOpportunityReviewHint")}
              </p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function DetailState({
  projectId,
  selectedSitePageId,
  selectedFindingId,
  diagnosticRunId,
}: {
  readonly projectId: string;
  readonly selectedSitePageId: string | null;
  readonly selectedFindingId: string | null;
  readonly diagnosticRunId: string;
}) {
  const t = useTranslations("growthMap");
  const detailQuery = useGrowthMapUrlDetail(
    projectId,
    selectedSitePageId,
    diagnosticRunId,
  );

  // The detail rail is one landmark for the whole session, so it keeps the
  // same accessible name whether it is empty, loading, failed, or showing a
  // URL. Assistive technology can then announce what the region is before its
  // contents exist, instead of the region appearing only once data arrives.
  if (selectedSitePageId === null) {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedUrlDetail")}
      >
        <EmptyState
          icon={<FileSearch size={28} />}
          title={t("selectUrlTitle")}
          description={t("selectUrlDescription")}
        />
      </aside>
    );
  }
  if (detailQuery.isPending) {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedUrlDetail")}
        role="status"
      >
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  if (detailQuery.isError) {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedUrlDetail")}
      >
        <ProblemState
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
          message={t("detailError")}
        />
      </aside>
    );
  }
  return (
    <UrlDetailPanel
      key={detailQuery.data.data.sitePageId}
      projectId={projectId}
      detail={detailQuery.data.data}
      selectedFindingId={selectedFindingId}
    />
  );
}

function UrlLedger({
  items,
  selectedId,
  onSelect,
}: {
  readonly items: readonly GrowthMapUrlPortfolioItem[];
  readonly selectedId: string | null;
  readonly onSelect: (sitePageId: string) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const pageTypeLabel = usePageTypeLabel();
  return (
    <div className={styles.ledger}>
      <div className={styles.ledgerHeader} aria-hidden="true">
        <span>{t("columns.url")}</span>
        <span>{t("columns.pageType")}</span>
        <span>{t("columns.signals")}</span>
        <span>{t("columns.clicks")}</span>
        <span>{t("columns.position")}</span>
        <span>{t("columns.priority")}</span>
      </div>
      <ul className={styles.portfolioList} aria-label={t("url.label")}>
        {items.map((item) => {
          const selected = selectedId === item.sitePageId;
          return (
            <li className={styles.portfolioRow} key={item.sitePageId}>
              <div
                className={cx(
                  styles.rowButton,
                  selected && styles.rowSelected,
                )}
                data-growth-map-url-row={item.sitePageId}
              >
                <button
                  type="button"
                  className={styles.rowSelectButton}
                  aria-pressed={selected}
                  onClick={() => onSelect(item.sitePageId)}
                >
                  <span className={styles.rowSelectLabel}>
                    {t("url.selectAria", { url: item.normalizedUrl })}
                  </span>
                </button>
                <span className={styles.urlCell}>
                  <strong>{urlPresentation(item.normalizedUrl).path}</strong>
                  <span>{item.title ?? t("url.titleUnavailable")}</span>
                  <small>{item.normalizedUrl}</small>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {pageTypeLabel(item.pageType)}
                  </strong>
                  <small>{item.templateKey ?? t("url.templateUnavailable")}</small>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {item.findingIds.length}
                  </strong>
                  <small>{t("counts.findings", { count: item.findingIds.length })}</small>
                </span>
                <span className={styles.metricCell}>
                  <MetricValue
                    compact
                    observation={findMetricObservation(
                      item.metricObservations,
                      LIST_METRICS.clicks,
                    )}
                  />
                </span>
                <span className={styles.metricCell}>
                  <MetricValue
                    compact
                    observation={findMetricObservation(
                      item.metricObservations,
                      LIST_METRICS.position,
                    )}
                  />
                </span>
                <span className={styles.priorityCell}>
                  {item.priority.availability === "available" ? (
                    <span
                      className={cx(
                        styles.priorityPill,
                        PRIORITY_CLASS[item.priority.value],
                      )}
                    >
                      {PRIORITY_CODE[item.priority.value]}
                    </span>
                  ) : (
                    <span className={styles.priorityUnavailable}>—</span>
                  )}
                  <ArrowRight aria-hidden="true" size={17} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UrlPageView({
  projectId,
  diagnosticRunId,
  items,
  requestedId,
  selectedFindingId,
  search,
  pageTypeFilter,
  priorityFilter,
  onSelect,
  onRepairSelection,
}: {
  readonly projectId: string;
  readonly diagnosticRunId: string;
  readonly items: readonly GrowthMapUrlPortfolioItem[];
  readonly requestedId: string | null;
  readonly selectedFindingId: string | null;
  readonly search: string;
  readonly pageTypeFilter: GrowthMapUrlPageTypeFilter;
  readonly priorityFilter: GrowthMapUrlPriorityFilter;
  readonly onSelect: (sitePageId: string) => void;
  readonly onRepairSelection: (sitePageId: string | null) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const normalizedSearch = search.normalize("NFKC").trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () =>
      filterGrowthMapUrlItems(items, {
        pageType: pageTypeFilter,
        priority: priorityFilter,
      }).filter((item) => {
        if (normalizedSearch.length === 0) return true;
        return [
          item.normalizedUrl,
          item.title,
          item.templateKey,
          item.clusterKey,
        ].some((value) =>
          value?.normalize("NFKC").toLocaleLowerCase().includes(normalizedSearch),
        );
      }),
    [items, normalizedSearch, pageTypeFilter, priorityFilter],
  );
  const selectedId = resolveVisibleGrowthMapUrlSelection(
    requestedId,
    visibleItems.map((item) => item.sitePageId),
  );

  useEffect(() => {
    if (requestedId === null || requestedId === selectedId) return;
    onRepairSelection(selectedId);
  }, [onRepairSelection, requestedId, selectedId]);

  if (visibleItems.length === 0) {
    return (
      <EmptyState
        className={styles.portfolioEmpty}
        icon={<Globe2 size={30} />}
        title={t("empty.url")}
        description={t("url.description")}
      />
    );
  }
  return (
    <div className={styles.workspace}>
      <div className={styles.masterColumn}>
        <UrlLedger
          items={visibleItems}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <p className={styles.completeViewScope}>
          {t("searchScope")} · {t("counts.urls", { count: visibleItems.length })}
        </p>
      </div>
      <DetailState
        projectId={projectId}
        selectedSitePageId={selectedId}
        selectedFindingId={selectedFindingId}
        diagnosticRunId={diagnosticRunId}
      />
    </div>
  );
}

function OpportunityPriorityPill({
  item,
}: {
  readonly item: GrowthMapOpportunityViewItem;
}) {
  const t = useTranslations("growthMap.pageViews.opportunity");
  const tPriority = useTranslations("priorityBand");
  if (item.priority.availability === "unavailable") {
    return (
      <span className={styles.priorityUnavailable}>
        {t("priorityUnavailable")}
        <LimitationHint
          label={t("priorityUnavailableHint")}
          limitations={[item.priority.limitation]}
        />
      </span>
    );
  }
  return (
    <span
      className={cx(styles.priorityPill, PRIORITY_CLASS[item.priority.value])}
    >
      {PRIORITY_CODE[item.priority.value]} · {tPriority(item.priority.value)}
    </span>
  );
}

function opportunityOutputType(opportunity: GrowthOpportunity): string | null {
  if (opportunity.readiness === "confirmed") {
    return opportunity.action.artifactType;
  }
  if (opportunity.readiness === "reviewable") {
    return opportunity.executionPreview?.artifactType ?? null;
  }
  return null;
}

function OpportunityLedger({
  items,
  selectedId,
  onSelect,
}: {
  readonly items: readonly GrowthMapOpportunityViewItem[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const tExecution = useTranslations("growthMap.executionPreview");
  return (
    <div
      className={cx(styles.ledger, styles.groupedLedger)}
      data-growth-map-opportunity-ledger
    >
      <div
        className={cx(styles.ledgerHeader, styles.opportunityLedgerHeader)}
        aria-hidden="true"
        data-growth-map-opportunity-ledger-header
      >
        <span>{t("columns.opportunity")}</span>
        <span>{t("columns.type")}</span>
        <span>{t("columns.priority")}</span>
        <span>{t("columns.urls")}</span>
        <span>{t("columns.artifacts")}</span>
        <span>{t("columns.status")}</span>
      </div>
      <ul className={styles.portfolioList} aria-label={t("opportunity.label")}>
        {items.map((item) => {
          const opportunity = item.opportunity;
          const outputType = opportunityOutputType(opportunity);
          const selected = selectedId === item.id;
          return (
            <li className={styles.portfolioRow} key={item.id}>
              <div
                className={cx(
                  styles.rowButton,
                  styles.opportunityRowButton,
                  selected && styles.rowSelected,
                )}
                data-growth-map-opportunity-row={item.id}
              >
                <button
                  type="button"
                  className={styles.rowSelectButton}
                  aria-pressed={selected}
                  onClick={() => onSelect(item.id)}
                >
                  <span className={styles.rowSelectLabel}>
                    {opportunity.title} — {opportunity.targetRef}
                  </span>
                </button>
                <span className={styles.urlCell}>
                  <strong>{opportunity.title}</strong>
                  <span>
                    {opportunity.targetRef} ·{" "}
                    {t(`opportunity.target.${opportunity.primaryTarget}`)}
                  </span>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {t(
                      `opportunity.lenses.${opportunity.lenses[0] ?? "site_health"}`,
                    )}
                  </strong>
                </span>
                <span className={styles.metricCell}>
                  <OpportunityPriorityPill item={item} />
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {item.targetPages.length}
                  </strong>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {outputType === null
                      ? "—"
                      : tExecution(`artifactTypes.${outputType}`)}
                  </strong>
                </span>
                <span className={styles.priorityCell}>
                  <span
                    className={cx(
                      styles.pageViewStatus,
                      styles[`pageViewStatus${opportunity.readiness}`],
                    )}
                  >
                    {t(`opportunity.readiness.${opportunity.readiness}`)}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Direct review for a reviewable Opportunity whose Finding has no crawled
 * URL target (new-asset coverage gaps). Every URL-backed Opportunity reviews
 * through its exact page evidence instead; this inline control exists only
 * because such Findings would otherwise have no review surface at all.
 */
function OpportunityInlineReview({
  projectId,
  opportunity,
  onReviewed,
}: {
  readonly projectId: string;
  readonly opportunity: Extract<GrowthOpportunity, { readiness: "reviewable" }>;
  readonly onReviewed: () => void;
}) {
  const t = useTranslations("growthMap");
  const tCommon = useTranslations("common");
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  const review = useReviewFinding(projectId);
  const [mode, setMode] = useState<GrowthMapFindingReviewMode>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function refreshOpportunities(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["opportunities", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["growth-map", projectId, uiLocale, "page-views"],
        refetchType: "active",
      }),
    ]);
  }

  async function submit(body: ReviewFindingRequest): Promise<void> {
    setError(null);
    setSaved(false);
    try {
      await review.mutateAsync({
        findingId: opportunity.primaryFindingId,
        body,
      });
      setMode("idle");
      setText("");
      // Pin the reviewed Opportunity before the refetched projection re-ranks
      // it: without this the rail silently jumps to the next near-identical
      // row and a successful decision reads as "nothing happened".
      onReviewed();
      await refreshOpportunities();
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("reviewConflict"));
        try {
          await refreshOpportunities();
        } catch {
          // The conflict notice already tells the operator to reload; a failed
          // background refresh must not replace that message.
        }
      } else {
        setError(t("reviewError"));
      }
    }
  }

  function openForm(nextMode: GrowthMapFindingReviewMode): void {
    setMode(nextMode);
    setText("");
    setError(null);
    setSaved(false);
  }

  function submitTextReview(): void {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setError(mode === "dismiss" ? t("reasonTooShort") : t("noteTooShort"));
      return;
    }
    const baseRevision = opportunity.primaryFindingReviewRevision;
    void submit(
      mode === "dismiss"
        ? { reviewState: "ignored", baseRevision, reason: trimmed }
        : { reviewState: "needs_more_data", baseRevision, note: trimmed },
    );
  }

  const busy = review.isPending;

  return (
    <div
      className={styles.reviewPanel}
      aria-busy={busy}
      data-opportunity-inline-review={opportunity.primaryFindingId}
    >
      <div className={styles.reviewButtons}>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() =>
            void submit({
              reviewState: "confirmed",
              baseRevision: opportunity.primaryFindingReviewRevision,
            })
          }
          disabled={busy}
        >
          {t("confirm")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => openForm("needs_more_data")}
          disabled={busy}
          aria-expanded={mode === "needs_more_data"}
        >
          {t("needsData")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => openForm("dismiss")}
          disabled={busy}
          aria-expanded={mode === "dismiss"}
        >
          {t("dismiss")}
        </Button>
      </div>

      {mode === "idle" ? null : (
        <div className={styles.reviewForm}>
          <Field
            label={mode === "dismiss" ? t("reason") : t("note")}
            help={mode === "dismiss" ? t("reasonHelp") : t("noteHelp")}
            required
            error={error ?? undefined}
          >
            <TextArea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              disabled={busy}
            />
          </Field>
          <div className={styles.reviewFormActions}>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={submitTextReview}
              disabled={busy}
            >
              {busy ? t("savingReview") : t("submitReview")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => openForm("idle")}
              disabled={busy}
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      {error !== null ? (
        <p className={styles.reviewError} role="alert">
          {error}
        </p>
      ) : null}
      {mode === "idle" && saved ? (
        <p className={styles.reviewSaved} role="status">
          {t("reviewSaved")}
        </p>
      ) : null}
      {busy ? (
        <p className={styles.reviewPending} role="status">
          {t("savingReview")}
        </p>
      ) : null}
    </div>
  );
}

function OpportunityDetailPanel({
  projectId,
  item,
  onOpenUrl,
  onPinSelection,
}: {
  readonly projectId: string;
  readonly item: GrowthMapOpportunityViewItem;
  readonly onOpenUrl: (sitePageId: string, findingId: string | null) => void;
  readonly onPinSelection: (id: string) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const tRoot = useTranslations("growthMap");
  const tExecution = useTranslations("growthMap.executionPreview");
  const tActionStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  const tProvider = useTranslations("provider");
  const tPlatform = useTranslations("growthMap.platformLimitations");
  const [targetsExpanded, setTargetsExpanded] = useState(false);
  const opportunity = item.opportunity;
  const outputType = opportunityOutputType(opportunity);
  const findingCount =
    opportunity.supportingFindingIds.length +
    (opportunity.readiness === "candidate" ? 0 : 1);
  const firstTarget = item.targetPages[0] ?? null;
  const primaryFindingId =
    opportunity.readiness === "candidate" ? null : opportunity.primaryFindingId;
  const nextBoundaryKey =
    opportunity.readiness === "candidate"
      ? "candidateBoundary"
      : opportunity.readiness === "reviewable"
        ? "reviewBoundary"
        : "confirmedBoundary";
  const evidenceProviders = Array.from(
    new Set(opportunity.evidenceSummary.map((trace) => trace.sourceProvider)),
  );

  return (
    <aside
      className={cx(styles.detailPanel, styles.opportunityDetailPanel)}
      aria-label={t("opportunity.detailLabel")}
      data-opportunity-detail={item.id}
    >
      <header className={styles.detailHeader}>
        <div className={styles.detailEyebrow}>
          <span>
            {t("opportunity.eyebrow")} ·{" "}
            {item.priority.availability === "available"
              ? PRIORITY_CODE[item.priority.value]
              : "—"}
          </span>
          <span
            className={cx(
              styles.pageViewStatus,
              styles[`pageViewStatus${opportunity.readiness}`],
            )}
          >
            {t(`opportunity.readiness.${opportunity.readiness}`)}
          </span>
        </div>
        <div className={styles.detailTitleRow}>
          <div>
            <h2>{opportunity.title}</h2>
            <p>
              {opportunity.lenses
                .map((lens) => t(`opportunity.lenses.${lens}`))
                .join(" / ")}
              {" · "}
              {t(`opportunity.workShape.${opportunity.workShape}`)}
              {" · "}
              {t(`opportunity.target.${opportunity.primaryTarget}`)}
            </p>
          </div>
        </div>
      </header>

      <section className={styles.detailSummary}>
        <div>
          <span>{t("opportunity.metrics.urls")}</span>
          <strong>{item.targetPages.length}</strong>
        </div>
        <div>
          <span>{t("opportunity.metrics.findings")}</span>
          <strong>{findingCount}</strong>
        </div>
        <div>
          <span>{t("opportunity.metrics.output")}</span>
          <strong>
            {outputType === null
              ? "—"
              : tExecution(`artifactTypes.${outputType}`)}
          </strong>
        </div>
      </section>

      <section className={styles.compactRailSection}>
        <div className={styles.railSectionHeading}>
          <span>{t("opportunity.sections.primaryFinding")}</span>
          {opportunity.readiness === "candidate" ? null : (
            <strong>{tPriority(opportunity.primaryFindingSeverity)}</strong>
          )}
        </div>
        <h3>{opportunity.title}</h3>
        <p>{opportunity.targetRef}</p>
        {opportunity.readiness === "candidate" ? null : (
          <small>{opportunity.primaryRule.ruleId}</small>
        )}
      </section>

      <section className={styles.compactRailSection}>
        <div className={styles.railSectionHeading}>
          <span>{t("opportunity.sections.evidence")}</span>
          <strong>
            {t("opportunity.evidenceCount", {
              count: opportunity.evidenceSummary.length,
            })}
          </strong>
        </div>
        {opportunity.evidenceSummary.length === 0 ? (
          <p>{t("opportunity.noEvidence")}</p>
        ) : (
          <>
            <div className={styles.queryChipGroups}>
              {evidenceProviders.map((provider) => (
                <span key={provider}>
                  {tProvider.has(provider) ? tProvider(provider) : provider}
                </span>
              ))}
            </div>
            <ul className={styles.compactRailList}>
              {opportunity.evidenceSummary.slice(0, 3).map((trace) => (
                <li
                  key={
                    trace.traceKind === "evidence"
                      ? trace.evidenceId
                      : trace.observationId
                  }
                >
                  <strong>{trace.claim}</strong>
                  <small>
                    {tProvider.has(trace.sourceProvider)
                      ? tProvider(trace.sourceProvider)
                      : trace.sourceProvider}
                  </small>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={styles.compactRailSection}>
        <div className={styles.railSectionHeading}>
          <span>{t("opportunity.sections.targets")}</span>
          <strong>
            {t("opportunity.targetsCount", {
              count: item.targetPages.length,
            })}
          </strong>
        </div>
        {item.targetPages.length === 0 ? (
          <p>{t("opportunity.noTargets")}</p>
        ) : (
          <>
            <ul
              className={cx(
                styles.compactRailActions,
                targetsExpanded && styles.railTargetScroll,
              )}
            >
              {(targetsExpanded
                ? item.targetPages
                : item.targetPages.slice(0, 5)
              ).map((page) => (
                <li key={page.sitePageId}>
                  <button
                    type="button"
                    onClick={() => onOpenUrl(page.sitePageId, primaryFindingId)}
                  >
                    <span className={styles.railTargetText}>
                      <strong>
                        {urlPresentation(page.normalizedUrl).path}
                      </strong>
                      <small>{page.title ?? tRoot("titleNotCollected")}</small>
                    </span>
                    <ArrowRight aria-hidden="true" size={15} />
                  </button>
                </li>
              ))}
            </ul>
            {/* The count above promises every target; never let the list
                silently deliver fewer than the section header claims. */}
            {item.targetPages.length > 5 ? (
              <button
                type="button"
                className={styles.railShowAll}
                aria-expanded={targetsExpanded}
                onClick={() => setTargetsExpanded((open) => !open)}
              >
                {targetsExpanded
                  ? t("opportunity.collapseTargets")
                  : t("opportunity.showAllTargets", {
                      count: item.targetPages.length - 5,
                    })}
              </button>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.compactRailSection}>
        <span>{t("opportunity.sections.limitations")}</span>
        {opportunity.coverageAndLimitations.length === 0 ? (
          <p>{t("opportunity.noLimitations")}</p>
        ) : (
          <ul className={styles.railLimitationList}>
            {opportunity.coverageAndLimitations.map((limitation) => {
              const key = growthMapPlatformLimitationKey(limitation);
              return (
                <li key={limitation}>
                  {key === null ? limitation : tPlatform(key)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.compactRailSection}>
        <span>{t("opportunity.sections.output")}</span>
        {opportunity.readiness === "confirmed" ? (
          <p>
            {tExecution(`artifactTypes.${opportunity.action.artifactType}`)} ·{" "}
            {tActionStatus(opportunity.action.status)}
          </p>
        ) : opportunity.readiness === "reviewable" &&
          opportunity.executionPreview !== null ? (
          <>
            <h3 lang={opportunity.executionPreview.contentLocale}>
              {opportunity.executionPreview.title}
            </h3>
            <p lang={opportunity.executionPreview.contentLocale}>
              {opportunity.executionPreview.description}
            </p>
          </>
        ) : (
          <p>{t("opportunity.noOutput")}</p>
        )}
      </section>

      <section className={cx(styles.compactRailSection, styles.nextDecision)}>
        <span>{t("opportunity.sections.decision")}</span>
        <p>
          {t(
            opportunity.readiness === "reviewable" && firstTarget === null
              ? "opportunity.reviewBoundaryNoTargets"
              : `opportunity.${nextBoundaryKey}`,
          )}
        </p>
        {opportunity.readiness === "confirmed" ? (
          <Link
            className={styles.detailPrimaryActionLink}
            href={executionHrefForRef(projectId, {
              actionId: opportunity.actionId,
              artifactIds: [],
            })}
          >
            {t("opportunity.openExecution")}
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        ) : opportunity.readiness === "reviewable" && firstTarget === null ? (
          <OpportunityInlineReview
            projectId={projectId}
            opportunity={opportunity}
            onReviewed={() => onPinSelection(item.id)}
          />
        ) : firstTarget === null ? null : (
          <Button
            type="button"
            variant={
              opportunity.readiness === "reviewable" ? "primary" : "secondary"
            }
            onClick={() => onOpenUrl(firstTarget.sitePageId, primaryFindingId)}
          >
            {t(
              opportunity.readiness === "reviewable"
                ? "opportunity.review"
                : "opportunity.inspectEvidence",
            )}
            <ArrowRight aria-hidden="true" size={17} />
          </Button>
        )}
      </section>
    </aside>
  );
}

function OpportunityPageView({
  projectId,
  diagnosticRunId,
  items,
  requestedId,
  search,
  pageTypeFilter,
  priorityFilter,
  selectedSitePageId,
  selectedFindingId,
  onSelect,
  onRepairSelection,
  onPinSelection,
  onOpenUrl,
  onCloseUrl,
}: {
  readonly projectId: string;
  readonly diagnosticRunId: string;
  readonly items: readonly GrowthMapOpportunityViewItem[];
  readonly requestedId: string | null;
  readonly search: string;
  readonly pageTypeFilter: GrowthMapUrlPageTypeFilter;
  readonly priorityFilter: GrowthMapUrlPriorityFilter;
  readonly selectedSitePageId: string | null;
  readonly selectedFindingId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onRepairSelection: (id: string | null) => void;
  readonly onPinSelection: (id: string) => void;
  readonly onOpenUrl: (sitePageId: string, findingId: string | null) => void;
  readonly onCloseUrl: () => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const normalizedSearch = search.normalize("NFKC").trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (
          pageTypeFilter !== "all" &&
          filterGrowthMapUrlItems(item.targetPages, {
            pageType: pageTypeFilter,
            priority: "all",
          }).length === 0
        ) {
          return false;
        }
        if (
          priorityFilter !== "all" &&
          (item.priority.availability !== "available" ||
            item.priority.value !== priorityFilter)
        ) {
          return false;
        }
        if (normalizedSearch.length === 0) return true;
        const opportunity = item.opportunity;
        return [
          opportunity.title,
          opportunity.targetRef,
          opportunity.workShape,
          opportunity.primaryTarget,
          ...item.targetPages.map((page) => page.normalizedUrl),
        ].some((value) =>
          value
            .normalize("NFKC")
            .toLocaleLowerCase()
            .includes(normalizedSearch),
        );
      }),
    [items, normalizedSearch, pageTypeFilter, priorityFilter],
  );
  const selectedId = resolveVisibleGrowthMapOpportunitySelection(
    requestedId,
    visibleItems.map((item) => item.id),
  );
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null;
  const urlDetailOpen = selectedSitePageId !== null;

  useEffect(() => {
    if (requestedId === null || requestedId === selectedId) return;
    onRepairSelection(selectedId);
  }, [onRepairSelection, requestedId, selectedId]);

  if (visibleItems.length === 0 && !urlDetailOpen) {
    return (
      <EmptyState
        className={styles.portfolioEmpty}
        icon={<Target size={30} />}
        title={t("empty.opportunity")}
        description={t("opportunity.description")}
      />
    );
  }
  return (
    <div
      className={cx(styles.workspace, styles.opportunityWorkspace)}
      data-growth-map-opportunity-workspace
    >
      <div
        className={styles.masterColumn}
        data-growth-map-opportunity-master
      >
        {visibleItems.length === 0 ? (
          <EmptyState
            className={styles.portfolioEmpty}
            icon={<Target size={30} />}
            title={t("empty.opportunity")}
            description={t("opportunity.description")}
          />
        ) : (
          <OpportunityLedger
            items={visibleItems}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
        <p className={styles.completeViewScope}>
          {t("searchScope")} ·{" "}
          {t("counts.opportunities", { count: visibleItems.length })}
        </p>
      </div>
      {urlDetailOpen ? (
        <div
          className={styles.opportunityDrilldown}
          data-growth-map-url-drilldown={selectedSitePageId}
        >
          <button
            type="button"
            className={styles.backToOpportunities}
            onClick={onCloseUrl}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {t("opportunity.backToList")}
          </button>
          <DetailState
            projectId={projectId}
            selectedSitePageId={selectedSitePageId}
            selectedFindingId={selectedFindingId}
            diagnosticRunId={diagnosticRunId}
          />
        </div>
      ) : selected === null ? (
        <aside className={styles.detailPlaceholder}>
          <p>{t("select.opportunity")}</p>
        </aside>
      ) : (
        <OpportunityDetailPanel
          key={selected.id}
          projectId={projectId}
          item={selected}
          onOpenUrl={onOpenUrl}
          onPinSelection={onPinSelection}
        />
      )}
    </div>
  );
}

function TopicClusterLedger({
  items,
  selectedId,
  onSelect,
}: {
  readonly items: readonly GrowthMapTopicClusterViewRow[];
  readonly selectedId: string | null;
  readonly onSelect: (topicNodeId: string) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const uiLocale = useLocale();
  return (
    <div className={cx(styles.ledger, styles.clusterLedger)}>
      <div
        className={cx(styles.ledgerHeader, styles.clusterLedgerHeader)}
        aria-hidden="true"
      >
        <span>{t("columns.topic")}</span>
        <span>{t("columns.role")}</span>
        <span>{t("columns.urls")}</span>
        <span>{t("columns.keywords")}</span>
        <span>{t("columns.volume")}</span>
        <span>{t("columns.coverage")}</span>
      </div>
      <ul className={styles.portfolioList} aria-label={t("cluster.label")}>
        {items.map((item) => {
          const selected = selectedId === item.topicNodeId;
          return (
            <li className={styles.portfolioRow} key={item.topicNodeId}>
              <div
                className={cx(
                  styles.rowButton,
                  styles.clusterRowButton,
                  selected && styles.rowSelected,
                )}
                data-growth-map-cluster-row={item.topicNodeId}
              >
                <button
                  type="button"
                  className={styles.rowSelectButton}
                  aria-pressed={selected}
                  onClick={() => onSelect(item.topicNodeId)}
                >
                  <span className={styles.rowSelectLabel}>
                    {t("cluster.selectAria", { topic: item.label })}
                  </span>
                </button>
                <span
                  className={styles.urlCell}
                  style={{ paddingInlineStart: `${item.depth * 14}px` }}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description ?? t("cluster.descriptionUnavailable")}</span>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {item.depth === 0 ? t("cluster.root") : t("cluster.child")}
                  </strong>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {item.pageCount}
                  </strong>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {item.keywordCount}
                  </strong>
                </span>
                <span className={styles.metricCell}>
                  <strong className={styles.libraryMetricPrimary}>
                    {item.searchVolume.value === null
                      ? "—"
                      : formatNumber(uiLocale, item.searchVolume.value)}
                  </strong>
                  {item.searchVolume.limitation === null ? null : (
                    <small>{t(`cluster.searchVolume.${item.searchVolume.limitation}`)}</small>
                  )}
                </span>
                <span className={styles.priorityCell}>
                  <span
                    className={cx(
                      styles.pageViewStatus,
                      styles[`clusterCoverage${item.coverageState}`],
                    )}
                  >
                    {t(`cluster.coverage.${item.coverageState}`)}
                  </span>
                  <ArrowRight aria-hidden="true" size={17} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TopicClusterDetailPanel({
  item,
  onOpenUrl,
  onOpenOpportunity,
}: {
  readonly item: GrowthMapTopicClusterViewRow;
  readonly onOpenUrl: (sitePageId: string) => void;
  readonly onOpenOpportunity: (opportunityId: string) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const uiLocale = useLocale();
  const primaryPage = item.primaryPage;
  const topOpportunity = item.topOpportunity;
  return (
    <aside
      className={styles.detailPanel}
      aria-label={t("cluster.detailLabel")}
      data-cluster-detail={item.topicNodeId}
    >
      <header className={styles.detailHeader}>
        <div className={styles.detailEyebrow}>
          <span>{t("cluster.eyebrow")}</span>
          <span
            className={cx(
              styles.pageViewStatus,
              styles[`clusterCoverage${item.coverageState}`],
            )}
          >
            {t(`cluster.coverage.${item.coverageState}`)}
          </span>
        </div>
        <div className={styles.detailTitleRow}>
          <div>
            <h2>{item.label}</h2>
            <p>{item.description ?? t("cluster.descriptionUnavailable")}</p>
          </div>
        </div>
      </header>

      <section className={styles.detailSummary}>
        <div>
          <span>{t("cluster.metrics.pages")}</span>
          <strong>{item.pageCount}</strong>
        </div>
        <div>
          <span>{t("cluster.metrics.keywords")}</span>
          <strong>{item.keywordCount}</strong>
        </div>
        <div>
          <span>{t("cluster.metrics.volume")}</span>
          <strong>
            {item.searchVolume.value === null
              ? "—"
              : formatNumber(uiLocale, item.searchVolume.value)}
          </strong>
        </div>
      </section>

      <section className={styles.compactRailSection}>
        <div className={styles.railSectionHeading}>
          <span>{t("cluster.sections.path")}</span>
        </div>
        <div className={styles.clusterConversionPath}>
          <div>
            <span>01</span>
            <small>{t("cluster.path.topic")}</small>
            <strong>{item.label}</strong>
          </div>
          <ArrowRight aria-hidden="true" size={16} />
          <div>
            <span>02</span>
            <small>{t("cluster.path.page")}</small>
            <strong>
              {primaryPage === null
                ? t("cluster.noMappedPage")
                : urlPresentation(primaryPage.normalizedUrl).path}
            </strong>
          </div>
          <ArrowRight aria-hidden="true" size={16} />
          <div>
            <span>03</span>
            <small>{t("cluster.path.cta")}</small>
            <strong>{t("cluster.ctaUnavailable")}</strong>
          </div>
        </div>
        <p className={styles.sectionBoundaryCopy}>
          {t("cluster.ctaUnavailableDescription")}
        </p>
      </section>

      <section className={styles.compactRailSection}>
        <div className={styles.railSectionHeading}>
          <span>{t("cluster.sections.pages")}</span>
          <strong>{t("cluster.itemCount", { count: item.pages.length })}</strong>
        </div>
        {item.pages.length === 0 ? (
          <p>{t("cluster.noPages")}</p>
        ) : (
          <ul className={styles.compactRailActions}>
            {item.pages.slice(0, 6).map((page) => (
              <li key={page.sitePageId}>
                <button type="button" onClick={() => onOpenUrl(page.sitePageId)}>
                  <span className={styles.railTargetText}>
                    <strong>{urlPresentation(page.normalizedUrl).path}</strong>
                    <small>{page.title ?? t("url.titleUnavailable")}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.compactRailSection}>
        <div className={styles.railSectionHeading}>
          <span>{t("cluster.sections.demand")}</span>
          <strong>{t("cluster.queryCount", { count: item.keywords.length })}</strong>
        </div>
        {item.keywords.length === 0 ? (
          <p>{t("cluster.noKeywords")}</p>
        ) : (
          <ul className={styles.compactRailList}>
            {item.keywords.slice(0, 8).map((keyword) => (
              <li key={keyword.keywordId}>
                <strong>{keyword.displayKeyword}</strong>
                <small>
                  {keyword.searchIntent.value ?? t("cluster.intentUnavailable")}
                  {" · "}
                  {keyword.metrics.volume?.value === null ||
                  keyword.metrics.volume?.value === undefined
                    ? t("cluster.volumeUnavailable")
                    : formatNumber(uiLocale, keyword.metrics.volume.value)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.compactRailSection}>
        <div className={styles.railSectionHeading}>
          <span>{t("cluster.sections.opportunity")}</span>
        </div>
        {topOpportunity === null ? (
          <p>{t("cluster.noOpportunity")}</p>
        ) : (
          <button
            type="button"
            className={styles.clusterOpportunityAction}
            onClick={() => onOpenOpportunity(topOpportunity.id)}
          >
            <span>
              <strong>{topOpportunity.opportunity.title}</strong>
              <small>{topOpportunity.opportunity.targetRef}</small>
            </span>
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        )}
        {item.coverageLimitation === null ? null : (
          <LimitationList limitations={[item.coverageLimitation]} />
        )}
      </section>
    </aside>
  );
}

function TopicClusterPageView({
  items,
  requestedId,
  search,
  pageTypeFilter,
  priorityFilter,
  onSelect,
  onRepairSelection,
  onOpenUrl,
  onOpenOpportunity,
}: {
  readonly items: readonly GrowthMapTopicClusterViewRow[];
  readonly requestedId: string | null;
  readonly search: string;
  readonly pageTypeFilter: GrowthMapUrlPageTypeFilter;
  readonly priorityFilter: GrowthMapUrlPriorityFilter;
  readonly onSelect: (topicNodeId: string) => void;
  readonly onRepairSelection: (topicNodeId: string | null) => void;
  readonly onOpenUrl: (sitePageId: string) => void;
  readonly onOpenOpportunity: (opportunityId: string) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const normalizedSearch = search.normalize("NFKC").trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (
          pageTypeFilter !== "all" &&
          !item.pages.some((page) => page.pageType === pageTypeFilter)
        ) {
          return false;
        }
        if (
          priorityFilter !== "all" &&
          (item.topOpportunity?.priority.availability !== "available" ||
            item.topOpportunity.priority.value !== priorityFilter)
        ) {
          return false;
        }
        if (normalizedSearch.length === 0) return true;
        return [
          item.label,
          item.description,
          ...item.pages.map((page) => `${page.normalizedUrl} ${page.title ?? ""}`),
          ...item.keywords.map((keyword) => keyword.displayKeyword),
        ].some((value) =>
          value?.normalize("NFKC").toLocaleLowerCase().includes(normalizedSearch),
        );
      }),
    [items, normalizedSearch, pageTypeFilter, priorityFilter],
  );
  const selectedId = resolveVisibleGrowthMapClusterSelection(
    requestedId,
    visibleItems.map((item) => item.topicNodeId),
  );
  const selected = visibleItems.find((item) => item.topicNodeId === selectedId) ?? null;

  useEffect(() => {
    if (requestedId === null || requestedId === selectedId) return;
    onRepairSelection(selectedId);
  }, [onRepairSelection, requestedId, selectedId]);

  if (visibleItems.length === 0) {
    return (
      <EmptyState
        className={styles.portfolioEmpty}
        icon={<Network size={30} />}
        title={t("empty.cluster")}
        description={t("cluster.description")}
      />
    );
  }
  return (
    <div className={styles.workspace}>
      <div className={styles.masterColumn}>
        <TopicClusterLedger
          items={visibleItems}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <p className={styles.completeViewScope}>
          {t("searchScope")} · {t("counts.clusters", { count: visibleItems.length })}
        </p>
      </div>
      {selected === null ? (
        <aside className={styles.detailPlaceholder}>
          <p>{t("select.cluster")}</p>
        </aside>
      ) : (
        <TopicClusterDetailPanel
          key={selected.topicNodeId}
          item={selected}
          onOpenUrl={onOpenUrl}
          onOpenOpportunity={onOpenOpportunity}
        />
      )}
    </div>
  );
}

function PageViewTabs({
  activeView,
  onSelect,
}: {
  readonly activeView: GrowthMapPageView;
  readonly onSelect: (view: GrowthMapPageView) => void;
}) {
  const t = useTranslations("growthMap.pageViews");
  const tabRefs = useRef<Partial<Record<GrowthMapPageView, HTMLButtonElement>>>(
    {},
  );

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const current = event.currentTarget.dataset.pageViewTab as
      | GrowthMapPageView
      | undefined;
    if (current === undefined) return;
    const currentIndex = GROWTH_MAP_PAGE_VIEWS.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % GROWTH_MAP_PAGE_VIEWS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + GROWTH_MAP_PAGE_VIEWS.length) %
        GROWTH_MAP_PAGE_VIEWS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = GROWTH_MAP_PAGE_VIEWS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextView = GROWTH_MAP_PAGE_VIEWS[nextIndex] ?? activeView;
    onSelect(nextView);
    tabRefs.current[nextView]?.focus();
  }

  return (
    <section className={styles.pageViewSwitcher}>
      <span>{t("viewLabel")}</span>
      <div role="tablist" aria-label={t("viewSwitcherLabel")}>
        {GROWTH_MAP_PAGE_VIEWS.map((view) => (
          <button
            type="button"
            role="tab"
            id={`sf-growth-map-page-view-${view}`}
            aria-controls={`sf-growth-map-page-panel-${view}`}
            aria-selected={activeView === view}
            tabIndex={activeView === view ? 0 : -1}
            className={cx(
              styles.pageViewTab,
              activeView === view && styles.pageViewTabActive,
            )}
            data-page-view-tab={view}
            key={view}
            ref={(element) => {
              if (element === null) delete tabRefs.current[view];
              else tabRefs.current[view] = element;
            }}
            onClick={() => onSelect(view)}
            onKeyDown={handleKeyDown}
          >
            {t(`view.${view}`)}
          </button>
        ))}
      </div>
    </section>
  );
}

function PortfolioPane({
  projectId,
  locationSearch,
  navigation,
  diagnosticRunId,
}: {
  readonly projectId: string;
  readonly locationSearch: string;
  readonly navigation: GrowthMapNavigationController;
  readonly diagnosticRunId: string;
}) {
  const t = useTranslations("growthMap");
  const tPriority = useTranslations("priorityBand");
  const pageTypeLabel = usePageTypeLabel();
  const moreFiltersId = useId();
  const pathname = usePathname();
  const canonicalSearchParams = useSearchParams();
  const canonicalLocationSearch = canonicalSearchParams.toString();
  const canonicalMode = normalizeGrowthMapObjectMode(
    canonicalSearchParams.get("object"),
  );
  const locationParams = useMemo(
    () => new URLSearchParams(locationSearch),
    [locationSearch],
  );
  const querySearch = locationParams.get("q") ?? "";
  const pageView = normalizeGrowthMapPageView(locationParams.get("view"));
  const selectedSitePageId = locationParams.get("selectedSitePageId");
  const selectedClusterParam = locationParams.get("selectedClusterId");
  const selectedOpportunityParam = locationParams.get("selectedOpportunityId");
  const selectedFindingId = locationParams.get("findingId");
  const [searchDraft, setSearchDraft] = useState(querySearch);
  const [pageTypeFilter, setPageTypeFilter] =
    useState<GrowthMapUrlPageTypeFilter>("all");
  const [priorityFilter, setPriorityFilter] =
    useState<GrowthMapUrlPriorityFilter>("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  // Loaded for the frozen-generation summary band only; the ledger below is
  // the complete Opportunity projection, not this bounded first page.
  const listQuery = useGrowthMapUrls(projectId, {
    search: null,
    cursor: null,
    limit: 50,
    diagnosticRunId,
  });
  const uiLocale = useLocale();
  const completeUrlsQuery = useQuery({
    queryKey: [
      "growth-map",
      projectId,
      uiLocale,
      "page-views",
      diagnosticRunId,
      "complete-urls",
    ],
    queryFn: () => readCompleteGrowthMapUrls(projectId, diagnosticRunId),
  });
  const completeOpportunitiesQuery = useQuery({
    queryKey: [
      "growth-map",
      projectId,
      uiLocale,
      "page-views",
      diagnosticRunId,
      "complete-opportunities",
    ],
    queryFn: () =>
      readCompleteGrowthMapOpportunities(projectId, diagnosticRunId),
  });
  const completeKeywordsQuery = useQuery({
    queryKey: [
      "growth-map",
      projectId,
      uiLocale,
      "page-views",
      diagnosticRunId,
      "complete-keywords",
    ],
    queryFn: () => readCompleteGrowthMapKeywords(projectId, diagnosticRunId),
    enabled: pageView === "cluster",
  });
  const topicWorkspaceQuery = useGrowthMapTopicModelWorkspace(projectId);
  const topicInsightsQuery = useGrowthMapTopicModelInsights(projectId);
  // Reads the live library rather than the frozen generation: a keyword that
  // has been collected but not yet reviewed still belongs in this count. Pinned
  // to the generation this reported zero until someone had reviewed a keyword,
  // which reads as "we found nothing" instead of "nothing is reviewed yet".
  // Must stay in the same scope as the Keyword Library tab or the card and the
  // tab will disagree about the very same keywords.
  const summaryKeywordsQuery = useGrowthMapKeywords(projectId, {
    limit: 100,
    diagnosticRunId: null,
  });
  const completeUrls = completeUrlsQuery.data ?? [];
  const completeOpportunities = completeOpportunitiesQuery.data ?? [];
  const pageTypeOptions = useMemo(
    () => growthMapPageTypeFilterOptions(completeUrls),
    [completeUrls],
  );
  const opportunityViewItems = useMemo(
    () =>
      buildGrowthMapOpportunityViewItems(completeOpportunities, completeUrls),
    [completeOpportunities, completeUrls],
  );
  const topicClusterView = useMemo(() => {
    if (
      pageView !== "cluster" ||
      completeKeywordsQuery.data === undefined ||
      topicWorkspaceQuery.data === undefined ||
      topicInsightsQuery.data === undefined
    ) {
      return null;
    }
    return buildGrowthMapTopicClusterView({
      diagnosticRunId,
      keywordDiagnosticRunId: completeKeywordsQuery.data.diagnosticRunId,
      workspace: topicWorkspaceQuery.data,
      insights: topicInsightsQuery.data,
      urls: completeUrls,
      keywords: completeKeywordsQuery.data.items,
      opportunities: completeOpportunities,
    });
  }, [
    completeKeywordsQuery.data,
    completeOpportunities,
    completeUrls,
    diagnosticRunId,
    pageView,
    topicInsightsQuery.data,
    topicWorkspaceQuery.data,
  ]);

  useEffect(() => {
    setSearchDraft(querySearch);
  }, [querySearch]);

  useEffect(() => {
    if (
      navigation.isPending ||
      locationSearch !== canonicalLocationSearch ||
      canonicalMode !== "pages"
    ) {
      return;
    }
    const canonicalHref = growthMapLocationHref(
      pathname,
      canonicalLocationSearch,
      {},
    );
    const canonicalQuery = canonicalHref.includes("?")
      ? (canonicalHref.split("?")[1] ?? "")
      : "";
    if (canonicalQuery === canonicalLocationSearch) return;
    navigation.replaceCanonicalHref(canonicalHref);
  }, [
    canonicalLocationSearch,
    canonicalMode,
    canonicalSearchParams,
    locationSearch,
    navigation,
    pathname,
  ]);

  function selectOpportunity(id: string | null): void {
    // Choosing an Opportunity always brings the rail back from an exact-URL
    // drill-down; a hidden page selection must never keep controlling it.
    navigation.request({
      selectedOpportunityId: id,
      selectedSitePageId: null,
      selectedFindingId: null,
    });
  }

  function selectUrl(sitePageId: string): void {
    navigation.request({
      selectedSitePageId: sitePageId,
      selectedFindingId: null,
    });
  }

  function repairUrlSelection(sitePageId: string | null): void {
    navigation.request({ selectedSitePageId: sitePageId });
  }

  function selectCluster(topicNodeId: string): void {
    navigation.request({ selectedClusterId: topicNodeId });
  }

  function repairClusterSelection(topicNodeId: string | null): void {
    navigation.request({ selectedClusterId: topicNodeId });
  }

  function openClusterUrl(sitePageId: string): void {
    navigation.request({
      pageView: "url",
      selectedSitePageId: sitePageId,
    });
  }

  function openClusterOpportunity(opportunityId: string): void {
    navigation.request({
      pageView: "opportunity",
      selectedOpportunityId: opportunityId,
    });
  }

  function selectPageView(nextView: GrowthMapPageView): void {
    navigation.request({ pageView: nextView });
  }

  function repairOpportunitySelection(id: string | null): void {
    // Canonical-selection repair only touches the stale Opportunity id. A
    // deep link whose page selection is still valid must keep its URL
    // drill-down open even when the Opportunity it referenced is gone.
    navigation.request({ selectedOpportunityId: id });
  }

  function openUrlFromOpportunity(
    sitePageId: string,
    findingId: string | null = null,
  ): void {
    navigation.request({
      selectedSitePageId: sitePageId,
      selectedFindingId: findingId,
    });
  }

  function closeUrlDetail(): void {
    navigation.request({
      selectedSitePageId: null,
      selectedFindingId: null,
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigation.request({
      search: searchDraft,
      selectedSitePageId: null,
      selectedClusterId: null,
      selectedOpportunityId: null,
      selectedFindingId: null,
    });
  }

  if (listQuery.isPending) {
    return (
      <div className={styles.pageState} role="status">
        <Spinner label={t("loadingPortfolio")} size="lg" />
        <p>{t("loadingPortfolio")}</p>
      </div>
    );
  }

  if (listQuery.isError) {
    if (
      listQuery.error instanceof ApiError &&
      listQuery.error.code === "GROWTH_MAP_AUDIT_NOT_FOUND"
    ) {
      return (
        <EmptyState
          className={styles.pageState}
          icon={<Globe2 size={30} />}
          title={t("auditUnavailableTitle")}
          description={t("auditUnavailableDescription")}
        />
      );
    }
    return (
      <ProblemState
        error={listQuery.error}
        onRetry={() => void listQuery.refetch()}
        message={t("portfolioError")}
        className={styles.pageState}
      />
    );
  }

  const response = listQuery.data;
  // Every headline count is the server's frozen-generation total. Summing the
  // loaded rows here is what made one Finding covering 354 URLs read as 56
  // separate signals, so the page never recomputes these.
  const summary = response.meta.summary;
  const activeMoreFilterCount = priorityFilter === "all" ? 0 : 1;
  const summaryKeywords = summaryKeywordsQuery.data?.data ?? null;
  const uncoveredKeywords =
    summaryKeywords?.filter(
      (keyword) => keyword.mappedTarget.kind === "unassigned",
    ) ?? null;
  const uncoveredKeywordCount = growthMapUncoveredKeywordCountPresentation(
    summaryKeywords,
    summaryKeywordsQuery.data?.meta.hasNext === true,
  );
  const uncoveredClusterCount =
    uncoveredKeywords === null
      ? null
      : new Set(
          uncoveredKeywords.flatMap((keyword) =>
            keyword.cluster === null ? [] : [keyword.cluster.clusterId],
          ),
        ).size;

  return (
    <section aria-label={t("runProvenance")}>
      <section
        className={styles.businessSummary}
        aria-label={t("portfolioSummary.label")}
      >
        <div className={styles.businessSummaryItem}>
          <span>{t("portfolioSummary.loaded")}</span>
          <strong>{summary.urlCount}</strong>
          <small>
            {t("portfolioSummary.loadedNote", { count: summary.urlCount })}
          </small>
        </div>
        <div className={styles.businessSummaryItem}>
          <span>{t("portfolioSummary.opportunityUrls")}</span>
          <strong>{summary.opportunityUrlCount}</strong>
          <small>
            {URL_PRIORITY_FILTERS.map(
              (priority) =>
                `${PRIORITY_CODE[priority]} ${summary.priorityCounts[priority]}`,
            ).join(" · ")}
          </small>
        </div>
        <div className={styles.businessSummaryItem}>
          <span>{t("portfolioSummary.signals")}</span>
          <strong>{summary.signalCount}</strong>
          <small>
            {t("portfolioSummary.signalsNote", { count: summary.signalCount })}
          </small>
        </div>
        <div className={styles.businessSummaryItem}>
          <span>{t("portfolioSummary.uncoveredKeywords")}</span>
          <strong>
            {uncoveredKeywordCount.kind === "unavailable"
              ? t("portfolioSummary.unavailable")
              : uncoveredKeywordCount.kind === "empty"
                ? "—"
                : uncoveredKeywordCount.kind === "lower_bound"
                  ? t("portfolioSummary.uncoveredLowerBound", {
                      count: uncoveredKeywordCount.count,
                    })
                  : uncoveredKeywordCount.count}
          </strong>
          <small>
            {summaryKeywords === null || uncoveredClusterCount === null ? (
              t("portfolioSummary.unavailable")
            ) : summaryKeywords.length === 0 ? (
              <>
                {t("portfolioSummary.uncoveredEmpty")}
                {" · "}
                <Link href={`/p/${projectId}/sources`}>
                  {t("portfolioSummary.uncoveredEmptyAction")}
                </Link>
              </>
            ) : (
              t(
                summaryKeywordsQuery.data?.meta.hasNext
                  ? "portfolioSummary.uncoveredNoteTruncated"
                  : "portfolioSummary.uncoveredNote",
                {
                  count: uncoveredClusterCount,
                  loaded: summaryKeywords.length,
                },
              )
            )}
          </small>
        </div>
      </section>
      <LimitationList limitations={response.meta.coverage.limitations} />

      <PageViewTabs activeView={pageView} onSelect={selectPageView} />

      <form
        className={cx(styles.libraryToolbar, styles.portfolioToolbar)}
        role="search"
        onSubmit={submitSearch}
      >
        <label className={styles.librarySearch} htmlFor="growth-map-url-search">
          <Search aria-hidden="true" size={20} />
          <input
            id="growth-map-url-search"
            type="search"
            maxLength={256}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
          <span className={styles.rowSelectLabel}>{t("searchLabel")}</span>
        </label>
        <label className={styles.libraryFilter}>
          <span>{t("portfolioFilters.pageType")}</span>
          <select
            value={pageTypeFilter}
            onChange={(event) =>
              setPageTypeFilter(
                event.target.value as GrowthMapUrlPageTypeFilter,
              )
            }
          >
            <option value="all">{t("portfolioFilters.allPageTypes")}</option>
            {pageTypeOptions.map((pageType) => (
              <option value={pageType} key={pageType}>
                {pageTypeLabel(pageType)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.portfolioToolGroup}>
          <button
            type="button"
            className={cx(
              styles.portfolioToolButton,
              (moreFiltersOpen || activeMoreFilterCount > 0) &&
                styles.portfolioToolButtonActive,
            )}
            aria-expanded={moreFiltersOpen}
            aria-controls={moreFiltersId}
            onClick={() => setMoreFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden="true" size={17} />
            <span>{t("portfolioFilters.more")}</span>
            {activeMoreFilterCount === 0 ? null : (
              <em className={styles.portfolioToolBadge}>
                {t("portfolioFilters.moreActiveCount", {
                  count: activeMoreFilterCount,
                })}
              </em>
            )}
          </button>
        </div>
        <Button type="submit" variant="primary">
          {t("searchAction")}
        </Button>
        {moreFiltersOpen ? (
          <div
            className={styles.portfolioFilterDrawer}
            id={moreFiltersId}
            role="group"
            aria-label={t("portfolioFilters.moreLabel")}
          >
            <label className={styles.libraryFilter}>
              <span>{t("portfolioFilters.priority")}</span>
              <select
                value={priorityFilter}
                onChange={(event) =>
                  setPriorityFilter(
                    event.target.value as GrowthMapUrlPriorityFilter,
                  )
                }
              >
                <option value="all">
                  {t("portfolioFilters.allPriorities")}
                </option>
                {URL_PRIORITY_FILTERS.map((priority) => (
                  <option value={priority} key={priority}>
                    {PRIORITY_CODE[priority]} · {tPriority(priority)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </form>

      {completeUrlsQuery.isPending ||
      completeOpportunitiesQuery.isPending ||
      (pageView === "cluster" &&
        (completeKeywordsQuery.isPending ||
          topicWorkspaceQuery.isPending ||
          topicInsightsQuery.isPending)) ? (
        <div className={styles.pageState} role="status">
          <Spinner label={t("pageViews.loading")} size="lg" />
          <p>{t("pageViews.loading")}</p>
        </div>
      ) : completeUrlsQuery.isError ||
        completeOpportunitiesQuery.isError ||
        (pageView === "cluster" &&
          (completeKeywordsQuery.isError ||
            topicWorkspaceQuery.isError ||
            topicInsightsQuery.isError)) ? (
        <div className={styles.pageState}>
          <ProblemState
            error={
              completeUrlsQuery.error ??
              completeOpportunitiesQuery.error ??
              completeKeywordsQuery.error ??
              topicWorkspaceQuery.error ??
              topicInsightsQuery.error
            }
            onRetry={() => {
              void completeUrlsQuery.refetch();
              void completeOpportunitiesQuery.refetch();
              if (pageView === "cluster") {
                void completeKeywordsQuery.refetch();
                void topicWorkspaceQuery.refetch();
                void topicInsightsQuery.refetch();
              }
            }}
            message={t(
              isGrowthMapPageViewScopeMismatch(completeUrlsQuery.error) ||
                isGrowthMapPageViewScopeMismatch(
                  completeOpportunitiesQuery.error,
                ) ||
                isGrowthMapPageViewScopeMismatch(completeKeywordsQuery.error)
                ? "pageViews.scopeMismatch"
                : "pageViews.loadError",
            )}
          />
        </div>
      ) : pageView === "cluster" && topicClusterView?.kind !== "ready" ? (
        <EmptyState
          className={styles.pageState}
          icon={<CircleAlert size={30} />}
          title={t("pageViews.cluster.unavailableTitle")}
          description={t(
            `pageViews.cluster.unavailable.${
              topicClusterView?.reason ?? "confirmed_topic_unavailable"
            }`,
          )}
        />
      ) : (
        <div
          id={`sf-growth-map-page-panel-${pageView}`}
          role="tabpanel"
          aria-labelledby={`sf-growth-map-page-view-${pageView}`}
        >
          {pageView === "url" ? (
            <UrlPageView
              projectId={projectId}
              diagnosticRunId={diagnosticRunId}
              items={completeUrls}
              requestedId={selectedSitePageId}
              selectedFindingId={selectedFindingId}
              search={querySearch}
              pageTypeFilter={pageTypeFilter}
              priorityFilter={priorityFilter}
              onSelect={selectUrl}
              onRepairSelection={repairUrlSelection}
            />
          ) : pageView === "cluster" && topicClusterView?.kind === "ready" ? (
            <TopicClusterPageView
              items={topicClusterView.rows}
              requestedId={selectedClusterParam}
              search={querySearch}
              pageTypeFilter={pageTypeFilter}
              priorityFilter={priorityFilter}
              onSelect={selectCluster}
              onRepairSelection={repairClusterSelection}
              onOpenUrl={openClusterUrl}
              onOpenOpportunity={openClusterOpportunity}
            />
          ) : (
            <OpportunityPageView
              projectId={projectId}
              diagnosticRunId={diagnosticRunId}
              items={opportunityViewItems}
              requestedId={selectedOpportunityParam}
              search={querySearch}
              pageTypeFilter={pageTypeFilter}
              priorityFilter={priorityFilter}
              selectedSitePageId={selectedSitePageId}
              selectedFindingId={selectedFindingId}
              onSelect={selectOpportunity}
              onRepairSelection={repairOpportunitySelection}
              onPinSelection={repairOpportunitySelection}
              onOpenUrl={openUrlFromOpportunity}
              onCloseUrl={closeUrlDetail}
            />
          )}
        </div>
      )}
    </section>
  );
}

type KeywordMetric = GrowthMapKeywordNumericMetric | GrowthMapKeywordTextMetric;

const KEYWORD_STATUS_CLASS = {
  candidate: styles.keywordStatusCandidate,
  approved: styles.keywordStatusApproved,
  excluded: styles.keywordStatusExcluded,
  parked: styles.keywordStatusParked,
} as const;

const KEYWORD_FRESHNESS_CLASS = {
  current: styles.keywordFreshnessCurrent,
  stale: styles.keywordFreshnessStale,
  unknown: styles.keywordFreshnessUnknown,
} as const;

const KEYWORD_RELATION_DECISION_KINDS = [
  "primary_supporting",
  "keep_separate",
  "park_secondary",
  "needs_research",
] as const satisfies readonly KeywordRelationDecisionKind[];

function latestKeywordOccurrence(
  occurrences: readonly GrowthMapKeywordSourceOccurrence[],
): GrowthMapKeywordSourceOccurrence | null {
  return occurrences.reduce<GrowthMapKeywordSourceOccurrence | null>(
    (latest, occurrence) => {
      if (latest === null) return occurrence;
      return Date.parse(occurrence.collectedAt) > Date.parse(latest.collectedAt)
        ? occurrence
        : latest;
    },
    null,
  );
}

const KEYWORD_INTENT_LABEL_KEYS = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;

function knownKeywordIntent(
  intent: string,
): (typeof KEYWORD_INTENT_LABEL_KEYS)[number] | null {
  return (
    KEYWORD_INTENT_LABEL_KEYS.find((candidate) => candidate === intent) ?? null
  );
}

function keywordVolumeSummary(
  locale: string,
  metric: KeywordMetric | null | undefined,
): string | null {
  const presentation = keywordMetricPresentation(metric, null);
  if (presentation.state === "unavailable") return null;
  return typeof presentation.value === "number"
    ? formatNumber(locale, presentation.value)
    : String(presentation.value);
}

function KeywordListMetric({
  metric,
  absenceLimitation,
  fallbackLabel,
  hideLimitationHint = false,
}: {
  readonly metric: KeywordMetric | null | undefined;
  readonly absenceLimitation: string | null;
  /** Ledger cells state absence in artifact vocabulary instead of a hint icon. */
  readonly fallbackLabel?: string | undefined;
  readonly hideLimitationHint?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.keywordLibrary");
  const presentation = keywordMetricPresentation(metric, absenceLimitation);

  if (presentation.state === "unavailable") {
    return (
      <span
        className={styles.libraryMetricSecondary}
        title={presentation.limitation ?? undefined}
      >
        {fallbackLabel ?? t("notAvailable")}
        {presentation.limitation === null || hideLimitationHint ? null : (
          <LimitationHint
            label={t("scopeLimitation")}
            limitations={[presentation.limitation]}
          />
        )}
      </span>
    );
  }

  const value =
    typeof presentation.value === "number"
      ? formatNumber(locale, presentation.value)
      : presentation.value;
  return (
    <strong className={styles.libraryMetricPrimary} title={String(value)}>
      {value}
    </strong>
  );
}

/**
 * `approved` is the label for a decision a person made. A keyword the system
 * auto-approved (`system_suggestion`) or a migration backfilled
 * (`migration_baseline`) has never been human-reviewed, so it is labelled as
 * approved *by the machine* and tagged as awaiting review instead of borrowing
 * the confirmation wording. `item` is read structurally so this keeps working
 * both before and after `reviewOrigin` reaches the read model.
 */
function KeywordStatusPill({
  item,
  showOrigin = true,
}: {
  readonly item: GrowthMapKeywordReviewOriginInput;
  readonly showOrigin?: boolean;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const presentation = growthMapKeywordReviewPresentation(item);
  return (
    <>
      <span
        className={cx(
          styles.keywordStatus,
          KEYWORD_STATUS_CLASS[item.status],
          presentation.awaitingHumanReview && styles.keywordStatusMachine,
        )}
        title={
          presentation.awaitingHumanReview
            ? t("reviewOrigin.pendingHumanReviewHint")
            : undefined
        }
      >
        {t(presentation.statusLabelKey)}
      </span>
      {presentation.originLabelKey === null || !showOrigin ? null : (
        <span className={styles.keywordReviewOrigin}>
          {t(presentation.originLabelKey)}
        </span>
      )}
    </>
  );
}

interface KeywordDeliveryDescription {
  readonly primary: string;
  readonly secondary: string;
}

function describeKeywordDelivery(
  projection: GrowthMapKeywordDeliveryProjection,
  tKeyword: ReturnType<typeof useTranslations<"growthMap.keywordLibrary">>,
  tStudio: ReturnType<typeof useTranslations<"studio">>,
): KeywordDeliveryDescription {
  if (projection.kind !== "ready") {
    return {
      primary: tKeyword("delivery.unavailablePrimary"),
      secondary: tKeyword(`delivery.reason.${projection.reason}`),
    };
  }

  if (projection.opportunities.length !== 1) {
    return {
      primary: tKeyword("delivery.contentPaths", {
        count: projection.opportunities.length,
      }),
      secondary: tKeyword("delivery.currentOutputs", {
        count: projection.artifactCount,
      }),
    };
  }

  const match = projection.opportunities[0]!;
  if (match.artifacts.length === 1) {
    const artifact = match.artifacts[0]!;
    return {
      primary: tStudio(`artifactType.${artifact.artifactType}`),
      secondary: tKeyword("delivery.artifactState", {
        status: tStudio(`status.${artifact.status}`),
        revision: artifact.currentRevision,
      }),
    };
  }

  if (match.artifacts.length > 1) {
    return {
      primary: tKeyword("delivery.currentOutputs", {
        count: match.artifacts.length,
      }),
      secondary: tKeyword("delivery.contentPaths", { count: 1 }),
    };
  }

  if (match.opportunity.readiness === "confirmed") {
    return {
      primary: tStudio(`artifactType.${match.opportunity.action.artifactType}`),
      secondary: tKeyword("delivery.awaitingGeneration"),
    };
  }

  const previewType =
    match.opportunity.readiness === "reviewable"
      ? match.opportunity.executionPreview?.artifactType ?? null
      : null;
  return {
    primary:
      previewType === null
        ? tKeyword("delivery.unavailablePrimary")
        : tStudio(`artifactType.${previewType}`),
    secondary: tKeyword("delivery.reviewRequired"),
  };
}

function KeywordDeliveryBadge({
  projection,
}: {
  readonly projection: GrowthMapKeywordDeliveryProjection;
}) {
  const tKeyword = useTranslations("growthMap.keywordLibrary");
  const tStudio = useTranslations("studio");
  const description = describeKeywordDelivery(
    projection,
    tKeyword,
    tStudio,
  );

  return (
    <span className={styles.keywordOutputMeta}>
      <strong
        className={cx(
          styles.keywordOutputBadge,
          projection.kind === "ready"
            ? styles.keywordOutputBadgeReady
            : styles.keywordOutputBadgeMuted,
        )}
      >
        {description.primary}
      </strong>
      <small className={styles.keywordOutputStatus}>{description.secondary}</small>
    </span>
  );
}

function KeywordFreshnessPill({
  freshness,
}: {
  readonly freshness: GrowthMapKeywordSourceOccurrence["freshness"];
}) {
  const t = useTranslations("growthMap.keywordLibrary.freshness");
  return (
    <span
      className={cx(
        styles.keywordFreshness,
        KEYWORD_FRESHNESS_CLASS[freshness],
      )}
    >
      {t(freshness)}
    </span>
  );
}

function KeywordSearchIntentValue({
  item,
}: {
  readonly item: GrowthMapKeywordLibraryItem;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const intent = item.searchIntent.value;
  const knownIntent = intent === null ? null : knownKeywordIntent(intent);
  const unavailableLimitation =
    item.searchIntent.authority === "unavailable"
      ? item.searchIntent.limitation
      : null;
  return (
    <>
      <strong className={styles.libraryMetricPrimary}>
        {intent === null
          ? t("notAvailable")
          : knownIntent === null
            ? intent
            : t(`intentLabel.${knownIntent}`)}
      </strong>
      <span className={styles.keywordIntentAuthorityLine}>
        <small
          className={styles.keywordIntentAuthority}
          data-search-intent-authority={item.searchIntent.authority}
          title={
            unavailableLimitation === null
              ? item.searchIntent.limitation ?? undefined
              : undefined
          }
        >
          {t(`searchIntentAuthority.${item.searchIntent.authority}`)}
        </small>
        {unavailableLimitation === null ? null : (
          <LimitationHint
            label={t("searchIntentUnavailableHint")}
            limitations={[unavailableLimitation]}
          />
        )}
      </span>
    </>
  );
}

function KeywordRow({
  entry,
  deliveryProjection,
  selected,
  onSelect,
  onOpenRelations,
}: {
  readonly entry: KeywordRelationVisibleItem;
  readonly deliveryProjection: GrowthMapKeywordDeliveryProjection;
  readonly selected: boolean;
  readonly onSelect: (keywordId: string) => void;
  readonly onOpenRelations: (keywordId: string) => void;
}) {
  const { item } = entry;
  const locale = useLocale();
  const t = useTranslations("growthMap.keywordLibrary");
  const sourceKinds = Array.from(
    new Set(item.sourceOccurrences.map((occurrence) => occurrence.sourceKind)),
  );
  const latestSource = latestKeywordOccurrence(item.sourceOccurrences);

  const hasRelationContext =
    entry.relations.length > 0 ||
    entry.supportingKeywords.length > 0 ||
    entry.offPagePrimary !== null;
  const hasStaleRelation = entry.relations.some(
    (relation) =>
      relation.candidateState === "stale" || relation.decisionState === "stale",
  );

  return (
    <li
      className={cx(
        styles.keywordRow,
        hasRelationContext && styles.keywordRowWithRelations,
      )}
    >
      <div
        className={cx(
          styles.keywordRowButton,
          selected && styles.keywordRowSelected,
        )}
      >
        <button
          type="button"
          className={styles.rowSelectButton}
          aria-pressed={selected}
          onClick={() => onSelect(item.keywordId)}
        >
          <span className={styles.rowSelectLabel}>
            {item.displayKeyword} —{" "}
            {item.cluster?.name ?? t("intake.unassignedCluster")}
          </span>
        </button>
        <span className={styles.keywordIdentityCell}>
          <strong>{item.displayKeyword}</strong>
          <span className={styles.keywordIdentityMeta}>
            <small>
              {t("marketLanguageValue", {
                market: item.marketCode,
                language: item.languageTag,
              })}
            </small>
            <span className={styles.keywordIdentityStatus}>
              <KeywordStatusPill item={item} showOrigin={false} />
            </span>
          </span>
        </span>
        <span
          className={styles.keywordTopicCell}
          data-column={t("columns.topic")}
        >
          <strong>{item.cluster?.name ?? t("intake.unassignedCluster")}</strong>
          {item.cluster === null ? null : (
            <small>
              {t("topicRevision", {
                revision: item.cluster.topicModelRevision,
              })}
            </small>
          )}
        </span>
        <span
          className={styles.keywordKindCell}
          data-column={t("columns.intentAuthority")}
        >
          <KeywordSearchIntentValue item={item} />
        </span>
        <span
          className={styles.libraryMetricCell}
          data-column={t("columns.volume")}
        >
          <KeywordListMetric
            metric={item.metrics.volume}
            absenceLimitation={item.metrics.limitations.volume}
            fallbackLabel={t("listFallback.volume")}
            hideLimitationHint
          />
        </span>
        <span
          className={styles.libraryMetricCell}
          data-column={t("columns.kd")}
        >
          <KeywordListMetric
            metric={item.metrics.kd}
            absenceLimitation={item.metrics.limitations.kd}
            fallbackLabel={t("listFallback.kd")}
            hideLimitationHint
          />
        </span>
        <span
          className={styles.libraryMetricCell}
          data-column={t("columns.rankUrl")}
        >
          <KeywordListMetric
            metric={item.metrics.currentRank}
            absenceLimitation={item.metrics.limitations.currentRank}
            fallbackLabel={t("listFallback.currentRank")}
            hideLimitationHint
          />
          <small className={styles.libraryMetricSecondary}>
            {item.mappedTarget.kind === "existing_page"
              ? urlPresentation(item.mappedTarget.normalizedUrl).path
              : t(`mappingTarget.${item.mappedTarget.kind}`)}
          </small>
        </span>
        <span
          className={styles.keywordSourceSummary}
          data-column={t("columns.source")}
        >
          <span>
            {sourceKinds.map((sourceKind) => (
              <small key={sourceKind} data-source-kind={sourceKind}>
                {t(`sourceKind.${sourceKind}`)}
              </small>
            ))}
          </span>
        </span>
        <span
          className={styles.libraryMetricCell}
          data-column={t("columns.freshness")}
        >
          {latestSource === null ? (
            <span className={styles.libraryMetricSecondary}>
              {t("notAvailable")}
            </span>
          ) : (
            <>
              <KeywordFreshnessPill freshness={latestSource.freshness} />
              <time
                className={styles.libraryMetricSecondary}
                dateTime={latestSource.collectedAt}
              >
                {formatObservedAt(locale, latestSource.collectedAt)}
              </time>
            </>
          )}
        </span>
        <span
          className={styles.keywordDeliveryCell}
          data-column={t("columns.delivery")}
        >
          <KeywordDeliveryBadge projection={deliveryProjection} />
          <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </span>
      </div>
      {hasRelationContext ? (
        <div className={styles.keywordRelationRowMeta}>
          {entry.relations.length === 0 ? null : (
            <button
              type="button"
              className={cx(
                styles.keywordRelationBadge,
                hasStaleRelation && styles.keywordRelationBadgeStale,
              )}
              aria-label={t("relations.openAria", {
                keyword: item.displayKeyword,
                count: entry.relations.length,
              })}
              onClick={() => onOpenRelations(item.keywordId)}
            >
              <GitMerge aria-hidden="true" size={15} />
              {t("relations.badge", { count: entry.relations.length })}
            </button>
          )}
          {entry.supportingKeywords.length === 0 ? null : (
            <span className={styles.keywordSupportingSummary}>
              <strong>{t("relations.supportingLabel")}</strong>
              <span>
                {entry.supportingKeywords.map((supporting) => (
                  <span key={supporting.relationId}>
                    {supporting.displayKeyword}
                  </span>
                ))}
              </span>
            </span>
          )}
          {entry.offPagePrimary === null ? null : (
            <span className={styles.keywordOffPagePrimary}>
              {t("relations.offPagePrimary", {
                keyword: entry.offPagePrimary.displayKeyword,
              })}
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}

function KeywordList({
  entries,
  deliveriesByKeywordId,
  selectedKeywordId,
  onSelect,
  onOpenRelations,
}: {
  readonly entries: readonly KeywordRelationVisibleItem[];
  readonly deliveriesByKeywordId: ReadonlyMap<
    string,
    GrowthMapKeywordDeliveryProjection
  >;
  readonly selectedKeywordId: string | null;
  readonly onSelect: (keywordId: string) => void;
  readonly onOpenRelations: (keywordId: string) => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  return (
    <div className={styles.keywordLedger}>
      <div className={styles.keywordLedgerHeader} aria-hidden="true">
        <span>{t("columns.keyword")}</span>
        <span>{t("columns.topic")}</span>
        <span>{t("columns.intentAuthority")}</span>
        <span>{t("columns.volume")}</span>
        <span>{t("columns.kd")}</span>
        <span>{t("columns.rankUrl")}</span>
        <span>{t("columns.source")}</span>
        <span>{t("columns.freshness")}</span>
        <span>{t("columns.delivery")}</span>
      </div>
      <ul className={styles.keywordList} aria-label={t("listLabel")}>
        {entries.map((entry) => (
          <KeywordRow
            key={entry.item.keywordId}
            entry={entry}
            deliveryProjection={
              deliveriesByKeywordId.get(entry.item.keywordId) ?? {
                kind: "none",
                reason: "published_run_unavailable",
              }
            }
            selected={selectedKeywordId === entry.item.keywordId}
            onSelect={onSelect}
            onOpenRelations={onOpenRelations}
          />
        ))}
      </ul>
    </div>
  );
}

function growthMapDialogInClosedDisclosure(
  element: HTMLElement,
  container: HTMLElement,
): boolean {
  let child: HTMLElement = element;
  let node = element.parentElement;
  while (node !== null && node !== container) {
    if (node instanceof HTMLDetailsElement && !node.open) {
      const isOwnSummary =
        child.tagName === "SUMMARY" && child.parentElement === node;
      if (!isOwnSummary) return true;
    }
    child = node;
    node = node.parentElement;
  }
  return false;
}

function growthMapDialogFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !growthMapDialogInClosedDisclosure(element, container),
  );
}

/**
 * Shared modal a11y contract for Growth Map dialogs and drawers: scroll lock,
 * inert background, initial focus, a Tab-cycle trap, Escape to close, and
 * focus restoration on close. Extracted verbatim from the dialog frame so the
 * Competitor profile drawer keeps exactly the same focus management.
 */
function useGrowthMapModalA11y(
  open: boolean,
  mounted: boolean,
  frameRef: RefObject<HTMLDivElement | null>,
  onRequestClose: () => void,
): void {
  useEffect(() => {
    if (!open || !mounted) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.body.children).filter(
      (element) => !element.hasAttribute("data-growth-map-dialog-backdrop"),
    );
    const backgroundState = background.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert"),
    }));
    background.forEach((element) => {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    });
    const focusFrame = requestAnimationFrame(() =>
      growthMapDialogFocusable(frameRef.current ?? document.body)[0]?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onRequestClose();
        return;
      }
      if (event.key !== "Tab" || frameRef.current === null) return;
      const focusable = growthMapDialogFocusable(frameRef.current);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      backgroundState.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (!inert) element.removeAttribute("inert");
      });
      requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [frameRef, mounted, onRequestClose, open]);
}

function GrowthMapDialogFrame({
  open,
  titleId,
  descriptionId,
  onRequestClose,
  className,
  children,
}: {
  readonly open: boolean;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly onRequestClose: () => void;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useGrowthMapModalA11y(open, mounted, frameRef, onRequestClose);

  if (!mounted || !open) return null;
  return createPortal(
    <div
      className={styles.keywordRelationBackdrop}
      data-growth-map-dialog-backdrop=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <div
        ref={frameRef}
        className={cx(styles.keywordRelationDialog, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function KeywordRelationDecisionCard({
  projectId,
  relation,
  isRefreshing,
  onRefresh,
}: {
  readonly projectId: string;
  readonly relation: GrowthMapKeywordRelation;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary.relations");
  const [decisionKind, setDecisionKind] = useState<KeywordRelationDecisionKind>(
    relation.decision?.decisionKind ?? "needs_research",
  );
  const [primaryKeywordId, setPrimaryKeywordId] = useState(
    relation.decision?.primaryKeywordId ??
      relation.candidate.keywordA.keywordId,
  );
  const [reason, setReason] = useState(
    relation.decision?.reason ?? t("defaultReason"),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const decisionMutation = useDecideGrowthMapKeywordRelation(projectId);
  const keywordA = relation.candidate.keywordA;
  const keywordB = relation.candidate.keywordB;
  const signals = relation.candidate.signals;
  const candidateIsStale = relation.candidateState === "stale";

  useEffect(() => {
    setDecisionKind(relation.decision?.decisionKind ?? "needs_research");
    setPrimaryKeywordId(
      relation.decision?.primaryKeywordId ?? keywordA.keywordId,
    );
    setReason(relation.decision?.reason ?? t("defaultReason"));
    setValidationError(null);
  }, [
    keywordA.keywordId,
    relation.currentRelationRevision,
    relation.decision,
    t,
  ]);

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = buildKeywordRelationDecisionCommand(
      relation,
      decisionKind,
      primaryKeywordId,
      reason,
    );
    if (command === null) {
      setValidationError(t("invalidDecision"));
      return;
    }
    setValidationError(null);
    try {
      await decisionMutation.mutateAsync({
        relationId: relation.relationId,
        body: command,
      });
    } catch {
      // The mutation exposes a localized, recoverable message below.
    }
  }

  function chooseDecision(nextDecision: KeywordRelationDecisionKind) {
    setDecisionKind(nextDecision);
    setValidationError(null);
    decisionMutation.reset();
  }

  const serpOverlap = signals.serpOverlap;
  return (
    <article className={styles.keywordRelationCard}>
      <header className={styles.keywordRelationCardHeader}>
        <div>
          <span>{t("pairTitle")}</span>
          <strong>{t(`displayState.${relation.displayState}`)}</strong>
        </div>
        <span
          className={cx(
            styles.keywordRelationState,
            candidateIsStale && styles.keywordRelationStateStale,
          )}
        >
          {candidateIsStale ? t("candidateStale") : t("candidateCurrent")}
        </span>
      </header>

      <div className={styles.keywordRelationPair}>
        <div className={styles.keywordRelationTerm}>
          <small>A</small>
          <strong>{keywordA.displayKeyword}</strong>
        </div>
        <GitMerge aria-hidden="true" size={20} />
        <div className={styles.keywordRelationTerm}>
          <small>B</small>
          <strong>{keywordB.displayKeyword}</strong>
        </div>
      </div>

      <section className={styles.keywordRelationEvidence}>
        <h4>{t("evidenceTitle")}</h4>
        <ul>
          <li>
            <CheckCircle2 aria-hidden="true" size={15} />
            {t("samePage")}
          </li>
          <li>
            <CheckCircle2 aria-hidden="true" size={15} />
            {t("sameIntent", { intent: keywordA.intent })}
          </li>
          <li>
            <CheckCircle2 aria-hidden="true" size={15} />
            {t("marketLanguage", {
              market: keywordA.marketCode,
              language: keywordA.languageTag,
            })}
          </li>
          <li>
            <CheckCircle2 aria-hidden="true" size={15} />
            {signals.sameConfirmedTopic
              ? t("sameTopic")
              : t("topicNotConfirmed")}
          </li>
          <li>
            {t("lexicalOverlap", {
              value: Math.round(signals.lexicalTokenOverlap * 100),
            })}
          </li>
          <li>
            {serpOverlap.availability === "available" &&
            serpOverlap.value !== null
              ? t("serpOverlap", {
                  value: Math.round(serpOverlap.value * 100),
                })
              : t("serpUnavailable")}
          </li>
        </ul>
      </section>

      {relation.decision === null ? null : (
        <p className={styles.keywordRelationCurrentDecision}>
          {t("currentDecision", {
            decision: t(`decision.${relation.decision.decisionKind}.label`),
          })}
          <span>
            {t("revision", {
              revision: relation.currentRelationRevision,
            })}
          </span>
        </p>
      )}

      {candidateIsStale ? (
        <div className={styles.keywordRelationStaleNotice} role="status">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>{t("staleNotice")}</strong>
            {relation.staleReasons.length === 0 ? null : (
              <small>
                {relation.staleReasons
                  .map((reason) => t(`staleReason.${reason}`))
                  .join(" · ")}
              </small>
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {isRefreshing ? t("refreshing") : t("refresh")}
          </Button>
        </div>
      ) : (
        <form
          className={styles.keywordRelationDecisionForm}
          onSubmit={(event) => void submitDecision(event)}
        >
          <fieldset>
            <legend>{t("decisionTitle")}</legend>
            <p>{t("decisionDescription")}</p>
            <div className={styles.keywordRelationChoices}>
              {KEYWORD_RELATION_DECISION_KINDS.map((kind) => (
                <label
                  key={kind}
                  className={cx(
                    styles.keywordRelationChoice,
                    decisionKind === kind &&
                      styles.keywordRelationChoiceSelected,
                  )}
                >
                  <input
                    type="radio"
                    name={`keyword-relation-decision-${relation.relationId}`}
                    value={kind}
                    checked={decisionKind === kind}
                    disabled={decisionMutation.isPending}
                    onChange={() => chooseDecision(kind)}
                  />
                  <span>
                    <strong>{t(`decision.${kind}.label`)}</strong>
                    <small>{t(`decision.${kind}.description`)}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {decisionKind === "primary_supporting" ? (
            <fieldset className={styles.keywordRelationPrimaryFieldset}>
              <legend>{t("primaryTitle")}</legend>
              <p>{t("primaryHint")}</p>
              <div className={styles.keywordRelationPrimaryChoices}>
                {[keywordA, keywordB].map((keyword) => (
                  <label key={keyword.keywordId}>
                    <input
                      type="radio"
                      name={`keyword-relation-primary-${relation.relationId}`}
                      value={keyword.keywordId}
                      checked={primaryKeywordId === keyword.keywordId}
                      disabled={decisionMutation.isPending}
                      onChange={() => {
                        setPrimaryKeywordId(keyword.keywordId);
                        setValidationError(null);
                        decisionMutation.reset();
                      }}
                    />
                    <span>{keyword.displayKeyword}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <Field
            label={t("reason")}
            help={t("reasonHelp")}
            required
            error={validationError ?? undefined}
            className={styles.keywordRelationReason}
          >
            <TextArea
              value={reason}
              rows={3}
              maxLength={2000}
              placeholder={t("reasonPlaceholder")}
              disabled={decisionMutation.isPending}
              onChange={(event) => {
                setReason(event.target.value);
                setValidationError(null);
                decisionMutation.reset();
              }}
            />
          </Field>

          {decisionMutation.isSuccess ? (
            <p
              className={styles.keywordRelationFeedback}
              role="status"
              aria-live="polite"
            >
              <CheckCircle2 aria-hidden="true" size={17} />
              {decisionMutation.data.replayed ? t("replayed") : t("saved")}
            </p>
          ) : null}
          {decisionMutation.error instanceof ApiError &&
          decisionMutation.error.status === 409 ? (
            <p className={styles.keywordRelationConflict} role="alert">
              <CircleAlert aria-hidden="true" size={17} />
              {t("conflict")}
            </p>
          ) : decisionMutation.isError ? (
            <ProblemNotice
              error={decisionMutation.error}
              message={t("decisionError")}
              compact
            />
          ) : null}

          <div className={styles.keywordRelationActions}>
            <Button
              type="submit"
              size="sm"
              disabled={decisionMutation.isPending}
            >
              {decisionMutation.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}

function KeywordRelationDialog({
  projectId,
  open,
  keyword,
  relations,
  isRefreshing,
  onRefresh,
  onRequestClose,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly keyword: string | null;
  readonly relations: readonly GrowthMapKeywordRelation[];
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onRequestClose: () => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary.relations");
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <GrowthMapDialogFrame
      open={open}
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={onRequestClose}
    >
      <header className={styles.keywordRelationDialogHeader}>
        <div>
          <span>{t("dialogEyebrow")}</span>
          <h2 id={titleId}>{t("dialogTitle")}</h2>
          <p id={descriptionId}>
            {keyword === null
              ? t("dialogDescription")
              : t("dialogKeywordDescription", { keyword })}
          </p>
        </div>
        <button
          type="button"
          className={styles.keywordRelationClose}
          aria-label={t("close")}
          onClick={onRequestClose}
        >
          <X aria-hidden="true" size={21} />
        </button>
      </header>
      <div className={styles.keywordRelationDialogSummary}>
        <span>{t("candidateCount", { count: relations.length })}</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {isRefreshing ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <div className={styles.keywordRelationDialogBody}>
        {relations.map((relation) => (
          <KeywordRelationDecisionCard
            key={relation.relationId}
            projectId={projectId}
            relation={relation}
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </GrowthMapDialogFrame>
  );
}

type TopicMapEditorMode =
  | "create"
  | "edit"
  | "rename"
  | "split"
  | "merge"
  | "retire"
  | "confirm";

const TOPIC_COVERAGE_CLASS = {
  empty: styles.topicCoverageEmpty,
  uncovered: styles.topicCoverageGap,
  partial: styles.topicCoveragePartial,
  covered: styles.topicCoverageCovered,
  conflict: styles.topicCoverageConflict,
} as const;

function topicIntentEnvelope(value: string): readonly string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function TopicCoveragePill({
  insight,
  fallbackState = "draft",
}: {
  readonly insight: GrowthMapTopicNodeInsight | null;
  readonly fallbackState?: "draft" | "unavailable";
}) {
  const t = useTranslations("growthMap.keywordLibrary.topicMap");
  if (insight === null) {
    return (
      <span className={cx(styles.topicCoveragePill, styles.topicCoverageDraft)}>
        {t(`coverageState.${fallbackState}`)}
      </span>
    );
  }
  return (
    <span
      className={cx(
        styles.topicCoveragePill,
        TOPIC_COVERAGE_CLASS[insight.coverageState],
      )}
    >
      {t(`coverageState.${insight.coverageState}`)}
    </span>
  );
}

function TopicMapTreeBranch({
  branch,
  selectedNodeId,
  tabStopNodeId,
  parentTopicNodeId,
  fallbackState,
  onSelect,
}: {
  readonly branch: TopicMapTreeNode;
  readonly selectedNodeId: string | null;
  readonly tabStopNodeId: string | null;
  readonly parentTopicNodeId: string | null;
  readonly fallbackState: "draft" | "unavailable";
  readonly onSelect: (topicNodeId: string) => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary.topicMap");
  const selected = branch.node.topicNodeId === selectedNodeId;
  return (
    <li role="none" className={styles.topicTreeItem}>
      <button
        type="button"
        role="treeitem"
        aria-level={branch.depth + 1}
        aria-selected={selected}
        aria-expanded={branch.children.length > 0 ? true : undefined}
        data-topic-node-id={branch.node.topicNodeId}
        data-parent-topic-node-id={parentTopicNodeId ?? undefined}
        tabIndex={branch.node.topicNodeId === tabStopNodeId ? 0 : -1}
        className={cx(
          styles.topicTreeNode,
          selected && styles.topicTreeNodeSelected,
        )}
        onClick={() => onSelect(branch.node.topicNodeId)}
      >
        <span className={styles.topicTreeNodeMain}>
          <strong>{branch.node.label}</strong>
          <small>
            {branch.insight === null
              ? t("tree.noPublishedMetrics")
              : t("tree.nodeSummary", {
                  keywords: branch.insight.keywordCount,
                  pages: branch.insight.mappedPageCount,
                })}
          </small>
        </span>
        <TopicCoveragePill
          insight={branch.insight}
          fallbackState={fallbackState}
        />
      </button>
      {branch.children.length === 0 ? null : (
        <ul role="group" className={styles.topicTreeChildren}>
          {branch.children.map((child) => (
            <TopicMapTreeBranch
              key={child.node.topicNodeId}
              branch={child}
              selectedNodeId={selectedNodeId}
              tabStopNodeId={tabStopNodeId}
              parentTopicNodeId={branch.node.topicNodeId}
              fallbackState={fallbackState}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TopicMapGateway({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("growthMap.keywordLibrary.topicMap");
  const [open, setOpen] = useState(false);
  const workspaceQuery = useGrowthMapTopicModelWorkspace(projectId);
  const insightsQuery = useGrowthMapTopicModelInsights(projectId);
  const projection = useMemo(
    () =>
      workspaceQuery.data === undefined
        ? null
        : buildTopicMapProjection(
            workspaceQuery.data,
            insightsQuery.data ?? null,
          ),
    [insightsQuery.data, workspaceQuery.data],
  );
  const latestConfirmed = workspaceQuery.data?.latestConfirmed ?? null;
  const status =
    workspaceQuery.isPending
      ? "loading"
      : workspaceQuery.isError
        ? "read_failed"
        : workspaceQuery.data?.draft !== null &&
            workspaceQuery.data?.draft !== undefined
      ? "draft"
      : latestConfirmed === null
        ? "unavailable"
        : latestConfirmed.confirmationMode === "system_auto"
          ? "system_confirmed"
          : latestConfirmed.confirmationMode === "user"
            ? "user_confirmed"
            : "legacy_confirmed";
  const generationSummary =
    latestConfirmed === null ? null : latestConfirmed.generationSummary;
  const gatewayTitleId = useId();
  const hasConfirmedInsights =
    projection?.confirmedInsightRevision !== null &&
    projection?.confirmedInsightRevision !== undefined;

  return (
    <>
      <section
        className={styles.topicMapGateway}
        aria-labelledby={gatewayTitleId}
      >
        <div className={styles.topicMapGatewayIntro}>
          <span className={styles.topicMapStep}>
            <Network aria-hidden="true" size={17} />
            {t("step")}
          </span>
          <div>
            <h2 id={gatewayTitleId}>{t("gatewayTitle")}</h2>
            <p>{t("gatewayDescription")}</p>
          </div>
        </div>
        <dl className={styles.topicMapGatewayFacts}>
          <div>
            <dt>{t("gateway.status")}</dt>
            <dd data-status={status}>
              {t(`status.${status}`)}
            </dd>
          </div>
          <div>
            <dt>{t("gateway.topics")}</dt>
            <dd>
              {projection?.structureAuthority === "unavailable"
                ? "—"
                : (projection?.activeNodes.length ?? "—")}
            </dd>
          </div>
          <div>
            <dt>{t("gateway.coverageGaps")}</dt>
            <dd>
              {hasConfirmedInsights
                ? (projection?.summary.coverageGapCount ?? "—")
                : "—"}
            </dd>
          </div>
          <div>
            <dt>{t("gateway.conflicts")}</dt>
            <dd>
              {hasConfirmedInsights
                ? (projection?.summary.conflictCount ?? "—")
                : "—"}
            </dd>
          </div>
        </dl>
        <div className={styles.topicMapGatewayAction}>
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <Network aria-hidden="true" size={16} />
            {t("manage")}
          </Button>
          {status === "unavailable" ? (
            <small className={styles.topicMapGatewayUnavailableAction}>
              <span>{t("gatewayUnavailableHint")}</span>
              <a href="#growth-map-run-diagnosis">
                {t("gatewayRunDiagnosis")}
                <ArrowUpRight aria-hidden="true" size={14} />
              </a>
            </small>
          ) : (
            <small>
              {generationSummary === null
                ? t("gatewayActionHint")
                : t("generationSummary", {
                    keywords: generationSummary.keywordCount,
                    assigned: generationSummary.assignedCount,
                  })}
            </small>
          )}
        </div>
        {workspaceQuery.isError ? (
          <ProblemNotice
            error={workspaceQuery.error}
            message={t("workspaceError")}
            onRetry={() => void workspaceQuery.refetch()}
            retryLabel={t("retry")}
            compact
            className={styles.topicMapGatewayProblem}
          />
        ) : insightsQuery.isError ? (
          <ProblemNotice
            error={insightsQuery.error}
            message={t("insightsError")}
            onRetry={() => void insightsQuery.refetch()}
            retryLabel={t("retry")}
            compact
            className={styles.topicMapGatewayProblem}
          />
        ) : null}
      </section>
      <TopicMapDialog
        projectId={projectId}
        open={open}
        onRequestClose={() => setOpen(false)}
      />
    </>
  );
}

function TopicMapDialog({
  projectId,
  open,
  onRequestClose,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly onRequestClose: () => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary.topicMap");
  const locale = useLocale();
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const parentSelectId = `${dialogId}-parent`;
  const workspaceQuery = useGrowthMapTopicModelWorkspace(projectId);
  const insightsQuery = useGrowthMapTopicModelInsights(projectId);
  const beginMutation = useBeginGrowthMapTopicModelDraft(projectId);
  const patchMutation = usePatchGrowthMapTopicModelDraft(projectId);
  const confirmMutation = useConfirmGrowthMapTopicModelDraft(projectId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<TopicMapEditorMode | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [intentEnvelope, setIntentEnvelope] = useState("");
  const [parentTopicNodeId, setParentTopicNodeId] = useState("");
  const [successorLabels, setSuccessorLabels] = useState("");
  const [mergeSourceIds, setMergeSourceIds] = useState<readonly string[]>([]);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [editorDraftVersion, setEditorDraftVersion] = useState<string | null>(
    null,
  );
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const workspace = workspaceQuery.data;
  const projection = useMemo(
    () =>
      workspace === undefined
        ? null
        : buildTopicMapProjection(
            workspace,
            insightsQuery.data ?? null,
            selectedNodeId,
          ),
    [insightsQuery.data, selectedNodeId, workspace],
  );
  const effectiveSelectedNodeId = projection?.selectedNodeId ?? null;
  const structure = workspace?.draft ?? workspace?.latestConfirmed ?? null;
  const selectedNode =
    structure?.nodes.find(
      (node) => node.topicNodeId === effectiveSelectedNodeId,
    ) ?? null;
  const confirmedInsights = insightsQuery.data;
  const selectedInsight =
    confirmedInsights !== undefined &&
    confirmedInsights.topicModelRevision ===
      workspace?.latestConfirmed?.topicModelRevision
      ? (confirmedInsights.nodes.find(
          (node) => node.topicNodeId === effectiveSelectedNodeId,
        ) ?? null)
      : null;
  const selectedSuccessors =
    structure?.successorRelationships
      .filter(
        (relationship) =>
          relationship.sourceTopicNodeId === effectiveSelectedNodeId,
      )
      .map((relationship) => ({
        ...relationship,
        label:
          structure.nodes.find(
            (node) => node.topicNodeId === relationship.successorTopicNodeId,
          )?.label ?? truncateId(relationship.successorTopicNodeId),
      })) ?? [];
  const draft = workspace?.draft ?? null;
  const activeNodes =
    draft?.nodes.filter((node) => node.lifecycleState === "active") ?? [];
  const selectedHasActiveChildren =
    selectedNode !== null &&
    activeNodes.some(
      (node) => node.parentTopicNodeId === selectedNode.topicNodeId,
    );
  const isSelectedRoot =
    selectedNode !== null &&
    draft?.rootTopicNodeId === selectedNode.topicNodeId;
  const legalParentIds =
    draft !== null && selectedNode !== null
      ? topicNodeAllowedParentIds(draft, selectedNode.topicNodeId)
      : [];
  const mutationError =
    beginMutation.error ?? patchMutation.error ?? confirmMutation.error;
  const mutationPending =
    beginMutation.isPending ||
    patchMutation.isPending ||
    confirmMutation.isPending;
  const currentDraftVersion =
    draft === null
      ? `no-draft:${workspace?.latestConfirmed?.topicModelRevision ?? 0}`
      : `draft:${draft.topicModelRevision}:${draft.editRevision}`;
  const treeTabStopNodeId =
    projection?.activeNodes.some(
      (node) => node.topicNodeId === effectiveSelectedNodeId,
    ) === true
      ? effectiveSelectedNodeId
      : (projection?.roots[0]?.node.topicNodeId ?? null);

  useEffect(() => {
    if (!open) {
      setEditorMode(null);
      setLocalError(null);
      setEditorDraftVersion(null);
      setWorkspaceNotice(null);
    }
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      editorMode === null ||
      editorDraftVersion === null ||
      mutationPending ||
      currentDraftVersion === editorDraftVersion
    ) {
      return;
    }
    setEditorMode(null);
    setEditorDraftVersion(null);
    setLocalError(null);
    setWorkspaceNotice(t("draftChangedNotice"));
  }, [
    currentDraftVersion,
    editorDraftVersion,
    editorMode,
    mutationPending,
    open,
    t,
  ]);

  function clearMutationState(): void {
    beginMutation.reset();
    patchMutation.reset();
    confirmMutation.reset();
    setLocalError(null);
  }

  function openEditor(mode: TopicMapEditorMode): void {
    clearMutationState();
    setWorkspaceNotice(null);
    setEditorMode(mode);
    setEditorDraftVersion(currentDraftVersion);
    setMergeSourceIds([]);
    setSuccessorLabels("");
    setLabel(mode === "create" ? "" : (selectedNode?.label ?? ""));
    setDescription(selectedNode?.description ?? "");
    setIntentEnvelope(selectedNode?.intentEnvelope.join(", ") ?? "");
    setParentTopicNodeId(
      mode === "create"
        ? (selectedNode?.topicNodeId ?? draft?.rootTopicNodeId ?? "")
        : (selectedNode?.parentTopicNodeId ??
            selectedNode?.topicNodeId ??
            draft?.rootTopicNodeId ??
            ""),
    );
    setReason(t(`defaultReason.${mode}`));
  }

  function selectTopicNode(topicNodeId: string): void {
    setSelectedNodeId(topicNodeId);
    setEditorMode(null);
    setEditorDraftVersion(null);
    setLocalError(null);
  }

  function handleTopicTreeKeyDown(
    event: ReactKeyboardEvent<HTMLUListElement>,
  ): void {
    const target = event.target;
    if (
      !(target instanceof HTMLButtonElement) ||
      target.getAttribute("role") !== "treeitem"
    ) {
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="treeitem"]',
      ),
    );
    const currentIndex = items.indexOf(target);
    if (currentIndex < 0) return;

    let nextItem: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") {
      nextItem = items[Math.min(currentIndex + 1, items.length - 1)];
    } else if (event.key === "ArrowUp") {
      nextItem = items[Math.max(currentIndex - 1, 0)];
    } else if (event.key === "Home") {
      nextItem = items[0];
    } else if (event.key === "End") {
      nextItem = items.at(-1);
    } else if (event.key === "ArrowRight") {
      nextItem = items.find(
        (item) => item.dataset.parentTopicNodeId === target.dataset.topicNodeId,
      );
    } else if (event.key === "ArrowLeft") {
      const parentTopicNodeId = target.dataset.parentTopicNodeId;
      nextItem =
        parentTopicNodeId === undefined
          ? undefined
          : items.find(
              (item) => item.dataset.topicNodeId === parentTopicNodeId,
            );
    } else {
      return;
    }

    if (nextItem === undefined) return;
    const nextTopicNodeId = nextItem.dataset.topicNodeId;
    if (nextTopicNodeId === undefined) return;
    event.preventDefault();
    nextItem.focus();
    selectTopicNode(nextTopicNodeId);
  }

  function submitBegin(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (workspace === undefined) return;
    const command = buildBeginTopicModelDraftCommand(workspace, reason);
    if (command === null) {
      setLocalError(t("validation.reason"));
      return;
    }
    beginMutation.mutate(command, {
      onSuccess: () => {
        setEditorMode(null);
        setLocalError(null);
      },
    });
  }

  function submitIntent(
    event: FormEvent<HTMLFormElement>,
    intent: TopicNodeDraftIntent | null,
  ): void {
    event.preventDefault();
    if (draft === null || intent === null) {
      setLocalError(t("validation.form"));
      return;
    }
    const command = buildPatchTopicModelDraftCommand(draft, reason, [intent]);
    if (command === null) {
      setLocalError(t("validation.form"));
      return;
    }
    patchMutation.mutate(command, {
      onSuccess: () => {
        setEditorMode(null);
        setLocalError(null);
      },
    });
  }

  function submitConfirm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draft === null) return;
    const command = buildConfirmTopicModelCommand(draft, reason);
    if (command === null || activeNodes.length === 0) {
      setLocalError(t("validation.confirm"));
      return;
    }
    confirmMutation.mutate(command, {
      onSuccess: () => {
        setEditorMode(null);
        setLocalError(null);
      },
    });
  }

  function createIntent(): TopicNodeDraftIntent | null {
    const parent =
      draft?.rootTopicNodeId === null
        ? null
        : parentTopicNodeId || draft?.rootTopicNodeId || null;
    return buildTopicNodeCreateIntent({
      parentTopicNodeId: parent,
      label,
      description: description.trim() || null,
      intentEnvelope: topicIntentEnvelope(intentEnvelope),
    });
  }

  function updateIntent(): TopicNodeDraftIntent | null {
    if (selectedNode === null) return null;
    return buildTopicNodeUpdateIntent(selectedNode.topicNodeId, {
      ...(isSelectedRoot
        ? {}
        : { parentTopicNodeId: parentTopicNodeId || null }),
      description: description.trim() || null,
      intentEnvelope: topicIntentEnvelope(intentEnvelope),
    });
  }

  function splitIntent(): TopicNodeDraftIntent | null {
    if (selectedNode === null) return null;
    const labels = successorLabels
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    return buildTopicNodeSplitIntent(
      selectedNode.topicNodeId,
      labels.map((successorLabel) => ({
        parentTopicNodeId: selectedNode.parentTopicNodeId,
        label: successorLabel,
        description: selectedNode.description,
        intentEnvelope: selectedNode.intentEnvelope,
      })),
    );
  }

  function mergeIntent(): TopicNodeDraftIntent | null {
    if (selectedNode === null || draft === null) return null;
    const sourceIds = [selectedNode.topicNodeId, ...mergeSourceIds];
    const sources = sourceIds
      .map((sourceId) =>
        draft.nodes.find((node) => node.topicNodeId === sourceId),
      )
      .filter((node): node is TopicNodeRevision => node !== undefined);
    const includesRoot = sourceIds.includes(draft.rootTopicNodeId ?? "");
    const commonParent = sources.every(
      (node) => node.parentTopicNodeId === sources[0]?.parentTopicNodeId,
    )
      ? (sources[0]?.parentTopicNodeId ?? draft.rootTopicNodeId)
      : draft.rootTopicNodeId;
    return buildTopicNodeMergeIntent(sourceIds, {
      parentTopicNodeId: includesRoot ? null : (commonParent ?? null),
      label,
      description: description.trim() || null,
      intentEnvelope: Array.from(
        new Set(sources.flatMap((node) => node.intentEnvelope)),
      ),
    });
  }

  const firstModel =
    workspace !== undefined &&
    workspace.latestConfirmed === null &&
    workspace.draft === null;
  const topicInsightFallbackState =
    draft !== null &&
    (workspace?.latestConfirmed === null ||
      projection?.confirmedInsightRevision !== null)
      ? "draft"
      : "unavailable";
  const editorPanel =
    editorMode === null ? null : (
      <TopicMapEditor
        mode={editorMode}
        draft={draft}
        selectedNode={selectedNode}
        activeNodes={activeNodes}
        legalParentIds={legalParentIds}
        parentSelectId={parentSelectId}
        label={label}
        description={description}
        intentEnvelope={intentEnvelope}
        parentTopicNodeId={parentTopicNodeId}
        successorLabels={successorLabels}
        mergeSourceIds={mergeSourceIds}
        reason={reason}
        localError={localError}
        mutationError={mutationError}
        mutationPending={mutationPending}
        onLabelChange={setLabel}
        onDescriptionChange={setDescription}
        onIntentEnvelopeChange={setIntentEnvelope}
        onParentChange={setParentTopicNodeId}
        onSuccessorLabelsChange={setSuccessorLabels}
        onMergeSourceIdsChange={setMergeSourceIds}
        onReasonChange={setReason}
        onCancel={() => {
          setEditorMode(null);
          clearMutationState();
        }}
        onBegin={submitBegin}
        onConfirm={submitConfirm}
        onCreate={(event) => submitIntent(event, createIntent())}
        onEdit={(event) => submitIntent(event, updateIntent())}
        onRename={(event) =>
          submitIntent(
            event,
            selectedNode === null
              ? null
              : buildTopicNodeRenameIntent(selectedNode.topicNodeId, label),
          )
        }
        onSplit={(event) => submitIntent(event, splitIntent())}
        onMerge={(event) => submitIntent(event, mergeIntent())}
        onRetire={(event) =>
          submitIntent(
            event,
            selectedNode === null
              ? null
              : buildTopicNodeRetireIntent(selectedNode.topicNodeId),
          )
        }
      />
    );

  return (
    <GrowthMapDialogFrame
      open={open}
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={onRequestClose}
      className={styles.topicMapDialog}
    >
      <header className={styles.keywordRelationDialogHeader}>
        <div>
          <span>{t("dialogEyebrow")}</span>
          <h2 id={titleId}>{t("dialogTitle")}</h2>
          <p id={descriptionId}>{t("dialogDescription")}</p>
        </div>
        <button
          type="button"
          className={styles.keywordRelationClose}
          aria-label={t("close")}
          onClick={onRequestClose}
        >
          <X aria-hidden="true" size={21} />
        </button>
      </header>
      <div className={styles.topicMapDialogBar}>
        <div>
          {draft !== null ? (
            <span className={styles.topicDraftBadge}>
              {t("draftRevision", {
                revision: draft.topicModelRevision,
                edit: draft.editRevision,
              })}
            </span>
          ) : workspace?.latestConfirmed !== null &&
            workspace?.latestConfirmed !== undefined ? (
            <span className={styles.topicConfirmedBadge}>
              {t("confirmedRevision", {
                revision: workspace.latestConfirmed.topicModelRevision,
              })}
            </span>
          ) : (
            <span className={styles.topicUnavailableBadge}>
              {t("status.unavailable")}
            </span>
          )}
          <p>
            {draft === null ? t("publishedAuthority") : t("draftAuthority")}
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={workspaceQuery.isFetching}
            onClick={() => {
              void workspaceQuery.refetch();
              void insightsQuery.refetch();
            }}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("refresh")}
          </Button>
          {draft === null ? (
            <Button
              type="button"
              size="sm"
              disabled={workspace === undefined}
              onClick={() => openEditor("create")}
            >
              <Pencil aria-hidden="true" size={15} />
              {firstModel ? t("beginFirstDraft") : t("beginDraft")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={activeNodes.length === 0}
              onClick={() => openEditor("confirm")}
            >
              <Send aria-hidden="true" size={15} />
              {t("confirm")}
            </Button>
          )}
        </div>
      </div>
      {workspaceNotice === null ? null : (
        <div className={styles.topicWorkspaceNotice} role="status">
          <RefreshCw aria-hidden="true" size={16} />
          <span>{workspaceNotice}</span>
          <button
            type="button"
            aria-label={t("dismissNotice")}
            onClick={() => setWorkspaceNotice(null)}
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      )}

      {workspaceQuery.isPending ? (
        <div className={styles.topicMapLoading} role="status">
          <Spinner label={t("loading")} size="lg" />
          <p>{t("loading")}</p>
        </div>
      ) : workspaceQuery.isError ? (
        <div className={styles.topicMapLoading}>
          <ProblemState
            error={workspaceQuery.error}
            onRetry={() => void workspaceQuery.refetch()}
            message={t("workspaceError")}
          />
        </div>
      ) : workspace === undefined || projection === null ? (
        <div className={styles.topicMapLoading} role="status">
          <Spinner label={t("loading")} size="lg" />
        </div>
      ) : (
        <div className={styles.topicMapWorkspace}>
          <section
            className={styles.topicMapStructure}
            aria-labelledby={`${dialogId}-structure`}
          >
            <div className={styles.topicMapSectionHeader}>
              <div>
                <span>{t("structureEyebrow")}</span>
                <h3 id={`${dialogId}-structure`}>{t("structureTitle")}</h3>
              </div>
              <strong>
                {t("activeTopicCount", {
                  count: projection.activeNodes.length,
                })}
              </strong>
            </div>
            {projection.roots.length === 0 ? (
              <div className={styles.topicMapEmptyStructure}>
                <Network aria-hidden="true" size={28} />
                <h4>{t("emptyStructureTitle")}</h4>
                <p>{t("emptyStructureDescription")}</p>
                {draft === null ? null : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openEditor("create")}
                  >
                    <Plus aria-hidden="true" size={15} />
                    {t("createRoot")}
                  </Button>
                )}
              </div>
            ) : (
              <ul
                role="tree"
                aria-label={t("tree.label")}
                className={styles.topicTree}
                onKeyDown={handleTopicTreeKeyDown}
              >
                {projection.roots.map((branch) => (
                  <TopicMapTreeBranch
                    key={branch.node.topicNodeId}
                    branch={branch}
                    selectedNodeId={effectiveSelectedNodeId}
                    tabStopNodeId={treeTabStopNodeId}
                    parentTopicNodeId={null}
                    fallbackState={topicInsightFallbackState}
                    onSelect={selectTopicNode}
                  />
                ))}
              </ul>
            )}
            {projection.supersededNodes.length === 0 ? null : (
              <div className={styles.topicHistory}>
                <div>
                  <History aria-hidden="true" size={17} />
                  <strong>
                    {t("historyTitle", {
                      count: projection.supersededNodes.length,
                    })}
                  </strong>
                </div>
                <p>{t("historyDescription")}</p>
                <ul>
                  {projection.supersededNodes.map((node) => (
                    <li key={node.topicNodeId}>
                      <button
                        type="button"
                        aria-pressed={
                          effectiveSelectedNodeId === node.topicNodeId
                        }
                        onClick={() => {
                          setSelectedNodeId(node.topicNodeId);
                          setEditorMode(null);
                        }}
                      >
                        {node.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <aside
            className={styles.topicMapDetail}
            aria-labelledby={`${dialogId}-detail`}
          >
            {selectedNode === null ? (
              (editorPanel ?? (
                <div className={styles.topicMapDetailEmpty}>
                  <Network aria-hidden="true" size={27} />
                  <h3 id={`${dialogId}-detail`}>{t("selectTopicTitle")}</h3>
                  <p>{t("selectTopicDescription")}</p>
                </div>
              ))
            ) : (
              <>
                <div className={styles.topicMapDetailHeader}>
                  <div>
                    <span>
                      {selectedNode.lifecycleState === "active"
                        ? t("activeTopic")
                        : t("retiredTopic")}
                    </span>
                    <h3 id={`${dialogId}-detail`}>{selectedNode.label}</h3>
                    <code title={selectedNode.topicNodeId}>
                      {truncateId(selectedNode.topicNodeId)}
                    </code>
                  </div>
                  <TopicCoveragePill
                    insight={selectedInsight}
                    fallbackState={topicInsightFallbackState}
                  />
                </div>
                {selectedNode.lifecycleState === "active" && draft !== null ? (
                  <>
                    <div
                      className={styles.topicMapNodeActions}
                      aria-label={t("actionsLabel")}
                    >
                      <button
                        type="button"
                        onClick={() => openEditor("create")}
                      >
                        <Plus aria-hidden="true" size={15} />
                        {t("action.create")}
                      </button>
                      <button type="button" onClick={() => openEditor("edit")}>
                        <Save aria-hidden="true" size={15} />
                        {t("action.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditor("rename")}
                      >
                        <Pencil aria-hidden="true" size={15} />
                        {t("action.rename")}
                      </button>
                      <button type="button" onClick={() => openEditor("split")}>
                        <GitBranch aria-hidden="true" size={15} />
                        {t("action.split")}
                      </button>
                      <button type="button" onClick={() => openEditor("merge")}>
                        <GitMerge aria-hidden="true" size={15} />
                        {t("action.merge")}
                      </button>
                      <button
                        type="button"
                        disabled={isSelectedRoot || selectedHasActiveChildren}
                        title={
                          isSelectedRoot
                            ? t("retireRootBlocked")
                            : selectedHasActiveChildren
                              ? t("retireChildrenBlocked")
                              : undefined
                        }
                        onClick={() => openEditor("retire")}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                        {t("action.retire")}
                      </button>
                    </div>
                    {isSelectedRoot || selectedHasActiveChildren ? (
                      <LimitationList
                        className={styles.topicActionLimitation}
                        limitations={[
                          isSelectedRoot
                            ? t("retireRootBlocked")
                            : t("retireChildrenBlocked"),
                        ]}
                      />
                    ) : null}
                  </>
                ) : null}

                {editorMode === null ? (
                  <TopicNodeReadView
                    node={selectedNode}
                    insight={selectedInsight}
                    parent={
                      selectedNode.parentTopicNodeId === null
                        ? null
                        : (structure?.nodes.find(
                            (node) =>
                              node.topicNodeId ===
                              selectedNode.parentTopicNodeId,
                          ) ?? null)
                    }
                    successors={selectedSuccessors}
                    insightsCoverage={insightsQuery.data?.coverage ?? null}
                  />
                ) : (
                  editorPanel
                )}
              </>
            )}
          </aside>
        </div>
      )}
      <footer className={styles.topicMapDialogFooter}>
        <span>
          {workspace?.generatedAt === undefined
            ? t("notAvailable")
            : t("generatedAt", {
                date: formatObservedAt(locale, workspace.generatedAt),
              })}
        </span>
        <strong>{t("historyGuarantee")}</strong>
      </footer>
    </GrowthMapDialogFrame>
  );
}

function TopicNodeReadView({
  node,
  insight,
  parent,
  successors,
  insightsCoverage,
}: {
  readonly node: TopicNodeRevision;
  readonly insight: GrowthMapTopicNodeInsight | null;
  readonly parent: TopicNodeRevision | null;
  readonly successors: readonly {
    readonly kind: "split_into" | "merged_into";
    readonly successorTopicNodeId: string;
    readonly label: string;
  }[];
  readonly insightsCoverage: GrowthMapTopicInsightsCoverage | null;
}) {
  const t = useTranslations("growthMap.keywordLibrary.topicMap");
  return (
    <div className={styles.topicNodeReadView}>
      {insight === null ? (
        <div className={styles.topicInsightUnavailable}>
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>{t("insightUnavailableTitle")}</strong>
            <p>{t("insightUnavailableDescription")}</p>
            <LimitationList limitations={insightsCoverage?.limitations ?? []} />
          </div>
        </div>
      ) : (
        <>
          <dl className={styles.topicInsightMetrics}>
            <div>
              <dt>{t("metric.keywords")}</dt>
              <dd>{insight.keywordCount}</dd>
            </div>
            <div>
              <dt>{t("metric.mappedPages")}</dt>
              <dd>{insight.mappedPageCount}</dd>
            </div>
            <div>
              <dt>{t("metric.reviewPending")}</dt>
              <dd>{insight.reviewPendingKeywordCount}</dd>
            </div>
            <div>
              <dt>{t("metric.conflicts")}</dt>
              <dd>{insight.conflictingIntentCount}</dd>
            </div>
          </dl>
          <div className={styles.topicMappingBreakdown}>
            <span>
              {t("mapping.existing", {
                count: insight.existingPageKeywordCount,
              })}
            </span>
            <span>
              {t("mapping.newAsset", {
                count: insight.newAssetKeywordCount,
              })}
            </span>
            <span>
              {t("mapping.unassigned", {
                count: insight.unassignedKeywordCount,
              })}
            </span>
          </div>
          {insight.limitation === null ? null : (
            <LimitationList
              className={styles.topicInsightLimitation}
              limitations={[insight.limitation]}
            />
          )}
        </>
      )}

      <dl className={styles.topicNodeFacts}>
        <div>
          <dt>{t("node.parent")}</dt>
          <dd>{parent?.label ?? t("node.root")}</dd>
        </div>
        <div>
          <dt>{t("node.description")}</dt>
          <dd>{node.description ?? t("notAvailable")}</dd>
        </div>
        <div>
          <dt>{t("node.intentEnvelope")}</dt>
          <dd>
            {node.intentEnvelope.length === 0 ? (
              t("notAvailable")
            ) : (
              <span className={styles.topicIntentTags}>
                {node.intentEnvelope.map((intent) => (
                  <span key={intent}>{intent}</span>
                ))}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {node.lifecycleState !== "superseded" ? null : (
        <div className={styles.topicRetiredHistory}>
          <History aria-hidden="true" size={18} />
          <div>
            <strong>{t("retiredHistoryTitle")}</strong>
            <p>{t("retiredHistoryDescription")}</p>
            {successors.length === 0 ? null : (
              <ul>
                {successors.map((successor) => (
                  <li
                    key={`${successor.kind}:${successor.successorTopicNodeId}`}
                  >
                    {t(`successorKind.${successor.kind}`, {
                      label: successor.label,
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface TopicMapEditorProps {
  readonly mode: TopicMapEditorMode;
  readonly draft: NonNullable<TopicModelWorkspaceProjection["draft"]> | null;
  readonly selectedNode: TopicNodeRevision | null;
  readonly activeNodes: readonly TopicNodeRevision[];
  readonly legalParentIds: readonly string[];
  readonly parentSelectId: string;
  readonly label: string;
  readonly description: string;
  readonly intentEnvelope: string;
  readonly parentTopicNodeId: string;
  readonly successorLabels: string;
  readonly mergeSourceIds: readonly string[];
  readonly reason: string;
  readonly localError: string | null;
  readonly mutationError: ApiError | null;
  readonly mutationPending: boolean;
  readonly onLabelChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onIntentEnvelopeChange: (value: string) => void;
  readonly onParentChange: (value: string) => void;
  readonly onSuccessorLabelsChange: (value: string) => void;
  readonly onMergeSourceIdsChange: (value: readonly string[]) => void;
  readonly onReasonChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onBegin: (event: FormEvent<HTMLFormElement>) => void;
  readonly onConfirm: (event: FormEvent<HTMLFormElement>) => void;
  readonly onCreate: (event: FormEvent<HTMLFormElement>) => void;
  readonly onEdit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onRename: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSplit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onMerge: (event: FormEvent<HTMLFormElement>) => void;
  readonly onRetire: (event: FormEvent<HTMLFormElement>) => void;
}

function TopicMapEditor({
  mode,
  draft,
  selectedNode,
  activeNodes,
  legalParentIds,
  parentSelectId,
  label,
  description,
  intentEnvelope,
  parentTopicNodeId,
  successorLabels,
  mergeSourceIds,
  reason,
  localError,
  mutationError,
  mutationPending,
  onLabelChange,
  onDescriptionChange,
  onIntentEnvelopeChange,
  onParentChange,
  onSuccessorLabelsChange,
  onMergeSourceIdsChange,
  onReasonChange,
  onCancel,
  onBegin,
  onConfirm,
  onCreate,
  onEdit,
  onRename,
  onSplit,
  onMerge,
  onRetire,
}: TopicMapEditorProps) {
  const t = useTranslations("growthMap.keywordLibrary.topicMap");
  const isBeginning = mode === "create" && draft === null;
  const editorKey = isBeginning ? "begin" : mode;
  const onSubmit = isBeginning
    ? onBegin
    : mode === "confirm"
      ? onConfirm
      : mode === "create"
        ? onCreate
        : mode === "edit"
          ? onEdit
          : mode === "rename"
            ? onRename
            : mode === "split"
              ? onSplit
              : mode === "merge"
                ? onMerge
                : onRetire;
  const parentOptions =
    mode === "create"
      ? activeNodes
      : activeNodes.filter((node) => legalParentIds.includes(node.topicNodeId));
  const mergeCandidates = activeNodes.filter(
    (node) => node.topicNodeId !== selectedNode?.topicNodeId,
  );
  const isConflict =
    mutationError instanceof ApiError && mutationError.status === 409;

  return (
    <form className={styles.topicMapEditor} onSubmit={onSubmit}>
      <div className={styles.topicMapEditorHeader}>
        <div>
          <span>{t("editor.eyebrow")}</span>
          <h3>{t(`editor.${editorKey}.title`)}</h3>
          <p>{t(`editor.${editorKey}.description`)}</p>
        </div>
        <button
          type="button"
          aria-label={t("editor.cancel")}
          onClick={onCancel}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      {isBeginning ? (
        <div className={styles.topicEditorNotice}>
          <Network aria-hidden="true" size={19} />
          <p>{t("editor.begin.authority")}</p>
        </div>
      ) : mode === "confirm" ? (
        <div className={styles.topicEditorNotice}>
          <Send aria-hidden="true" size={19} />
          <p>{t("editor.confirm.authority")}</p>
        </div>
      ) : mode === "retire" ? (
        <div className={cx(styles.topicEditorNotice, styles.topicEditorDanger)}>
          <History aria-hidden="true" size={19} />
          <p>{t("editor.retire.history")}</p>
        </div>
      ) : null}

      {mode === "create" && !isBeginning ? (
        <>
          <Field label={t("field.label")} required>
            <TextInput
              value={label}
              maxLength={200}
              onChange={(event) => onLabelChange(event.target.value)}
            />
          </Field>
          {draft?.rootTopicNodeId === null ? (
            <div className={styles.topicRootHint}>{t("field.firstRoot")}</div>
          ) : (
            <Field label={t("field.parent")} htmlFor={parentSelectId} required>
              <select
                id={parentSelectId}
                className={styles.topicSelect}
                value={parentTopicNodeId}
                onChange={(event) => onParentChange(event.target.value)}
              >
                {parentOptions.map((node) => (
                  <option key={node.topicNodeId} value={node.topicNodeId}>
                    {node.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("field.description")}>
            <TextArea
              className={styles.topicCompactArea}
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
          </Field>
          <Field
            label={t("field.intentEnvelope")}
            help={t("field.intentEnvelopeHelp")}
          >
            <TextInput
              value={intentEnvelope}
              onChange={(event) => onIntentEnvelopeChange(event.target.value)}
            />
          </Field>
        </>
      ) : mode === "edit" ? (
        <>
          {selectedNode?.topicNodeId === draft?.rootTopicNodeId ? (
            <div className={styles.topicRootHint}>{t("field.rootFixed")}</div>
          ) : (
            <Field label={t("field.parent")} htmlFor={parentSelectId} required>
              <select
                id={parentSelectId}
                className={styles.topicSelect}
                value={parentTopicNodeId}
                onChange={(event) => onParentChange(event.target.value)}
              >
                {parentOptions.map((node) => (
                  <option key={node.topicNodeId} value={node.topicNodeId}>
                    {node.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("field.description")}>
            <TextArea
              className={styles.topicCompactArea}
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
          </Field>
          <Field
            label={t("field.intentEnvelope")}
            help={t("field.intentEnvelopeHelp")}
          >
            <TextInput
              value={intentEnvelope}
              onChange={(event) => onIntentEnvelopeChange(event.target.value)}
            />
          </Field>
        </>
      ) : mode === "rename" ? (
        <Field label={t("field.newLabel")} required>
          <TextInput
            value={label}
            maxLength={200}
            onChange={(event) => onLabelChange(event.target.value)}
          />
        </Field>
      ) : mode === "split" ? (
        <Field
          label={t("field.successorLabels")}
          help={t("field.successorLabelsHelp")}
          required
        >
          <TextArea
            className={styles.topicCompactArea}
            rows={4}
            value={successorLabels}
            placeholder={t("field.successorLabelsPlaceholder")}
            onChange={(event) => onSuccessorLabelsChange(event.target.value)}
          />
        </Field>
      ) : mode === "merge" ? (
        <>
          <Field label={t("field.mergedLabel")} required>
            <TextInput
              value={label}
              maxLength={200}
              onChange={(event) => onLabelChange(event.target.value)}
            />
          </Field>
          <fieldset className={styles.topicMergeChoices}>
            <legend>{t("field.mergeSources")}</legend>
            {mergeCandidates.map((node) => (
              <label key={node.topicNodeId}>
                <input
                  type="checkbox"
                  checked={mergeSourceIds.includes(node.topicNodeId)}
                  onChange={(event) =>
                    onMergeSourceIdsChange(
                      event.target.checked
                        ? [...mergeSourceIds, node.topicNodeId]
                        : mergeSourceIds.filter(
                            (sourceId) => sourceId !== node.topicNodeId,
                          ),
                    )
                  }
                />
                <span>{node.label}</span>
              </label>
            ))}
          </fieldset>
          <Field label={t("field.description")}>
            <TextArea
              className={styles.topicCompactArea}
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
          </Field>
        </>
      ) : null}

      <Field label={t("field.reason")} help={t("field.reasonHelp")} required>
        <TextArea
          className={styles.topicReasonArea}
          rows={2}
          value={reason}
          maxLength={2000}
          onChange={(event) => onReasonChange(event.target.value)}
        />
      </Field>

      {localError === null ? null : (
        <p className={styles.topicEditorError} role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          {localError}
        </p>
      )}
      {isConflict ? (
        <p className={styles.topicEditorError} role="alert">
          <RefreshCw aria-hidden="true" size={16} />
          {t("conflict")}
        </p>
      ) : mutationError !== null ? (
        <ProblemNotice
          error={mutationError}
          message={t("mutationError")}
          compact
        />
      ) : null}

      <div className={styles.topicEditorActions}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={mutationPending}
          onClick={onCancel}
        >
          {t("editor.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={mutationPending}>
          {mutationPending
            ? t("editor.saving")
            : t(`editor.${editorKey}.submit`)}
        </Button>
      </div>
    </form>
  );
}

function KeywordClassificationField({
  label,
  value,
  limitation,
  identity,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly limitation: string | null;
  readonly identity?: string | undefined;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  return (
    <div className={styles.keywordClassificationField}>
      <dt>{label}</dt>
      <dd>
        <strong className={value === null ? styles.keywordMissing : undefined}>
          {value ?? t("notAvailable")}
        </strong>
        {identity === undefined ? null : (
          <code title={identity}>{truncateId(identity)}</code>
        )}
        {limitation === null ? null : (
          <LimitationHint label={label} limitations={[limitation]} />
        )}
      </dd>
    </div>
  );
}

function KeywordMappedTarget({
  target,
}: {
  readonly target: GrowthMapKeywordLibraryItem["mappedTarget"];
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  if (target.kind === "existing_page") {
    const externalUrl = safeExternalPageUrl(target.normalizedUrl);
    return (
      <span className={styles.keywordMappedTarget}>
        <strong>{t("mappingTarget.existing_page")}</strong>
        {externalUrl === null ? (
          <span>{target.normalizedUrl}</span>
        ) : (
          <a href={externalUrl} target="_blank" rel="noreferrer">
            {target.normalizedUrl}
            <ArrowUpRight aria-hidden="true" size={14} />
          </a>
        )}
        <code title={target.sitePageId}>{truncateId(target.sitePageId)}</code>
      </span>
    );
  }
  return (
    <span className={styles.keywordMappedTarget}>
      <strong>{t(`mappingTarget.${target.kind}`)}</strong>
    </span>
  );
}

function KeywordMetricCard({
  metricKey,
  metric,
  absenceLimitation,
}: {
  readonly metricKey: keyof GrowthMapKeywordLibraryItem["metrics"]["limitations"];
  readonly metric: KeywordMetric | null;
  readonly absenceLimitation: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.keywordLibrary");
  const presentation = keywordMetricPresentation(metric, absenceLimitation);
  const currentUrl =
    presentation.state === "observed" &&
    metricKey === "currentUrl" &&
    typeof presentation.value === "string"
      ? safeExternalPageUrl(presentation.value)
      : null;

  return (
    <article className={styles.keywordMetricCard}>
      <header>
        <span>{t(`metric.${metricKey}`)}</span>
        {metric === null ? null : (
          <KeywordFreshnessPill freshness={metric.freshness} />
        )}
      </header>
      {presentation.state === "observed" ? (
        <div className={styles.keywordMetricValue}>
          {typeof presentation.value === "number" ? (
            <strong>{formatNumber(locale, presentation.value)}</strong>
          ) : currentUrl !== null ? (
            <a href={currentUrl} target="_blank" rel="noreferrer">
              {presentation.value}
              <ArrowUpRight aria-hidden="true" size={14} />
            </a>
          ) : (
            <strong>{presentation.value}</strong>
          )}
        </div>
      ) : (
        <strong className={styles.keywordMissing}>{t("notAvailable")}</strong>
      )}
      {metric === null ? null : (
        <>
          <p className={styles.keywordMetricObservedAt}>
            <span>{t("metricObservedAt")}</span>
            <time dateTime={metric.observedAt}>
              {formatObservedAt(locale, metric.observedAt)}
            </time>
          </p>
          <details className={styles.traceDisclosure}>
            <summary>{t("viewMetricSourceDetails")}</summary>
            <dl className={styles.keywordMetricMeta}>
              <div>
                <dt>{t("snapshotId")}</dt>
                <dd>
                  <code title={metric.snapshotId}>{metric.snapshotId}</code>
                </dd>
              </div>
              <div>
                <dt>{t("metricObservation")}</dt>
                <dd>
                  <code title={metric.observationId}>
                    {metric.observationId}
                  </code>
                </dd>
              </div>
              <div>
                <dt>{t("metricPointer")}</dt>
                <dd>
                  <code>{metric.valuePointer}</code>
                </dd>
              </div>
            </dl>
          </details>
        </>
      )}
      {presentation.limitation === null ? null : (
        <LimitationList
          className={styles.keywordMetricLimitation}
          limitations={[presentation.limitation]}
        />
      )}
    </article>
  );
}

function KeywordSourceOccurrenceCard({
  occurrence,
}: {
  readonly occurrence: GrowthMapKeywordSourceOccurrence;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.keywordLibrary");
  return (
    <article
      className={styles.keywordSourceCard}
      data-source-kind={occurrence.sourceKind}
    >
      <header>
        <div>
          <Database aria-hidden="true" size={18} />
          <strong>{t(`sourceKind.${occurrence.sourceKind}`)}</strong>
        </div>
        <KeywordFreshnessPill freshness={occurrence.freshness} />
      </header>
      <dl className={styles.keywordSourceFacts}>
        <div>
          <dt>{t("collectedAt")}</dt>
          <dd>
            <time dateTime={occurrence.collectedAt}>
              {formatObservedAt(locale, occurrence.collectedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t("providerDataAsOf")}</dt>
          <dd>
            {occurrence.providerDataAsOf === null ? (
              <span>{t("notProvided")}</span>
            ) : (
              <time dateTime={occurrence.providerDataAsOf}>
                {formatObservedAt(locale, occurrence.providerDataAsOf)}
              </time>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("scopeBasisLabel")}</dt>
          <dd>{t(`scopeBasis.${occurrence.scopeBasis}`)}</dd>
        </div>
        <div>
          <dt>{t("marketLanguage")}</dt>
          <dd>
            {t("marketLanguageValue", {
              market: occurrence.marketCode,
              language: occurrence.languageTag,
            })}
          </dd>
        </div>
        {occurrence.sourceKind === "interview_summary" ||
        occurrence.sourceKind === "user_review" ? (
          <div>
            <dt>{t("evidenceLabel")}</dt>
            <dd>{occurrence.evidenceLabel}</dd>
          </div>
        ) : null}
        {occurrence.sourceKind === "user_review" ? (
          <div>
            <dt>{t("reviewPlatformLabel")}</dt>
            <dd>{t(`reviewPlatform.${occurrence.reviewPlatform}`)}</dd>
          </div>
        ) : null}
      </dl>
      {occurrence.sourceKind === "user_review" &&
      occurrence.sourceUrl !== null ? (
        <a
          className={styles.keywordEvidenceSourceLink}
          href={occurrence.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t("openPublicReviewSource")}
          <ArrowUpRight aria-hidden="true" size={14} />
        </a>
      ) : null}
      {occurrence.sourceKind === "interview_summary" ||
      occurrence.sourceKind === "user_review" ? (
        <p className={styles.keywordEvidencePrivacy}>
          <ShieldCheck aria-hidden="true" size={15} />
          {t("deidentifiedEvidenceNotice")}
        </p>
      ) : null}
      <details className={styles.traceDisclosure}>
        <summary>{t("viewSourceDetails")}</summary>
        <dl className={styles.keywordSourceRefs}>
          <div>
            <dt>{t("occurrenceId")}</dt>
            <dd>
              <code title={occurrence.occurrenceId}>
                {occurrence.occurrenceId}
              </code>
            </dd>
          </div>
          {occurrence.snapshotId === null ? null : (
            <div>
              <dt>{t("snapshotId")}</dt>
              <dd>
                <code title={occurrence.snapshotId}>
                  {occurrence.snapshotId}
                </code>
              </dd>
            </div>
          )}
          {occurrence.sourceKind === "interview_summary" ||
          occurrence.sourceKind === "user_review" ? (
            <div>
              <dt>{t("collectionRunId")}</dt>
              <dd>
                <code title={occurrence.collectionRunId}>
                  {occurrence.collectionRunId}
                </code>
              </dd>
            </div>
          ) : null}
          {occurrence.sourceObservationId === null ? null : (
            <div>
              <dt>{t("observationId")}</dt>
              <dd>
                <code title={occurrence.sourceObservationId}>
                  {occurrence.sourceObservationId}
                </code>
              </dd>
            </div>
          )}
          {occurrence.sourcePointer === null ? null : (
            <div>
              <dt>{t("sourcePointer")}</dt>
              <dd>
                <code>{occurrence.sourcePointer}</code>
              </dd>
            </div>
          )}
          {occurrence.sourceKind === "csv_import" ? (
            <div>
              <dt>{t("importPreviewId")}</dt>
              <dd>
                <code title={occurrence.importPreviewId}>
                  {occurrence.importPreviewId}
                </code>
              </dd>
            </div>
          ) : null}
          {occurrence.sourceKind === "interview_summary" ||
          occurrence.sourceKind === "user_review" ? (
            <div>
              <dt>{t("sourceRecordHash")}</dt>
              <dd>
                <code title={occurrence.sourceRecordHash}>
                  {occurrence.sourceRecordHash}
                </code>
              </dd>
            </div>
          ) : null}
        </dl>
      </details>
      {occurrence.scopeLimitation === null ? null : (
        <LimitationList
          className={styles.keywordSourceNote}
          label={t("scopeLimitation")}
          limitations={[occurrence.scopeLimitation]}
        />
      )}
      {occurrence.limitation === null ? null : (
        <LimitationList
          className={styles.keywordSourceNote}
          label={t("sourceLimitation")}
          limitations={[occurrence.limitation]}
        />
      )}
    </article>
  );
}

function KeywordRankHistorySection({
  keyword,
  history,
  isPending,
  error,
  onRetry,
}: {
  readonly keyword: string;
  readonly history: GrowthMapKeywordRankHistory | undefined;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.keywordLibrary.rankHistory");
  const model =
    history === undefined ? null : buildKeywordRankChartModel(history);
  const chartId = `keyword-rank-chart-${history?.keywordId ?? "pending"}`;

  if (isPending) {
    return (
      <section
        className={cx(styles.keywordDetailSection, styles.rankHistorySection)}
        aria-labelledby={`${chartId}-heading`}
        aria-busy="true"
      >
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("eyebrow")}</span>
            <h3 id={`${chartId}-heading`}>{t("title")}</h3>
          </div>
          <BarChart3 aria-hidden="true" size={21} />
        </div>
        <div className={styles.rankHistoryLoading} role="status">
          <Spinner label={t("loading")} size="md" />
          <p>{t("loading")}</p>
        </div>
      </section>
    );
  }

  if (error !== null) {
    return (
      <section
        className={cx(styles.keywordDetailSection, styles.rankHistorySection)}
        aria-labelledby={`${chartId}-heading`}
      >
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("eyebrow")}</span>
            <h3 id={`${chartId}-heading`}>{t("title")}</h3>
          </div>
          <BarChart3 aria-hidden="true" size={21} />
        </div>
        <ProblemNotice
          compact
          className={styles.rankHistoryProblem}
          error={error}
          message={t("error")}
          onRetry={onRetry}
        />
      </section>
    );
  }

  if (history === undefined) return null;

  const windowStart = formatObservedAt(locale, history.window.startedAt);
  const windowEnd = formatObservedAt(locale, history.window.endedAt);
  const tableRows = history.series
    .flatMap((series) =>
      series.points.map((point) => ({
        provider: series.provider,
        metric: series.metric,
        point,
      })),
    )
    .sort(
      (left, right) =>
        Date.parse(left.point.observedAt) - Date.parse(right.point.observedAt),
    );
  const pointCount = tableRows.length;

  return (
    <section
      className={cx(styles.keywordDetailSection, styles.rankHistorySection)}
      aria-labelledby={`${chartId}-heading`}
    >
      <div className={styles.keywordSectionHeading}>
        <div>
          <span>{t("eyebrow")}</span>
          <h3 id={`${chartId}-heading`}>{t("title")}</h3>
        </div>
        <BarChart3 aria-hidden="true" size={21} />
      </div>
      <p className={styles.keywordSectionDescription}>{t("description")}</p>

      <div className={styles.rankHistoryMeta}>
        <span>
          <strong>{t("window", { start: windowStart, end: windowEnd })}</strong>
          <small>{t("axisRank")}</small>
        </span>
        <span>
          <small>{t("coverage")}</small>
          <CoveragePill coverage={history.coverage} />
        </span>
      </div>

      {model === null ? (
        <div className={styles.rankHistoryUnavailable}>
          <CircleDashed aria-hidden="true" size={26} />
          <div>
            <strong>{t("unavailableTitle")}</strong>
            <p>{t("unavailableDescription")}</p>
          </div>
        </div>
      ) : (
        <>
          <ul className={styles.rankHistoryLegend} aria-label={t("coverage")}>
            {model.series.map((series) => (
              <li key={`${series.provider}:${series.metric}`}>
                <span
                  className={styles.rankLegendMark}
                  data-provider={series.provider}
                  aria-hidden="true"
                />
                <span>
                  <strong>{t(`series.${series.provider}`)}</strong>
                  <small>{t(`seriesDescription.${series.provider}`)}</small>
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.rankChartFrame}>
            <svg
              className={styles.rankChart}
              viewBox={`0 0 ${model.width} ${model.height}`}
              role="img"
              aria-labelledby={`${chartId}-title ${chartId}-description`}
            >
              <title id={`${chartId}-title`}>
                {t("chartTitle", { keyword })}
              </title>
              <desc id={`${chartId}-description`}>
                {t("chartDescription", {
                  seriesCount: model.series.length,
                  pointCount,
                })}
              </desc>
              {model.yTicks.map((tick) => (
                <g key={tick.value} aria-hidden="true">
                  <line
                    className={styles.rankGridLine}
                    x1={model.plot.left}
                    x2={model.plot.right}
                    y1={tick.y}
                    y2={tick.y}
                  />
                  <text
                    className={styles.rankAxisLabel}
                    x={model.plot.left - 10}
                    y={tick.y + 4}
                    textAnchor="end"
                  >
                    {formatNumber(locale, tick.value)}
                  </text>
                </g>
              ))}
              {model.changeMarkers.map((marker) => (
                <line
                  key={marker.changeReceiptId}
                  className={styles.rankChangeMarker}
                  data-kind={marker.attemptKind}
                  x1={marker.x}
                  x2={marker.x}
                  y1={model.plot.top}
                  y2={model.plot.bottom}
                  aria-hidden="true"
                />
              ))}
              {model.series.map((series) =>
                series.polylinePoints === null ? null : (
                  <polyline
                    key={`${series.provider}:${series.metric}:line`}
                    className={styles.rankSeriesLine}
                    data-provider={series.provider}
                    points={series.polylinePoints}
                    aria-hidden="true"
                  />
                ),
              )}
              {model.series.flatMap((series) =>
                series.points.map((point) =>
                  series.provider === "gsc" ? (
                    <rect
                      key={`${point.observationId}:${point.valuePointer}`}
                      className={styles.rankPoint}
                      data-provider={series.provider}
                      x={point.x - 5}
                      y={point.y - 5}
                      width={10}
                      height={10}
                      rx={2}
                      transform={`rotate(45 ${point.x} ${point.y})`}
                      aria-hidden="true"
                    />
                  ) : (
                    <circle
                      key={`${point.observationId}:${point.valuePointer}`}
                      className={styles.rankPoint}
                      data-provider={series.provider}
                      cx={point.x}
                      cy={point.y}
                      r={5}
                      aria-hidden="true"
                    />
                  ),
                ),
              )}
              <text
                className={styles.rankDateLabel}
                x={model.plot.left}
                y={model.height - 16}
                textAnchor="start"
                aria-hidden="true"
              >
                {new Intl.DateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                }).format(new Date(history.window.startedAt))}
              </text>
              <text
                className={styles.rankDateLabel}
                x={model.plot.right}
                y={model.height - 16}
                textAnchor="end"
                aria-hidden="true"
              >
                {new Intl.DateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                }).format(new Date(history.window.endedAt))}
              </text>
            </svg>
          </div>
        </>
      )}

      <LimitationList limitations={history.coverage.limitations} />

      <div className={styles.rankChangeLedger}>
        <header>
          <strong>{t("verifiedChanges")}</strong>
          <small>{t("changeNote")}</small>
        </header>
        {history.changeMarkers.length === 0 ? (
          <p>{t("noChanges")}</p>
        ) : (
          <ul>
            {history.changeMarkers.map((marker) => (
              <li key={marker.changeReceiptId}>
                <span
                  className={styles.rankChangeSwatch}
                  data-kind={marker.attemptKind}
                  aria-hidden="true"
                />
                <span>
                  <strong>
                    {t("changeItem", {
                      kind: t(`attemptKind.${marker.attemptKind}`),
                      revision: marker.artifactRevision,
                    })}
                  </strong>
                  <small>
                    {t("changeTime")}{" "}
                    <time dateTime={marker.changedAt}>
                      {formatObservedAt(locale, marker.changedAt)}
                    </time>
                  </small>
                </span>
                <code title={marker.changeReceiptId}>
                  {truncateId(marker.changeReceiptId)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>

      {tableRows.length === 0 ? null : (
        <details className={styles.rankDataDisclosure}>
          <summary>{t("viewDataTable")}</summary>
          <div className={styles.rankDataTableScroll}>
            <table className={styles.rankDataTable}>
              <caption>{t("tableCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("table.source")}</th>
                  <th scope="col">{t("table.metric")}</th>
                  <th scope="col">{t("table.observedAt")}</th>
                  <th scope="col">{t("table.providerDataAsOf")}</th>
                  <th scope="col">{t("table.rank")}</th>
                  <th scope="col">{t("table.grade")}</th>
                  <th scope="col">{t("table.limitation")}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map(({ provider, metric, point }) => (
                  <tr key={`${point.observationId}:${point.valuePointer}`}>
                    <th scope="row">
                      {provider === "dataforseo" ? "DataForSEO" : "GSC"}
                    </th>
                    <td>{t(`metric.${metric}`)}</td>
                    <td>
                      <time dateTime={point.observedAt}>
                        {formatObservedAt(locale, point.observedAt)}
                      </time>
                    </td>
                    <td>
                      {point.providerDataAsOf === null ? (
                        t("notProvided")
                      ) : (
                        <time dateTime={point.providerDataAsOf}>
                          {formatObservedAt(locale, point.providerDataAsOf)}
                        </time>
                      )}
                    </td>
                    <td>{formatNumber(locale, point.value)}</td>
                    <td>{point.grade}</td>
                    <td>
                      <LimitationList limitations={[point.limitation]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

interface KeywordReviewSitePageOption {
  readonly sitePageId: string;
  readonly normalizedUrl: string;
  readonly title: string | null;
}

function keywordReviewSelectValues(
  current: string | null,
  defaults: readonly string[],
): readonly string[] {
  return Array.from(
    new Set([...(current === null ? [] : [current]), ...defaults]),
  );
}

function keywordReviewSitePageOptions(
  detail: GrowthMapKeywordLibraryItem,
  sitePages: readonly GrowthMapUrlPortfolioItem[],
): readonly KeywordReviewSitePageOption[] {
  const options = new Map<string, KeywordReviewSitePageOption>();
  if (detail.mappedTarget.kind === "existing_page") {
    options.set(detail.mappedTarget.sitePageId, {
      sitePageId: detail.mappedTarget.sitePageId,
      normalizedUrl: detail.mappedTarget.normalizedUrl,
      title: null,
    });
  }
  for (const page of sitePages) {
    options.set(page.sitePageId, {
      sitePageId: page.sitePageId,
      normalizedUrl: page.normalizedUrl,
      title: page.title,
    });
  }
  return Array.from(options.values());
}

function KeywordReviewDialog({
  projectId,
  open,
  detail,
  topicInsights,
  isTopicInsightsPending,
  topicInsightsError,
  onRetryTopicInsights,
  sitePages,
  isSitePagesPending,
  sitePagesError,
  sitePagesTruncated,
  onRequestClose,
  onSaved,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly detail: GrowthMapKeywordLibraryItem;
  readonly topicInsights: GrowthMapTopicModelInsights | null;
  readonly isTopicInsightsPending: boolean;
  readonly topicInsightsError: unknown;
  readonly onRetryTopicInsights: () => void;
  readonly sitePages: readonly GrowthMapUrlPortfolioItem[];
  readonly isSitePagesPending: boolean;
  readonly sitePagesError: unknown;
  readonly sitePagesTruncated: boolean;
  readonly onRequestClose: () => void;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary.review");
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const statusId = `${dialogId}-status`;
  const intentId = `${dialogId}-intent`;
  const buyerStageId = `${dialogId}-buyer-stage`;
  const topicId = `${dialogId}-topic`;
  const mappingDecisionId = `${dialogId}-mapping-decision`;
  const sitePageId = `${dialogId}-site-page`;
  const reviewDetailQuery = useGrowthMapKeywordReviewDetail(
    projectId,
    detail.keywordId,
    open,
  );
  const reviewDetail = reviewDetailQuery.data?.data ?? null;
  const mutation = useReviewGrowthMapKeyword(projectId, detail.keywordId);
  const [status, setStatus] = useState<GrowthMapKeywordStatus>("candidate");
  const [intent, setIntent] = useState("");
  const [buyerStage, setBuyerStage] = useState("");
  const [topicNodeId, setTopicNodeId] = useState("");
  const [mappingDecision, setMappingDecision] =
    useState<KeywordMappingDecision>("unassigned");
  const [mappedSitePageId, setMappedSitePageId] = useState("");
  const [reason, setReason] = useState(t("defaultReason"));
  const [localError, setLocalError] = useState<string | null>(null);
  const [conflictCommand, setConflictCommand] =
    useState<ReviewKeywordRequest | null>(null);

  const confirmedTopicNodes = useMemo(
    () =>
      topicInsights?.topicModelRevision === null
        ? []
        : (topicInsights?.nodes ?? []),
    [topicInsights],
  );
  const selectedTopic =
    confirmedTopicNodes.find((node) => node.topicNodeId === topicNodeId) ??
    null;
  const pageOptions = useMemo(
    () =>
      reviewDetail === null
        ? []
        : keywordReviewSitePageOptions(reviewDetail, sitePages),
    [reviewDetail, sitePages],
  );
  const intentOptions = keywordReviewSelectValues(
    reviewDetail?.intent ?? null,
    KEYWORD_REVIEW_INTENTS,
  );
  const buyerStageOptions = keywordReviewSelectValues(
    reviewDetail?.buyerStage ?? null,
    KEYWORD_REVIEW_BUYER_STAGES,
  );
  const hasConfirmedTopicAuthority =
    topicInsights?.topicModelRevision !== null &&
    topicInsights !== null &&
    confirmedTopicNodes.length > 0;
  const isRevisionConflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;

  useEffect(() => {
    if (!open || reviewDetail === null) return;
    setStatus(reviewDetail.status);
    setIntent(reviewDetail.intent ?? "");
    setBuyerStage(reviewDetail.buyerStage ?? "");
    setTopicNodeId(
      confirmedTopicNodes.some(
        (node) => node.topicNodeId === reviewDetail.cluster?.clusterId,
      )
        ? (reviewDetail.cluster?.clusterId ?? "")
        : "",
    );
    setMappingDecision(reviewDetail.mappedTarget.kind);
    setMappedSitePageId(
      reviewDetail.mappedTarget.kind === "existing_page"
        ? reviewDetail.mappedTarget.sitePageId
        : "",
    );
    setReason(reviewDetail.mappedTarget.reason ?? t("defaultReason"));
    setLocalError(null);
    setConflictCommand(null);
  }, [confirmedTopicNodes, open, reviewDetail, t]);

  function clearPendingConfirmation(): void {
    setConflictCommand(null);
    setLocalError(null);
    mutation.reset();
  }

  function handleStatusChange(nextStatus: GrowthMapKeywordStatus): void {
    clearPendingConfirmation();
    setStatus(nextStatus);
    if (nextStatus === "excluded") {
      setTopicNodeId("");
      setMappingDecision("unassigned");
      setMappedSitePageId("");
    }
  }

  function handleTopicChange(nextTopicNodeId: string): void {
    clearPendingConfirmation();
    setTopicNodeId(nextTopicNodeId);
    if (nextTopicNodeId.length === 0) {
      setMappingDecision("unassigned");
      setMappedSitePageId("");
    }
  }

  function handleMappingChange(
    nextMappingDecision: KeywordMappingDecision,
  ): void {
    clearPendingConfirmation();
    setMappingDecision(nextMappingDecision);
    if (nextMappingDecision !== "existing_page") {
      setMappedSitePageId("");
    } else if (mappedSitePageId.length === 0) {
      setMappedSitePageId(pageOptions[0]?.sitePageId ?? "");
    }
  }

  function reviewDraft(): KeywordGovernanceReviewDraft {
    return {
      status,
      intent,
      buyerStage,
      topicNodeId,
      mappingDecision,
      mappedSitePageId,
      reason,
    };
  }

  function save(command: ReviewKeywordRequest): void {
    mutation.mutate(command, {
      onSuccess: () => {
        setConflictCommand(null);
        setLocalError(null);
        onSaved();
        onRequestClose();
      },
    });
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.reset();
    if (reviewDetail === null) return;
    const command = buildKeywordGovernanceReviewCommand(
      reviewDetail,
      topicInsights,
      reviewDraft(),
    );
    if (command === null) {
      setLocalError(
        mappingDecision !== "unassigned" && topicNodeId.length === 0
          ? t("validation.topicRequired")
          : mappingDecision === "existing_page" && mappedSitePageId.length === 0
            ? t("validation.pageRequired")
            : t("validation.form"),
      );
      return;
    }
    if (
      keywordTopicNeedsConflictConfirmation(
        topicInsights,
        command.topicNodeId ?? "",
      )
    ) {
      setLocalError(null);
      setConflictCommand(command);
      return;
    }
    save(command);
  }

  return (
    <GrowthMapDialogFrame
      open={open}
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={onRequestClose}
      className={styles.keywordReviewDialog}
    >
      <header className={styles.keywordRelationDialogHeader}>
        <div>
          <span>{t("eyebrow")}</span>
          <h2 id={titleId}>
            {t("title", {
              keyword: reviewDetail?.displayKeyword ?? detail.displayKeyword,
            })}
          </h2>
          <p id={descriptionId}>{t("description")}</p>
        </div>
        <button
          type="button"
          className={styles.keywordRelationClose}
          aria-label={t("close")}
          onClick={onRequestClose}
        >
          <X aria-hidden="true" size={19} />
        </button>
      </header>

      <form className={styles.keywordReviewForm} onSubmit={submit}>
        <section className={styles.keywordReviewSection}>
          <div className={styles.keywordReviewSectionHeading}>
            <span>01</span>
            <div>
              <h3>{t("classificationTitle")}</h3>
              <p>{t("classificationDescription")}</p>
            </div>
          </div>
          <div className={styles.keywordReviewGrid}>
            <Field label={t("field.status")} htmlFor={statusId} required>
              <select
                id={statusId}
                className={styles.topicSelect}
                value={status}
                disabled={reviewDetail === null}
                onChange={(event) =>
                  handleStatusChange(
                    event.target.value as GrowthMapKeywordStatus,
                  )
                }
              >
                {KEYWORD_REVIEW_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.intent")} htmlFor={intentId}>
              <select
                id={intentId}
                className={styles.topicSelect}
                value={intent}
                disabled={reviewDetail === null}
                onChange={(event) => {
                  clearPendingConfirmation();
                  setIntent(event.target.value);
                }}
              >
                <option value="">{t("unclassified")}</option>
                {intentOptions.map((value) => (
                  <option key={value} value={value}>
                    {KEYWORD_REVIEW_INTENTS.includes(
                      value as (typeof KEYWORD_REVIEW_INTENTS)[number],
                    )
                      ? t(`intent.${value}`)
                      : value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.buyerStage")} htmlFor={buyerStageId}>
              <select
                id={buyerStageId}
                className={styles.topicSelect}
                value={buyerStage}
                disabled={reviewDetail === null}
                onChange={(event) => {
                  clearPendingConfirmation();
                  setBuyerStage(event.target.value);
                }}
              >
                <option value="">{t("unclassified")}</option>
                {buyerStageOptions.map((value) => (
                  <option key={value} value={value}>
                    {KEYWORD_REVIEW_BUYER_STAGES.includes(
                      value as (typeof KEYWORD_REVIEW_BUYER_STAGES)[number],
                    )
                      ? t(`buyerStage.${value}`)
                      : value}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className={styles.keywordReviewSection}>
          <div className={styles.keywordReviewSectionHeading}>
            <span>02</span>
            <div>
              <h3>{t("topicTitle")}</h3>
              <p>{t("topicDescription")}</p>
            </div>
          </div>

          {isTopicInsightsPending ? (
            <div className={styles.keywordReviewAuthorityState} role="status">
              <Spinner label={t("topicLoading")} size="sm" />
              <span>{t("topicLoading")}</span>
            </div>
          ) : topicInsightsError !== null ? (
            <div className={styles.keywordReviewAuthorityState} role="alert">
              <CircleAlert aria-hidden="true" size={17} />
              <span>{t("topicError")}</span>
              <button type="button" onClick={onRetryTopicInsights}>
                {t("retry")}
              </button>
            </div>
          ) : !hasConfirmedTopicAuthority ? (
            <div
              className={styles.keywordReviewAuthorityState}
              data-state="unavailable"
            >
              <CircleAlert aria-hidden="true" size={17} />
              <span>{t("noConfirmedTopic")}</span>
            </div>
          ) : (
            <Field
              label={t("field.topic")}
              htmlFor={topicId}
              required={mappingDecision !== "unassigned"}
            >
              <select
                id={topicId}
                className={styles.topicSelect}
                value={topicNodeId}
                disabled={status === "excluded"}
                onChange={(event) => handleTopicChange(event.target.value)}
              >
                <option value="">{t("topicUnassigned")}</option>
                {confirmedTopicNodes.map((node) => (
                  <option key={node.topicNodeId} value={node.topicNodeId}>
                    {node.label} · {t(`coverageState.${node.coverageState}`)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {selectedTopic === null ? null : (
            <article
              className={styles.keywordReviewTopicSummary}
              data-coverage-state={selectedTopic.coverageState}
              data-testid="keyword-review-topic-summary"
            >
              <div>
                <span>
                  {t("confirmedTopicRevision", {
                    revision: selectedTopic.topicModelRevision,
                  })}
                </span>
                <strong>{selectedTopic.label}</strong>
              </div>
              <span>{t(`coverageState.${selectedTopic.coverageState}`)}</span>
              <dl>
                <div>
                  <dt>{t("topicMetrics.keywords")}</dt>
                  <dd>{selectedTopic.keywordCount}</dd>
                </div>
                <div>
                  <dt>{t("topicMetrics.pages")}</dt>
                  <dd>{selectedTopic.mappedPageCount}</dd>
                </div>
                <div>
                  <dt>{t("topicMetrics.conflicts")}</dt>
                  <dd>{selectedTopic.conflictingIntentCount}</dd>
                </div>
              </dl>
              {selectedTopic.limitation === null ? null : (
                <LimitationList limitations={[selectedTopic.limitation]} />
              )}
            </article>
          )}
        </section>

        <section className={styles.keywordReviewSection}>
          <div className={styles.keywordReviewSectionHeading}>
            <span>03</span>
            <div>
              <h3>{t("mappingTitle")}</h3>
              <p>{t("mappingDescription")}</p>
            </div>
          </div>
          <div className={styles.keywordReviewGrid}>
            <Field
              label={t("field.mappingDecision")}
              htmlFor={mappingDecisionId}
              required
            >
              <select
                id={mappingDecisionId}
                className={styles.topicSelect}
                value={mappingDecision}
                disabled={reviewDetail === null || status === "excluded"}
                onChange={(event) =>
                  handleMappingChange(
                    event.target.value as KeywordMappingDecision,
                  )
                }
              >
                {KEYWORD_REVIEW_MAPPING_DECISIONS.map((value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={
                      value !== "unassigned" &&
                      (topicNodeId.length === 0 ||
                        (value === "existing_page" && pageOptions.length === 0))
                    }
                  >
                    {t(`mappingDecision.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            {mappingDecision === "existing_page" ? (
              <Field label={t("field.sitePage")} htmlFor={sitePageId} required>
                <select
                  id={sitePageId}
                  className={styles.topicSelect}
                  value={mappedSitePageId}
                  disabled={isSitePagesPending}
                  onChange={(event) => {
                    clearPendingConfirmation();
                    setMappedSitePageId(event.target.value);
                  }}
                >
                  <option value="">{t("selectSitePage")}</option>
                  {pageOptions.map((page) => (
                    <option key={page.sitePageId} value={page.sitePageId}>
                      {page.title === null
                        ? page.normalizedUrl
                        : `${page.title} · ${page.normalizedUrl}`}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          {sitePagesError === null ? (
            sitePagesTruncated ? (
              <p className={styles.keywordReviewDataNote}>
                <CircleAlert aria-hidden="true" size={15} />
                {t("sitePagesTruncated")}
              </p>
            ) : null
          ) : (
            <p className={styles.keywordReviewDataNote} role="alert">
              <CircleAlert aria-hidden="true" size={15} />
              {t("sitePagesError")}
            </p>
          )}
        </section>

        <section className={styles.keywordReviewSection}>
          <Field label={t("field.reason")} help={t("reasonHelp")} required>
            <TextArea
              rows={3}
              maxLength={2000}
              value={reason}
              onChange={(event) => {
                clearPendingConfirmation();
                setReason(event.target.value);
              }}
            />
          </Field>

          {conflictCommand === null ? null : (
            <div
              className={styles.keywordReviewConflictConfirm}
              role="alert"
              data-testid="keyword-review-conflict-confirmation"
            >
              <CircleAlert aria-hidden="true" size={20} />
              <div>
                <strong>{t("conflictConfirmTitle")}</strong>
                <p>
                  {t("conflictConfirmDescription", {
                    topic: selectedTopic?.label ?? t("unknownTopic"),
                  })}
                </p>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setConflictCommand(null)}
                  >
                    {t("backToEdit")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() => save(conflictCommand)}
                  >
                    {mutation.isPending
                      ? t("saving")
                      : t("confirmConflictAndSave")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {localError === null ? null : (
            <p className={styles.keywordReviewError} role="alert">
              {localError}
            </p>
          )}
          {mutation.isError ? (
            <p className={styles.keywordReviewError} role="alert">
              {isRevisionConflict ? t("revisionConflict") : t("saveError")}
            </p>
          ) : null}
        </section>

        <footer className={styles.keywordReviewFooter}>
          <span>
            {t("revision", {
              revision: reviewDetail?.revision ?? detail.revision,
            })}
          </span>
          <div>
            <Button type="button" variant="secondary" onClick={onRequestClose}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                reviewDetail === null ||
                mutation.isPending ||
                conflictCommand !== null
              }
            >
              {mutation.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </footer>
      </form>
    </GrowthMapDialogFrame>
  );
}

function KeywordEvidenceDialog({
  open,
  detail,
  rankHistory,
  isRankHistoryPending,
  rankHistoryError,
  onRetryRankHistory,
  onRequestClose,
}: {
  readonly open: boolean;
  readonly detail: GrowthMapKeywordLibraryItem;
  readonly rankHistory: GrowthMapKeywordRankHistory | undefined;
  readonly isRankHistoryPending: boolean;
  readonly rankHistoryError: unknown;
  readonly onRetryRankHistory: () => void;
  readonly onRequestClose: () => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const metricKeys = [
    "volume",
    "kd",
    "currentRank",
    "currentUrl",
    "competitorDomain",
    "competitorRank",
  ] as const;

  return (
    <GrowthMapDialogFrame
      open={open}
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={onRequestClose}
      className={styles.keywordEvidenceDialog}
    >
      <header className={styles.keywordRelationDialogHeader}>
        <div>
          <span>{t("sourcesEyebrow")}</span>
          <h2 id={titleId}>{t("evidence.title")}</h2>
          <p id={descriptionId}>
            {t("evidence.description", { keyword: detail.displayKeyword })}
          </p>
        </div>
        <button
          type="button"
          className={styles.keywordRelationClose}
          aria-label={t("evidence.close")}
          onClick={onRequestClose}
        >
          <X aria-hidden="true" size={21} />
        </button>
      </header>
      <div className={styles.keywordEvidenceBody}>
      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("classificationEyebrow")}</span>
            <h3>{t("classificationTitle")}</h3>
          </div>
          <Target aria-hidden="true" size={21} />
        </div>
        <p className={styles.keywordSectionDescription}>
          {t("classificationDescription")}
        </p>
        <dl className={styles.keywordClassificationGrid}>
          <KeywordClassificationField
            label={t("intent")}
            value={detail.searchIntent.value}
            identity={t(
              `searchIntentAuthority.${detail.searchIntent.authority}`,
            )}
            limitation={detail.searchIntent.limitation}
          />
          <KeywordClassificationField
            label={t("buyerStage")}
            value={detail.buyerStage}
            limitation={detail.classificationLimitations.buyerStage}
          />
          <KeywordClassificationField
            label={t("cluster")}
            value={detail.cluster?.name ?? null}
            identity={detail.cluster?.clusterId}
            limitation={detail.classificationLimitations.cluster}
          />
          <div className={styles.keywordClassificationField}>
            <dt>{t("columns.queryKind")}</dt>
            <dd>
              <strong>{t(`queryKind.${detail.queryKind}`)}</strong>
            </dd>
          </div>
          <div className={styles.keywordClassificationField}>
            <dt>{t("mappedTarget")}</dt>
            <dd><KeywordMappedTarget target={detail.mappedTarget} /></dd>
          </div>
          <div className={styles.keywordClassificationField}>
            <dt>{t("mappingReview")}</dt>
            <dd>
              <strong>
                {t(`mappingReviewState.${detail.mappedTarget.reviewState}`)}
              </strong>
              {detail.mappedTarget.reason === null ? null : (
                <small>{detail.mappedTarget.reason}</small>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("metricsEyebrow")}</span>
            <h3>{t("metricsTitle")}</h3>
          </div>
          <BarChart3 aria-hidden="true" size={21} />
        </div>
        <p className={styles.keywordSectionDescription}>
          {t("metricsDescription")}
        </p>
        <div className={styles.keywordMetricGrid}>
          {metricKeys.map((metricKey) => (
            <KeywordMetricCard
              key={metricKey}
              metricKey={metricKey}
              metric={detail.metrics[metricKey]}
              absenceLimitation={detail.metrics.limitations[metricKey]}
            />
          ))}
        </div>
      </section>

      <KeywordRankHistorySection
        keyword={detail.displayKeyword}
        history={rankHistory}
        isPending={isRankHistoryPending}
        error={rankHistoryError}
        onRetry={onRetryRankHistory}
      />

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("sourcesEyebrow")}</span>
            <h3>{t("sourcesTitle")}</h3>
          </div>
          <ShieldCheck aria-hidden="true" size={21} />
        </div>
        <p className={styles.keywordSectionDescription}>
          {t("sourcesDescription")}
        </p>
        <div className={styles.keywordSourceList}>
          {detail.sourceOccurrences.map((occurrence) => (
            <KeywordSourceOccurrenceCard
              key={occurrence.occurrenceId}
              occurrence={occurrence}
            />
          ))}
        </div>
      </section>

      <footer className={styles.keywordDetailFooter}>
        <details className={styles.recordDisclosure}>
          <summary>{t("viewRecordDetails")}</summary>
          <div className={styles.recordDisclosureBody}>
            <span>
              {t("keywordId")}
              <code title={detail.keywordId}>{detail.keywordId}</code>
            </span>
            <span>
              {t("revision")}
              <strong>{detail.revision}</strong>
            </span>
          </div>
        </details>
      </footer>
      </div>
    </GrowthMapDialogFrame>
  );
}

function KeywordDetailPanel({
  projectId,
  detail,
  deliveryProjection,
  rankHistory,
  isRankHistoryPending,
  rankHistoryError,
  onRetryRankHistory,
  topicInsights,
  isTopicInsightsPending,
  topicInsightsError,
  onRetryTopicInsights,
  sitePages,
  isSitePagesPending,
  sitePagesError,
  sitePagesTruncated,
  relatedKeywords,
  onSelectKeyword,
}: {
  readonly projectId: string;
  readonly detail: GrowthMapKeywordLibraryItem;
  readonly deliveryProjection: GrowthMapKeywordDeliveryProjection;
  readonly rankHistory: GrowthMapKeywordRankHistory | undefined;
  readonly isRankHistoryPending: boolean;
  readonly rankHistoryError: unknown;
  readonly onRetryRankHistory: () => void;
  readonly topicInsights: GrowthMapTopicModelInsights | null;
  readonly isTopicInsightsPending: boolean;
  readonly topicInsightsError: unknown;
  readonly onRetryTopicInsights: () => void;
  readonly sitePages: readonly GrowthMapUrlPortfolioItem[];
  readonly isSitePagesPending: boolean;
  readonly sitePagesError: unknown;
  readonly sitePagesTruncated: boolean;
  readonly relatedKeywords: readonly GrowthMapKeywordLibraryItem[];
  readonly onSelectKeyword: (keywordId: string) => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const tStudio = useTranslations("studio");
  const locale = useLocale();
  const pageTypeLabel = usePageTypeLabel();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const closeReview = useCallback(() => setReviewOpen(false), []);
  const closeEvidence = useCallback(() => setEvidenceOpen(false), []);
  const latestSource = latestKeywordOccurrence(detail.sourceOccurrences);
  const clusterPeersInLoadedRange = relatedKeywords.filter(
    (keyword) =>
      keyword.keywordId !== detail.keywordId &&
      keyword.cluster?.clusterId !== undefined &&
      keyword.cluster.clusterId === detail.cluster?.clusterId,
  );
  const clusterPeers = clusterPeersInLoadedRange.slice(0, 5);
  const mappedTargetLabel =
    detail.mappedTarget.kind === "existing_page"
      ? urlPresentation(detail.mappedTarget.normalizedUrl).path
      : t(`mappingTarget.${detail.mappedTarget.kind}`);
  return (
    <>
      <aside
        className={cx(styles.detailPanel, styles.keywordDetailPanel)}
        aria-label={t("selectedDetailLabel")}
      >
      <header className={styles.keywordDetailHeader}>
        <div className={styles.detailEyebrow}>
          <span>{t("selectedKeyword")}</span>
          <CoveragePill coverage={detail.coverage} />
        </div>
        <h2>{detail.displayKeyword}</h2>
        <p>
          {detail.cluster?.name ?? t("intake.unassignedCluster")}
          {" · "}
          {detail.searchIntent.value === null
            ? t("notAvailable")
            : knownKeywordIntent(detail.searchIntent.value) === null
              ? detail.searchIntent.value
              : t(
                  `intentLabel.${knownKeywordIntent(detail.searchIntent.value)!}`,
                )}
          {" · "}
          {t("marketLanguageValue", {
            market: detail.marketCode,
            language: detail.languageTag,
          })}
        </p>
        <div className={styles.keywordDetailTags}>
          <KeywordDeliveryBadge
            projection={deliveryProjection}
          />
          <KeywordStatusPill item={detail} />
          <span className={styles.keywordIntentAuthorityLine}>
            <span
              className={styles.keywordReviewOrigin}
              data-search-intent-authority={detail.searchIntent.authority}
            >
              {t(`searchIntentAuthority.${detail.searchIntent.authority}`)}
            </span>
            {detail.searchIntent.authority === "unavailable" ? (
              <LimitationHint
                label={t("searchIntentUnavailableHint")}
                limitations={[detail.searchIntent.limitation]}
              />
            ) : null}
          </span>
        </div>
        <div className={styles.keywordReviewHeaderAction}>
          {reviewSaved ? (
            <span role="status">
              <CheckCircle2 aria-hidden="true" size={15} />
              {t("review.saved")}
            </span>
          ) : null}
        </div>
      </header>

      <LimitationList limitations={detail.coverage.limitations} />

      <div className={styles.detailMetricsFour}>
        <div>
          <span>{t("columns.volume")}</span>
          <KeywordListMetric
            metric={detail.metrics.volume}
            absenceLimitation={detail.metrics.limitations.volume}
          />
        </div>
        <div>
          <span>{t("columns.kd")}</span>
          <KeywordListMetric
            metric={detail.metrics.kd}
            absenceLimitation={detail.metrics.limitations.kd}
          />
        </div>
        <div>
          <span>{t("metric.currentRank")}</span>
          <KeywordListMetric
            metric={detail.metrics.currentRank}
            absenceLimitation={detail.metrics.limitations.currentRank}
          />
        </div>
        <div>
          <span>{t("columns.freshness")}</span>
          {latestSource === null ? (
            <strong>{t("notAvailable")}</strong>
          ) : (
            <strong>
              <time dateTime={latestSource.collectedAt}>
                {formatObservedAt(locale, latestSource.collectedAt)}
              </time>
            </strong>
          )}
        </div>
      </div>

      <section className={styles.routeCard}>
        <span>{t("intake.routeLabel")}</span>
        <strong>
          {Array.from(
            new Set(
              detail.sourceOccurrences.map((occurrence) =>
                t(`sourceKind.${occurrence.sourceKind}`),
              ),
            ),
          ).join(" · ")}
        </strong>
        <p>
          {t("intake.routeDescription", {
            count: detail.sourceOccurrences.length,
          })}
        </p>
      </section>

      {detail.recollection === null ? null : (
        <section
          className={cx(styles.routeCard, styles.routeCardWarning)}
          data-keyword-recollection={detail.recollection.reason}
        >
          <span>{t("recollection.eyebrow")}</span>
          <strong>{t("recollection.title")}</strong>
          <p>
            {t("recollection.description", {
              fields: detail.recollection.fields
                .map((field) => t(`recollection.field.${field}`))
                .join(" · "),
            })}
          </p>
          <a
            className={styles.recollectionAction}
            href="#growth-map-run-diagnosis"
          >
            {t("recollection.action")}
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        </section>
      )}

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <h3>{t("intake.pathTitle")}</h3>
          </div>
        </div>
        <div className={styles.conversionPath}>
          <div className={styles.conversionStep}>
            <span>01</span>
            <small>{t("intake.pathStepCluster")}</small>
            <strong>{detail.cluster?.name ?? t("intake.unassignedCluster")}</strong>
          </div>
          <ArrowRight aria-hidden="true" size={16} />
          <div className={styles.conversionStep}>
            <span>02</span>
            <small>{t("intake.pathStepPage")}</small>
            <strong>{mappedTargetLabel}</strong>
          </div>
          <ArrowRight aria-hidden="true" size={16} />
          <div className={styles.conversionStep}>
            <span>03</span>
            <small>{t("intake.pathStepCta")}</small>
            <strong>{t("intake.ctaUnavailable")}</strong>
          </div>
        </div>
        <p className={styles.keywordSectionDescription}>
          {t("intake.ctaUnavailableDescription")}
        </p>
      </section>

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <h3>{t("delivery.title")}</h3>
            <span>{t("delivery.provenance")}</span>
          </div>
          <span className={styles.sectionCount}>
            {deliveryProjection.kind !== "ready"
              ? t("delivery.sectionUnavailable")
              : t("delivery.sectionCount", {
                  opportunities: deliveryProjection.opportunities.length,
                  artifacts: deliveryProjection.artifactCount,
                })}
          </span>
        </div>
        {deliveryProjection.kind !== "ready" ? (
          <p className={styles.keywordSectionDescription}>
            {t(`delivery.reason.${deliveryProjection.reason}`)}
          </p>
        ) : (
          <>
            <div className={styles.keywordDeliveryScope}>
              <span>{t("delivery.mappedPage")}</span>
              <strong>
                {urlPresentation(deliveryProjection.mappedPage.normalizedUrl).path}
              </strong>
              <small>
                {t("delivery.pageCarrier", {
                  type: pageTypeLabel(deliveryProjection.mappedPage.pageType),
                })}
              </small>
              <small>{t("delivery.scopeBoundary")}</small>
            </div>
            <div className={styles.keywordDeliveryList}>
            {deliveryProjection.opportunities.map((opportunity) => {
              const previewType =
                opportunity.opportunity.readiness === "confirmed"
                  ? opportunity.opportunity.action.artifactType
                  : opportunity.opportunity.readiness === "reviewable"
                    ? opportunity.opportunity.executionPreview?.artifactType ?? null
                    : null;
              return (
                <article
                  key={opportunity.id}
                  className={styles.keywordDeliveryItem}
                >
                  <header>
                    <span>
                      <strong>{opportunity.opportunity.title}</strong>
                      <small>
                        {previewType === null
                          ? t("delivery.unavailablePrimary")
                          : tStudio(`artifactType.${previewType}`)}
                      </small>
                    </span>
                    <small>
                      {opportunity.opportunity.readiness === "confirmed"
                        ? t("delivery.confirmed")
                        : t("delivery.reviewRequired")}
                    </small>
                  </header>
                  {opportunity.artifacts.length === 0 ? (
                    <p>
                      {opportunity.opportunity.readiness === "confirmed"
                        ? t("delivery.awaitingGeneration")
                        : t("delivery.reviewRequired")}
                    </p>
                  ) : (
                    <ul className={styles.keywordArtifactList}>
                      {opportunity.artifacts.map((artifact) => (
                        <li key={artifact.id}>
                          <strong>
                            {tStudio(`artifactType.${artifact.artifactType}`)}
                          </strong>
                          <span>{tStudio(`status.${artifact.status}`)}</span>
                          <small>
                            {t("delivery.revision", {
                              revision: artifact.currentRevision,
                            })}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {opportunity.executionRef === null ? null : (
                    <Link
                      className={styles.keywordDeliveryAction}
                      href={executionHrefForRef(projectId, opportunity.executionRef)}
                      aria-label={t("delivery.openExecutionFor", {
                        title: opportunity.opportunity.title,
                      })}
                    >
                      {t("delivery.openExecution")}
                      <ArrowUpRight aria-hidden="true" size={15} />
                    </Link>
                  )}
                </article>
              );
            })}
            </div>
          </>
        )}
      </section>

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <h3>{t("intake.relatedTitle")}</h3>
          </div>
          <span className={styles.sectionCount}>
            {t("intake.relatedCount", {
              shown: clusterPeers.length,
              total: clusterPeersInLoadedRange.length,
            })}
          </span>
        </div>
        {clusterPeers.length === 0 ? (
          <p className={styles.keywordSectionDescription}>
            {t("intake.relatedCount", { shown: 0, total: 0 })}
          </p>
        ) : (
          <div className={styles.relatedList}>
            {clusterPeers.map((keyword) => {
              const volume = keywordVolumeSummary(
                locale,
                keyword.metrics.volume,
              );
              return (
                <button
                  type="button"
                  key={keyword.keywordId}
                  onClick={() => onSelectKeyword(keyword.keywordId)}
                >
                  <span>
                    <strong>{keyword.displayKeyword}</strong>
                    <small>
                      {keyword.searchIntent.value === null
                        ? t("notAvailable")
                        : knownKeywordIntent(keyword.searchIntent.value) === null
                          ? keyword.searchIntent.value
                          : t(
                              `intentLabel.${knownKeywordIntent(keyword.searchIntent.value)!}`,
                            )}
                      {volume === null
                        ? null
                        : ` · ${t("relatedVolume", { volume })}`}
                    </small>
                  </span>
                  <ArrowRight aria-hidden="true" size={15} />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className={styles.detailActions}>
        <button type="button" onClick={() => setEvidenceOpen(true)}>
          <ShieldCheck aria-hidden="true" size={16} />
          {t("intake.viewSources")}
        </button>
        <button
          type="button"
          onClick={() => {
            setReviewSaved(false);
            setReviewOpen(true);
          }}
        >
          <Pencil aria-hidden="true" size={16} />
          {t("review.open")}
        </button>
      </div>


      </aside>
      <KeywordReviewDialog
        projectId={projectId}
        open={reviewOpen}
        detail={detail}
        topicInsights={topicInsights}
        isTopicInsightsPending={isTopicInsightsPending}
        topicInsightsError={topicInsightsError}
        onRetryTopicInsights={onRetryTopicInsights}
        sitePages={sitePages}
        isSitePagesPending={isSitePagesPending}
        sitePagesError={sitePagesError}
        sitePagesTruncated={sitePagesTruncated}
        onRequestClose={closeReview}
        onSaved={() => setReviewSaved(true)}
      />
      <KeywordEvidenceDialog
        open={evidenceOpen}
        detail={detail}
        rankHistory={rankHistory}
        isRankHistoryPending={isRankHistoryPending}
        rankHistoryError={rankHistoryError}
        onRetryRankHistory={onRetryRankHistory}
        onRequestClose={closeEvidence}
      />
    </>
  );
}

function KeywordDetailState({
  projectId,
  selectedKeywordId,
  diagnosticRunId,
  publishedDiagnosticRunId,
  completeUrls,
  completeOpportunities,
  completeArtifacts,
  relatedKeywords,
  onSelectKeyword,
}: {
  readonly projectId: string;
  readonly selectedKeywordId: string | null;
  readonly diagnosticRunId: string | null;
  readonly publishedDiagnosticRunId: string;
  readonly completeUrls: readonly GrowthMapUrlPortfolioItem[] | null;
  readonly completeOpportunities: readonly GrowthOpportunity[] | null;
  readonly completeArtifacts: readonly Artifact[] | null;
  readonly relatedKeywords: readonly GrowthMapKeywordLibraryItem[];
  readonly onSelectKeyword: (keywordId: string) => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const detailQuery = useGrowthMapKeywordReviewDetail(
    projectId,
    selectedKeywordId,
  );
  const rankHistoryQuery = useGrowthMapKeywordRankHistory(
    projectId,
    selectedKeywordId,
  );
  const topicInsightsQuery = useGrowthMapTopicModelInsights(projectId);
  const pinnedSitePagesQuery = useGrowthMapUrls(projectId, {
    limit: 100,
    diagnosticRunId,
  });
  const readState = keywordDetailReadState({
    selectedKeywordId,
    isPending: detailQuery.isPending,
    isError: detailQuery.isError,
  });

  // Same landmark contract as the URL rail: one stable accessible name across
  // every read state, so the region is announceable before its data lands.
  if (readState === "unselected") {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
      >
        <EmptyState
          icon={<BookOpenText size={28} />}
          title={t("selectKeywordTitle")}
          description={t("selectKeywordDescription")}
        />
      </aside>
    );
  }
  if (readState === "loading") {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
        role="status"
      >
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  if (readState === "error") {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
      >
        <ProblemState
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
          message={t("detailError")}
        />
      </aside>
    );
  }
  if (detailQuery.data === undefined) {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
        role="status"
      >
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  const deliveryProjection = buildGrowthMapKeywordDeliveryProjection({
    keyword: detailQuery.data.data,
    publishedDiagnosticRunId,
    urls: completeUrls,
    opportunities: completeOpportunities,
    artifacts: completeArtifacts,
  });
  return (
    <KeywordDetailPanel
      key={detailQuery.data.data.keywordId}
      projectId={projectId}
      detail={detailQuery.data.data}
      deliveryProjection={deliveryProjection}
      rankHistory={rankHistoryQuery.data}
      isRankHistoryPending={rankHistoryQuery.isPending}
      rankHistoryError={
        rankHistoryQuery.isError ? rankHistoryQuery.error : null
      }
      onRetryRankHistory={() => void rankHistoryQuery.refetch()}
      topicInsights={topicInsightsQuery.data ?? null}
      isTopicInsightsPending={topicInsightsQuery.isPending}
      topicInsightsError={
        topicInsightsQuery.isError ? topicInsightsQuery.error : null
      }
      onRetryTopicInsights={() => void topicInsightsQuery.refetch()}
      sitePages={pinnedSitePagesQuery.data?.data ?? []}
      isSitePagesPending={pinnedSitePagesQuery.isPending}
      sitePagesError={
        pinnedSitePagesQuery.isError ? pinnedSitePagesQuery.error : null
      }
      sitePagesTruncated={pinnedSitePagesQuery.data?.meta.hasNext ?? false}
      relatedKeywords={relatedKeywords}
      onSelectKeyword={onSelectKeyword}
    />
  );
}

function KeywordLibraryEmpty() {
  const t = useTranslations("growthMap");
  return (
    <section className={styles.libraryUnavailable} aria-live="polite">
      <div className={styles.libraryIcon}>
        <BookOpenText aria-hidden="true" size={31} strokeWidth={1.6} />
      </div>
      <span className={styles.libraryKicker}>{t("realDataOnly")}</span>
      <h2>{t("libraries.keywords.title")}</h2>
      <p>{t("libraries.keywords.description")}</p>
      <div className={styles.libraryBoundary}>
        <CircleAlert aria-hidden="true" size={20} />
        <p>{t("libraries.keywords.boundary")}</p>
      </div>
    </section>
  );
}

function KeywordLibraryPane({
  projectId,
  locationSearch,
  navigation,
  diagnosticRunId,
  publishedDiagnosticRunId,
}: {
  readonly projectId: string;
  readonly locationSearch: string;
  readonly navigation: GrowthMapNavigationController;
  /** null reads the live library, including keywords awaiting review. */
  readonly diagnosticRunId: string | null;
  readonly publishedDiagnosticRunId: string;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const uiLocale = useLocale();
  const pathname = usePathname();
  const canonicalSearchParams = useSearchParams();
  const canonicalLocationSearch = canonicalSearchParams.toString();
  const canonicalMode = normalizeGrowthMapObjectMode(
    canonicalSearchParams.get("object"),
  );
  const locationParams = useMemo(
    () => new URLSearchParams(locationSearch),
    [locationSearch],
  );
  const cursor = locationParams.get("cursor");
  const requestedKeywordId = locationParams.get("selectedKeywordId");
  const canonicalRequestedKeywordId = canonicalSearchParams.get(
    "selectedKeywordId",
  );
  const [cursorPredecessors, setCursorPredecessors] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());
  const [keywordSearch, setKeywordSearch] = useState("");
  const [sourceFilter, setSourceFilter] =
    useState<GrowthMapKeywordSourceFilter>("all");
  const [relationDialogKeywordId, setRelationDialogKeywordId] =
    useState<string | null>(null);
  const automaticRelationRefreshProjectRef = useRef<string | null>(
    null,
  );
  const listQuery = useGrowthMapKeywords(projectId, {
    cursor,
    limit: 50,
    diagnosticRunId,
    sourceKind: sourceFilter === "all" ? null : sourceFilter,
  });
  const completeUrlsQuery = useQuery({
    queryKey: [
      "growth-map",
      projectId,
      uiLocale,
      "page-views",
      publishedDiagnosticRunId,
      "complete-urls",
    ],
    queryFn: () =>
      readCompleteGrowthMapUrls(projectId, publishedDiagnosticRunId),
  });
  const completeOpportunitiesQuery = useQuery({
    queryKey: [
      "growth-map",
      projectId,
      uiLocale,
      "page-views",
      publishedDiagnosticRunId,
      "complete-opportunities",
    ],
    queryFn: () =>
      readCompleteGrowthMapOpportunities(
        projectId,
        publishedDiagnosticRunId,
      ),
  });
  const artifactsQuery = useProjectArtifacts(projectId);
  useEffect(() => {
    if (
      !artifactsQuery.hasNextPage ||
      artifactsQuery.isFetchingNextPage ||
      artifactsQuery.isFetchNextPageError
    ) {
      return;
    }
    void artifactsQuery.fetchNextPage();
  }, [
    artifactsQuery.fetchNextPage,
    artifactsQuery.hasNextPage,
    artifactsQuery.isFetchNextPageError,
    artifactsQuery.isFetchingNextPage,
  ]);
  const items = useMemo(
    () => listQuery.data?.data ?? [],
    [listQuery.data?.data],
  );
  const completeUrls = completeUrlsQuery.isSuccess
    ? completeUrlsQuery.data
    : null;
  const completeOpportunities = completeOpportunitiesQuery.isSuccess
    ? completeOpportunitiesQuery.data
    : null;
  const completeArtifacts = useMemo(
    () =>
      artifactsQuery.isSuccess &&
      !artifactsQuery.hasNextPage &&
      !artifactsQuery.isFetchingNextPage &&
      !artifactsQuery.isFetchNextPageError
        ? uniqueCursorItems(artifactsQuery.data)
        : null,
    [
      artifactsQuery.data,
      artifactsQuery.hasNextPage,
      artifactsQuery.isFetchNextPageError,
      artifactsQuery.isFetchingNextPage,
      artifactsQuery.isSuccess,
    ],
  );
  const deliveriesByKeywordId = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.keywordId,
          buildGrowthMapKeywordDeliveryProjection({
            keyword: item,
            publishedDiagnosticRunId: publishedDiagnosticRunId,
            urls: completeUrls,
            opportunities: completeOpportunities,
            artifacts: completeArtifacts,
          }),
        ]),
      ),
    [
      completeArtifacts,
      completeOpportunities,
      completeUrls,
      items,
      publishedDiagnosticRunId,
    ],
  );
  const keywordIds = useMemo(
    () => items.map((item) => item.keywordId),
    [items],
  );
  const relationQuery = useCompleteGrowthMapKeywordRelations(
    projectId,
    keywordIds,
  );
  const {
    mutate: refreshRelations,
    isPending: isRefreshingRelations,
    isError: isRelationRefreshError,
    error: relationRefreshError,
  } = useRefreshGrowthMapKeywordRelations(projectId);
  const relationProjection = useMemo(
    () =>
      buildKeywordRelationPageProjection(
        items,
        relationQuery.data ?? [],
      ),
    [items, relationQuery.data],
  );
  const filteredEntries = useMemo(
    () =>
      // The server already restricted the page by intake source, and its
      // predicate scans the full occurrence ledger while item.sourceOccurrences
      // is a truncated projection — re-filtering here would silently hide
      // legitimately matched rows, so only the text search runs client-side.
      filterGrowthMapKeywordEntries(relationProjection.visibleItems, {
        search: keywordSearch,
        sourceKind: "all",
      }),
    [keywordSearch, relationProjection.visibleItems],
  );
  const visibleKeywordIds = useMemo(
    () =>
      filteredEntries.map(
        (entry) => entry.item.keywordId,
      ),
    [filteredEntries],
  );
  const selectedKeywordId = resolveVisibleKeywordSelection(
    requestedKeywordId,
    visibleKeywordIds,
  );
  const canonicalSelectedKeywordId = resolveVisibleKeywordSelection(
    canonicalRequestedKeywordId,
    visibleKeywordIds,
  );
  const dialogRelations =
    relationDialogKeywordId === null
      ? []
      : (relationProjection.relationsByKeywordId.get(
          relationDialogKeywordId,
        ) ?? []);
  const relationDialogKeyword =
    relationDialogKeywordId === null
      ? null
      : (items.find(
          (item) => item.keywordId === relationDialogKeywordId,
        )?.displayKeyword ??
        dialogRelations
          .flatMap((relation) => [
            relation.candidate.keywordA,
            relation.candidate.keywordB,
          ])
          .find(
            (keyword) =>
              keyword.keywordId === relationDialogKeywordId,
          )?.displayKeyword ??
        null);
  const readState = keywordLibraryReadState({
    isPending: listQuery.isPending,
    isError: listQuery.isError,
    itemCount: items.length,
    cursor,
  });
  const previousCursor = resolveGrowthMapCursorPredecessor(
    cursorPredecessors,
    cursor,
  );
  const runRelationRefresh = useCallback(() => {
    refreshRelations();
  }, [refreshRelations]);
  // Changing the intake source changes the server-filtered cursor space, so
  // every filter change restarts from the first page with no stale selection.
  const changeSourceFilter = useCallback(
    (next: GrowthMapKeywordSourceFilter): void => {
      setSourceFilter(next);
      navigation.request({ cursor: null, selectedKeywordId: null });
    },
    [navigation],
  );
  const closeRelationDialog = useCallback(() => {
    setRelationDialogKeywordId(null);
  }, []);

  useEffect(() => {
    if (
      !listQuery.isSuccess ||
      keywordIds.length === 0 ||
      automaticRelationRefreshProjectRef.current === projectId
    ) {
      return;
    }
    automaticRelationRefreshProjectRef.current = projectId;
    refreshRelations();
  }, [
    keywordIds.length,
    listQuery.isSuccess,
    projectId,
    refreshRelations,
  ]);

  useEffect(() => {
    // As with the URL portfolio, an absent selection deliberately renders the
    // first visible row without rewriting the address. Only repair an explicit
    // stale/cursor-mismatched deep link after the bounded page has loaded.
    if (
      navigation.isPending ||
      locationSearch !== canonicalLocationSearch ||
      canonicalMode !== "keywords" ||
      !listQuery.isSuccess ||
      canonicalRequestedKeywordId === null ||
      canonicalRequestedKeywordId === canonicalSelectedKeywordId
    ) {
      return;
    }
    navigation.replaceCanonicalHref(
      growthMapLocationHref(pathname, canonicalLocationSearch, {
        selectedKeywordId: canonicalSelectedKeywordId,
      }),
    );
  }, [
    canonicalLocationSearch,
    canonicalMode,
    canonicalRequestedKeywordId,
    canonicalSelectedKeywordId,
    listQuery.isSuccess,
    locationSearch,
    navigation,
    pathname,
  ]);

  function selectKeyword(keywordId: string): void {
    navigation.request({ selectedKeywordId: keywordId });
  }

  function goNext(): void {
    const nextCursor = listQuery.data?.meta.nextCursor ?? null;
    if (nextCursor === null) return;
    setCursorPredecessors((current) =>
      rememberGrowthMapCursorPredecessor(current, cursor, nextCursor),
    );
    navigation.request({ cursor: nextCursor, selectedKeywordId: null });
  }

  function goPrevious(): void {
    if (previousCursor === undefined) return;
    navigation.request({ cursor: previousCursor, selectedKeywordId: null });
  }

  function goFirst(): void {
    navigation.request({ cursor: null, selectedKeywordId: null });
  }

  if (readState === "loading") {
    return (
      <div className={styles.pageState} role="status">
        <Spinner label={t("loadingLibrary")} size="lg" />
        <p>{t("loadingLibrary")}</p>
      </div>
    );
  }

  if (readState === "error") {
    return (
      <ProblemState
        error={listQuery.error}
        onRetry={() => void listQuery.refetch()}
        message={t("libraryError")}
        className={styles.pageState}
      />
    );
  }

  if (listQuery.data === undefined) {
    return (
      <div className={styles.pageState} role="status">
        <Spinner label={t("loadingLibrary")} size="lg" />
        <p>{t("loadingLibrary")}</p>
      </div>
    );
  }
  const response = listQuery.data;
  // Whole-library counts come from the live read; the loaded-page tallies
  // remain the honest fallback whenever the meta block is absent.
  const librarySourceCounts = response.meta.sourceCounts ?? null;
  const sourceStripItems: readonly SourceStripItem[] = [
    {
      key: "all",
      label: t("intake.all"),
      count:
        librarySourceCounts?.all ?? relationProjection.loadedSourceCounts.all,
      tone: "mint",
    },
    ...GROWTH_MAP_KEYWORD_SOURCE_KINDS.map((sourceKind, index) => ({
      key: sourceKind,
      label: t(`sourceKind.${sourceKind}`),
      count:
        librarySourceCounts?.[sourceKind] ??
        relationProjection.loadedSourceCounts[sourceKind],
      tone: (["amber", "cobalt", "mint", "violet", "coral", "mint"] as const)[
        index
      ]!,
    })),
  ];
  const relationStatusText =
    keywordIds.length === 0
      ? t("relations.empty")
      : relationQuery.isPending
        ? t("relations.loading")
        : relationQuery.isError
          ? t("relations.refreshError")
          : relationProjection.relationsByKeywordId.size === 0
            ? t("relations.empty")
            : t("relations.ready", {
                count: relationQuery.data?.length ?? 0,
                collapsed:
                  relationProjection.collapsedSupportingKeywordIds
                    .length,
              });

  return (
    <>
      <SourceStrip
        label={t("intake.label")}
        title={t("intake.title")}
        description={t("intake.description")}
        items={sourceStripItems}
        selectedKey={sourceFilter}
        onSelect={(key) =>
          changeSourceFilter(key as GrowthMapKeywordSourceFilter)
        }
        countLabel={(count) => t("intake.count", { count })}
      />
      <TopicMapGateway projectId={projectId} />
      {readState === "empty" && sourceFilter !== "all" ? (
        <>
          <div className={styles.libraryToolbar}>
            <label className={styles.libraryFilter}>
              <span>{t("intake.sourceFilterLabel")}</span>
              <select
                value={sourceFilter}
                onChange={(event) =>
                  changeSourceFilter(
                    event.target.value as GrowthMapKeywordSourceFilter,
                  )
                }
              >
                <option value="all">{t("intake.all")}</option>
                {GROWTH_MAP_KEYWORD_SOURCE_KINDS.map((sourceKind) => (
                  <option value={sourceKind} key={sourceKind}>
                    {t(`sourceKind.${sourceKind}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <EmptyState
            className={styles.libraryFilteredEmpty}
            icon={<Search size={28} />}
            title={t("intake.noMatchesTitle")}
            description={t("intake.noMatchesDescription")}
          />
        </>
      ) : readState === "empty" ? (
        <KeywordLibraryEmpty />
      ) : (
        <>
          <div className={styles.libraryToolbar}>
            <label className={styles.librarySearch}>
              <Search aria-hidden="true" size={19} />
              <input
                type="search"
                value={keywordSearch}
                onChange={(event) => setKeywordSearch(event.target.value)}
                placeholder={t("intake.searchPlaceholder")}
              />
              <span className={styles.rowSelectLabel}>
                {t("intake.searchPlaceholder")}
              </span>
            </label>
            <label className={styles.libraryFilter}>
              <span>{t("intake.sourceFilterLabel")}</span>
              <select
                value={sourceFilter}
                onChange={(event) =>
                  changeSourceFilter(
                    event.target.value as GrowthMapKeywordSourceFilter,
                  )
                }
              >
                <option value="all">{t("intake.all")}</option>
                {GROWTH_MAP_KEYWORD_SOURCE_KINDS.map((sourceKind) => (
                  <option value={sourceKind} key={sourceKind}>
                    {t(`sourceKind.${sourceKind}`)}
                  </option>
                ))}
              </select>
            </label>
            <Link className={styles.libraryAction} href={`/p/${projectId}/sources`}>
              <Plus aria-hidden="true" size={17} />
              {t("intake.addKeyword")}
            </Link>
          </div>

          <div className={styles.keywordWorkspace}>
            <div className={styles.masterColumn}>
              {readState === "cursor_empty" ? (
                <LibraryCursorPageEmpty
                  icon={<BookOpenText size={28} />}
                  title={t("cursorPageEmptyTitle")}
                  description={t("cursorPageEmptyDescription")}
                  actionLabel={t("firstPage")}
                  onReset={goFirst}
                />
              ) : filteredEntries.length === 0 ? (
                <EmptyState
                  className={styles.libraryFilteredEmpty}
                  icon={<Search size={28} />}
                  title={t("intake.noMatchesTitle")}
                  description={t("intake.noMatchesDescription")}
                />
              ) : (
                <KeywordList
                  entries={filteredEntries}
                  deliveriesByKeywordId={deliveriesByKeywordId}
                  selectedKeywordId={selectedKeywordId}
                  onSelect={selectKeyword}
                  onOpenRelations={setRelationDialogKeywordId}
                />
              )}
              <nav
                className={styles.pagination}
                aria-label={t("paginationLabel")}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={previousCursor === undefined}
                  onClick={goPrevious}
                >
                  <ArrowLeft aria-hidden="true" size={16} />
                  {t("previousPage")}
                </Button>
                <span className={styles.paginationSummary}>
                  {t("visibleCount", {
                    visible: filteredEntries.length,
                    total: response.data.length,
                  })}
                  <CoveragePill coverage={response.meta.coverage} />
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!response.meta.hasNext}
                  onClick={goNext}
                >
                  {t("nextPage")}
                  <ArrowRight aria-hidden="true" size={16} />
                </Button>
              </nav>
            </div>
            <KeywordDetailState
              projectId={projectId}
              selectedKeywordId={selectedKeywordId}
              diagnosticRunId={diagnosticRunId}
              publishedDiagnosticRunId={publishedDiagnosticRunId}
              completeUrls={completeUrls}
              completeOpportunities={completeOpportunities}
              completeArtifacts={completeArtifacts}
              relatedKeywords={items}
              onSelectKeyword={selectKeyword}
            />
          </div>
          <div className={styles.keywordGovernanceAppendix}>
          <section
            className={styles.keywordRelationToolbar}
            aria-labelledby="keyword-relation-toolbar-title"
          >
            <div className={styles.keywordRelationToolbarIntro}>
              <GitMerge aria-hidden="true" size={20} />
              <div>
                <span>{t("relations.toolbarLabel")}</span>
                <strong id="keyword-relation-toolbar-title">
                  {t("relations.toolbarTitle")}
                </strong>
                <p>{t("relations.toolbarDescription")}</p>
              </div>
            </div>
            <div className={styles.keywordRelationToolbarStatus}>
              <p role="status" aria-live="polite">
                {relationStatusText}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isRefreshingRelations}
                onClick={runRelationRefresh}
              >
                <RefreshCw
                  aria-hidden="true"
                  size={15}
                  className={
                    isRefreshingRelations
                      ? styles.keywordRelationRefreshSpinning
                      : undefined
                  }
                />
                {isRefreshingRelations
                  ? t("relations.refreshing")
                  : t("relations.refresh")}
              </Button>
            </div>
            {relationQuery.isError ? (
              <ProblemNotice
                error={relationQuery.error}
                message={t("relations.refreshError")}
                onRetry={() => void relationQuery.refetch()}
                retryLabel={t("relations.retry")}
                compact
                className={styles.keywordRelationToolbarError}
              />
            ) : isRelationRefreshError ? (
              <ProblemNotice
                error={relationRefreshError}
                message={t("relations.refreshError")}
                onRetry={runRelationRefresh}
                retryLabel={t("relations.retry")}
                compact
                className={styles.keywordRelationToolbarError}
              />
            ) : null}
          </section>
          </div>
          <KeywordRelationDialog
            projectId={projectId}
            open={
              relationDialogKeywordId !== null &&
              dialogRelations.length > 0
            }
            keyword={relationDialogKeyword}
            relations={dialogRelations}
            isRefreshing={isRefreshingRelations}
            onRefresh={runRelationRefresh}
            onRequestClose={closeRelationDialog}
          />
        </>
      )}
    </>
  );
}

type ProductProfileCompetitorOrigin = Extract<
  GrowthMapCompetitorOriginOccurrence,
  { readonly originKind: "product_profile" }
>;

type ProductProfileOriginEvidence =
  ProductProfileCompetitorOrigin["evidenceRefs"][number];

const COMPETITOR_STATUS_CLASS = {
  candidate: styles.competitorStatusCandidate,
  approved: styles.competitorStatusApproved,
  excluded: styles.competitorStatusExcluded,
} as const;

function CompetitorStatusPill({
  status,
}: {
  readonly status: GrowthMapCompetitorLibraryItem["reviewStatus"];
}) {
  const t = useTranslations("growthMap.competitorLibrary.reviewStatus");
  return (
    <span
      className={cx(styles.competitorStatus, COMPETITOR_STATUS_CLASS[status])}
    >
      {t(status)}
    </span>
  );
}

function CompetitorRelationship({
  relationship,
}: {
  readonly relationship: GrowthMapCompetitorLibraryItem["relationship"];
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  return (
    <span
      className={relationship === null ? styles.competitorMissing : undefined}
    >
      {relationship === null
        ? t("relationshipPending")
        : t(`relationship.${relationship}`)}
    </span>
  );
}

/**
 * Organic-search overlap: only a canonical available observation renders a
 * number (as a percentage); the unavailable state keeps the API limitation
 * behind the ⓘ hint and never borrows 0 or a neighbouring metric.
 */
function CompetitorOverlapValue({
  insight,
}: {
  readonly insight: GrowthMapCompetitorSerpOverlap;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  const display = competitorOrganicOverlapDisplay(insight);
  if (display.state === "unavailable") {
    return (
      <span className={styles.libraryMetricSecondary}>
        {t("fallback.insufficientData")}
        <LimitationHint
          label={t("coverageLabel")}
          limitations={[display.limitation]}
        />
      </span>
    );
  }
  const value = `${formatNumber(locale, display.percentage)}%`;
  return (
    <span className={styles.libraryMetricSecondary}>
      <strong className={styles.libraryMetricPrimary} title={value}>
        {value}
      </strong>
      {display.limitation === null ? null : (
        <LimitationHint
          label={t("coverageLabel")}
          limitations={[display.limitation]}
        />
      )}
    </span>
  );
}

/**
 * Shared keywords: only an available canonical insight renders a count, and
 * its scope limitation stays behind the ⓘ hint. An unavailable insight keeps
 * the API's own limitation — the cell only picks the fallback vocabulary,
 * "collecting" when a serp_overlap origin already covers this domain and
 * "insufficient data" otherwise — and never invents or borrows a number.
 */
function CompetitorSharedKeywordsValue({
  item,
}: {
  readonly item: Pick<
    GrowthMapCompetitorLibraryItem,
    "originOccurrences" | "sharedKeywordInsight"
  >;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  const display = competitorSharedKeywordDisplay(item);
  if (display.state === "counted") {
    const value = formatNumber(locale, display.value);
    return (
      <span className={styles.libraryMetricSecondary}>
        <strong className={styles.libraryMetricPrimary} title={value}>
          {value}
        </strong>
        {display.limitation === null ? null : (
          <LimitationHint
            label={t("coverageLabel")}
            limitations={[display.limitation]}
          />
        )}
      </span>
    );
  }
  return (
    <span className={styles.libraryMetricSecondary}>
      {display.state === "collecting"
        ? t("fallback.collecting")
        : t("fallback.insufficientData")}
      <LimitationHint
        label={t("coverageLabel")}
        limitations={[display.limitation]}
      />
    </span>
  );
}

/**
 * AI citations use the canonical cohort formatter in every surface. Complete
 * cohorts show cited/20; partial cohorts show cited/observed and keep the
 * attempted/unavailable counts accessible behind the compact limitation hint.
 */
function CompetitorAiCitationValue({
  insight,
}: {
  readonly insight: GrowthMapCompetitorAiCitationInsight;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  const display = competitorAiCitationDisplay(insight);
  if (display.state === "unavailable") {
    return (
      <span className={styles.libraryMetricSecondary}>
        {t("fallback.unavailable")}
        <LimitationHint
          label={t("coverageLabel")}
          limitations={[display.limitation]}
        />
      </span>
    );
  }
  const limitations =
    display.cohortCoverage === "partial"
      ? [
          t("aiCitationCohort.partial", {
            attempted: display.attemptedQueries,
            unavailable: display.unavailableQueries,
          }),
          ...(display.limitation === null ? [] : [display.limitation]),
        ]
      : display.limitation === null
        ? []
        : [display.limitation];
  return (
    <span className={styles.libraryMetricSecondary}>
      <strong className={styles.libraryMetricPrimary} title={display.primary}>
        {display.primary}
      </strong>
      {limitations.length === 0 ? null : (
        <LimitationHint
          label={t("aiCitationCohort.coverageLabel")}
          limitations={limitations}
        />
      )}
    </span>
  );
}

function CompetitorRow({
  item,
  selected,
  onSelect,
  onOpenProfile,
}: {
  readonly item: GrowthMapCompetitorLibraryItem;
  readonly selected: boolean;
  readonly onSelect: (competitorId: string) => void;
  readonly onOpenProfile: (competitorId: string) => void;
}) {
  const t = useTranslations("growthMap.competitorLibrary");

  return (
    <li className={styles.competitorRow}>
      <div
        className={cx(
          styles.competitorRowButton,
          selected && styles.competitorRowSelected,
        )}
      >
        <button
          type="button"
          className={styles.rowSelectButton}
          aria-pressed={selected}
          onClick={() => onSelect(item.competitorId)}
        >
          <span className={styles.rowSelectLabel}>
            {item.name ?? item.domain} — {item.domain}
          </span>
        </button>
        <span className={styles.competitorIdentityCell}>
          <strong>{item.name ?? item.domain}</strong>
          <small>{item.domain}</small>
        </span>
        <span
          className={styles.competitorGovernanceCell}
          data-column={t("columns.relationship")}
        >
          <CompetitorRelationship relationship={item.relationship} />
        </span>
        <span
          className={styles.competitorScopeCell}
          data-column={t("columns.analysisScope")}
        >
          {item.analysisScope.length === 0 ? (
            <span className={styles.competitorMissing}>
              {t("scopePending")}
            </span>
          ) : (
            item.analysisScope.map((scope) => (
              <small key={scope}>{t(`analysisScope.${scope}`)}</small>
            ))
          )}
        </span>
        <span
          className={styles.libraryMetricCell}
          data-column={t("columns.organicOverlap")}
        >
          <CompetitorOverlapValue insight={item.serpOverlap} />
        </span>
        <span
          className={styles.libraryMetricCell}
          data-column={t("columns.sharedKeywords")}
        >
          <CompetitorSharedKeywordsValue item={item} />
        </span>
        <span
          className={styles.libraryMetricCell}
          data-column={t("columns.aiCitations")}
        >
          <CompetitorAiCitationValue insight={item.aiCitationInsight} />
        </span>
        <span
          className={styles.competitorGovernanceCell}
          data-column={t("columns.status")}
        >
          <CompetitorStatusPill status={item.reviewStatus} />
        </span>
        <button
          type="button"
          className={styles.competitorRowArrow}
          aria-label={t("openFullProfile")}
          onClick={() => onOpenProfile(item.competitorId)}
        >
          <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>
    </li>
  );
}

function CompetitorList({
  items,
  selectedCompetitorId,
  onSelect,
  onOpenProfile,
}: {
  readonly items: readonly GrowthMapCompetitorLibraryItem[];
  readonly selectedCompetitorId: string | null;
  readonly onSelect: (competitorId: string) => void;
  readonly onOpenProfile: (competitorId: string) => void;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  return (
    <div className={styles.competitorLedger}>
      <div className={styles.competitorLedgerHeader} aria-hidden="true">
        <span>{t("columns.competitor")}</span>
        <span>{t("columns.relationship")}</span>
        <span>{t("columns.analysisScope")}</span>
        <span>{t("columns.organicOverlap")}</span>
        <span>{t("columns.sharedKeywords")}</span>
        <span>{t("columns.aiCitations")}</span>
        <span>{t("columns.status")}</span>
        <span />
      </div>
      <ul className={styles.competitorList} aria-label={t("listLabel")}>
        {items.map((item) => (
          <CompetitorRow
            key={item.competitorId}
            item={item}
            selected={selectedCompetitorId === item.competitorId}
            onSelect={onSelect}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </ul>
    </div>
  );
}

function CompetitorOriginFact({
  label,
  value,
  technical = true,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly technical?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {technical ? <code title={String(value)}>{String(value)}</code> : value}
      </dd>
    </div>
  );
}

function productProfileEvidenceSourceId(
  evidence: ProductProfileOriginEvidence,
): string | null {
  switch (evidence.kind) {
    case "snapshot":
      return evidence.snapshotId;
    case "pageSnapshot":
      return evidence.pageSnapshotId;
    case "observation":
      return evidence.observationId;
    case "analysisInvocation":
      return evidence.analysisInvocationId;
    case "declaredHint":
    case "userEdit":
      return null;
  }
}

function CompetitorEvidenceList({
  origin,
}: {
  readonly origin: GrowthMapCompetitorOriginOccurrence;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  if (origin.evidenceRefs.length === 0) {
    return (
      <p className={styles.competitorEvidenceEmpty}>{t("noEvidenceRefs")}</p>
    );
  }
  return (
    <ul className={styles.competitorEvidenceList}>
      {origin.originKind === "product_profile"
        ? origin.evidenceRefs.map((evidence) => {
            const sourceId = productProfileEvidenceSourceId(evidence);
            return (
              <li key={evidence.evidenceRefId}>
                <span>
                  <strong>{t(`evidenceKind.${evidence.kind}`)}</strong>
                  <code title={evidence.evidenceRefId}>
                    {evidence.evidenceRefId}
                  </code>
                </span>
                {sourceId === null ? null : (
                  <code title={sourceId}>{sourceId}</code>
                )}
              </li>
            );
          })
        : origin.evidenceRefs.map((evidence) => (
            <li key={evidence.evidenceId}>
              <span>
                <strong>{t("evidenceKind.evidence")}</strong>
                <code title={evidence.evidenceId}>{evidence.evidenceId}</code>
              </span>
            </li>
          ))}
    </ul>
  );
}

/**
 * The immutable per-origin provenance facts. Rendered inside the drawer's
 * "why was this discovered" rows; field set is unchanged from the previous
 * origin occurrence cards.
 */
function CompetitorOriginFactsDl({
  origin,
}: {
  readonly origin: GrowthMapCompetitorOriginOccurrence;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  return (
    <dl className={styles.competitorOriginFacts}>
      <CompetitorOriginFact
        label={t("occurrenceId")}
        value={origin.occurrenceId}
      />
      {origin.originKind === "product_profile" ? (
        <>
          <CompetitorOriginFact
            label={t("productProfileId")}
            value={origin.productProfileId}
          />
          <CompetitorOriginFact
            label={t("profileVersion")}
            value={origin.profileVersion}
            technical={false}
          />
          <CompetitorOriginFact
            label={t("candidateId")}
            value={origin.candidateId}
          />
          <CompetitorOriginFact
            label={t("fieldProvenancePath")}
            value={origin.fieldProvenancePath}
          />
        </>
      ) : origin.originKind === "csv_keyword_gap" ? (
        <>
          <CompetitorOriginFact
            label={t("snapshotId")}
            value={origin.snapshotId}
          />
          <CompetitorOriginFact
            label={t("observationId")}
            value={origin.observationId}
          />
          <CompetitorOriginFact
            label={t("sourcePointer")}
            value={origin.sourcePointer}
          />
          <CompetitorOriginFact
            label={t("importPreviewId")}
            value={origin.importPreviewId}
          />
        </>
      ) : origin.originKind === "manual" ? (
        <CompetitorOriginFact
          label={t("manualEntryId")}
          value={origin.manualEntryId}
        />
      ) : (
        <>
          <CompetitorOriginFact
            label={t("snapshotId")}
            value={origin.snapshotId}
          />
          <CompetitorOriginFact
            label={t("observationId")}
            value={origin.observationId}
          />
        </>
      )}
    </dl>
  );
}

function CompetitorMonitorStatusPill({
  state,
}: {
  readonly state: CompetitorMonitorDisplayState;
}) {
  const t = useTranslations("growthMap.competitorLibrary.monitor");
  return (
    <span
      className={styles.competitorMonitorStatus}
      data-state={state}
      data-testid="competitor-monitor-status"
    >
      {t(`status.${state}`)}
    </span>
  );
}

function CompetitorMonitorSignalCard({
  projectId,
  signal,
}: {
  readonly projectId: string;
  readonly signal: CompetitorMonitorSignal;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary.monitor");
  const searchParams = useSearchParams();
  const sourceUrl =
    signal.kind === "new_content_overlap"
      ? safeExternalPageUrl(signal.url)
      : null;
  const signalAnchor = `competitor-signal-${signal.signalId}`;
  const selected = searchParams.get("competitorSignalId") === signal.signalId;
  const opportunityParams = new URLSearchParams(searchParams.toString());
  opportunityParams.set("object", "competitors");
  opportunityParams.set("selectedCompetitorId", signal.competitorId);
  opportunityParams.set("competitorSignalId", signal.signalId);
  const opportunityHref = `/p/${encodeURIComponent(projectId)}/growth-map?${opportunityParams.toString()}#${signalAnchor}`;

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(signalAnchor)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected, signalAnchor]);

  return (
    <article
      id={signalAnchor}
      className={styles.competitorMonitorSignal}
      data-signal-kind={signal.kind}
      data-opportunity-update-source-ref={signal.opportunityUpdate.sourceRef}
      data-selected={selected ? "true" : "false"}
      data-testid={`competitor-monitor-signal-${signal.signalId}`}
    >
      <header className={styles.competitorMonitorSignalHeader}>
        <span>
          {signal.kind === "rank_gain" ? t("rankSignal") : t("contentSignal")}
        </span>
        <strong>
          {signal.kind === "rank_gain" ? signal.keyword : signal.topicLabel}
        </strong>
      </header>

      {signal.kind === "rank_gain" ? (
        <p className={styles.competitorMonitorSignalSummary}>
          <strong>
            {t("rankSummary", {
              previous: formatNumber(locale, signal.previousRank),
              current: formatNumber(locale, signal.currentRank),
              improvement: formatNumber(locale, signal.improvement),
            })}
          </strong>
        </p>
      ) : (
        <>
          <p className={styles.competitorMonitorSignalSummary}>
            <strong>
              {t("contentSummary", {
                keywordCount: signal.matchedKeywordIds.length,
                overlap: formatPercentage(locale, signal.overlapRatio),
              })}
            </strong>
          </p>
          {sourceUrl === null ? (
            <code className={styles.competitorMonitorContentUrl}>
              {signal.url}
            </code>
          ) : (
            <a
              className={styles.competitorMonitorContentUrl}
              href={sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span>{signal.url}</span>
              <ArrowUpRight aria-hidden="true" size={15} />
            </a>
          )}
        </>
      )}

      <dl className={styles.competitorMonitorEvidence}>
        <div>
          <dt>{t("topicLabel")}</dt>
          <dd>{signal.topicLabel}</dd>
        </div>
        <div>
          <dt>{t("detectedAt")}</dt>
          <dd>
            <time dateTime={signal.detectedAt}>
              {formatObservedAt(locale, signal.detectedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t("evidenceSource")}</dt>
          <dd>DataForSEO</dd>
        </div>
      </dl>

      <details className={styles.traceDisclosure}>
        <summary>{t("viewEvidence")}</summary>
        <dl className={styles.keywordMetricMeta}>
          <CompetitorOriginFact
            label={t("currentSnapshot")}
            value={signal.currentSnapshotId}
          />
          <CompetitorOriginFact
            label={t("previousSnapshot")}
            value={signal.previousSnapshotId}
          />
          <CompetitorOriginFact label={t("signalId")} value={signal.signalId} />
        </dl>
        {signal.limitation === null ? null : (
          <LimitationList
            className={styles.competitorMonitorLimitation}
            limitations={[signal.limitation]}
          />
        )}
      </details>
      <footer className={styles.competitorMonitorSignalAction}>
        <span>{t("opportunityUpdateReady")}</span>
        <Link href={opportunityHref}>
          {t("openOpportunityUpdate")}
          <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </footer>
    </article>
  );
}

function CompetitorMonitorSection({
  projectId,
  response,
  item,
  isPending,
  isError,
  onRetry,
  isUpdating,
  isUpdateSuccess,
  updateError,
  onToggle,
  onRefreshConfig,
}: {
  readonly projectId: string;
  readonly response: CompetitorMonitorResponse | undefined;
  readonly item: CompetitorMonitorItem | null;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
  readonly isUpdating: boolean;
  readonly isUpdateSuccess: boolean;
  readonly updateError: unknown;
  readonly onToggle: (enabled: boolean) => void;
  readonly onRefreshConfig: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary.monitor");

  if (isPending || response === undefined) {
    if (isError) {
      return (
        <section
          className={cx(
            styles.keywordDetailSection,
            styles.competitorMonitorSection,
          )}
          data-testid="competitor-monitor"
        >
          <div className={styles.competitorMonitorReadState} role="alert">
            <CircleAlert aria-hidden="true" size={19} />
            <div>
              <strong>{t("error")}</strong>
              <button type="button" onClick={onRetry}>
                {t("retry")}
              </button>
            </div>
          </div>
        </section>
      );
    }
    return (
      <section
        className={cx(
          styles.keywordDetailSection,
          styles.competitorMonitorSection,
        )}
        data-testid="competitor-monitor"
      >
        <div className={styles.competitorMonitorReadState} role="status">
          <Spinner label={t("loading")} size="sm" />
          <span>{t("loading")}</span>
        </div>
      </section>
    );
  }

  const state = competitorMonitorDisplayState(response, item);
  const configEnabled = response.config?.enabled === true;
  const updateConflict =
    updateError instanceof ApiError && updateError.status === 409;
  const scope = response.scope;
  const signals =
    state === "available" || state === "partial"
      ? (item?.recentSignals ?? [])
      : [];
  const limitation =
    item?.limitation ??
    response.limitation ??
    (item === null ? t("notInConfirmedScope") : null);

  return (
    <section
      className={cx(
        styles.keywordDetailSection,
        styles.competitorMonitorSection,
      )}
      data-competitor-id={item?.competitorId ?? "unavailable"}
      data-testid="competitor-monitor"
    >
      <div className={styles.keywordSectionHeading}>
        <div>
          <span>{t("eyebrow")}</span>
          <h3>{t("title")}</h3>
        </div>
        <History aria-hidden="true" size={21} />
      </div>
      <div className={styles.competitorMonitorLead}>
        <p>{t("description")}</p>
        <CompetitorMonitorStatusPill state={state} />
      </div>

      <div
        className={styles.competitorMonitorControls}
        aria-label={t("settingsLabel")}
      >
        <div>
          <span>{t("frequencyLabel")}</span>
          <strong>{t("monthly")}</strong>
          <small>{t("onlySupportedCadence")}</small>
        </div>
        <button
          type="button"
          aria-pressed={configEnabled}
          disabled={isUpdating}
          onClick={() => onToggle(!configEnabled)}
        >
          {isUpdating ? t("saving") : configEnabled ? t("pause") : t("enable")}
        </button>
      </div>

      {updateError === null ? (
        isUpdateSuccess ? (
          <p
            className={styles.competitorMonitorConfigFeedback}
            data-state="success"
            role="status"
          >
            <CheckCircle2 aria-hidden="true" size={16} />
            <span>{t("saved")}</span>
          </p>
        ) : null
      ) : (
        <div
          className={styles.competitorMonitorConfigFeedback}
          data-state="error"
          data-testid="competitor-monitor-config-error"
          role="alert"
        >
          <CircleAlert aria-hidden="true" size={16} />
          <span>{updateConflict ? t("conflict") : t("saveError")}</span>
          <button type="button" onClick={onRefreshConfig}>
            <RefreshCw aria-hidden="true" size={14} />
            {t("refreshState")}
          </button>
        </div>
      )}

      <dl className={styles.competitorMonitorFacts}>
        <div>
          <dt>{t("sourceAndFrequency")}</dt>
          <dd>
            <strong>DataForSEO</strong>
            <span>
              {response.config?.frequency === "monthly"
                ? t("monthly")
                : t("unavailableValue")}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t("confirmedScope")}</dt>
          <dd>
            {scope === null ? (
              <strong>{t("unavailableValue")}</strong>
            ) : (
              <>
                <strong>
                  {scope.market} · {scope.languageTag}
                </strong>
                <span>
                  {t("topicRevision", {
                    revision: scope.topicModelRevision,
                  })}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("lastCollection")}</dt>
          <dd>
            {item?.lastCollectionAt === null ||
            item?.lastCollectionAt === undefined ? (
              <strong>{t("unavailableValue")}</strong>
            ) : (
              <time dateTime={item.lastCollectionAt}>
                {formatObservedAt(locale, item.lastCollectionAt)}
              </time>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("nextCollection")}</dt>
          <dd>
            {item?.nextCollectionAt === null ||
            item?.nextCollectionAt === undefined ? (
              <strong>{t("unavailableValue")}</strong>
            ) : (
              <time dateTime={item.nextCollectionAt}>
                {formatObservedAt(locale, item.nextCollectionAt)}
              </time>
            )}
          </dd>
        </div>
      </dl>

      {limitation === null ? null : (
        <LimitationList
          className={styles.competitorMonitorLimitation}
          limitations={[limitation]}
        />
      )}

      {signals.length > 0 ? (
        <div
          className={styles.competitorMonitorSignals}
          aria-label={t("signalListLabel")}
        >
          {signals.map((signal) => (
            <CompetitorMonitorSignalCard
              key={signal.signalId}
              projectId={projectId}
              signal={signal}
            />
          ))}
        </div>
      ) : state === "available" ? (
        <p className={styles.competitorMonitorEmpty}>
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>{t("noThresholdSignals")}</span>
        </p>
      ) : (
        <p className={styles.competitorMonitorEmpty}>
          <CircleDashed aria-hidden="true" size={18} />
          <span>{t(`stateDescription.${state}`)}</span>
        </p>
      )}

      {signals.length === 0 ? null : (
        <div className={styles.competitorMonitorAction}>
          <div>
            <strong>{t("executionTitle")}</strong>
            <p>{t("executionDescription")}</p>
          </div>
          <Link href={`/p/${encodeURIComponent(projectId)}/execution`}>
            {t("openExecution")}
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      )}
    </section>
  );
}

function CompetitorReviewDialog({
  projectId,
  open,
  detail,
  onRequestClose,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly detail: GrowthMapCompetitorLibraryItem;
  readonly onRequestClose: () => void;
}) {
  const t = useTranslations("growthMap.competitorLibrary.review");
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const nameId = `${dialogId}-name`;
  const statusId = `${dialogId}-status`;
  const relationshipId = `${dialogId}-relationship`;
  const reviewDetailQuery = useGrowthMapCompetitorReviewDetail(
    projectId,
    detail.competitorId,
    open,
  );
  const reviewDetail = reviewDetailQuery.data?.data ?? null;
  const mutation = useReviewGrowthMapCompetitor(projectId, detail.competitorId);
  const [name, setName] = useState("");
  const [reviewStatus, setReviewStatus] =
    useState<GrowthMapCompetitorReviewStatus>("candidate");
  const [relationship, setRelationship] = useState<
    GrowthMapCompetitorRelationship | ""
  >("");
  const [analysisScope, setAnalysisScope] = useState<
    readonly ProductProfileCompetitorAnalysisScope[]
  >([]);
  const [localError, setLocalError] = useState<string | null>(null);
  /**
   * Set only from a confirmed mutation success while the dialog is still
   * open; while non-null the dialog shows the recorded-decision view. The
   * approved copy is derived from the server-returned scope so it never
   * claims capabilities the saved authority does not establish.
   */
  const [successState, setSuccessState] = useState<Pick<
    GrowthMapCompetitorLibraryItem,
    "reviewStatus" | "analysisScope"
  > | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const isRevisionConflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;

  useEffect(() => {
    setSuccessState(null);
  }, [open]);

  useEffect(() => {
    if (!open || reviewDetail === null) return;
    setName(reviewDetail.name ?? "");
    setReviewStatus(reviewDetail.reviewStatus);
    setRelationship(reviewDetail.relationship ?? "");
    setAnalysisScope(reviewDetail.analysisScope);
    setLocalError(null);
    mutation.reset();
  }, [open, reviewDetail]);

  function resetFeedback(): void {
    setLocalError(null);
    mutation.reset();
  }

  function changeStatus(nextStatus: GrowthMapCompetitorReviewStatus): void {
    resetFeedback();
    setReviewStatus(nextStatus);
    if (nextStatus !== "approved") {
      setRelationship("");
      setAnalysisScope([]);
    }
  }

  function toggleAnalysisScope(
    scope: ProductProfileCompetitorAnalysisScope,
    checked: boolean,
  ): void {
    resetFeedback();
    const selected = new Set(analysisScope);
    if (checked) selected.add(scope);
    else selected.delete(scope);
    setAnalysisScope(
      COMPETITOR_REVIEW_ANALYSIS_SCOPES.filter((value) => selected.has(value)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.reset();
    if (reviewDetail === null) return;

    let reviewedRelationship: GrowthMapCompetitorRelationship | null = null;
    let reviewedAnalysisScope: readonly ProductProfileCompetitorAnalysisScope[] =
      [];
    if (reviewStatus === "approved") {
      if (relationship === "") {
        setLocalError(t("validation.relationshipRequired"));
        return;
      }
      if (analysisScope.length === 0) {
        setLocalError(t("validation.analysisScopeRequired"));
        return;
      }
      reviewedRelationship = relationship;
      reviewedAnalysisScope = analysisScope;
    }

    const command: ReviewCompetitorRequest = {
      expectedRevision: reviewDetail.revision,
      name: name.trim() || null,
      reviewStatus,
      relationship: reviewedRelationship,
      analysisScope: [...reviewedAnalysisScope],
    };
    setLocalError(null);
    mutation.mutate(command, {
      onSuccess: (response) => {
        if (!openRef.current) return;
        setSuccessState({
          reviewStatus: response.data.reviewStatus,
          analysisScope: response.data.analysisScope,
        });
      },
    });
  }

  return (
    <GrowthMapDialogFrame
      open={open}
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={onRequestClose}
      className={styles.keywordReviewDialog}
    >
      <header className={styles.keywordRelationDialogHeader}>
        <div>
          <span id={descriptionId}>
            {reviewDetail?.name ?? detail.name ?? detail.domain} ·{" "}
            {reviewDetail?.domain ?? detail.domain}
          </span>
          <h2 id={titleId}>
            {successState === null ? t("title") : t("successTitle")}
          </h2>
        </div>
        <button
          type="button"
          className={styles.keywordRelationClose}
          aria-label={t("close")}
          onClick={onRequestClose}
        >
          <X aria-hidden="true" size={19} />
        </button>
      </header>

      {successState !== null ? (
        <div
          className={styles.competitorReviewSuccess}
          data-testid="competitor-review-success"
          role="status"
        >
          <CheckCircle2 aria-hidden="true" size={22} />
          <p>
            {successState.reviewStatus === "approved"
              ? t("success.approved", {
                  scopes: successState.analysisScope
                    .map((scope) => t(`analysisScope.${scope}`))
                    .join(" · "),
                })
              : t(`success.${successState.reviewStatus}`)}
          </p>
          <footer className={styles.keywordReviewFooter}>
            <span>
              {t("revision", {
                revision: reviewDetail?.revision ?? detail.revision,
              })}
            </span>
            <div>
              <Button type="button" onClick={onRequestClose}>
                {t("done")}
              </Button>
            </div>
          </footer>
        </div>
      ) : (
        <form
          className={styles.keywordReviewForm}
          data-testid="competitor-review-form"
          onSubmit={submit}
        >
          {reviewDetailQuery.isPending ? (
            <div className={styles.keywordReviewAuthorityState} role="status">
              <Spinner label={t("loading")} size="sm" />
              <span>{t("loading")}</span>
            </div>
          ) : reviewDetailQuery.isError ? (
            <div className={styles.keywordReviewAuthorityState} role="alert">
              <CircleAlert aria-hidden="true" size={17} />
              <span>{t("loadError")}</span>
              <button
                type="button"
                onClick={() => void reviewDetailQuery.refetch()}
              >
                {t("retry")}
              </button>
            </div>
          ) : (
            <>
              <Field label={t("decisionLabel")} htmlFor={statusId} required>
                <select
                  id={statusId}
                  className={styles.topicSelect}
                  value={reviewStatus}
                  disabled={reviewDetail === null}
                  onChange={(event) =>
                    changeStatus(
                      event.target.value as GrowthMapCompetitorReviewStatus,
                    )
                  }
                >
                  {COMPETITOR_REVIEW_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`decision.${status}`)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label={t("field.name")}
                help={t("field.nameHelp")}
                htmlFor={nameId}
              >
                <TextInput
                  id={nameId}
                  value={name}
                  maxLength={160}
                  onChange={(event) => {
                    resetFeedback();
                    setName(event.target.value);
                  }}
                />
              </Field>

              {reviewStatus === "approved" ? (
                <>
                  <Field
                    label={t("field.relationship")}
                    htmlFor={relationshipId}
                    required
                  >
                    <select
                      id={relationshipId}
                      className={styles.topicSelect}
                      value={relationship}
                      disabled={reviewDetail === null}
                      onChange={(event) => {
                        resetFeedback();
                        setRelationship(
                          event.target.value as
                            | GrowthMapCompetitorRelationship
                            | "",
                        );
                      }}
                    >
                      <option value="">{t("selectRelationship")}</option>
                      {COMPETITOR_REVIEW_RELATIONSHIPS.map((value) => (
                        <option key={value} value={value}>
                          {t(`relationship.${value}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <fieldset
                    className={styles.topicMergeChoices}
                    data-testid="competitor-review-analysis-scope"
                  >
                    <legend>{t("field.analysisScope")}</legend>
                    {COMPETITOR_REVIEW_ANALYSIS_SCOPES.map((scope) => (
                      <label key={scope}>
                        <input
                          type="checkbox"
                          checked={analysisScope.includes(scope)}
                          disabled={reviewDetail === null}
                          onChange={(event) =>
                            toggleAnalysisScope(scope, event.target.checked)
                          }
                        />
                        <span>{t(`analysisScope.${scope}`)}</span>
                      </label>
                    ))}
                  </fieldset>
                </>
              ) : (
                <p className={styles.keywordReviewDataNote}>
                  <CircleAlert aria-hidden="true" size={16} />
                  <span>{t("nonApprovedBoundary")}</span>
                </p>
              )}
            </>
          )}

          <p className={styles.competitorDecisionImpact}>
            <strong>{t("impactTitle")}</strong>
            <span>{t("impactBody")}</span>
          </p>

          {localError === null ? null : (
            <p className={styles.keywordReviewError} role="alert">
              {localError}
            </p>
          )}
          {mutation.isError ? (
            <p className={styles.keywordReviewError} role="alert">
              {isRevisionConflict ? t("revisionConflict") : t("saveError")}
            </p>
          ) : null}

          <footer className={styles.keywordReviewFooter}>
            <span>
              {t("revision", {
                revision: reviewDetail?.revision ?? detail.revision,
              })}
            </span>
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={onRequestClose}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={reviewDetail === null || mutation.isPending}
              >
                {mutation.isPending ? t("saving") : t("submit")}
              </Button>
            </div>
          </footer>
        </form>
      )}
    </GrowthMapDialogFrame>
  );
}

/**
 * The Competitor full-profile drawer. It reuses the already-fetched review
 * detail (no extra request), carries the monitor section, origin provenance,
 * and the record disclosure moved out of the detail panel, and mirrors the
 * review dialog's focus management via useGrowthMapModalA11y.
 */
function CompetitorProfileDrawer({
  projectId,
  open,
  detail,
  onRequestClose,
  onOpenReview,
  monitorResponse,
  monitorItem,
  isMonitorPending,
  isMonitorError,
  onRetryMonitor,
  isMonitorUpdating,
  isMonitorUpdateSuccess,
  monitorUpdateError,
  onToggleMonitor,
  onRefreshMonitorConfig,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly detail: GrowthMapCompetitorLibraryItem;
  readonly onRequestClose: () => void;
  readonly onOpenReview: () => void;
  readonly monitorResponse: CompetitorMonitorResponse | undefined;
  readonly monitorItem: CompetitorMonitorItem | null;
  readonly isMonitorPending: boolean;
  readonly isMonitorError: boolean;
  readonly onRetryMonitor: () => void;
  readonly isMonitorUpdating: boolean;
  readonly isMonitorUpdateSuccess: boolean;
  readonly monitorUpdateError: unknown;
  readonly onToggleMonitor: (enabled: boolean) => void;
  readonly onRefreshMonitorConfig: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  const drawerId = useId();
  const titleId = `${drawerId}-title`;
  const [mounted, setMounted] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useGrowthMapModalA11y(open, mounted, frameRef, onRequestClose);

  if (!mounted || !open) return null;

  const participation = competitorKeywordGapParticipation(detail);
  const impactKey =
    participation === "participating"
      ? "approved"
      : participation === "awaiting_confirmation"
        ? "candidate"
        : "excluded";

  return createPortal(
    <div
      className={styles.competitorDrawerScrim}
      data-growth-map-dialog-backdrop=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <div
        ref={frameRef}
        className={styles.competitorDrawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="competitor-profile-drawer"
      >
        <header className={styles.competitorDrawerHeader}>
          <div>
            <span>{detail.domain}</span>
            <h2 id={titleId}>{detail.name ?? detail.domain}</h2>
          </div>
          <button
            type="button"
            className={styles.keywordRelationClose}
            aria-label={t("drawer.close")}
            onClick={onRequestClose}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>
        <div className={styles.competitorDrawerBody}>
          <div className={styles.competitorDrawerScoreGrid}>
            <div>
              <span>{t("metrics.organicOverlap")}</span>
              <CompetitorOverlapValue insight={detail.serpOverlap} />
            </div>
            <div>
              <span>{t("metrics.sharedKeywords")}</span>
              <CompetitorSharedKeywordsValue item={detail} />
            </div>
            <div>
              <span>{t("metrics.aiCitations")}</span>
              <CompetitorAiCitationValue insight={detail.aiCitationInsight} />
            </div>
          </div>

          <section className={styles.competitorDrawerSection}>
            <h3>{t("drawer.scopeSection")}</h3>
            <dl className={styles.competitorFacts}>
              <div>
                <dt>{t("facts.relationship")}</dt>
                <dd>
                  <CompetitorRelationship relationship={detail.relationship} />
                </dd>
              </div>
              <div>
                <dt>{t("facts.analysisScope")}</dt>
                <dd>
                  {detail.analysisScope.length === 0
                    ? t("scopePending")
                    : detail.analysisScope
                        .map((scope) => t(`analysisScope.${scope}`))
                        .join(" · ")}
                </dd>
              </div>
              <div>
                <dt>{t("drawer.reviewStatus")}</dt>
                <dd>
                  <CompetitorStatusPill status={detail.reviewStatus} />
                </dd>
              </div>
              <div>
                <dt>{t("drawer.keywordGapImpact")}</dt>
                <dd>{t(`drawer.impact.${impactKey}`)}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.competitorDrawerSection}>
            <h3>{t("drawer.discoverySection")}</h3>
            {detail.originOccurrences.map((origin) => (
              <article
                key={origin.occurrenceId}
                className={styles.competitorDrawerOriginRow}
              >
                <header>
                  <span className={styles.competitorDrawerOriginBadge}>
                    {origin.originKind === "serp_overlap" ||
                    origin.originKind === "ai_citation"
                      ? t("drawer.badgeSnapshot")
                      : t("drawer.badgeManual")}
                  </span>
                  <strong>{t(`originKind.${origin.originKind}`)}</strong>
                  {origin.observedAt === null ? (
                    <span className={styles.competitorObservedState}>
                      {t("notObserved")}
                    </span>
                  ) : (
                    <time dateTime={origin.observedAt}>
                      {formatObservedAt(locale, origin.observedAt)}
                    </time>
                  )}
                </header>
                <details className={styles.traceDisclosure}>
                  <summary>{t("viewOriginDetails")}</summary>
                  <CompetitorOriginFactsDl origin={origin} />
                  <div className={styles.competitorEvidenceBlock}>
                    <strong>{t("evidenceRefs")}</strong>
                    <CompetitorEvidenceList origin={origin} />
                  </div>
                </details>
              </article>
            ))}
          </section>

          <CompetitorMonitorSection
            projectId={projectId}
            response={monitorResponse}
            item={monitorItem}
            isPending={isMonitorPending}
            isError={isMonitorError}
            onRetry={onRetryMonitor}
            isUpdating={isMonitorUpdating}
            isUpdateSuccess={isMonitorUpdateSuccess}
            updateError={monitorUpdateError}
            onToggle={onToggleMonitor}
            onRefreshConfig={onRefreshMonitorConfig}
          />
        </div>
        <footer className={styles.competitorDrawerFooter}>
          <details className={styles.recordDisclosure}>
            <summary>{t("viewRecordDetails")}</summary>
            <div className={styles.recordDisclosureBody}>
              <span>
                {t("competitorId")}
                <code title={detail.competitorId}>{detail.competitorId}</code>
              </span>
              <span>
                {t("revision")}
                <strong>{detail.revision}</strong>
              </span>
            </div>
          </details>
          <Button type="button" onClick={onOpenReview}>
            <Pencil aria-hidden="true" size={16} />
            {detail.reviewStatus === "candidate"
              ? t("reviewScopeCandidate")
              : t("reviewScopeApproved")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function CompetitorDetailPanel({
  detail,
  projectId,
  profileOpen,
  onOpenProfile,
  onCloseProfile,
  monitorResponse,
  monitorItem,
  isMonitorPending,
  isMonitorError,
  onRetryMonitor,
  isMonitorUpdating,
  isMonitorUpdateSuccess,
  monitorUpdateError,
  onToggleMonitor,
  onRefreshMonitorConfig,
}: {
  readonly detail: GrowthMapCompetitorLibraryItem;
  readonly projectId: string;
  readonly profileOpen: boolean;
  readonly onOpenProfile: () => void;
  readonly onCloseProfile: () => void;
  readonly monitorResponse: CompetitorMonitorResponse | undefined;
  readonly monitorItem: CompetitorMonitorItem | null;
  readonly isMonitorPending: boolean;
  readonly isMonitorError: boolean;
  readonly onRetryMonitor: () => void;
  readonly isMonitorUpdating: boolean;
  readonly isMonitorUpdateSuccess: boolean;
  readonly monitorUpdateError: unknown;
  readonly onToggleMonitor: (enabled: boolean) => void;
  readonly onRefreshMonitorConfig: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  const [reviewOpen, setReviewOpen] = useState(false);
  const entryReason = competitorPoolEntryReason(detail);
  const organicOverlapDisplay = competitorOrganicOverlapDisplay(
    detail.serpOverlap,
  );
  return (
    <>
      <aside
        className={cx(styles.detailPanel, styles.competitorDetailPanel)}
        aria-label={t("selectedDetailLabel")}
      >
        <header className={styles.competitorDetailHeader}>
          <div className={styles.detailEyebrow}>
            <span>{t("detailEyebrow")}</span>
            <CompetitorStatusPill status={detail.reviewStatus} />
          </div>
          <h2>{detail.name ?? detail.domain}</h2>
          <p>
            {detail.domain} ·{" "}
            {detail.relationship === null
              ? t("relationshipPending")
              : t(`relationship.${detail.relationship}`)}
          </p>
        </header>

        <div className={styles.competitorDetailTags}>
          <CoveragePill coverage={detail.coverage} />
          <LimitationList limitations={detail.coverage.limitations} />
        </div>

        <section
          className={cx(
            styles.competitorRouteCard,
            detail.reviewStatus === "candidate" &&
              styles.competitorRouteCardWarning,
          )}
        >
          <span>{t("poolEntry.title")}</span>
          <p>
            {entryReason === "customer_confirmed"
              ? t("poolEntry.reasonCustomer")
              : entryReason === "metrics" &&
                  organicOverlapDisplay.state === "available"
                ? t("poolEntry.reasonMetrics", {
                    overlap: formatNumber(
                      locale,
                      organicOverlapDisplay.percentage,
                    ),
                  })
                : t("poolEntry.reasonCollection")}
          </p>
        </section>

        <div className={styles.competitorDetailMetricsFour}>
          <div>
            <span>{t("metrics.organicOverlap")}</span>
            <CompetitorOverlapValue insight={detail.serpOverlap} />
          </div>
          <div>
            <span>{t("metrics.sharedKeywords")}</span>
            <CompetitorSharedKeywordsValue item={detail} />
          </div>
          <div>
            <span>{t("metrics.aiCitations")}</span>
            <CompetitorAiCitationValue insight={detail.aiCitationInsight} />
          </div>
          <div>
            <span>{t("metrics.evidence")}</span>
            <strong>{detail.originOccurrences.length}</strong>
          </div>
        </div>

        <dl className={styles.competitorFacts}>
          <div>
            <dt>{t("facts.relationship")}</dt>
            <dd>
              <CompetitorRelationship relationship={detail.relationship} />
            </dd>
          </div>
          <div>
            <dt>{t("facts.analysisScope")}</dt>
            <dd>
              {detail.analysisScope.length === 0
                ? t("scopePending")
                : detail.analysisScope
                    .map((scope) => t(`analysisScope.${scope}`))
                    .join(" · ")}
            </dd>
          </div>
          <div>
            <dt>{t("facts.keywordGap")}</dt>
            <dd>
              {t(
                `keywordGapParticipation.${competitorKeywordGapParticipation(detail)}`,
              )}
            </dd>
          </div>
          <div>
            <dt>{t("facts.systemEvidence")}</dt>
            <dd>
              {t("systemEvidenceCount", {
                count: detail.originOccurrences.length,
              })}
            </dd>
          </div>
        </dl>

        <div className={styles.detailActions}>
          <button type="button" onClick={onOpenProfile}>
            <BookOpenText aria-hidden="true" size={16} />
            {t("viewFullProfile")}
          </button>
          <button
            type="button"
            data-testid="competitor-review-open"
            onClick={() => setReviewOpen(true)}
          >
            <Pencil aria-hidden="true" size={16} />
            {detail.reviewStatus === "candidate"
              ? t("reviewScopeCandidate")
              : t("reviewScopeApproved")}
          </button>
        </div>
      </aside>
      <CompetitorProfileDrawer
        projectId={projectId}
        open={profileOpen}
        detail={detail}
        onRequestClose={onCloseProfile}
        onOpenReview={() => {
          onCloseProfile();
          setReviewOpen(true);
        }}
        monitorResponse={monitorResponse}
        monitorItem={monitorItem}
        isMonitorPending={isMonitorPending}
        isMonitorError={isMonitorError}
        onRetryMonitor={onRetryMonitor}
        isMonitorUpdating={isMonitorUpdating}
        isMonitorUpdateSuccess={isMonitorUpdateSuccess}
        monitorUpdateError={monitorUpdateError}
        onToggleMonitor={onToggleMonitor}
        onRefreshMonitorConfig={onRefreshMonitorConfig}
      />
      <CompetitorReviewDialog
        projectId={projectId}
        open={reviewOpen}
        detail={detail}
        onRequestClose={() => setReviewOpen(false)}
      />
    </>
  );
}

function CompetitorDetailState({
  projectId,
  selectedCompetitorId,
  profileOpen,
  onOpenProfile,
  onCloseProfile,
}: {
  readonly projectId: string;
  readonly selectedCompetitorId: string | null;
  readonly profileOpen: boolean;
  readonly onOpenProfile: () => void;
  readonly onCloseProfile: () => void;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  const detailQuery = useGrowthMapCompetitorReviewDetail(
    projectId,
    selectedCompetitorId,
  );
  const monitorQuery = useGrowthMapCompetitorMonitor(projectId);
  const monitorUpdate = useUpdateGrowthMapCompetitorMonitor(projectId);
  const monitorItem = selectCompetitorMonitorItem(
    monitorQuery.data,
    selectedCompetitorId,
  );

  function toggleMonitor(enabled: boolean): void {
    if (monitorQuery.data === undefined) return;
    monitorUpdate.reset();
    monitorUpdate.mutate({
      expectedRevision: monitorQuery.data.config?.revision ?? 0,
      enabled,
      frequency: "monthly",
    });
  }

  function refreshMonitorConfig(): void {
    monitorUpdate.reset();
    void monitorQuery.refetch();
  }
  const readState = competitorDetailReadState({
    selectedCompetitorId,
    isPending: detailQuery.isPending,
    isError: detailQuery.isError,
  });

  // Same landmark contract as the URL and Keyword rails.
  if (readState === "unselected") {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
      >
        <EmptyState
          icon={<Target size={28} />}
          title={t("selectCompetitorTitle")}
          description={t("selectCompetitorDescription")}
        />
      </aside>
    );
  }
  if (readState === "loading") {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
        role="status"
      >
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  if (readState === "error") {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
      >
        <ProblemState
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
          message={t("detailError")}
        />
      </aside>
    );
  }
  if (detailQuery.data === undefined) {
    return (
      <aside
        className={styles.detailPlaceholder}
        aria-label={t("selectedDetailLabel")}
        role="status"
      >
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  return (
    <CompetitorDetailPanel
      key={detailQuery.data.data.competitorId}
      detail={detailQuery.data.data}
      projectId={projectId}
      profileOpen={profileOpen}
      onOpenProfile={onOpenProfile}
      onCloseProfile={onCloseProfile}
      monitorResponse={monitorQuery.data}
      monitorItem={monitorItem}
      isMonitorPending={monitorQuery.isPending}
      isMonitorError={monitorQuery.isError}
      onRetryMonitor={() => void monitorQuery.refetch()}
      isMonitorUpdating={monitorUpdate.isPending}
      isMonitorUpdateSuccess={monitorUpdate.isSuccess}
      monitorUpdateError={monitorUpdate.error}
      onToggleMonitor={toggleMonitor}
      onRefreshMonitorConfig={refreshMonitorConfig}
    />
  );
}

function CompetitorLibraryEmpty({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("growthMap");
  const tc = useTranslations("growthMap.competitorLibrary");
  return (
    <section
      className={styles.libraryUnavailable}
      aria-live="polite"
      data-testid="competitor-library-empty"
    >
      <div className={styles.libraryIcon}>
        <Target aria-hidden="true" size={31} strokeWidth={1.6} />
      </div>
      <span className={styles.libraryKicker}>{t("realDataOnly")}</span>
      <h2>{t("libraries.competitors.title")}</h2>
      <p>{t("libraries.competitors.description")}</p>
      <div className={styles.libraryBoundary}>
        <CircleAlert aria-hidden="true" size={20} />
        <p>{t("libraries.competitors.boundary")}</p>
      </div>
      <Link
        className={styles.competitorManageLink}
        href={`/p/${projectId}/context`}
      >
        <Pencil aria-hidden="true" size={17} />
        {tc("editProfileCompetitors")}
      </Link>
    </section>
  );
}

function CompetitorLibraryPane({
  projectId,
  locationSearch,
  navigation,
  diagnosticRunId,
}: {
  readonly projectId: string;
  readonly locationSearch: string;
  readonly navigation: GrowthMapNavigationController;
  readonly diagnosticRunId: string;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  const pathname = usePathname();
  const canonicalSearchParams = useSearchParams();
  const canonicalLocationSearch = canonicalSearchParams.toString();
  const canonicalMode = normalizeGrowthMapObjectMode(
    canonicalSearchParams.get("object"),
  );
  const locationParams = useMemo(
    () => new URLSearchParams(locationSearch),
    [locationSearch],
  );
  const cursor = locationParams.get("cursor");
  const requestedCompetitorId = locationParams.get("selectedCompetitorId");
  const canonicalRequestedCompetitorId = canonicalSearchParams.get(
    "selectedCompetitorId",
  );
  const [cursorPredecessors, setCursorPredecessors] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());
  const [competitorSearch, setCompetitorSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<GrowthMapCompetitorStatusFilter>("all");
  // Full-profile drawer visibility lives beside the selection so both the
  // row arrow and the detail panel action drive the same drawer.
  const [profileOpen, setProfileOpen] = useState(false);
  const listQuery = useGrowthMapCompetitors(projectId, {
    cursor,
    limit: 50,
    diagnosticRunId,
  });
  const items = listQuery.data?.data ?? [];
  const filteredItems = useMemo(
    () =>
      filterGrowthMapCompetitorItems(items, {
        search: competitorSearch,
        reviewStatus: statusFilter,
      }),
    [competitorSearch, items, statusFilter],
  );
  const selectedCompetitorId = resolveVisibleCompetitorSelection(
    requestedCompetitorId,
    filteredItems.map((item) => item.competitorId),
  );
  const canonicalSelectedCompetitorId = resolveVisibleCompetitorSelection(
    canonicalRequestedCompetitorId,
    filteredItems.map((item) => item.competitorId),
  );
  const readState = competitorLibraryReadState({
    isPending: listQuery.isPending,
    isError: listQuery.isError,
    itemCount: items.length,
    cursor,
  });
  const previousCursor = resolveGrowthMapCursorPredecessor(
    cursorPredecessors,
    cursor,
  );

  useEffect(() => {
    // Do not rewrite the implicit first row. Repair only an explicit stale
    // cursor-page deep link, so a late list response cannot undo a Tab click.
    if (
      navigation.isPending ||
      locationSearch !== canonicalLocationSearch ||
      canonicalMode !== "competitors" ||
      !listQuery.isSuccess ||
      canonicalRequestedCompetitorId === null ||
      canonicalRequestedCompetitorId === canonicalSelectedCompetitorId
    ) {
      return;
    }
    navigation.replaceCanonicalHref(
      growthMapLocationHref(pathname, canonicalLocationSearch, {
        selectedCompetitorId: canonicalSelectedCompetitorId,
      }),
    );
  }, [
    canonicalLocationSearch,
    canonicalMode,
    canonicalRequestedCompetitorId,
    canonicalSelectedCompetitorId,
    listQuery.isSuccess,
    locationSearch,
    navigation,
    pathname,
  ]);

  function selectCompetitor(competitorId: string): void {
    navigation.request({ selectedCompetitorId: competitorId });
  }

  function openCompetitorProfile(competitorId: string): void {
    if (competitorId !== selectedCompetitorId) {
      selectCompetitor(competitorId);
    }
    setProfileOpen(true);
  }

  function goNext(): void {
    const nextCursor = listQuery.data?.meta.nextCursor ?? null;
    if (nextCursor === null) return;
    setCursorPredecessors((current) =>
      rememberGrowthMapCursorPredecessor(current, cursor, nextCursor),
    );
    setProfileOpen(false);
    navigation.request({ cursor: nextCursor, selectedCompetitorId: null });
  }

  function goPrevious(): void {
    if (previousCursor === undefined) return;
    setProfileOpen(false);
    navigation.request({ cursor: previousCursor, selectedCompetitorId: null });
  }

  function goFirst(): void {
    setProfileOpen(false);
    navigation.request({ cursor: null, selectedCompetitorId: null });
  }

  if (readState === "loading") {
    return (
      <div className={styles.pageState} role="status">
        <Spinner label={t("loadingLibrary")} size="lg" />
        <p>{t("loadingLibrary")}</p>
      </div>
    );
  }
  if (readState === "error") {
    return (
      <ProblemState
        error={listQuery.error}
        onRetry={() => void listQuery.refetch()}
        message={t("libraryError")}
        className={styles.pageState}
      />
    );
  }
  if (listQuery.data === undefined) {
    return (
      <div className={styles.pageState} role="status">
        <Spinner label={t("loadingLibrary")} size="lg" />
        <p>{t("loadingLibrary")}</p>
      </div>
    );
  }

  const response = listQuery.data;
  // Artifact-parity discovery grouping: customer/sales input folds
  // product_profile and manual origins together, and the approved corpus is
  // the csv_keyword_gap import path. One Competitor may count in several
  // routes; counts cover only the loaded cursor range (existing algorithm).
  const discoveryItems: readonly SourceStripItem[] = [
    {
      key: "customer_input",
      label: t("discoverySource.customer_input"),
      count: items.filter((item) =>
        item.originOccurrences.some(
          (origin) =>
            origin.originKind === "product_profile" ||
            origin.originKind === "manual",
        ),
      ).length,
      tone: "amber",
    },
    {
      key: "serp_duplicate",
      label: t("discoverySource.serp_duplicate"),
      count: items.filter((item) =>
        item.originOccurrences.some(
          (origin) => origin.originKind === "serp_overlap",
        ),
      ).length,
      tone: "mint",
    },
    {
      key: "ai_co_citation",
      label: t("discoverySource.ai_co_citation"),
      count: items.filter((item) =>
        item.originOccurrences.some(
          (origin) => origin.originKind === "ai_citation",
        ),
      ).length,
      tone: "violet",
    },
    {
      key: "approved_corpus",
      label: t("discoverySource.approved_corpus"),
      count: items.filter((item) =>
        item.originOccurrences.some(
          (origin) => origin.originKind === "csv_keyword_gap",
        ),
      ).length,
      tone: "cobalt",
    },
  ];

  return (
    <>
      <div data-testid="competitor-library-provenance">
        <SourceStrip
          label={t("discoveryPathLabel")}
          title={t("discoveryPathTitle")}
          description={t("discoveryPathDescription")}
          items={discoveryItems}
          countLabel={(count) => t("discoveryCount", { count })}
        />
      </div>
      {readState === "empty" ? (
        <CompetitorLibraryEmpty projectId={projectId} />
      ) : (
        <>
          <div className={styles.libraryToolbar}>
            <label className={styles.librarySearch}>
              <Search aria-hidden="true" size={19} />
              <input
                type="search"
                value={competitorSearch}
                onChange={(event) => setCompetitorSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
              />
              <span className={styles.rowSelectLabel}>{t("searchLabel")}</span>
            </label>
            <label className={styles.libraryFilter}>
              <span>{t("statusFilterLabel")}</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as GrowthMapCompetitorStatusFilter,
                  )
                }
              >
                <option value="all">{t("statusFilterAll")}</option>
                {COMPETITOR_STATUS_FILTERS.map((status) => (
                  <option value={status} key={status}>
                    {t(`reviewStatus.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <Link
              className={styles.libraryAction}
              href={`/p/${projectId}/context`}
            >
              <Plus aria-hidden="true" size={17} />
              {t("addCompetitor")}
            </Link>
          </div>
          <div className={styles.competitorWorkspace}>
            <div className={styles.masterColumn}>
              {readState === "cursor_empty" ? (
                <LibraryCursorPageEmpty
                  icon={<Target size={28} />}
                  title={t("cursorPageEmptyTitle")}
                  description={t("cursorPageEmptyDescription")}
                  actionLabel={t("firstPage")}
                  onReset={goFirst}
                />
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  className={styles.libraryFilteredEmpty}
                  icon={<Search size={28} />}
                  title={t("noMatchesTitle")}
                  description={t("noMatchesDescription")}
                />
              ) : (
                <CompetitorList
                  items={filteredItems}
                  selectedCompetitorId={selectedCompetitorId}
                  onSelect={selectCompetitor}
                  onOpenProfile={openCompetitorProfile}
                />
              )}
              <nav
                className={styles.pagination}
                aria-label={t("paginationLabel")}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={previousCursor === undefined}
                  onClick={goPrevious}
                >
                  <ArrowLeft aria-hidden="true" size={16} />
                  {t("previousPage")}
                </Button>
                <span className={styles.paginationSummary}>
                  {t("visibleCount", {
                    visible: filteredItems.length,
                    total: response.data.length,
                  })}
                  <CoveragePill coverage={response.meta.coverage} />
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!response.meta.hasNext}
                  onClick={goNext}
                >
                  {t("nextPage")}
                  <ArrowRight aria-hidden="true" size={16} />
                </Button>
              </nav>
            </div>
            <CompetitorDetailState
              projectId={projectId}
              selectedCompetitorId={selectedCompetitorId}
              profileOpen={profileOpen}
              onOpenProfile={() => setProfileOpen(true)}
              onCloseProfile={() => setProfileOpen(false)}
            />
          </div>
        </>
      )}
    </>
  );
}

export function GrowthMapClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("growthMap");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationSearch = searchParams.toString();
  const mode = normalizeGrowthMapObjectMode(searchParams.get("object"));
  // One unpinned URL read is the published-generation authority. Every
  // customer-visible URL, Keyword, and Competitor read below is then pinned to
  // that exact Diagnostic run, so switching tabs cannot blend generations.
  const generationQuery = useGrowthMapUrls(projectId, { limit: 1 });
  const diagnosticRunId = generationQuery.data?.diagnosticRunId ?? null;

  const requestNavigation = useCallback(
    (patch: GrowthMapNavigationPatch): void => {
      // Every Growth Map interaction changes only same-page query state. Next
      // patches the native History API so replaceState updates useSearchParams
      // without an RSC round trip. Reading window.location here makes rapid
      // clicks compose from the latest committed browser intent synchronously.
      const href = growthMapLocationHref(
        pathname,
        window.location.search.slice(1),
        patch,
      );
      window.history.replaceState(null, "", href);
    },
    [pathname],
  );

  const replaceCanonicalHref = useCallback((href: string): void => {
    window.history.replaceState(null, "", href);
  }, []);

  const navigation = useMemo<GrowthMapNavigationController>(
    () => ({
      isPending: false,
      request: requestNavigation,
      replaceCanonicalHref,
    }),
    [replaceCanonicalHref, requestNavigation],
  );

  // Only the URL portfolio publishes a frozen-generation total. The Keyword and
  // Competitor tabs have no equivalent summary, and the loaded page length is
  // not that total, so they stay uncounted instead of stating a smaller number.
  const urlCount = generationQuery.data?.meta.summary.urlCount ?? null;
  const tabItems = useMemo(
    () =>
      GROWTH_MAP_OBJECT_MODES.map((key) => ({
        key,
        Icon: MODE_ICONS[key],
      })),
    [],
  );

  function switchMode(nextMode: GrowthMapObjectMode): void {
    navigation.request({ mode: nextMode });
  }

  return (
    <div className={styles.page} data-growth-map-page="">
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>
            <Sparkles aria-hidden="true" size={16} />
            {t("eyebrow")}
          </span>
          <h1 data-app-page-title="">{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.sourceLink} href={`/p/${projectId}/sources`}>
            <Database aria-hidden="true" size={18} />
            {t("manageSources")}
          </Link>
          <div
            id="growth-map-run-diagnosis"
            className={styles.runDiagnosisAnchor}
            tabIndex={-1}
          >
            <RunDiagnosis projectId={projectId} />
          </div>
        </div>
      </header>

      <nav
        className={styles.objectTabs}
        aria-label={t("objectNavLabel")}
        aria-busy={false}
      >
        {tabItems.map(({ key, Icon }) => (
          <button
            type="button"
            key={key}
            className={cx(
              styles.objectTab,
              mode === key && styles.objectTabActive,
            )}
            aria-current={mode === key ? "page" : undefined}
            aria-pressed={mode === key}
            onClick={() => switchMode(key)}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
            <span>
              <strong>
                {t(`modes.${key}.label`)}
                {key === "pages" && urlCount !== null ? (
                  <em className={styles.objectTabCount}>
                    {t("modeCount.pages", { count: urlCount })}
                  </em>
                ) : null}
              </strong>
              <small>{t(`modes.${key}.description`)}</small>
            </span>
          </button>
        ))}
      </nav>

      {mode !== "backlinks" && generationQuery.isPending ? (
        <div className={styles.pageState} role="status">
          <Spinner label={t("loadingPortfolio")} size="lg" />
          <p>{t("loadingPortfolio")}</p>
        </div>
      ) : mode !== "backlinks" && generationQuery.isError ? (
        generationQuery.error instanceof ApiError &&
        generationQuery.error.code === "GROWTH_MAP_AUDIT_NOT_FOUND" ? (
          <EmptyState
            className={styles.pageState}
            icon={<Globe2 size={30} />}
            title={t("auditUnavailableTitle")}
            description={t("auditUnavailableDescription")}
          />
        ) : (
          <ProblemState
            error={generationQuery.error}
            onRetry={() => void generationQuery.refetch()}
            message={t("portfolioError")}
            className={styles.pageState}
          />
        )
      ) : mode !== "backlinks" && diagnosticRunId === null ? (
        <EmptyState
          className={styles.pageState}
          icon={<Globe2 size={30} />}
          title={t("auditUnavailableTitle")}
          description={t("auditUnavailableDescription")}
        />
      ) : mode === "pages" ? (
        <PortfolioPane
          projectId={projectId}
          locationSearch={locationSearch}
          navigation={navigation}
          diagnosticRunId={diagnosticRunId!}
        />
      ) : mode === "keywords" ? (
        <KeywordLibraryPane
          projectId={projectId}
          locationSearch={locationSearch}
          navigation={navigation}
          diagnosticRunId={null}
          publishedDiagnosticRunId={diagnosticRunId!}
        />
      ) : mode === "competitors" ? (
        <CompetitorLibraryPane
          projectId={projectId}
          locationSearch={locationSearch}
          navigation={navigation}
          diagnosticRunId={diagnosticRunId!}
        />
      ) : (
        <BacklinkGrowthPath projectId={projectId} />
      )}
    </div>
  );
}
