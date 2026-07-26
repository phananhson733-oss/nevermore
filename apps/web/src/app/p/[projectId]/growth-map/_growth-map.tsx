"use client";

import type {
  GrowthMapCoverage,
  GrowthMapCompetitorAiCitationInsight,
  GrowthMapCompetitorLibraryItem,
  GrowthMapCompetitorOriginOccurrence,
  GrowthMapCompetitorSerpOverlap,
  GrowthMapKeywordLibraryItem,
  GrowthMapKeywordNumericMetric,
  GrowthMapKeywordSourceOccurrence,
  GrowthMapKeywordTextMetric,
  GrowthMapUrlDetail,
  GrowthMapUrlFinding,
  GrowthMapUrlMetricObservation,
  GrowthMapUrlPortfolioItem,
} from "@sf/contracts";
import {
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
  Sparkles,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Button,
  EmptyState,
  Field,
  Spinner,
  TextArea,
  cx,
} from "@/components/ui";
import { useReviewFinding } from "@/lib/api/hooks-diagnosis";
import {
  refreshGrowthMapAfterFindingReview,
  useGrowthMapCompetitorDetail,
  useGrowthMapCompetitors,
  useGrowthMapKeywordDetail,
  useGrowthMapKeywords,
  useGrowthMapUrlDetail,
  useGrowthMapUrls,
} from "@/lib/api/hooks-growth-map";
import { ProblemState } from "../_problem-display.tsx";
import { EvidenceRefsDisclosure } from "./_evidence-refs-disclosure.tsx";
import { RunDiagnosis } from "./_run-diagnosis.tsx";
import { executionHrefForRef } from "../execution/_execution-deep-link.ts";
import {
  GROWTH_MAP_OBJECT_MODES,
  buildGrowthMapReviewCommand,
  competitorDetailReadState,
  competitorLibraryReadState,
  findMetricObservation,
  findingTargetLabelKey,
  growthMapDetailAllowsFindingReview,
  growthMapLocationHref,
  growthMapPlatformLimitationKey,
  identitySourceKey,
  keywordDetailReadState,
  keywordLibraryReadState,
  keywordMetricPresentation,
  metricLabelKey,
  metricPresentation,
  metricValueLabelKey,
  normalizeGrowthMapObjectMode,
  presentGrowthMapReviewProblem,
  rememberGrowthMapCursorPredecessor,
  resolveGrowthMapCursorPredecessor,
  resolveVisibleSitePageSelectionForFinding,
  resolveVisibleCompetitorSelection,
  resolveVisibleKeywordSelection,
  safeExternalPageUrl,
  shouldShowGrowthMapReviewError,
  urlPresentation,
  type GrowthMapMetricLabelKey,
  type GrowthMapDetailState,
  type GrowthMapFindingReviewMode,
  type GrowthMapObjectMode,
  type GrowthMapReviewProblemPresentation,
  type GrowthMapReviewIntent,
} from "./_growth-map-view-model.ts";
import {
  createGrowthMapNavigationJournal,
  observeGrowthMapCanonicalSearch,
  recordGrowthMapNavigationHref,
  requestGrowthMapNavigation,
  settleGrowthMapNavigation,
  type GrowthMapNavigationPatch,
} from "./_growth-map-navigation.ts";
import styles from "./growth-map.module.css";

const LIST_METRICS = {
  crawlStatus: { provider: "crawl", pointer: "/status" },
  clicks: { provider: "gsc", pointer: "/current28d/clicks" },
  position: { provider: "gsc", pointer: "/current28d/position" },
} as const;

const PRIORITY_CLASS = {
  critical: styles.priorityCritical,
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  low: styles.priorityLow,
} as const;

const COVERAGE_CLASS = {
  available: styles.coverageAvailable,
  partial: styles.coveragePartial,
  stale: styles.coverageStale,
  unavailable: styles.coverageUnavailable,
} as const;

const MODE_ICONS: Readonly<Record<GrowthMapObjectMode, typeof MapIcon>> = {
  pages: MapIcon,
  keywords: BookOpenText,
  competitors: Target,
};

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
    return (
      <span
        className={styles.missingValue}
        title={
          "limitation" in presentation
            ? (presentation.limitation ?? undefined)
            : undefined
        }
      >
        {t(labelKey)}
      </span>
    );
  }
  return (
    <span className={cx(styles.observedValue, compact && styles.compactValue)}>
      {formatNumber(locale, presentation.value)}
      {presentation.unit === null ? null : (
        <small>{presentation.unit}</small>
      )}
    </span>
  );
}

function PriorityPill({ item }: { readonly item: GrowthMapUrlPortfolioItem }) {
  const t = useTranslations("growthMap");
  const tPriority = useTranslations("priorityBand");
  if (item.priority.availability === "unavailable") {
    return (
      <span className={styles.priorityUnavailable} title={item.priority.limitation}>
        {t("priorityUnavailable")}
      </span>
    );
  }
  return (
    <span
      className={cx(
        styles.priorityPill,
        PRIORITY_CLASS[item.priority.value],
      )}
    >
      {tPriority(item.priority.value)}
    </span>
  );
}

