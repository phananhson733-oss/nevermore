"use client";

import type {
  GrowthMapUrlFinding,
  GrowthMapUrlPortfolioItem,
} from "@sf/contracts";
import {
  ArrowRight,
  BarChart3,
  CircleAlert,
  Clock3,
  GitPullRequest,
  Globe2,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { Spinner, StatusPill, type StatusTone } from "@/components/ui";
import {
  useProductProfile,
  useWorkspaceView,
  type OverviewAction,
  type OverviewContentDecayAlert,
  type OverviewDecisionReminder,
  type OverviewView,
} from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import {
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
  isGrowthAuditAbsent,
  useCreateGrowthAuditRun,
  useProjectGrowthAudit,
} from "@/lib/api/hooks-audit";
import {
  useGrowthMapUrlDetail,
  useGrowthMapUrls,
} from "@/lib/api/hooks-growth-map";
import { useProjectSources, type SourceState } from "@/lib/api/hooks-sources";
import { ProblemState } from "../_problem-display";
import {
  buildConfirmedProfileSummary,
  buildOverviewSourceCards,
  buildPortfolioSummary,
  buildVerifiedResultSummary,
  overviewGrowthMapHref,
  selectAuthoritativeGrowthMapRead,
  selectFirstReviewableFinding,
  selectProjectWorkItemsForFrozenRun,
  shouldRefreshFrozenRunPair,
  selectTopOpportunityFinding,
  selectTopPortfolioItem,
  type OverviewSourceCard,
} from "./_overview-view-model";
import {
  toProjectOpportunityMixResult,
  type ProjectOpportunityMix,
} from "./_project-opportunity-mix.ts";
import styles from "./overview.module.css";

/**
 * The decision list is capped so the screen keeps stating what to do next
 * instead of becoming a backlog. Row 01 is always the top Opportunity.
 */
const MAX_DECISION_ROWS = 3;

const SOURCE_TONE: Partial<Record<SourceState | "unavailable", StatusTone>> = {
  available: "success",
  connected: "info",
  syncing: "info",
  connecting: "info",
  partial: "warning",
  stale: "warning",
  permission_denied: "danger",
  unavailable: "neutral",
  disconnected: "neutral",
};

function formatDateTime(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function pageLabel(item: GrowthMapUrlPortfolioItem | null): string | null {
  if (!item) return null;
  if (item.title) return item.title;
  try {
    const url = new URL(item.normalizedUrl);
    return url.pathname || "/";
  } catch {
    return item.normalizedUrl;
  }
}

function SectionHeading({
  eyebrow,
  title,
  meta,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly meta?: string | undefined;
}) {
  return (
    <header className={styles.sectionHeading}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {meta ? <span className={styles.sectionMeta}>{meta}</span> : null}
    </header>
  );
}

function LoadingBlock({ label }: { readonly label: string }) {
  return (
    <div className={styles.loadingBlock} role="status">
      <Spinner label={label} size="md" />
      <span>{label}</span>
    </div>
  );
}

function EmptyBlock({
  title,
  description,
  href,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly href?: string;
  readonly action?: string;
}) {
  return (
    <div className={styles.emptyBlock}>
      <CircleAlert aria-hidden="true" size={24} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {href && action ? (
        <Link href={href} className={styles.textLink}>
          {action}
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      ) : null}
    </div>
  );
}

function pathLabel(normalizedUrl: string): string {
  try {
    const parsed = new URL(normalizedUrl);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return normalizedUrl;
  }
}

function formatRank(position: number): string {
  return String(position).padStart(2, "0");
}

/**
 * One decision row. Every row repeats the same anatomy — rank, kind, the
 * conclusion, the object it applies to, and exactly one next action that the
 * whole row activates — so no entry can look more actionable than another.
 * Rule ids, evidence counts and other audit provenance stay on the Growth Map
 * detail this row links to (PRD: conclusion first, provenance in the drawer).
 */
function DecisionRow({
  rank,
  kind,
  tone,
  title,
  meta,
  href,
  actionLabel,
}: {
  readonly rank: string;
  readonly kind: string;
  readonly tone: string;
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly href: string;
  readonly actionLabel: string;
}) {
  return (
    <li className={styles.decisionRow} data-decision-kind={tone}>
      <span className={styles.decisionRank} data-kind={tone}>
        {rank}
      </span>
      <div>
        <span className={styles.decisionKind}>{kind}</span>
        {title}
        {meta}
      </div>
      <Link href={href} aria-label={actionLabel}>
        <ArrowRight aria-hidden="true" size={18} />
      </Link>
    </li>
  );
}

function TopOpportunityRow({
  projectId,
  rank,
  page,
  finding,
}: {
  readonly projectId: string;
  readonly rank: string;
  readonly page: GrowthMapUrlPortfolioItem;
  readonly finding: GrowthMapUrlFinding;
}) {
  const t = useTranslations("overview.customer");
  return (
    <DecisionRow
      rank={rank}
      tone="opportunity"
      kind={`${t("priority.kinds.evidenceReview")} · ${t(
        `priority.levels.${finding.severity}`,
      )}`}
      title={<h3 className={styles.decisionTitle}>{finding.title}</h3>}
      meta={
        <span className={styles.decisionMeta}>
          <span>{pageLabel(page)}</span>
          {/* pageLabel already falls back to the path when there is no title. */}
          {page.title ? <code>{pathLabel(page.normalizedUrl)}</code> : null}
        </span>
      }
      href={overviewGrowthMapHref(projectId, page.sitePageId)}
      actionLabel={
        finding.reviewState === "confirmed"
          ? t("actions.inspectOpportunity")
          : t("actions.reviewOpportunity")
      }
    />
  );
}

function ProjectWorkRow({
  projectId,
  rank,
  action,
}: {
  readonly projectId: string;
  readonly rank: string;
  readonly action: OverviewAction;
}) {
  const tActionStatus = useTranslations("actionStatus");
  return (
    <DecisionRow
      rank={rank}
      tone={action.status}
      kind={tActionStatus(action.status)}
      title={<strong className={styles.decisionTitle}>{action.title}</strong>}
      meta={null}
      href={`/p/${projectId}/execution?actionId=${encodeURIComponent(action.id)}`}
      actionLabel={`${tActionStatus(action.status)}: ${action.title}`}
    />
  );
}

function DecisionReminderRow({
  projectId,
  rank,
  reminder,
}: {
  readonly projectId: string;
  readonly rank: string;
  readonly reminder: OverviewDecisionReminder;
}) {
  const t = useTranslations("overview.customer");
  return (
    <DecisionRow
      rank={rank}
      tone="decision_due"
      kind={t("priority.decisionDue", { days: reminder.staleForDays })}
      title={
        <strong className={styles.decisionTitle} lang={reminder.summaryLocale}>
          {reminder.summary}
        </strong>
      }
      meta={null}
      href={overviewGrowthMapHref(
        projectId,
        reminder.sitePageId,
        reminder.findingId,
      )}
      actionLabel={t("priority.decideOpportunityLabel", {
        summary: reminder.summary,
      })}
    />
  );
}

function ContentDecayAlertRow({
  projectId,
  alert,
}: {
  readonly projectId: string;
  readonly alert: OverviewContentDecayAlert;
}) {
  const locale = useLocale();
  const t = useTranslations("overview.customer");
  const page = pathLabel(alert.normalizedUrl);
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  });
  // The sample sizes travel with the signal: a percentage without the click
  // counts behind it reads as far stronger evidence than it is.
  const signals: readonly string[] = [
    ...(alert.rankTrend
      ? [
          t("priority.decay.rankSignal", {
            first: number.format(alert.rankTrend.firstDecline),
            second: number.format(alert.rankTrend.secondDecline),
          }),
        ]
      : []),
    ...(alert.trafficTrend
      ? [
          t("priority.decay.trafficSignalWithSample", {
            previous: number.format(alert.trafficTrend.previousClicks),
            current: number.format(alert.trafficTrend.currentClicks),
            percent: number.format(
              Math.abs(alert.trafficTrend.changeRatio) * 100,
            ),
          }),
        ]
      : []),
  ];
  const href = overviewGrowthMapHref(projectId, alert.sitePageId);
  return (
    <li className={styles.decisionRow} data-content-decay-alert="">
      <span className={styles.decisionIcon} data-kind="content_decay">
        <TrendingDown aria-hidden="true" size={18} />
      </span>
      <div>
        <span className={styles.decisionKind}>
          {t("priority.decay.detected", { month: alert.currentMonth })}
          {signals.length > 0 ? ` · ${signals.join(" · ")}` : null}
        </span>
        <strong>{t("priority.decay.reviewSuggested")}</strong>
        <code className={styles.decayPage}>{page}</code>
      </div>
      <Link href={href} aria-label={t("priority.decay.openLabel", { page })}>
        <ArrowRight aria-hidden="true" size={18} />
      </Link>
    </li>
  );
}

