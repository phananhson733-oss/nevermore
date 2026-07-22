"use client";

import type {
  GrowthMapCoverage,
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
  Map,
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
  useEffect,
  useMemo,
  useState,
  type FormEvent,
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
  useGrowthMapUrlDetail,
  useGrowthMapUrls,
} from "@/lib/api/hooks-growth-map";
import { ProblemState } from "../_problem-display.tsx";
import { executionHrefForRef } from "../execution/_execution-deep-link.ts";
import {
  GROWTH_MAP_OBJECT_MODES,
  buildGrowthMapReviewCommand,
  findMetricObservation,
  findingTargetLabelKey,
  growthMapDetailAllowsFindingReview,
  growthMapLocationHref,
  identitySourceKey,
  metricLabelKey,
  metricPresentation,
  metricValueLabelKey,
  normalizeGrowthMapObjectMode,
  presentGrowthMapReviewProblem,
  resolveVisibleSitePageSelectionForFinding,
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

const MODE_ICONS: Readonly<Record<GrowthMapObjectMode, typeof Map>> = {
  pages: Map,
  keywords: BookOpenText,
  competitors: Target,
};

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
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </div>
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
      <details className={styles.evidenceRefs}>
        <summary>{t("inspectEvidenceIds")}</summary>
        <ul>
          {finding.evidenceIds.map((evidenceId) => (
            <li key={evidenceId}>
              <code title={evidenceId}>
                {t("ids.evidence")} · {truncateId(evidenceId)}
              </code>
            </li>
          ))}
        </ul>
      </details>
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

function PortfolioPane({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("growthMap");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const cursor = searchParams.get("cursor");
  const selectedParam = searchParams.get("selectedSitePageId");
  const selectedFindingId = searchParams.get("findingId");
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
  const locationSearch = searchParams.toString();

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
      !listQuery.isSuccess ||
      selectedParam === null ||
      selectedParam === selectedSitePageId
    ) {
      return;
    }
    router.replace(
      growthMapLocationHref(pathname, locationSearch, {
        selectedSitePageId,
      }),
      { scroll: false },
    );
  }, [
    listQuery.isSuccess,
    locationSearch,
    pathname,
    router,
    selectedParam,
    selectedSitePageId,
  ]);

  function selectUrl(sitePageId: string): void {
    router.replace(
      growthMapLocationHref(pathname, locationSearch, {
        selectedSitePageId: sitePageId,
        selectedFindingId: null,
      }),
      { scroll: false },
    );
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setCursorHistory([]);
    router.replace(
      growthMapLocationHref(pathname, locationSearch, {
        search: searchDraft,
        cursor: null,
        selectedSitePageId: null,
        selectedFindingId: null,
      }),
      { scroll: false },
    );
  }

  function goNext(): void {
    const nextCursor = listQuery.data?.meta.nextCursor ?? null;
    if (nextCursor === null) return;
    setCursorHistory((current) => [...current, cursor]);
    router.replace(
      growthMapLocationHref(pathname, locationSearch, {
        cursor: nextCursor,
        selectedSitePageId: null,
        selectedFindingId: null,
      }),
      { scroll: false },
    );
  }

  function goPrevious(): void {
    const previous = cursorHistory.at(-1);
    if (previous === undefined) return;
    setCursorHistory((current) => current.slice(0, -1));
    router.replace(
      growthMapLocationHref(pathname, locationSearch, {
        cursor: previous,
        selectedSitePageId: null,
        selectedFindingId: null,
      }),
      { scroll: false },
    );
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

function UnavailableLibrary({
  mode,
}: {
  readonly mode: Exclude<GrowthMapObjectMode, "pages">;
}) {
  const t = useTranslations("growthMap");
  const Icon = MODE_ICONS[mode];
  return (
    <section className={styles.libraryUnavailable} aria-live="polite">
      <div className={styles.libraryIcon}>
        <Icon aria-hidden="true" size={31} strokeWidth={1.6} />
      </div>
      <span className={styles.libraryKicker}>{t("realDataOnly")}</span>
      <h2>{t(`libraries.${mode}.title`)}</h2>
      <p>{t(`libraries.${mode}.description`)}</p>
      <div className={styles.libraryBoundary}>
        <CircleAlert aria-hidden="true" size={20} />
        <p>{t(`libraries.${mode}.boundary`)}</p>
      </div>
    </section>
  );
}

export function GrowthMapClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("growthMap");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizeGrowthMapObjectMode(searchParams.get("object"));

  const tabItems = useMemo(
    () =>
      GROWTH_MAP_OBJECT_MODES.map((key) => ({
        key,
        Icon: MODE_ICONS[key],
      })),
    [],
  );

  function switchMode(nextMode: GrowthMapObjectMode): void {
    router.replace(
      growthMapLocationHref(pathname, searchParams.toString(), {
        mode: nextMode,
      }),
      { scroll: false },
    );
  }

  return (
    <div className={styles.page} data-growth-map-page="">
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>
            <Sparkles aria-hidden="true" size={16} />
            {t("eyebrow")}
          </span>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <Link className={styles.sourceLink} href={`/p/${projectId}/sources`}>
          <Database aria-hidden="true" size={18} />
          {t("manageSources")}
        </Link>
      </header>

      <nav className={styles.objectTabs} aria-label={t("objectNavLabel")}>
        {tabItems.map(({ key, Icon }) => (
          <button
            type="button"
            key={key}
            className={cx(styles.objectTab, mode === key && styles.objectTabActive)}
            aria-current={mode === key ? "page" : undefined}
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
        <PortfolioPane projectId={projectId} />
      ) : (
        <UnavailableLibrary mode={mode} />
      )}
    </div>
  );
}