function PortfolioRow({
  item,
  selected,
  onSelect,
}: {
  readonly item: GrowthMapUrlPortfolioItem;
  readonly selected: boolean;
  readonly onSelect: (sitePageId: string) => void;
}) {
  const t = useTranslations("growthMap");
  const url = urlPresentation(item.normalizedUrl);
  const status = findMetricObservation(
    item.metricObservations,
    LIST_METRICS.crawlStatus,
  );
  const clicks = findMetricObservation(
    item.metricObservations,
    LIST_METRICS.clicks,
  );
  const position = findMetricObservation(
    item.metricObservations,
    LIST_METRICS.position,
  );

  return (
    <li className={styles.portfolioRow}>
      <button
        type="button"
        className={cx(styles.rowButton, selected && styles.rowSelected)}
        aria-pressed={selected}
        onClick={() => onSelect(item.sitePageId)}
      >
        <span className={styles.urlCell}>
          <strong title={item.normalizedUrl}>{url.path}</strong>
          <span>{item.title ?? t("titleNotCollected")}</span>
          <small>{url.hostname}</small>
        </span>
        <span className={styles.metricCell} data-column={t("columns.httpStatus")}>
          <MetricValue observation={status} compact />
        </span>
        <span className={styles.metricCell} data-column={t("columns.clicks")}>
          <MetricValue observation={clicks} compact />
        </span>
        <span className={styles.metricCell} data-column={t("columns.position")}>
          <MetricValue observation={position} compact />
        </span>
        <span className={styles.findingCell} data-column={t("columns.findings")}>
          <strong>{item.findingIds.length}</strong>
          {item.reviewableFindingIds.length > 0 ? (
            <small>
              {t("reviewableCount", {
                count: item.reviewableFindingIds.length,
              })}
            </small>
          ) : null}
        </span>
        <span className={styles.priorityCell} data-column={t("columns.priority")}>
          <PriorityPill item={item} />
          <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </span>
      </button>
    </li>
  );
}