/**
 * `error` and `unavailable` are deliberately distinct. A failed read is
 * retryable and says nothing about whether a frozen audit exists; only an
 * audit-not-found answer may claim that no frozen audit was identified.
 */
type WorkRunState = "loading" | "ready" | "mismatch" | "unavailable" | "error";

function WorkRunNotice({
  state,
  onRetryRunPair,
}: {
  readonly state: WorkRunState;
  readonly onRetryRunPair: () => void;
}) {
  const t = useTranslations("overview.customer");
  if (state === "ready") return null;
  if (state === "loading") {
    return (
      <div className={styles.queueNotice} role="status">
        <Spinner label={t("priority.queueSyncing")} size="sm" />
        <span>{t("priority.queueSyncing")}</span>
      </div>
    );
  }
  if (state === "mismatch") {
    return (
      <div className={styles.queueNotice} role="status">
        <CircleAlert aria-hidden="true" size={18} />
        <span>{t("priority.queueRunMismatch")}</span>
        <button type="button" onClick={onRetryRunPair}>
          {t("actions.retryAuditPair")}
        </button>
      </div>
    );
  }
  // `error` reuses the retry the card already shows above it, so the two never
  // offer competing recoveries for one failed read.
  return (
    <p className={styles.secondaryEmpty}>
      {state === "error"
        ? t("priority.queueLoadFailed")
        : t("priority.queueUnavailable")}
    </p>
  );
}

