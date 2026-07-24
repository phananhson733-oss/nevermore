"use client";

import type {
  GrowthMapUrlFinding,
  GrowthMapUrlPortfolioItem,
} from "@sf/contracts";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Clock3,
  GitPullRequest,
  Globe2,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Spinner, StatusPill, type StatusTone } from "@/components/ui";
import {
  useProductProfile,
  useWorkspaceView,
  type OverviewAction,
  type OverviewView,
} from "@/lib/api";
import {
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
  useCreateGrowthAuditRun,
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
  selectProjectWorkItemsForFrozenRun,
  shouldRefreshFrozenRunPair,
  selectTopOpportunityFinding,
  selectTopPortfolioItem,
  type OverviewSourceCard,
} from "./_overview-view-model";
import styles from "./overview.module.css";

const PRIORITY_TONE: Readonly<
  Record<GrowthMapUrlFinding["severity"], StatusTone>
> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

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

function TopOpportunity({
  projectId,
  topPage,
  topFinding,
}: {
  readonly projectId: string;
  readonly topPage: GrowthMapUrlPortfolioItem | null;
  readonly topFinding: GrowthMapUrlFinding | null;
}) {
  const t = useTranslations("overview.customer");
  const tReview = useTranslations("reviewState");
  const href = overviewGrowthMapHref(projectId, topPage?.sitePageId ?? null);

  if (!topPage || !topFinding) {
    return (
      <EmptyBlock
        title={t("priority.noOpportunity")}
        description={t("priority.noOpportunityDescription")}
        href={href}
        action={t("actions.openGrowthMap")}
      />
    );
  }

  return (
    <article className={styles.topOpportunity}>
      <div className={styles.opportunityTopline}>
        <span className={styles.opportunityRank}>01</span>
        <StatusPill tone={PRIORITY_TONE[topFinding.severity]}>
          {t(`priority.levels.${topFinding.severity}`)}
        </StatusPill>
        <StatusPill
          tone={topFinding.reviewState === "confirmed" ? "success" : "info"}
        >
          {tReview(topFinding.reviewState)}
        </StatusPill>
      </div>
      <h3>{topFinding.title}</h3>
      <p className={styles.opportunityPage}>
        <Target aria-hidden="true" size={17} />
        <span>{pageLabel(topPage)}</span>
        <code>{new URL(topPage.normalizedUrl).pathname}</code>
      </p>
      <div className={styles.opportunityFacts}>
        <span>{topFinding.ruleId}</span>
        <span>
          {t("priority.evidenceCount", {
            count: topFinding.evidenceIds.length,
          })}
        </span>
        <span>{t("priority.oneFinding")}</span>
      </div>
      <Link href={href} className={styles.primaryLink}>
        {topFinding.reviewState === "confirmed"
          ? t("actions.inspectOpportunity")
          : t("actions.reviewOpportunity")}
        <ArrowRight aria-hidden="true" size={17} />
      </Link>
    </article>
  );
}

function ProjectWorkRow({
  projectId,
  action,
}: {
  readonly projectId: string;
  readonly action: OverviewAction;
}) {
  const tActionStatus = useTranslations("actionStatus");
  return (
    <li className={styles.decisionRow}>
      <span className={styles.decisionIcon} data-kind={action.status}>
        {action.status === "blocked" ? (
          <CircleAlert aria-hidden="true" size={18} />
        ) : action.status === "in_progress" ? (
          <Clock3 aria-hidden="true" size={18} />
        ) : action.status === "done" ? (
          <CheckCircle2 aria-hidden="true" size={18} />
        ) : (
          <Target aria-hidden="true" size={18} />
        )}
      </span>
      <div>
        <span className={styles.decisionKind}>
          {tActionStatus(action.status)}
        </span>
        <strong>{action.title}</strong>
      </div>
      <Link
        href={`/p/${projectId}/execution?actionId=${encodeURIComponent(action.id)}`}
        aria-label={`${tActionStatus(action.status)}: ${action.title}`}
      >
        <ArrowRight aria-hidden="true" size={18} />
      </Link>
    </li>
  );
}

type WorkRunState = "loading" | "ready" | "mismatch" | "unavailable";