function PortfolioList({
  items,
  selectedSitePageId,
  onSelect,
}: {
  readonly items: readonly GrowthMapUrlPortfolioItem[];
  readonly selectedSitePageId: string | null;
  readonly onSelect: (sitePageId: string) => void;
}) {
  const t = useTranslations("growthMap");
  return (
    <div className={styles.ledger}>
      <div className={styles.ledgerHeader} aria-hidden="true">
        <span>{t("columns.url")}</span>
        <span>{t("columns.httpStatus")}</span>
        <span>{t("columns.clicks")}</span>
        <span>{t("columns.position")}</span>
        <span>{t("columns.findings")}</span>
        <span>{t("columns.priority")}</span>
      </div>
      <ul className={styles.portfolioList} aria-label={t("portfolioLabel")}>
        {items.map((item) => (
          <PortfolioRow
            key={item.sitePageId}
            item={item}
            selected={selectedSitePageId === item.sitePageId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function LimitationList({
  limitations,
}: {
  readonly limitations: readonly string[];
}) {
  const t = useTranslations("growthMap");
  if (limitations.length === 0) return null;
  return (
    <div className={styles.limitations}>
      <strong>
        <CircleAlert aria-hidden="true" size={17} />
        {t("limitations")}
      </strong>
      <ul>
        {limitations.map((limitation) => (
          <li key={limitation}>
            <PlatformLimitationText limitation={limitation} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlatformLimitationText({
  limitation,
}: {
  readonly limitation: string;
}) {
  const t = useTranslations("growthMap.platformLimitations");
  const key = growthMapPlatformLimitationKey(limitation);
  return key === null ? limitation : t(key);
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
              <span className={styles.providerMark} data-provider={observation.provider}>
                {tProvider(observation.provider)}
              </span>
              <strong>
                {t(`metrics.${metricLabelKey(observation)}` as `metrics.${GrowthMapMetricLabelKey}`)}
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
              <p className={styles.recordLimitation}>
                <span>{t("sourceOriginalLimitation")}</span>
                {observation.limitation}
              </p>
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
            <span>{t(`targets.${findingTargetLabelKey(finding.targetRelation)}`)}</span>
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
            <code title={finding.findingId}>{truncateId(finding.findingId)}</code>
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
              <code title={execution.actionId}>{truncateId(execution.actionId)}</code>
            </span>
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
          {execution.artifactIds.length === 0 ? null : (
            <ul className={styles.artifactRefs} aria-label={t("artifactRefs")}>
              {execution.artifactIds.map((artifactId, index) => (
                <li key={artifactId}>
                  <span title={artifactId}>
                    {t("artifactRef", { index: index + 1 })} · {truncateId(artifactId)}
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
            {t(
              reviewEnabled
                ? "findingsEyebrow"
                : "evidenceFindingsEyebrow",
            )}
          </span>
          <h3>
            {t(
              reviewEnabled
                ? "findingsTitle"
                : "evidenceFindingsTitle",
            )}
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
    <details className={styles.identityLedger}>
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
  const [detailState, setDetailState] =
    useState<GrowthMapDetailState>("audit_evidence");
  const url = urlPresentation(detail.normalizedUrl);
  const externalUrl = safeExternalPageUrl(detail.normalizedUrl);

  useEffect(() => {
    if (
      selectedFindingId !== null &&
      detail.findings.some((finding) => finding.findingId === selectedFindingId)
    ) {
      setDetailState("opportunity_review");
    }
  }, [detail.findings, selectedFindingId]);

  useEffect(() => {
    if (selectedFindingId === null || detailState !== "opportunity_review") {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`sf-finding-${selectedFindingId}`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailState, selectedFindingId]);

  return (
    <aside className={styles.detailPanel} aria-label={t("selectedUrlDetail")}>
      <header className={styles.detailHeader}>
        <div className={styles.detailEyebrow}>
          <span>{t("selectedUrl")}</span>
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
          {detail.pageType === null ? null : (
            <span>{t("pageType", { value: detail.pageType })}</span>
          )}
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
          <span>{t("priority")}</span>
          {detail.priority.availability === "available" ? (
            <strong className={PRIORITY_CLASS[detail.priority.value]}>
              {tPriority(detail.priority.value)}
            </strong>
          ) : (
            <strong className={styles.summaryMissing}>
              {t("priorityUnavailable")}
            </strong>
          )}
        </div>
        <div>
          <span>{t("currentFindings")}</span>
          <strong>{detail.findings.length}</strong>
        </div>
        <div>
          <span>{t("reviewable")}</span>
          <strong>{detail.reviewableFindingIds.length}</strong>
        </div>
      </section>

      <LimitationList limitations={detail.coverage.limitations} />
      {detail.priority.limitation === null ? null : (
        <p className={styles.projectionNote}>
          <CircleAlert aria-hidden="true" size={16} />
          {detail.priority.limitation}
        </p>
      )}

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
            detailState === "audit_evidence" && styles.detailStateButtonActive,
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

          <FindingSection
            projectId={projectId}
            detail={detail}
            state="audit_evidence"
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
            <p>
              {detail.delta.availability === "available"
                ? detail.delta.summary
                : detail.delta.limitation}
            </p>
          </section>

          <IdentityLedger detail={detail} />
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

      <footer className={styles.detailFooter}>
        <span>
          {t("ids.sitePage")}
          <code title={detail.sitePageId}>{truncateId(detail.sitePageId)}</code>
        </span>
        <span>
          {t("pageSnapshot")}
          {detail.pageSnapshotCapturedAt === null ? (
            <strong>{t("notCollected")}</strong>
          ) : (
            <time dateTime={detail.pageSnapshotCapturedAt}>
              {formatObservedAt(locale, detail.pageSnapshotCapturedAt)}
            </time>
          )}
        </span>
      </footer>
    </aside>
  );
}

function DetailState({
  projectId,
  selectedSitePageId,
  selectedFindingId,
}: {
  readonly projectId: string;
  readonly selectedSitePageId: string | null;
  readonly selectedFindingId: string | null;
}) {
  const t = useTranslations("growthMap");
  const detailQuery = useGrowthMapUrlDetail(projectId, selectedSitePageId);

  if (selectedSitePageId === null) {
    return (
      <aside className={styles.detailPlaceholder}>
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
      <aside className={styles.detailPlaceholder} role="status">
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  if (detailQuery.isError) {
    return (
      <aside className={styles.detailPlaceholder}>
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

function PortfolioPane({
  projectId,
  locationSearch,
  navigation,
}: {
  readonly projectId: string;
  readonly locationSearch: string;
  readonly navigation: GrowthMapNavigationController;
}) {
  const t = useTranslations("growthMap");
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
  const cursor = locationParams.get("cursor");
  const selectedParam = locationParams.get("selectedSitePageId");
  const selectedFindingId = locationParams.get("findingId");
  const canonicalSelectedParam = canonicalSearchParams.get(
    "selectedSitePageId",
  );
  const canonicalSelectedFindingId = canonicalSearchParams.get("findingId");
  const [searchDraft, setSearchDraft] = useState(querySearch);
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>([]);
  const listQuery = useGrowthMapUrls(projectId, {
    search: querySearch,
    cursor,
    limit: 50,
  });
  const items = listQuery.data?.data ?? [];
  const selectedSitePageId = resolveVisibleSitePageSelectionForFinding(
    selectedParam,
    selectedFindingId,
    items,
  );
  const canonicalSelectedSitePageId = resolveVisibleSitePageSelectionForFinding(
    canonicalSelectedParam,
    canonicalSelectedFindingId,
    items,
  );

  useEffect(() => {
    setSearchDraft(querySearch);
  }, [querySearch]);

  useEffect(() => {
    // An absent selection intentionally renders the first visible row without
    // rewriting the address. Rewriting it here races a user's object-tab
    // navigation when the portfolio request settles after the click, allowing
    // this stale page-only effect to replace `?object=keywords|competitors`.
    // We only repair an explicit, now-invalid deep link; direct row clicks are
    // the authority that add a selected SitePage ID to the address.
    if (
      navigation.isPending ||
      locationSearch !== canonicalLocationSearch ||
      canonicalMode !== "pages" ||
      !listQuery.isSuccess ||
      canonicalSelectedParam === null ||
      canonicalSelectedParam === canonicalSelectedSitePageId
    ) {
      return;
    }
    navigation.replaceCanonicalHref(
      growthMapLocationHref(pathname, canonicalLocationSearch, {
        selectedSitePageId: canonicalSelectedSitePageId,
      }),
    );
  }, [
    canonicalLocationSearch,
    canonicalMode,
    canonicalSelectedParam,
    canonicalSelectedSitePageId,
    listQuery.isSuccess,
    locationSearch,
    navigation,
    pathname,
  ]);

  function selectUrl(sitePageId: string): void {
    navigation.request({
      selectedSitePageId: sitePageId,
      selectedFindingId: null,
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setCursorHistory([]);
    navigation.request({
      search: searchDraft,
      cursor: null,
      selectedSitePageId: null,
      selectedFindingId: null,
    });
  }

  function goNext(): void {
    const nextCursor = listQuery.data?.meta.nextCursor ?? null;
    if (nextCursor === null) return;
    setCursorHistory((current) => [...current, cursor]);
    navigation.request({
      cursor: nextCursor,
      selectedSitePageId: null,
      selectedFindingId: null,
    });
  }

  function goPrevious(): void {
    const previous = cursorHistory.at(-1);
    if (previous === undefined) return;
    setCursorHistory((current) => current.slice(0, -1));
    navigation.request({
      cursor: previous,
      selectedSitePageId: null,
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

  return (
    <>
      <section className={styles.provenanceBand} aria-label={t("runProvenance")}>
        <div className={styles.provenanceIntro}>
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <strong>{t("traceableRun")}</strong>
            <p>{t("traceableRunDescription")}</p>
          </div>
        </div>
        <dl className={styles.provenanceFacts}>
          <div>
            <dt>{t("loadedOnPage")}</dt>
            <dd>{response.data.length}</dd>
          </div>
          <div>
            <dt>{t("runCoverage")}</dt>
            <dd><CoveragePill coverage={response.meta.coverage} /></dd>
          </div>
          <div>
            <dt>{t("ids.diagnosticRun")}</dt>
            <dd title={response.diagnosticRunId}>{truncateId(response.diagnosticRunId)}</dd>
          </div>
          <div>
            <dt>{t("ids.crawlSnapshot")}</dt>
            <dd title={response.crawlSnapshotId}>{truncateId(response.crawlSnapshotId)}</dd>
          </div>
        </dl>
        <LimitationList limitations={response.meta.coverage.limitations} />
      </section>

      <form className={styles.searchBar} role="search" onSubmit={submitSearch}>
        <label htmlFor="growth-map-url-search">{t("searchLabel")}</label>
        <div className={styles.searchControl}>
          <Search aria-hidden="true" size={20} />
          <input
            id="growth-map-url-search"
            type="search"
            maxLength={256}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
          <Button type="submit" variant="primary">
            {t("searchAction")}
          </Button>
        </div>
      </form>

      {items.length === 0 ? (
        <EmptyState
          className={styles.portfolioEmpty}
          icon={<Globe2 size={30} />}
          title={querySearch ? t("noSearchResults") : t("noPagesTitle")}
          description={querySearch ? t("noSearchResultsDescription") : t("noPagesDescription")}
        />
      ) : (
        <div className={styles.workspace}>
          <div className={styles.masterColumn}>
            <PortfolioList
              items={items}
              selectedSitePageId={selectedSitePageId}
              onSelect={selectUrl}
            />
            <nav className={styles.pagination} aria-label={t("paginationLabel")}>
              <Button
                variant="secondary"
                size="sm"
                disabled={cursorHistory.length === 0}
                onClick={goPrevious}
              >
                <ArrowLeft aria-hidden="true" size={16} />
                {t("previousPage")}
              </Button>
              <span>{t("loadedCount", { count: items.length })}</span>
              <Button
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
          <DetailState
            projectId={projectId}
            selectedSitePageId={selectedSitePageId}
            selectedFindingId={selectedFindingId}
          />
        </div>
      )}
    </>
  );
}

type KeywordMetric =
  | GrowthMapKeywordNumericMetric
  | GrowthMapKeywordTextMetric;

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

function latestKeywordCollection(
  occurrences: readonly GrowthMapKeywordSourceOccurrence[],
): string | null {
  return occurrences.reduce<string | null>((latest, occurrence) => {
    if (latest === null) return occurrence.collectedAt;
    return Date.parse(occurrence.collectedAt) > Date.parse(latest)
      ? occurrence.collectedAt
      : latest;
  }, null);
}

function KeywordStatusPill({
  status,
}: {
  readonly status: GrowthMapKeywordLibraryItem["status"];
}) {
  const t = useTranslations("growthMap.keywordLibrary.status");
  return (
    <span className={cx(styles.keywordStatus, KEYWORD_STATUS_CLASS[status])}>
      {t(status)}
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

function KeywordRow({
  item,
  selected,
  onSelect,
}: {
  readonly item: GrowthMapKeywordLibraryItem;
  readonly selected: boolean;
  readonly onSelect: (keywordId: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.keywordLibrary");
  const sourceKinds = Array.from(
    new Set(item.sourceOccurrences.map((occurrence) => occurrence.sourceKind)),
  );
  const latestCollectedAt = latestKeywordCollection(item.sourceOccurrences);

  return (
    <li className={styles.keywordRow}>
      <button
        type="button"
        className={cx(
          styles.keywordRowButton,
          selected && styles.keywordRowSelected,
        )}
        aria-pressed={selected}
        onClick={() => onSelect(item.keywordId)}
      >
        <span className={styles.keywordIdentityCell}>
          <strong>{item.displayKeyword}</strong>
          <small>
            {t("marketLanguageValue", {
              market: item.marketCode,
              language: item.languageTag,
            })}
          </small>
        </span>
        <span
          className={styles.keywordKindCell}
          data-column={t("columns.queryKind")}
        >
          {t(`queryKind.${item.queryKind}`)}
        </span>
        <span
          className={styles.keywordStatusCell}
          data-column={t("columns.status")}
        >
          <KeywordStatusPill status={item.status} />
        </span>
        <span
          className={styles.keywordSourceSummary}
          data-column={t("columns.source")}
        >
          <span>
            {sourceKinds.map((sourceKind) => (
              <small key={sourceKind}>{t(`sourceKind.${sourceKind}`)}</small>
            ))}
          </span>
          {latestCollectedAt === null ? null : (
            <time dateTime={latestCollectedAt}>
              {formatObservedAt(locale, latestCollectedAt)}
            </time>
          )}
          <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </span>
      </button>
    </li>
  );
}

function KeywordList({
  items,
  selectedKeywordId,
  onSelect,
}: {
  readonly items: readonly GrowthMapKeywordLibraryItem[];
  readonly selectedKeywordId: string | null;
  readonly onSelect: (keywordId: string) => void;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  return (
    <div className={styles.keywordLedger}>
      <div className={styles.keywordLedgerHeader} aria-hidden="true">
        <span>{t("columns.keyword")}</span>
        <span>{t("columns.queryKind")}</span>
        <span>{t("columns.status")}</span>
        <span>{t("columns.source")}</span>
      </div>
      <ul className={styles.keywordList} aria-label={t("listLabel")}>
        {items.map((item) => (
          <KeywordRow
            key={item.keywordId}
            item={item}
            selected={selectedKeywordId === item.keywordId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
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
        {limitation === null ? null : <small>{limitation}</small>}
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
            <a
              href={currentUrl}
              target="_blank"
              rel="noreferrer"
            >
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
                <dd><code>{metric.valuePointer}</code></dd>
              </div>
            </dl>
          </details>
        </>
      )}
      {presentation.limitation === null ? null : (
        <p className={styles.keywordMetricLimitation}>
          <CircleAlert aria-hidden="true" size={15} />
          {presentation.limitation}
        </p>
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
    <article className={styles.keywordSourceCard}>
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
      </dl>
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
                <code title={occurrence.snapshotId}>{occurrence.snapshotId}</code>
              </dd>
            </div>
          )}
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
              <dd><code>{occurrence.sourcePointer}</code></dd>
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
        </dl>
      </details>
      {occurrence.scopeLimitation === null ? null : (
        <p className={styles.keywordSourceNote}>
          <strong>{t("scopeLimitation")}</strong>
          {occurrence.scopeLimitation}
        </p>
      )}
      {occurrence.limitation === null ? null : (
        <p className={styles.keywordSourceNote}>
          <strong>{t("sourceLimitation")}</strong>
          {occurrence.limitation}
        </p>
      )}
    </article>
  );
}

function KeywordDetailPanel({
  detail,
}: {
  readonly detail: GrowthMapKeywordLibraryItem;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const metricKeys = [
    "volume",
    "kd",
    "currentRank",
    "currentUrl",
    "competitorDomain",
    "competitorRank",
  ] as const;

  return (
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
          {t("marketLanguageValue", {
            market: detail.marketCode,
            language: detail.languageTag,
          })}
        </p>
        <div className={styles.keywordDetailTags}>
          <span>{t(`queryKind.${detail.queryKind}`)}</span>
          <KeywordStatusPill status={detail.status} />
        </div>
      </header>

      <LimitationList limitations={detail.coverage.limitations} />

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
            value={detail.intent}
            limitation={detail.classificationLimitations.intent}
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
    </aside>
  );
}

function KeywordDetailState({
  projectId,
  selectedKeywordId,
}: {
  readonly projectId: string;
  readonly selectedKeywordId: string | null;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
  const detailQuery = useGrowthMapKeywordDetail(projectId, selectedKeywordId);
  const readState = keywordDetailReadState({
    selectedKeywordId,
    isPending: detailQuery.isPending,
    isError: detailQuery.isError,
  });

  if (readState === "unselected") {
    return (
      <aside className={styles.detailPlaceholder}>
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
      <aside className={styles.detailPlaceholder} role="status">
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  if (readState === "error") {
    return (
      <aside className={styles.detailPlaceholder}>
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
      <aside className={styles.detailPlaceholder} role="status">
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  return (
    <KeywordDetailPanel
      key={detailQuery.data.data.keywordId}
      detail={detailQuery.data.data}
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
}: {
  readonly projectId: string;
  readonly locationSearch: string;
  readonly navigation: GrowthMapNavigationController;
}) {
  const t = useTranslations("growthMap.keywordLibrary");
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
  const listQuery = useGrowthMapKeywords(projectId, { cursor, limit: 50 });
  const items = listQuery.data?.data ?? [];
  const selectedKeywordId = resolveVisibleKeywordSelection(
    requestedKeywordId,
    items.map((item) => item.keywordId),
  );
  const canonicalSelectedKeywordId = resolveVisibleKeywordSelection(
    canonicalRequestedKeywordId,
    items.map((item) => item.keywordId),
  );
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
  const occurrenceCount = response.data.reduce(
    (count, item) => count + item.sourceOccurrences.length,
    0,
  );

  return (
    <>
      <section
        className={styles.provenanceBand}
        aria-label={t("libraryScopeLabel")}
      >
        <div className={styles.provenanceIntro}>
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <strong>{t("libraryScopeTitle")}</strong>
            <p>{t("libraryScopeDescription")}</p>
          </div>
        </div>
        <dl className={cx(styles.provenanceFacts, styles.keywordPageFacts)}>
          <div>
            <dt>{t("loadedOnPage")}</dt>
            <dd>{response.data.length}</dd>
          </div>
          <div>
            <dt>{t("sourceOccurrencesOnPage")}</dt>
            <dd>{occurrenceCount}</dd>
          </div>
          <div>
            <dt>{t("coverageLabel")}</dt>
            <dd><CoveragePill coverage={response.meta.coverage} /></dd>
          </div>
        </dl>
        <LimitationList limitations={response.meta.coverage.limitations} />
      </section>

      {readState === "empty" ? (
        <KeywordLibraryEmpty />
      ) : (
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
            ) : (
              <KeywordList
                items={items}
                selectedKeywordId={selectedKeywordId}
                onSelect={selectKeyword}
              />
            )}
            <nav className={styles.pagination} aria-label={t("paginationLabel")}>
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
              <span>{t("loadedCount", { count: items.length })}</span>
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
          />
        </div>
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
    <span className={cx(styles.competitorStatus, COMPETITOR_STATUS_CLASS[status])}>
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
    <span className={relationship === null ? styles.competitorMissing : undefined}>
      {relationship === null
        ? t("relationshipPending")
        : t(`relationship.${relationship}`)}
    </span>
  );
}

function CompetitorRow({
  item,
  selected,
  onSelect,
}: {
  readonly item: GrowthMapCompetitorLibraryItem;
  readonly selected: boolean;
  readonly onSelect: (competitorId: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  const originKinds = Array.from(
    new Set(item.originOccurrences.map((origin) => origin.originKind)),
  );

  return (
    <li className={styles.competitorRow}>
      <button
        type="button"
        className={cx(
          styles.competitorRowButton,
          selected && styles.competitorRowSelected,
        )}
        aria-pressed={selected}
        onClick={() => onSelect(item.competitorId)}
      >
        <span className={styles.competitorIdentityCell}>
          <strong>{item.name ?? item.domain}</strong>
          <small>{item.domain}</small>
        </span>
        <span
          className={styles.competitorGovernanceCell}
          data-column={t("columns.governance")}
        >
          <CompetitorStatusPill status={item.reviewStatus} />
          <CompetitorRelationship relationship={item.relationship} />
        </span>
        <span
          className={styles.competitorScopeCell}
          data-column={t("columns.analysisScope")}
        >
          {item.analysisScope.length === 0 ? (
            <span className={styles.competitorMissing}>{t("scopePending")}</span>
          ) : (
            item.analysisScope.map((scope) => (
              <small key={scope}>{t(`analysisScope.${scope}`)}</small>
            ))
          )}
        </span>
        <span
          className={styles.competitorOriginSummary}
          data-column={t("columns.origins")}
        >
          <span>
            {originKinds.map((originKind) => (
              <small key={originKind}>{t(`originKind.${originKind}`)}</small>
            ))}
          </span>
          {item.lastObservedAt === null ? (
            <time>{t("notObserved")}</time>
          ) : (
            <time dateTime={item.lastObservedAt}>
              {formatObservedAt(locale, item.lastObservedAt)}
            </time>
          )}
          <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </span>
      </button>
    </li>
  );
}

function CompetitorList({
  items,
  selectedCompetitorId,
  onSelect,
}: {
  readonly items: readonly GrowthMapCompetitorLibraryItem[];
  readonly selectedCompetitorId: string | null;
  readonly onSelect: (competitorId: string) => void;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  return (
    <div className={styles.competitorLedger}>
      <div className={styles.competitorLedgerHeader} aria-hidden="true">
        <span>{t("columns.competitor")}</span>
        <span>{t("columns.governance")}</span>
        <span>{t("columns.analysisScope")}</span>
        <span>{t("columns.origins")}</span>
      </div>
      <ul className={styles.competitorList} aria-label={t("listLabel")}>
        {items.map((item) => (
          <CompetitorRow
            key={item.competitorId}
            item={item}
            selected={selectedCompetitorId === item.competitorId}
            onSelect={onSelect}
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
    return <p className={styles.competitorEvidenceEmpty}>{t("noEvidenceRefs")}</p>;
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
                <code title={evidence.evidenceId}>
                  {evidence.evidenceId}
                </code>
              </span>
            </li>
          ))}
    </ul>
  );
}

function CompetitorOriginOccurrenceCard({
  origin,
}: {
  readonly origin: GrowthMapCompetitorOriginOccurrence;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  return (
    <article className={styles.keywordSourceCard}>
      <header>
        <div>
          <Database aria-hidden="true" size={18} />
          <strong>{t(`originKind.${origin.originKind}`)}</strong>
        </div>
        {origin.observedAt === null ? (
          <span className={styles.competitorObservedState}>{t("notObserved")}</span>
        ) : (
          <time dateTime={origin.observedAt}>
            {formatObservedAt(locale, origin.observedAt)}
          </time>
        )}
      </header>
      <details className={styles.traceDisclosure}>
        <summary>{t("viewOriginDetails")}</summary>
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
        <div className={styles.competitorEvidenceBlock}>
          <strong>{t("evidenceRefs")}</strong>
          <CompetitorEvidenceList origin={origin} />
        </div>
      </details>
    </article>
  );
}

type CompetitorInsight =
  | GrowthMapCompetitorSerpOverlap
  | GrowthMapCompetitorAiCitationInsight;

function CompetitorInsightCard({
  insightKind,
  insight,
}: {
  readonly insightKind: "serpOverlap" | "aiCitationInsight";
  readonly insight: CompetitorInsight;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  return (
    <article className={styles.competitorInsightCard}>
      <header>
        <strong>{t(`insight.${insightKind}`)}</strong>
        <span
          className={cx(
            styles.competitorInsightAvailability,
            insight.availability === "available"
              ? styles.competitorInsightAvailable
              : styles.competitorInsightUnavailable,
          )}
        >
          {insight.availability === "available"
            ? t("canonicalObservationAvailable")
            : t("noCanonicalObservation")}
        </span>
      </header>
      {insight.availability === "unavailable" ? (
        <p className={styles.competitorInsightLimitation}>
          <CircleAlert aria-hidden="true" size={15} />
          <PlatformLimitationText limitation={insight.limitation} />
        </p>
      ) : (
        <>
          <div className={styles.competitorInsightValue}>
            {typeof insight.value === "number"
              ? formatNumber(locale, insight.value)
              : insight.value}
          </div>
          <p className={styles.keywordMetricObservedAt}>
            <span>{t("observedAt")}</span>
            <time dateTime={insight.observedAt}>
              {formatObservedAt(locale, insight.observedAt)}
            </time>
          </p>
          <details className={styles.traceDisclosure}>
            <summary>{t("viewInsightSourceDetails")}</summary>
            <dl className={styles.keywordMetricMeta}>
              <CompetitorOriginFact
                label={t("snapshotId")}
                value={insight.snapshotId}
              />
              <CompetitorOriginFact
                label={t("observationId")}
                value={insight.observationId}
              />
              <CompetitorOriginFact
                label={t("valuePointer")}
                value={insight.valuePointer}
              />
            </dl>
          </details>
          {insight.limitation === null ? null : (
            <p className={styles.competitorInsightLimitation}>
              <CircleAlert aria-hidden="true" size={15} />
              <PlatformLimitationText limitation={insight.limitation} />
            </p>
          )}
        </>
      )}
    </article>
  );
}

function CompetitorDetailPanel({
  detail,
}: {
  readonly detail: GrowthMapCompetitorLibraryItem;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.competitorLibrary");
  return (
    <aside
      className={cx(styles.detailPanel, styles.competitorDetailPanel)}
      aria-label={t("selectedDetailLabel")}
    >
      <header className={styles.competitorDetailHeader}>
        <div className={styles.detailEyebrow}>
          <span>{t("selectedCompetitor")}</span>
          <CoveragePill coverage={detail.coverage} />
        </div>
        <h2>{detail.name ?? detail.domain}</h2>
        <p>{detail.domain}</p>
        <div className={styles.competitorDetailTags}>
          <CompetitorStatusPill status={detail.reviewStatus} />
          <CompetitorRelationship relationship={detail.relationship} />
        </div>
      </header>

      <LimitationList limitations={detail.coverage.limitations} />

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("governanceEyebrow")}</span>
            <h3>{t("governanceTitle")}</h3>
          </div>
          <Target aria-hidden="true" size={21} />
        </div>
        <p className={styles.keywordSectionDescription}>
          {t("governanceDescription")}
        </p>
        <dl className={styles.keywordClassificationGrid}>
          <div className={styles.keywordClassificationField}>
            <dt>{t("reviewStatusLabel")}</dt>
            <dd><CompetitorStatusPill status={detail.reviewStatus} /></dd>
          </div>
          <div className={styles.keywordClassificationField}>
            <dt>{t("relationshipLabel")}</dt>
            <dd><strong><CompetitorRelationship relationship={detail.relationship} /></strong></dd>
          </div>
          <div className={styles.keywordClassificationField}>
            <dt>{t("analysisScopeLabel")}</dt>
            <dd>
              {detail.analysisScope.length === 0 ? (
                <strong className={styles.competitorMissing}>{t("scopePending")}</strong>
              ) : (
                <span className={styles.competitorScopeChips}>
                  {detail.analysisScope.map((scope) => (
                    <small key={scope}>{t(`analysisScope.${scope}`)}</small>
                  ))}
                </span>
              )}
            </dd>
          </div>
          <div className={styles.keywordClassificationField}>
            <dt>{t("lastObservedAt")}</dt>
            <dd>
              {detail.lastObservedAt === null ? (
                <strong className={styles.competitorMissing}>{t("notObserved")}</strong>
              ) : (
                <time dateTime={detail.lastObservedAt}>
                  {formatObservedAt(locale, detail.lastObservedAt)}
                </time>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("insightsEyebrow")}</span>
            <h3>{t("insightsTitle")}</h3>
          </div>
          <BarChart3 aria-hidden="true" size={21} />
        </div>
        <p className={styles.keywordSectionDescription}>
          {t("insightsDescription")}
        </p>
        <div className={styles.competitorInsightGrid}>
          <CompetitorInsightCard
            insightKind="serpOverlap"
            insight={detail.serpOverlap}
          />
          <CompetitorInsightCard
            insightKind="aiCitationInsight"
            insight={detail.aiCitationInsight}
          />
        </div>
      </section>

      <section className={styles.keywordDetailSection}>
        <div className={styles.keywordSectionHeading}>
          <div>
            <span>{t("originsEyebrow")}</span>
            <h3>{t("originsTitle")}</h3>
          </div>
          <ShieldCheck aria-hidden="true" size={21} />
        </div>
        <p className={styles.keywordSectionDescription}>
          {t("originsDescription")}
        </p>
        <div className={styles.keywordSourceList}>
          {detail.originOccurrences.map((origin) => (
            <CompetitorOriginOccurrenceCard
              key={origin.occurrenceId}
              origin={origin}
            />
          ))}
        </div>
      </section>

      <footer className={styles.keywordDetailFooter}>
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
      </footer>
    </aside>
  );
}

function CompetitorDetailState({
  projectId,
  selectedCompetitorId,
}: {
  readonly projectId: string;
  readonly selectedCompetitorId: string | null;
}) {
  const t = useTranslations("growthMap.competitorLibrary");
  const detailQuery = useGrowthMapCompetitorDetail(projectId, selectedCompetitorId);
  const readState = competitorDetailReadState({
    selectedCompetitorId,
    isPending: detailQuery.isPending,
    isError: detailQuery.isError,
  });

  if (readState === "unselected") {
    return (
      <aside className={styles.detailPlaceholder}>
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
      <aside className={styles.detailPlaceholder} role="status">
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  if (readState === "error") {
    return (
      <aside className={styles.detailPlaceholder}>
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
      <aside className={styles.detailPlaceholder} role="status">
        <Spinner label={t("loadingDetail")} size="lg" />
        <p>{t("loadingDetail")}</p>
      </aside>
    );
  }
  return (
    <CompetitorDetailPanel
      key={detailQuery.data.data.competitorId}
      detail={detailQuery.data.data}
    />
  );
}

function CompetitorLibraryEmpty({
  projectId,
}: {
  readonly projectId: string;
}) {
  const t = useTranslations("growthMap");
  const tc = useTranslations("growthMap.competitorLibrary");
  return (
    <section className={styles.libraryUnavailable} aria-live="polite">
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
      <Link className={styles.competitorManageLink} href={`/p/${projectId}/sources`}>
        <Database aria-hidden="true" size={17} />
        {tc("manageSources")}
      </Link>
    </section>
  );
}

function CompetitorLibraryPane({
  projectId,
  locationSearch,
  navigation,
}: {
  readonly projectId: string;
  readonly locationSearch: string;
  readonly navigation: GrowthMapNavigationController;
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
  const listQuery = useGrowthMapCompetitors(projectId, { cursor, limit: 50 });
  const items = listQuery.data?.data ?? [];
  const selectedCompetitorId = resolveVisibleCompetitorSelection(
    requestedCompetitorId,
    items.map((item) => item.competitorId),
  );
  const canonicalSelectedCompetitorId = resolveVisibleCompetitorSelection(
    canonicalRequestedCompetitorId,
    items.map((item) => item.competitorId),
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

  function goNext(): void {
    const nextCursor = listQuery.data?.meta.nextCursor ?? null;
    if (nextCursor === null) return;
    setCursorPredecessors((current) =>
      rememberGrowthMapCursorPredecessor(current, cursor, nextCursor),
    );
    navigation.request({ cursor: nextCursor, selectedCompetitorId: null });
  }

  function goPrevious(): void {
    if (previousCursor === undefined) return;
    navigation.request({ cursor: previousCursor, selectedCompetitorId: null });
  }

  function goFirst(): void {
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
  const originCount = response.data.reduce(
    (count, item) => count + item.originOccurrences.length,
    0,
  );

  return (
    <>
      <section className={styles.provenanceBand} aria-label={t("libraryScopeLabel")}>
        <div className={styles.provenanceIntro}>
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <strong>{t("libraryScopeTitle")}</strong>
            <p>{t("libraryScopeDescription")}</p>
            <Link
              className={styles.competitorInlineSourceLink}
              href={`/p/${projectId}/sources`}
            >
              <Database aria-hidden="true" size={15} />
              {t("manageSources")}
            </Link>
          </div>
        </div>
        <dl className={cx(styles.provenanceFacts, styles.keywordPageFacts)}>
          <div>
            <dt>{t("loadedOnPage")}</dt>
            <dd>{response.data.length}</dd>
          </div>
          <div>
            <dt>{t("originOccurrencesOnPage")}</dt>
            <dd>{originCount}</dd>
          </div>
          <div>
            <dt>{t("coverageLabel")}</dt>
            <dd><CoveragePill coverage={response.meta.coverage} /></dd>
          </div>
        </dl>
        <LimitationList limitations={response.meta.coverage.limitations} />
      </section>

      {readState === "empty" ? (
        <CompetitorLibraryEmpty projectId={projectId} />
      ) : (
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
            ) : (
              <CompetitorList
                items={items}
                selectedCompetitorId={selectedCompetitorId}
                onSelect={selectCompetitor}
              />
            )}
            <nav className={styles.pagination} aria-label={t("paginationLabel")}>
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
              <span>{t("loadedCount", { count: items.length })}</span>
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
          />
        </div>
      )}
    </>
  );
}

export function GrowthMapClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("growthMap");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canonicalLocationSearch = searchParams.toString();
  const [isNavigationPending, startNavigationTransition] = useTransition();
  const navigationJournal = useRef(
    createGrowthMapNavigationJournal(canonicalLocationSearch),
  );
  if (navigationJournal.current.canonicalSearch !== canonicalLocationSearch) {
    navigationJournal.current = observeGrowthMapCanonicalSearch(
      navigationJournal.current,
      canonicalLocationSearch,
    );
  }
  if (!isNavigationPending) {
    navigationJournal.current = settleGrowthMapNavigation(
      navigationJournal.current,
      canonicalLocationSearch,
    );
  }
  const [optimisticLocationSearch, setOptimisticLocationSearch] = useOptimistic(
    canonicalLocationSearch,
    (_currentSearch, requestedSearch: string) => requestedSearch,
  );
  const optimisticSearchParams = useMemo(
    () => new URLSearchParams(optimisticLocationSearch),
    [optimisticLocationSearch],
  );
  const mode = normalizeGrowthMapObjectMode(
    optimisticSearchParams.get("object"),
  );

  const requestNavigation = useCallback(
    (patch: GrowthMapNavigationPatch): void => {
      const request = requestGrowthMapNavigation(
        navigationJournal.current,
        pathname,
        patch,
      );
      navigationJournal.current = request.journal;
      startNavigationTransition(() => {
        setOptimisticLocationSearch(request.search);
        router.replace(request.href, { scroll: false });
      });
    },
    [pathname, router, setOptimisticLocationSearch, startNavigationTransition],
  );

  const replaceCanonicalHref = useCallback(
    (href: string): void => {
      navigationJournal.current = recordGrowthMapNavigationHref(
        navigationJournal.current,
        href,
      );
      startNavigationTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router, startNavigationTransition],
  );

  const navigation = useMemo<GrowthMapNavigationController>(
    () => ({
      isPending: isNavigationPending,
      request: requestNavigation,
      replaceCanonicalHref,
    }),
    [isNavigationPending, replaceCanonicalHref, requestNavigation],
  );

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
    <div
      className={styles.page}
      data-growth-map-page=""
      data-navigation-pending={isNavigationPending ? "" : undefined}
    >
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>
            <Sparkles aria-hidden="true" size={16} />
            {t("eyebrow")}
          </span>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.sourceLink} href={`/p/${projectId}/sources`}>
            <Database aria-hidden="true" size={18} />
            {t("manageSources")}
          </Link>
          <RunDiagnosis projectId={projectId} />
        </div>
      </header>

      <nav
        className={styles.objectTabs}
        aria-label={t("objectNavLabel")}
        aria-busy={isNavigationPending}
      >
        {tabItems.map(({ key, Icon }) => (
          <button
            type="button"
            key={key}
            className={cx(styles.objectTab, mode === key && styles.objectTabActive)}
            aria-current={mode === key ? "page" : undefined}
            aria-pressed={mode === key}
            onClick={() => switchMode(key)}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
            <span>
              <strong>{t(`modes.${key}.label`)}</strong>
              <small>{t(`modes.${key}.description`)}</small>
            </span>
          </button>
        ))}
      </nav>

      {mode === "pages" ? (
        <PortfolioPane
          projectId={projectId}
          locationSearch={optimisticLocationSearch}
          navigation={navigation}
        />
      ) : mode === "keywords" ? (
        <KeywordLibraryPane
          projectId={projectId}
          locationSearch={optimisticLocationSearch}
          navigation={navigation}
        />
      ) : (
        <CompetitorLibraryPane
          projectId={projectId}
          locationSearch={optimisticLocationSearch}
          navigation={navigation}
        />
      )}
    </div>
  );
}