type DecisionEntry =
  | {
      readonly type: "opportunity";
      readonly page: GrowthMapUrlPortfolioItem;
      readonly finding: GrowthMapUrlFinding;
    }
  | { readonly type: "reminder"; readonly reminder: OverviewDecisionReminder }
  | { readonly type: "action"; readonly action: OverviewAction };

/**
 * Build the bounded decision list. Row 01 is the top Opportunity whenever the
 * frozen audit has one; the remaining slots go to decisions and work in the
 * order their own selectors already established. A Finding that is both the top
 * Opportunity and a stale decision is listed once, so a duplicate can never
 * consume a slot.
 */
function buildDecisionEntries(
  topPage: GrowthMapUrlPortfolioItem | null,
  topFinding: GrowthMapUrlFinding | null,
  decisionReminders: readonly OverviewDecisionReminder[],
  projectWork: readonly OverviewAction[],
): readonly DecisionEntry[] {
  const opportunity: readonly DecisionEntry[] =
    topPage !== null && topFinding !== null
      ? [{ type: "opportunity", page: topPage, finding: topFinding }]
      : [];
  const slots = Math.max(0, MAX_DECISION_ROWS - opportunity.length);
  const reminders: readonly DecisionEntry[] = decisionReminders
    .filter((reminder) => reminder.findingId !== topFinding?.findingId)
    .slice(0, slots)
    .map((reminder) => ({ type: "reminder", reminder }));
  const work: readonly DecisionEntry[] = projectWork
    .slice(0, Math.max(0, slots - reminders.length))
    .map((action) => ({ type: "action", action }));
  return [...opportunity, ...reminders, ...work];
}

function DecisionEntryRow({
  projectId,
  entry,
  rank,
}: {
  readonly projectId: string;
  readonly entry: DecisionEntry;
  readonly rank: string;
}) {
  if (entry.type === "opportunity") {
    return (
      <TopOpportunityRow
        projectId={projectId}
        rank={rank}
        page={entry.page}
        finding={entry.finding}
      />
    );
  }
  if (entry.type === "reminder") {
    return (
      <DecisionReminderRow
        projectId={projectId}
        rank={rank}
        reminder={entry.reminder}
      />
    );
  }
  return (
    <ProjectWorkRow projectId={projectId} rank={rank} action={entry.action} />
  );
}

function decisionEntryKey(entry: DecisionEntry): string {
  if (entry.type === "opportunity") {
    return `opportunity:${entry.finding.findingId}`;
  }
  if (entry.type === "reminder") return `reminder:${entry.reminder.findingId}`;
  return `action:${entry.action.id}`;
}