function PrioritySection({
  projectId,
  projectWork,
  workRunState,
  topPage,
  topFinding,
  resultPage,
  detailRunMismatch,
  portfolioPending,
  detailPending,
  portfolioError,
  onRetry,
  onRetryRunPair,
}: {
  readonly projectId: string;
  readonly projectWork: readonly OverviewAction[];
  readonly workRunState: WorkRunState;
  readonly topPage: GrowthMapUrlPortfolioItem | null;
  readonly topFinding: GrowthMapUrlFinding | null;
  readonly resultPage: GrowthMapUrlPortfolioItem | null;
  readonly detailRunMismatch: boolean;
  readonly portfolioPending: boolean;
  readonly detailPending: boolean;
  readonly portfolioError: unknown;
  readonly onRetry: () => void;
  readonly onRetryRunPair: () => void;
}) {
  const t = useTranslations("overview.customer");
  const tDelta = useTranslations("growthMap.delta");
  const verifiedResult = buildVerifiedResultSummary(resultPage);

  return (
    <section className={`${styles.card} ${styles.priorityCard}`}>
      <SectionHeading
        eyebrow={t("priority.eyebrow")}
        title={t("priority.title")}
        meta={t("priority.maxItems")}
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
        <TopOpportunity
          projectId={projectId}
          topPage={topPage}
          topFinding={topFinding}
        />
      )}

      <div className={styles.queueHeading}>
        <strong>{t("priority.queueTitle")}</strong>
        <span>
          {workRunState === "ready"
            ? t("priority.queueCount", { count: projectWork.length })
            : "—"}
        </span>
      </div>
      {workRunState === "loading" ? (
        <div className={styles.queueNotice} role="status">
          <Spinner label={t("priority.queueSyncing")} size="sm" />
          <span>{t("priority.queueSyncing")}</span>
        </div>
      ) : workRunState === "mismatch" ? (
        <div className={styles.queueNotice} role="status">
          <CircleAlert aria-hidden="true" size={18} />
          <span>{t("priority.queueRunMismatch")}</span>
          <button type="button" onClick={onRetryRunPair}>
            {t("actions.retryAuditPair")}
          </button>
        </div>
      ) : workRunState === "unavailable" ? (
        <p className={styles.secondaryEmpty}>
          {t("priority.queueUnavailable")}
        </p>
      ) : projectWork.length === 0 ? (
        <p className={styles.secondaryEmpty}>{t("priority.queueEmpty")}</p>
      ) : (
        <ol className={styles.decisionList}>
          {projectWork.map((action) => (
            <ProjectWorkRow
              key={action.id}
              projectId={projectId}
              action={action}
            />
          ))}
        </ol>
      )}
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
    </section>
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
  const priorityCounts = response?.data.reduce(
    (counts, item) => {
      if (item.priority.availability === "available") {
        counts[item.priority.value] += 1;
      }
      return counts;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );

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
                <small>{t("portfolio.oneByOne")}</small>
              </dd>
            </div>
          </dl>
          <div className={styles.priorityMix}>
            {(["critical", "high", "medium", "low"] as const).map(
              (priority) => {
                const count = priorityCounts?.[priority] ?? 0;
                const denominator = Math.max(1, summary.loadedUrlCount);
                return (
                  <div key={priority} className={styles.priorityRow}>
                    <span>{t(`priority.levels.${priority}`)}</span>
                    <span className={styles.priorityTrack} aria-hidden="true">
                      <span
                        style={{
                          width: `${count === 0 ? 0 : Math.max(3, (count / denominator) * 100)}%`,
                        }}
                      />
                    </span>
                    <strong>{count}</strong>
                  </div>
                );
              },
            )}
          </div>
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
  const portfolioRunId = portfolioQuery.data?.diagnosticRunId ?? null;
  const topPage = selectTopPortfolioItem(portfolioQuery.data?.data ?? []);
  const resultPage = selectTopPortfolioItem(
    (portfolioQuery.data?.data ?? []).filter(
      (item) => item.delta.availability === "available",
    ),
  );
  const detailQuery = useGrowthMapUrlDetail(
    projectId,
    topPage?.sitePageId ?? null,
  );
  const detailRunId = detailQuery.data?.diagnosticRunId ?? null;
  const detailRunMismatch =
    portfolioRunId !== null &&
    detailRunId !== null &&
    detailRunId !== portfolioRunId;
  const topFinding = selectTopOpportunityFinding(
    detailQuery.data?.data,
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
      <main className={styles.pageState} role="status">
        <Spinner label={t("loading")} size="lg" />
        <p>{t("loading")}</p>
      </main>
    );
  }

  if (workspaceQuery.isError) {
    return (
      <main className={styles.pageState}>
        <ProblemState
          error={workspaceQuery.error}
          onRetry={() => void workspaceQuery.refetch()}
          message={t("error")}
        />
      </main>
    );
  }

  const view = workspaceQuery.data;
  const projectWork = selectProjectWorkItemsForFrozenRun(
    view.topActions,
    view.frozenDiagnosticRunId,
    portfolioRunId,
  );
  const workRunState: WorkRunState = portfolioQuery.isPending
    ? "loading"
    : portfolioQuery.isError || portfolioRunId === null
      ? "unavailable"
      : runPairMismatch
        ? workspaceQuery.isFetching
          ? "loading"
          : "mismatch"
        : "ready";
  return (
    <main className={styles.page} data-overview-page="">
      <header className={styles.hero}>
        <div>
          <span className={styles.heroEyebrow}>{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
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
          workRunState={workRunState}
          topPage={topPage}
          topFinding={topFinding}
          resultPage={resultPage}
          detailRunMismatch={detailRunMismatch}
          portfolioPending={portfolioQuery.isPending}
          detailPending={
            detailQuery.isPending ||
            (detailRunMismatch &&
              (detailQuery.isFetching || portfolioQuery.isFetching))
          }
          portfolioError={portfolioQuery.error ?? detailQuery.error}
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
          response={portfolioQuery.data}
          topPage={topPage}
          pending={portfolioQuery.isPending}
          error={portfolioQuery.error}
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
    </main>
  );
}