function DecisionList({
  projectId,
  entries,
  hasTopOpportunity,
  auditUnavailable,
  topPage,
}: {
  readonly projectId: string;
  readonly entries: readonly DecisionEntry[];
  readonly hasTopOpportunity: boolean;
  readonly auditUnavailable: boolean;
  readonly topPage: GrowthMapUrlPortfolioItem | null;
}) {
  const t = useTranslations("overview.customer");
  return (
    <>
      {hasTopOpportunity ? null : (
        <EmptyBlock
          title={
            auditUnavailable
              ? t("portfolio.unavailable")
              : t("priority.noOpportunity")
          }
          description={
            auditUnavailable
              ? t("portfolio.unavailableDescription")
              : t("priority.noOpportunityDescription")
          }
          href={overviewGrowthMapHref(projectId, topPage?.sitePageId ?? null)}
          action={t("actions.openGrowthMap")}
        />
      )}
      {entries.length === 0 ? null : (
        <ol className={styles.decisionList}>
          {entries.map((entry, index) => (
            <DecisionEntryRow
              key={decisionEntryKey(entry)}
              projectId={projectId}
              entry={entry}
              rank={formatRank(index + 1)}
            />
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * Content decay is an observation, not a customer decision, so it sits below
 * the decision list in its own block and never spends one of the three slots.
 */
function ContentHealthBlock({
  projectId,
  alerts,
}: {
  readonly projectId: string;
  readonly alerts: readonly OverviewContentDecayAlert[];
}) {
  const t = useTranslations("overview.customer");
  if (alerts.length === 0) return null;
  return (
    <div className={styles.contentHealth}>
      <div className={styles.contentHealthHeading}>
        <h3>{t("priority.contentHealth.title")}</h3>
        <p>{t("priority.contentHealth.note")}</p>
      </div>
      <ul className={styles.decisionList}>
        {alerts.map((alert) => (
          <ContentDecayAlertRow
            key={`${alert.sitePageId}:${alert.currentMonth}`}
            projectId={projectId}
            alert={alert}
          />
        ))}
      </ul>
    </div>
  );
}

function ResultBoundary({
  projectId,
  resultPage,
}: {
  readonly projectId: string;
  readonly resultPage: GrowthMapUrlPortfolioItem | null;
}) {
  const t = useTranslations("overview.customer");
  const tDelta = useTranslations("growthMap.delta");
  const verifiedResult = buildVerifiedResultSummary(resultPage);
  return (
    <div
      className={styles.resultBoundary}
      data-availability={verifiedResult ? "verified" : "unavailable"}
    >
      {verifiedResult ? (
        <ShieldCheck aria-hidden="true" size={18} />
      ) : (
        <Clock3 aria-hidden="true" size={18} />
      )}
      <div>
        <strong>
          {verifiedResult
            ? t("priority.resultVerified", {
                state: tDelta(verifiedResult.value),
              })
            : t("priority.resultUnavailable")}
        </strong>
        <p>
          {verifiedResult
            ? t("priority.resultSummary", {
                page:
                  pageLabel(resultPage) ?? resultPage?.normalizedUrl ?? "URL",
                summary: verifiedResult.summary,
              })
            : t("priority.resultUnavailableDescription")}
        </p>
      </div>
      <Link href={`/p/${projectId}/results`}>{t("actions.openResults")}</Link>
    </div>
  );
}

function PrioritySection({
  projectId,
  projectWork,
  decisionReminders,
  contentDecayAlerts,
  workRunState,
  topPage,
  topFinding,
  resultPage,
  detailRunMismatch,
  auditUnavailable,
  portfolioPending,
  detailPending,
  portfolioError,
  onRetry,
  onRetryRunPair,
}: {
  readonly projectId: string;
  readonly projectWork: readonly OverviewAction[];
  readonly decisionReminders: readonly OverviewDecisionReminder[];
  readonly contentDecayAlerts: readonly OverviewContentDecayAlert[];
  readonly workRunState: WorkRunState;
  readonly topPage: GrowthMapUrlPortfolioItem | null;
  readonly topFinding: GrowthMapUrlFinding | null;
  readonly resultPage: GrowthMapUrlPortfolioItem | null;
  readonly detailRunMismatch: boolean;
  readonly auditUnavailable: boolean;
  readonly portfolioPending: boolean;
  readonly detailPending: boolean;
  readonly portfolioError: unknown;
  readonly onRetry: () => void;
  readonly onRetryRunPair: () => void;
}) {
  const t = useTranslations("overview.customer");
  const hasTopOpportunity = topPage !== null && topFinding !== null;
  const entries = buildDecisionEntries(
    topPage,
    topFinding,
    decisionReminders,
    projectWork,
  );

  return (
    <section className={`${styles.card} ${styles.priorityCard}`}>
      <SectionHeading
        eyebrow={t("priority.eyebrow")}
        title={t("priority.title")}
        meta={t("priority.listScope")}
      />
      {portfolioPending || (topPage !== null && detailPending) ? (
        <LoadingBlock label={t("priority.loading")} />
      ) : portfolioError ? (
        <ProblemState
          error={portfolioError}
          onRetry={onRetry}
          message={t("priority.error")}
        />
      ) : detailRunMismatch ? (
        <EmptyBlock
          title={t("priority.detailRunMismatch")}
          description={t("priority.detailRunMismatchDescription")}
          href={overviewGrowthMapHref(projectId, topPage?.sitePageId ?? null)}
          action={t("actions.openGrowthMap")}
        />
      ) : (
        <DecisionList
          projectId={projectId}
          entries={entries}
          hasTopOpportunity={hasTopOpportunity}
          auditUnavailable={auditUnavailable}
          topPage={topPage}
        />
      )}
      <WorkRunNotice state={workRunState} onRetryRunPair={onRetryRunPair} />
      <ContentHealthBlock projectId={projectId} alerts={contentDecayAlerts} />
      <ResultBoundary projectId={projectId} resultPage={resultPage} />
    </section>
  );
}

/**
 * Whole-project opportunity mix. It reads the Growth Audit projection, which is
 * project-wide by definition, and is kept visually and textually apart from the
 * loaded-page stat cells above it: two scopes on one card that are not labelled
 * apart would be a dishonest comparison.
 */
function LensMixBlock({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("overview.customer");
  const tCommon = useTranslations("common");
  const auditQuery = useProjectGrowthAudit(projectId);
  // A 404 means no audit has ever run: honest absence, not a failed read.
  const result = auditQuery.isSuccess
    ? toProjectOpportunityMixResult(auditQuery.data)
    : isGrowthAuditAbsent(auditQuery.error)
      ? ({ state: "no_data", reason: "no_audit_run" } as const)
      : null;

  return (
    <div className={styles.lensMix}>
      <div className={styles.lensMixHeading}>
        <h3>{t("portfolio.lensMixTitle")}</h3>
        <span className={styles.scopeLabel}>{t("portfolio.lensMixScope")}</span>
      </div>
      {auditQuery.isPending ? (
        <div className={styles.lensMixState} role="status">
          <Spinner label={t("portfolio.lensMixLoading")} size="sm" />
          <span>{t("portfolio.lensMixLoading")}</span>
        </div>
      ) : result === null ? (
        <div className={styles.lensMixState} role="alert">
          <CircleAlert aria-hidden="true" size={17} />
          <span>{t("portfolio.lensMixError")}</span>
          <button type="button" onClick={() => void auditQuery.refetch()}>
            {tCommon("retry")}
          </button>
        </div>
      ) : result.state === "no_data" ? (
        <p className={styles.lensMixState}>{t("portfolio.lensMixNoData")}</p>
      ) : (
        <LensMixBars mix={result.mix} />
      )}
    </div>
  );
}

function LensMixBars({ mix }: { readonly mix: ProjectOpportunityMix }) {
  const t = useTranslations("overview.customer");
  const tCommon = useTranslations("common");
  const known = mix.lenses.flatMap((lens) =>
    lens.findingCount === null ? [] : [lens.findingCount],
  );
  const denominator = Math.max(1, ...known);

  return (
    <>
      <div className={styles.lensRows}>
        {mix.lenses.map((lens) => (
          <div
            key={lens.lensId}
            className={styles.lensRow}
            data-lens={lens.lensId}
            data-coverage={lens.coverageState}
          >
            <span>{t(`portfolio.lenses.${lens.lensId}`)}</span>
            <span className={styles.lensTrack} aria-hidden="true">
              {lens.findingCount === null ? null : (
                <span
                  style={{
                    width: `${
                      lens.findingCount === 0
                        ? 0
                        : Math.max(3, (lens.findingCount / denominator) * 100)
                    }%`,
                  }}
                />
              )}
            </span>
            {lens.findingCount === null ? (
              <strong title={tCommon("unavailable")}>—</strong>
            ) : (
              <strong>{lens.findingCount}</strong>
            )}
          </div>
        ))}
      </div>
      <p className={styles.lensMixTotal}>
        {mix.total === null
          ? t("portfolio.lensMixTotalUnavailable")
          : t("portfolio.lensMixTotal", { count: mix.total })}
      </p>
    </>
  );
}

/**
 * The contract always carries the limitations behind a degraded coverage grade,
 * so the badge alone would hide the reason the customer needs to judge it.
 */
function CoverageLimitations({
  limitations,
}: {
  readonly limitations: readonly string[];
}) {
  const t = useTranslations("overview.customer");
  if (limitations.length === 0) return null;
  return (
    <div className={styles.coverageLimitations}>
      <strong>
        <CircleAlert aria-hidden="true" size={16} />
        {t("portfolio.coverageLimitationsTitle")}
      </strong>
      <ul>
        {limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </div>
  );
}

function PortfolioSection({
  projectId,
  response,
  topPage,
  pending,
  error,
  onRetry,
}: {
  readonly projectId: string;
  readonly response: ReturnType<typeof useGrowthMapUrls>["data"];
  readonly topPage: GrowthMapUrlPortfolioItem | null;
  readonly pending: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const t = useTranslations("overview.customer");
  const summary = response ? buildPortfolioSummary(response) : null;
  const reviewTarget = selectFirstReviewableFinding(response?.data ?? []);

  return (
    <section className={`${styles.card} ${styles.portfolioCard}`}>
      <SectionHeading
        eyebrow={t("portfolio.eyebrow")}
        title={t("portfolio.title")}
        meta={summary ? t("portfolio.frozenRun") : undefined}
      />
      {pending ? (
        <LoadingBlock label={t("portfolio.loading")} />
      ) : error ? (
        <ProblemState
          error={error}
          onRetry={onRetry}
          message={t("portfolio.error")}
        />
      ) : !summary ? (
        <EmptyBlock
          title={t("portfolio.unavailable")}
          description={t("portfolio.unavailableDescription")}
          href={overviewGrowthMapHref(projectId, null)}
          action={t("actions.openGrowthMap")}
        />
      ) : (
        <>
          <p className={styles.scopeLabel}>{t("portfolio.statsScope")}</p>
          <dl className={styles.portfolioMetrics}>
            <div>
              <dt>{t("portfolio.loadedUrls")}</dt>
              <dd>
                <span className={styles.portfolioMetricValue}>
                  {summary.loadedUrlCount}
                </span>
                <small>
                  {summary.hasMore
                    ? t("portfolio.boundedPageMore")
                    : t("portfolio.boundedPageComplete")}
                </small>
              </dd>
            </div>
            <div>
              <dt>{t("portfolio.opportunityUrls")}</dt>
              <dd>
                <span className={styles.portfolioMetricValue}>
                  {summary.opportunityUrlCount}
                </span>
                <small>{t("portfolio.currentPageScope")}</small>
              </dd>
            </div>
            <div>
              <dt>{t("portfolio.findings")}</dt>
              <dd>
                <span className={styles.portfolioMetricValue}>
                  {summary.findingCount}
                </span>
                <small>{t("portfolio.currentRunOnly")}</small>
              </dd>
            </div>
            <div>
              <dt>{t("portfolio.toReview")}</dt>
              <dd>
                <span className={styles.portfolioMetricValue}>
                  {summary.reviewableFindingCount}
                </span>
                {/*
                  The description carries the review entry point, never the
                  count: with nothing left to review the link would open an
                  empty queue, so it is simply absent instead.
                */}
                <small>
                  {reviewTarget === null ? (
                    t("portfolio.oneByOne")
                  ) : (
                    <Link
                      className={styles.metricLink}
                      href={overviewGrowthMapHref(
                        projectId,
                        reviewTarget.sitePageId,
                        reviewTarget.findingId,
                      )}
                    >
                      {t("portfolio.oneByOne")}
                      <ArrowRight aria-hidden="true" size={14} />
                    </Link>
                  )}
                </small>
              </dd>
            </div>
          </dl>
          <LensMixBlock projectId={projectId} />
          <div className={styles.auditIdentity}>
            <ShieldCheck aria-hidden="true" size={18} />
            <span>
              {t("portfolio.auditIdentity")}
              <code title={summary.diagnosticRunId}>
                {shortId(summary.diagnosticRunId)}
              </code>
            </span>
            <StatusPill
              tone={
                summary.coverage.availability === "available"
                  ? "success"
                  : "warning"
              }
            >
              {t(`portfolio.coverage.${summary.coverage.availability}`)}
            </StatusPill>
          </div>
          <CoverageLimitations limitations={summary.coverage.limitations} />
          <Link
            className={styles.textLink}
            href={overviewGrowthMapHref(projectId, topPage?.sitePageId ?? null)}
          >
            {t("actions.openGrowthMap")}
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </>
      )}
    </section>
  );
}

function SourceIcon({
  provider,
}: {
  readonly provider: OverviewSourceCard["provider"];
}) {
  if (provider === "github")
    return <GitPullRequest aria-hidden="true" size={22} />;
  if (provider === "gsc") return <Search aria-hidden="true" size={22} />;
  return <BarChart3 aria-hidden="true" size={22} />;
}

function SourcesSection({
  projectId,
  cards,
  pending,
  error,
  onRetry,
}: {
  readonly projectId: string;
  readonly cards: readonly OverviewSourceCard[];
  readonly pending: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("overview.customer");
  const tSourceState = useTranslations("sourceState");

  return (
    <section className={`${styles.card} ${styles.sourcesCard}`}>
      <SectionHeading
        eyebrow={t("sources.eyebrow")}
        title={t("sources.title")}
        meta={t("sources.onlyThree")}
      />
      {pending ? (
        <LoadingBlock label={t("sources.loading")} />
      ) : error ? (
        <ProblemState
          error={error}
          onRetry={onRetry}
          message={t("sources.error")}
        />
      ) : (
        <div className={styles.sourceGrid}>
          {cards.map((card) => {
            const observedAt = formatDateTime(card.capturedAt, locale);
            return (
              <article className={styles.sourceItem} key={card.provider}>
                <span className={styles.sourceIcon}>
                  <SourceIcon provider={card.provider} />
                </span>
                <div className={styles.sourceMain}>
                  <div className={styles.sourceTitleRow}>
                    <strong>{t(`sources.providers.${card.provider}`)}</strong>
                    <StatusPill tone={SOURCE_TONE[card.state] ?? "neutral"}>
                      {tSourceState(card.state)}
                    </StatusPill>
                  </div>
                  <p>
                    {card.reserved
                      ? t("sources.githubReserved")
                      : observedAt
                        ? t("sources.latestSnapshot", { date: observedAt })
                        : t("sources.noSnapshot")}
                  </p>
                  {card.rawLimitation ? (
                    <details className={styles.sourceRecord}>
                      <summary>{t("sources.originalRecord")}</summary>
                      <p lang={locale.startsWith("zh") ? "en" : undefined}>
                        {card.rawLimitation}
                      </p>
                    </details>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Link className={styles.textLink} href={`/p/${projectId}/sources`}>
        {t("actions.manageConnections")}
        <ArrowRight aria-hidden="true" size={16} />
      </Link>
    </section>
  );
}

function ContextSection({
  projectId,
  profileData,
  pending,
  error,
  onRetry,
}: {
  readonly projectId: string;
  readonly profileData: ReturnType<typeof useProductProfile>["data"];
  readonly pending: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("overview.customer");
  const summary = buildConfirmedProfileSummary(profileData?.confirmedProfile);
  const audit = useCreateGrowthAuditRun(projectId);

  return (
    <section className={`${styles.card} ${styles.contextCard}`}>
      <SectionHeading
        eyebrow={t("context.eyebrow")}
        title={t("context.title")}
        meta={
          summary
            ? t("context.confirmedVersion", { version: summary.version })
            : undefined
        }
      />
      {pending ? (
        <LoadingBlock label={t("context.loading")} />
      ) : error ? (
        <ProblemState
          error={error}
          onRetry={onRetry}
          message={t("context.error")}
        />
      ) : !summary ? (
        <EmptyBlock
          title={t("context.unavailable")}
          description={t("context.unavailableDescription")}
          href={`/p/${projectId}/context`}
          action={t("actions.completeProfile")}
        />
      ) : (
        <>
          <article className={styles.profileLead}>
            <span className={styles.profileMark} aria-hidden="true">
              {summary.productName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h3>{summary.productName}</h3>
              <p>{summary.oneLiner}</p>
              <div className={styles.profileTags}>
                <span>{summary.category}</span>
                <span>{summary.productType}</span>
                {summary.businessModels.slice(0, 2).map((model) => (
                  <span key={model}>{model}</span>
                ))}
              </div>
            </div>
          </article>
          <div className={styles.profileColumns}>
            <div>
              <span className={styles.detailLabel}>
                <Globe2 aria-hidden="true" size={16} />
                {t("context.primaryMarket")}
              </span>
              <strong>{summary.primaryMarket}</strong>
            </div>
            <div>
              <span className={styles.detailLabel}>
                <Users aria-hidden="true" size={16} />
                {t("context.primaryIcp")}
              </span>
              <strong>{summary.primaryAudience}</strong>
              <p>{summary.buyerRoles.join(" · ")}</p>
            </div>
            <div>
              <span className={styles.detailLabel}>
                <Target aria-hidden="true" size={16} />
                JTBD
              </span>
              <strong>
                {summary.jtbd[0] ?? t("context.unavailableValue")}
              </strong>
              <p>{summary.pains[0] ?? t("context.unavailableValue")}</p>
            </div>
            <div>
              <span className={styles.detailLabel}>
                <Sparkles aria-hidden="true" size={16} />
                {t("context.approvedCompetitors")}
              </span>
              <strong>
                {t("context.competitorMix", {
                  direct: summary.approvedDirectCompetitors,
                  indirect: summary.approvedIndirectCompetitors,
                })}
              </strong>
            </div>
          </div>
          <details className={styles.provenanceDisclosure}>
            <summary>{t("context.provenance")}</summary>
            <dl>
              <div>
                <dt>{t("context.confirmedAt")}</dt>
                <dd>
                  {formatDateTime(summary.confirmedAt, locale) ??
                    t("context.unavailableValue")}
                </dd>
              </div>
              <div>
                <dt>Profile ID</dt>
                <dd>
                  <code>{summary.profileId}</code>
                </dd>
              </div>
              <div>
                <dt>Content hash</dt>
                <dd>
                  <code>{summary.contentHash}</code>
                </dd>
              </div>
              <div>
                <dt>Source Site ID</dt>
                <dd>
                  <code>{summary.sourceSiteId}</code>
                </dd>
              </div>
              <div>
                <dt>{t("context.sourceSnapshot")}</dt>
                <dd>
                  {summary.sourceSnapshotId ? (
                    <code>{summary.sourceSnapshotId}</code>
                  ) : (
                    t("context.declaredOnly")
                  )}
                </dd>
              </div>
            </dl>
          </details>
          <div className={styles.contextFooter}>
            <button
              type="button"
              className={styles.primaryLink}
              onClick={() =>
                audit.mutate({
                  siteId: summary.sourceSiteId,
                  icpProfileId: summary.profileId,
                  scope: { kind: "site" },
                  outputLocale: locale,
                  capabilityContractVersion:
                    GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
                })
              }
              disabled={audit.isPending || audit.isSuccess}
            >
              <Sparkles aria-hidden="true" size={16} />
              {t("actions.runAudit")}
            </button>
            <Link className={styles.textLink} href={`/p/${projectId}/context`}>
              {t("actions.editProfile")}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          {audit.isPending ? (
            <p className={styles.secondaryEmpty} role="status">
              {t("context.auditRunning")}
            </p>
          ) : audit.isSuccess ? (
            <p className={styles.secondaryEmpty} role="status">
              {t("context.auditQueued")}
            </p>
          ) : audit.isError ? (
            <p className={styles.secondaryEmpty} role="alert">
              {t("context.auditError")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function OverviewClient({
  projectId,
  initialView,
}: {
  readonly projectId: string;
  readonly initialView?: OverviewView;
}) {
  const t = useTranslations("overview.customer");
  const workspaceQuery = useWorkspaceView(projectId, "overview", initialView);
  const portfolioQuery = useGrowthMapUrls(projectId, { limit: 100 });
  const auditUnavailable =
    portfolioQuery.error instanceof ApiError &&
    portfolioQuery.error.code === "GROWTH_MAP_AUDIT_NOT_FOUND";
  const portfolioResponse = selectAuthoritativeGrowthMapRead(
    portfolioQuery.data,
    portfolioQuery.isError,
  );
  const portfolioRunId = portfolioResponse?.diagnosticRunId ?? null;
  const topPage = selectTopPortfolioItem(portfolioResponse?.data ?? []);
  const resultPage = selectTopPortfolioItem(
    (portfolioResponse?.data ?? []).filter(
      (item) => item.delta.availability === "available",
    ),
  );
  const detailQuery = useGrowthMapUrlDetail(
    projectId,
    topPage?.sitePageId ?? null,
  );
  const detailResponse = selectAuthoritativeGrowthMapRead(
    detailQuery.data,
    detailQuery.isError || auditUnavailable,
  );
  const detailRunId = detailResponse?.diagnosticRunId ?? null;
  const detailRunMismatch =
    portfolioRunId !== null &&
    detailRunId !== null &&
    detailRunId !== portfolioRunId;
  const topFinding = selectTopOpportunityFinding(
    detailResponse?.data,
    portfolioRunId,
  );
  const sourcesQuery = useProjectSources(projectId);
  const sourceCards = buildOverviewSourceCards(sourcesQuery.data ?? []);
  const profileQuery = useProductProfile(projectId);
  const workspaceRunId = workspaceQuery.data?.frozenDiagnosticRunId ?? null;
  const runPairMismatch =
    portfolioRunId !== null && workspaceRunId !== portfolioRunId;
  const attemptedPortfolioRunRef = useRef<string | null>(null);
  const attemptedDetailPortfolioRunRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !shouldRefreshFrozenRunPair({
        workspaceRunId,
        portfolioRunId,
        workspaceFetching: workspaceQuery.isFetching,
        attemptedPortfolioRunId: attemptedPortfolioRunRef.current,
      })
    ) {
      return;
    }
    attemptedPortfolioRunRef.current = portfolioRunId;
    void workspaceQuery.refetch();
  }, [
    portfolioRunId,
    runPairMismatch,
    workspaceRunId,
    workspaceQuery.isFetching,
    workspaceQuery.refetch,
  ]);

  useEffect(() => {
    if (
      !detailRunMismatch ||
      portfolioRunId === null ||
      detailRunId === null ||
      portfolioQuery.isFetching ||
      detailQuery.isFetching
    ) {
      return;
    }
    if (attemptedDetailPortfolioRunRef.current === portfolioRunId) return;
    attemptedDetailPortfolioRunRef.current = portfolioRunId;
    void Promise.all([portfolioQuery.refetch(), detailQuery.refetch()]);
  }, [
    detailQuery.isFetching,
    detailQuery.refetch,
    detailRunId,
    detailRunMismatch,
    portfolioQuery.isFetching,
    portfolioQuery.refetch,
    portfolioRunId,
  ]);

  if (workspaceQuery.isPending) {
    return (
      <div className={styles.pageState} role="status">
        <Spinner label={t("loading")} size="lg" />
        <p>{t("loading")}</p>
      </div>
    );
  }

  if (workspaceQuery.isError) {
    return (
      <div className={styles.pageState}>
        <ProblemState
          error={workspaceQuery.error}
          onRetry={() => void workspaceQuery.refetch()}
          message={t("error")}
        />
      </div>
    );
  }

  const view = workspaceQuery.data;
  const projectWork = selectProjectWorkItemsForFrozenRun(
    view.topActions,
    view.frozenDiagnosticRunId,
    portfolioRunId,
  );
  // Only an audit-not-found answer proves there is no frozen audit. Any other
  // failed read is a transport problem, and claiming absence from it would
  // contradict the retryable error the same card already shows.
  const workRunState: WorkRunState = portfolioQuery.isPending
    ? "loading"
    : portfolioQuery.isError
      ? auditUnavailable
        ? "unavailable"
        : "error"
      : portfolioRunId === null
        ? "unavailable"
        : runPairMismatch
          ? workspaceQuery.isFetching
            ? "loading"
            : "mismatch"
          : "ready";
  return (
    <div className={styles.page} data-overview-page="">
      <header className={styles.hero}>
        <div>
          <span className={styles.heroEyebrow}>{t("eyebrow")}</span>
          <h1 data-app-page-title="">{t("title")}</h1>
          <p>{t("subtitle", { project: view.project.projectName })}</p>
        </div>
        <div className={styles.heroActions}>
          <Link
            className={styles.secondaryLink}
            href={`/p/${projectId}/context`}
          >
            {t("actions.editProfile")}
          </Link>
          <Link
            className={styles.primaryLink}
            href={overviewGrowthMapHref(projectId, topPage?.sitePageId ?? null)}
          >
            {t("actions.openGrowthMap")}
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
      </header>

      <div className={styles.dashboardGrid}>
        <PrioritySection
          projectId={projectId}
          projectWork={projectWork}
          decisionReminders={view.decisionReminders}
          contentDecayAlerts={view.contentDecayMonitor.alerts}
          workRunState={workRunState}
          topPage={topPage}
          topFinding={topFinding}
          resultPage={resultPage}
          detailRunMismatch={detailRunMismatch}
          auditUnavailable={auditUnavailable}
          portfolioPending={portfolioQuery.isPending}
          detailPending={
            detailQuery.isPending ||
            (detailRunMismatch &&
              (detailQuery.isFetching || portfolioQuery.isFetching))
          }
          portfolioError={
            auditUnavailable
              ? detailQuery.error
              : (portfolioQuery.error ?? detailQuery.error)
          }
          onRetry={() => {
            attemptedDetailPortfolioRunRef.current = null;
            void portfolioQuery.refetch();
            if (topPage) void detailQuery.refetch();
          }}
          onRetryRunPair={() => {
            attemptedPortfolioRunRef.current = null;
            attemptedDetailPortfolioRunRef.current = null;
            void Promise.all([
              workspaceQuery.refetch(),
              portfolioQuery.refetch(),
              ...(topPage ? [detailQuery.refetch()] : []),
            ]);
          }}
        />
        <PortfolioSection
          projectId={projectId}
          response={portfolioResponse}
          topPage={topPage}
          pending={portfolioQuery.isPending}
          error={auditUnavailable ? null : portfolioQuery.error}
          onRetry={() => void portfolioQuery.refetch()}
        />
        <SourcesSection
          projectId={projectId}
          cards={sourceCards}
          pending={sourcesQuery.isPending}
          error={sourcesQuery.error}
          onRetry={() => void sourcesQuery.refetch()}
        />
        <ContextSection
          projectId={projectId}
          profileData={profileQuery.data}
          pending={profileQuery.isPending}
          error={profileQuery.error}
          onRetry={() => void profileQuery.refetch()}
        />
      </div>
    </div>
  );
}
