"use client";

/**
 * Diagnosis client view (spec §4.2, §8, §9.1). TanStack Query owns the server
 * state (never copied into a hand-rolled store, spec §3.2). Three honesty rules
 * shape this screen:
 *   1. A `pass` rule (no finding) and a `skipped` / `inconclusive` rule (never
 *      ran / no verdict) are visually distinct — the latter shows its reason,
 *      never "healthy".
 *   2. Evidence grade (A/B/C) and availability are shown as-is; an unavailable
 *      measure reads "unavailable", never 0 (spec §1.3).
 *   3. Review actions carry `baseRevision`; a 409 conflict refetches + informs.
 * The "Run diagnosis" button is disabled with an explanation until a complete
 * ICP and a crawl snapshot both exist (the server's hard gates, spec §5).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, CircleDashed, ShieldCheck } from "lucide-react";
import {
  Button,
  EmptyState,
  LimitationHint,
  Panel,
  Spinner,
  StatusPill,
  cx,
  type StatusTone,
} from "@/components/ui";
import { ApiError, useProject } from "@/lib/api";
import type { Coverage } from "@/lib/api";
import {
  hasCrawlSnapshot,
  isRunTerminal,
  mergeFindingPages,
  selectLatestSnapshotIds,
  useCreateDiagnosticRun,
  useProjectFindings,
  useProjectRun,
  useProjectSnapshots,
  type DiagnosticDomain,
  type DiagnosticRuleResult,
  type Finding,
  type RunStatus,
  type Severity,
} from "@/lib/api/hooks-diagnosis";
import { ProblemState } from "../_problem-display";
import { FindingCard } from "./_finding-card.tsx";
import {
  filterCanonicalFindings,
  resolveCoveragePresentationState,
  type FindingFilters,
} from "./_diagnosis-view-model.ts";
import styles from "./diagnosis.module.css";

/** The five diagnosis domains, in the spec's canonical order (spec §4.2). */
const DOMAIN_KEYS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;

const SEVERITY_KEYS = ["critical", "high", "medium", "low"] as const;

type CoverageLabelKey = "ready" | "degraded" | "partial" | "missing";

interface ToneLabel {
  readonly tone: StatusTone;
  readonly labelKey: CoverageLabelKey;
}

/** Domain-level coverage status → pill tone + `coverage.*` label key. */
function domainCoverageMeta(status: string | undefined): ToneLabel {
  switch (status) {
    case "complete":
      return { tone: "success", labelKey: "ready" };
    case "partial":
      return { tone: "warning", labelKey: "partial" };
    case "qualitative":
      return { tone: "info", labelKey: "degraded" };
    default:
      return { tone: "neutral", labelKey: "missing" };
  }
}

function runStatusTone(status: RunStatus): StatusTone {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
    default:
      return "info";
  }
}

/* ------------------------------------------------------------ Run header --- */

/** Which hard gate (if any) is blocking a run — drives the disabled explanation. */
type RunGate = "context" | "crawl" | null;
type SnapshotReadState = "loading" | "error" | "ready";

interface RunHeaderProps {
  readonly projectId: string;
  readonly clientName: string;
  readonly findingCount: number;
  readonly completeDomainCount: number | null;
  readonly evidenceBackedCount: number;
  readonly canRun: boolean;
  readonly gate: RunGate;
  readonly hasEverRun: boolean;
  readonly polling: boolean;
  readonly pending: boolean;
  readonly runStatus: RunStatus | null;
  readonly snapshotReadState: SnapshotReadState;
  readonly statusPollError: boolean;
  readonly statusPollRetrying: boolean;
  readonly notice: {
    readonly kind: "error" | "info";
    readonly text: string;
  } | null;
  readonly onRun: () => void;
  readonly onRetryStatus: () => void;
}

function RunHeader({
  projectId,
  clientName,
  findingCount,
  completeDomainCount,
  evidenceBackedCount,
  canRun,
  gate,
  hasEverRun,
  polling,
  pending,
  runStatus,
  snapshotReadState,
  statusPollError,
  statusPollRetrying,
  notice,
  onRun,
  onRetryStatus,
}: RunHeaderProps) {
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");
  const tRun = useTranslations("runState");
  const tNav = useTranslations("nav");
  const buttonLabel = polling
    ? t("runInProgress")
    : hasEverRun
      ? t("rerunDiagnosis")
      : t("runDiagnosis");
  const noteId = "sf-diagnosis-run-note";
  const gateText =
    gate === "context"
      ? t("needsContext")
      : gate === "crawl"
        ? t("needsCrawl")
        : null;
  const snapshotReadText =
    snapshotReadState === "loading"
      ? `${tNav("sources")}: ${tCommon("loading")}`
      : snapshotReadState === "error"
        ? `${tNav("sources")}: ${tCommon("error")}`
        : null;
  const runNote = gateText ?? snapshotReadText;
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <div className={styles.heroMeta}>
          <span className={styles.heroEyebrow}>{t("title")}</span>
          {runStatus !== null ? (
            <span className={styles.runStatusRow}>
              <span className={styles.runStatusLabel}>{t("lastRun")}</span>
              <StatusPill tone={runStatusTone(runStatus)}>
                {tRun(runStatus)}
              </StatusPill>
            </span>
          ) : null}
        </div>
        <h1 className={styles.title} data-app-page-title="">
          {t("heroTitle")}
        </h1>
        <p className={styles.subtitle}>
          {t("subtitle", { client: clientName, count: findingCount })}
        </p>
      </div>
      <div className={styles.heroAside}>
        <dl className={styles.metricGroup} aria-label={t("metrics.label")}>
          <div>
            <dt>{t("metrics.completeDomains")}</dt>
            <dd>
              {completeDomainCount ?? (
                <span className={styles.metricUnavailable}>
                  {t(
                    hasEverRun
                      ? "metrics.coverageUnavailable"
                      : "metrics.coverageNotRun",
                  )}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("metrics.loadedFindings")}</dt>
            <dd>{findingCount}</dd>
          </div>
          <div>
            <dt>{t("metrics.evidenceBacked")}</dt>
            <dd>{evidenceBackedCount}</dd>
          </div>
        </dl>
        <div className={styles.runControl}>
          <Button
            variant="primary"
            onClick={onRun}
            disabled={!canRun}
            aria-describedby={runNote ? noteId : undefined}
          >
            {(polling || pending) && (
              <Spinner
                size="sm"
                label={t("runInProgress")}
                className={styles.btnSpinner}
              />
            )}
            {buttonLabel}
          </Button>
          {runNote ? (
            <p id={noteId} className={styles.runNote}>
              {snapshotReadState === "loading" && gateText === null ? (
                <Spinner
                  size="sm"
                  label={snapshotReadText ?? tCommon("loading")}
                  className={styles.btnSpinner}
                />
              ) : null}
              {runNote}
              {gate === "context" ? (
                <>
                  {" "}
                  <Link
                    href={`/p/${projectId}/context`}
                    className={styles.runNoteLink}
                  >
                    {tNav("context")}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {notice ? (
            <p
              className={cx(
                styles.notice,
                notice.kind === "error"
                  ? styles.noticeError
                  : styles.noticeInfo,
              )}
              role="status"
            >
              {notice.text}
            </p>
          ) : null}
          {statusPollError ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRetryStatus}
              disabled={statusPollRetrying}
            >
              {statusPollRetrying ? (
                <Spinner
                  size="sm"
                  label={tCommon("loading")}
                  className={styles.btnSpinner}
                />
              ) : null}
              {tCommon("retry")}
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------- Coverage + rail --- */

function CoverageMark({ status }: { readonly status: string | undefined }) {
  if (status === "complete") {
    return <Check aria-hidden="true" size={15} strokeWidth={2.2} />;
  }
  if (status === undefined || status === "missing") {
    return <CircleDashed aria-hidden="true" size={15} strokeWidth={1.8} />;
  }
  return <AlertTriangle aria-hidden="true" size={15} strokeWidth={1.8} />;
}

function CoverageBand({
  coverage,
  rules,
  hasEverRun,
}: {
  readonly coverage: Coverage | null;
  readonly rules: readonly DiagnosticRuleResult[];
  readonly hasEverRun: boolean;
}) {
  const t = useTranslations("diagnosis");
  const tCoverage = useTranslations("coverage");
  const tDomain = useTranslations("domain");
  const presentationState = resolveCoveragePresentationState(
    coverage,
    hasEverRun,
  );
  return (
    <section
      className={styles.coverageBand}
      aria-labelledby="sf-coverage-band-title"
      data-coverage-band=""
      data-coverage-availability={presentationState}
      tabIndex={0}
    >
      <h2 id="sf-coverage-band-title" className={styles.visuallyHidden}>
        {t("coverageBand.label")}
      </h2>
      {coverage === null ? (
        <div className={styles.coverageUnavailable} role="status">
          <span className={styles.coverageUnavailableIcon} aria-hidden="true">
            <CircleDashed size={19} strokeWidth={1.8} />
          </span>
          <div>
            <strong>
              {t(
                presentationState === "not-run"
                  ? "coverageBand.notRunTitle"
                  : "coverageBand.unavailableTitle",
              )}
            </strong>
            <p>
              {t(
                presentationState === "not-run"
                  ? "coverageBand.notRunDescription"
                  : "coverageBand.unavailableDescription",
              )}
            </p>
          </div>
        </div>
      ) : (
        <ul>
          {DOMAIN_KEYS.map((domain) => {
            const status = coverage.domains[domain];
            const meta = domainCoverageMeta(status);
            const ruleCount = rules.filter(
              (rule) => rule.domain === domain,
            ).length;
            return (
              <li key={domain} data-coverage-state={status ?? "missing"}>
                <div className={styles.coverageCellMeta}>
                  <span data-tone={meta.tone}>
                    <CoverageMark status={status} />
                    {tCoverage(meta.labelKey)}
                  </span>
                  <strong>{ruleCount}</strong>
                </div>
                <span className={styles.coverageDomain}>{tDomain(domain)}</span>
                <span
                  className={styles.coverageStateBar}
                  data-coverage-state-bar=""
                  aria-hidden="true"
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RailRuleRow({ rule }: { readonly rule: DiagnosticRuleResult }) {
  const t = useTranslations("diagnosis");
  const tRule = useTranslations("ruleTitle");
  const detail =
    rule.reason ??
    (rule.status === "pass"
      ? t("rulePassHint")
      : rule.status === "skipped"
        ? t("ruleNotRunHint")
        : null);
  return (
    <li className={styles.railRuleRow} data-rule-status={rule.status}>
      <div className={styles.ruleMain}>
        <span className={styles.ruleTitle}>{tRule(rule.ruleId)}</span>
        {detail ? <span className={styles.ruleReason}>{detail}</span> : null}
      </div>
      <span className={styles.railRuleStatus}>
        {t(`ruleStatus.${rule.status}`)}
      </span>
    </li>
  );
}

function AuditRail({
  coverage,
  rules,
  hasEverRun,
}: {
  readonly coverage: Coverage | null;
  readonly rules: readonly DiagnosticRuleResult[];
  readonly hasEverRun: boolean;
}) {
  const t = useTranslations("diagnosis");
  const tDomain = useTranslations("domain");
  const presentationState = resolveCoveragePresentationState(
    coverage,
    hasEverRun,
  );
  const limitations = [...new Set(coverage?.limitations ?? [])];
  const completeDomains = DOMAIN_KEYS.filter(
    (domain) => coverage?.domains[domain] === "complete",
  ).length;
  return (
    <aside
      className={styles.auditRail}
      aria-labelledby="sf-audit-rail-title"
      data-audit-rail=""
      data-coverage-availability={presentationState}
    >
      <div className={styles.auditRailHeader}>
        <span className={styles.auditIcon} aria-hidden="true">
          <ShieldCheck size={21} strokeWidth={1.8} />
        </span>
        <div>
          <p>{t("auditRail.eyebrow")}</p>
          <h2 id="sf-audit-rail-title">{t("auditRail.title")}</h2>
        </div>
      </div>
      <p className={styles.auditRailDescription}>
        {t("auditRail.description")}
      </p>

      {coverage === null ? (
        <div className={styles.auditUnavailable} role="status">
          <strong>
            {t(
              presentationState === "not-run"
                ? "auditRail.notRunTitle"
                : "auditRail.unavailableTitle",
            )}
          </strong>
          <p>
            {t(
              presentationState === "not-run"
                ? "auditRail.notRunDescription"
                : "auditRail.unavailableDescription",
            )}
          </p>
        </div>
      ) : (
        <div className={styles.auditMeter}>
          <div>
            <strong>{`${completeDomains}/${DOMAIN_KEYS.length}`}</strong>
            <span>
              {t("auditRail.completeDomains", {
                complete: completeDomains,
                total: DOMAIN_KEYS.length,
              })}
            </span>
          </div>
          <div className={styles.auditDomainTrack} aria-hidden="true">
            {DOMAIN_KEYS.map((domain) => (
              <span
                key={domain}
                data-audit-domain-segment=""
                data-coverage-state={coverage.domains[domain] ?? "missing"}
              />
            ))}
          </div>
        </div>
      )}

      {coverage !== null && limitations.length > 0 ? (
        <section className={styles.auditSection}>
          <LimitationHint
            label={t("auditRail.limitations")}
            limitations={limitations}
          />
        </section>
      ) : null}

      <section className={styles.auditSection}>
        <h3>{t("auditRail.ruleOutcomes")}</h3>
        {rules.length === 0 ? (
          <p className={styles.railEmpty}>{t("ruleBoardEmpty")}</p>
        ) : (
          <div className={styles.domainGroups}>
            {DOMAIN_KEYS.map((domain) => {
              const domainRules = rules.filter((rule) => rule.domain === domain);
              if (domainRules.length === 0) return null;
              return (
                <section key={domain} className={styles.domainGroup}>
                  <h4 className={styles.domainGroupTitle}>{tDomain(domain)}</h4>
                  <ul className={styles.ruleList}>
                    {domainRules.map((rule) => (
                      <RailRuleRow key={rule.ruleId} rule={rule} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}

/* --------------------------------------------------------- Findings list --- */

function FindingsSection({
  projectId,
  findings,
  hasEverRun,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  onRefetch,
}: {
  readonly projectId: string;
  readonly findings: readonly Finding[];
  readonly hasEverRun: boolean;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadMoreError: boolean;
  readonly onLoadMore: () => void;
  readonly onRefetch: () => void;
}) {
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");
  const tDomain = useTranslations("domain");
  const tSeverity = useTranslations("priorityBand");
  const [domain, setDomain] = useState<FindingFilters["domain"]>("all");
  const [severity, setSeverity] =
    useState<FindingFilters["severity"]>("all");
  const filtered = filterCanonicalFindings(findings, { domain, severity });
  const filtersActive = domain !== "all" || severity !== "all";

  function clearFilters(): void {
    setDomain("all");
    setSeverity("all");
  }

  return (
    <section
      className={styles.findingsSection}
      aria-labelledby="sf-findings-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-findings-title" className={styles.panelTitle}>
          {t("findings")}
        </h2>
        {findings.length > 0 ? (
          <span className={styles.filterCount} aria-live="polite">
            {hasMore
              ? t("filters.resultsPartial", {
                  shown: filtered.length,
                  total: findings.length,
                })
              : t("filters.results", {
                  shown: filtered.length,
                  total: findings.length,
                })}
          </span>
        ) : null}
      </div>
      {findings.length > 0 ? (
        <Panel
          padding="md"
          className={styles.filterPanel}
          aria-labelledby="sf-finding-filters-title"
        >
          <h3 id="sf-finding-filters-title" className={styles.filterTitle}>
            {t("filters.title")}
          </h3>
          <div className={styles.filterControls}>
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>{t("filters.domain")}</span>
              <select
                className={styles.filterSelect}
                value={domain}
                onChange={(event) =>
                  setDomain(event.target.value as DiagnosticDomain | "all")
                }
              >
                <option value="all">{t("filters.allDomains")}</option>
                {DOMAIN_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {tDomain(key)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>
                {t("filters.severity")}
              </span>
              <select
                className={styles.filterSelect}
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value as Severity | "all")
                }
              >
                <option value="all">{t("filters.allSeverities")}</option>
                {SEVERITY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {tSeverity(key)}
                  </option>
                ))}
              </select>
            </label>
            {filtersActive ? (
              <Button
                size="sm"
                variant="ghost"
                className={styles.filterClear}
                onClick={clearFilters}
              >
                {t("filters.clear")}
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}
      {findings.length === 0 ? (
        <Panel padding="lg">
          <EmptyState
            title={
              hasMore
                ? t("moreFindingsHint")
                : hasEverRun
                  ? t("noFindings")
                  : t("notDiagnosed")
            }
            description={
              hasMore
                ? undefined
                : hasEverRun
                  ? t("noFindingsHint")
                  : t("notDiagnosedHint")
            }
          />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel padding="lg">
          <EmptyState
            title={hasMore ? t("filters.emptyPartial") : t("filters.empty")}
          >
            <Button variant="secondary" onClick={clearFilters}>
              {t("filters.clear")}
            </Button>
          </EmptyState>
        </Panel>
      ) : (
        <div className={styles.findingList} data-finding-list="">
          {filtered.map((finding) => (
            <FindingCard
              key={finding.id}
              projectId={projectId}
              finding={finding}
              index={findings.indexOf(finding)}
              onRefetch={onRefetch}
            />
          ))}
        </div>
      )}
      {hasMore || loadMoreError ? (
        <div className={styles.pagination}>
          {loadMoreError ? (
            <p className={styles.paginationError} role="alert">
              {tCommon("loadMoreError")}
            </p>
          ) : null}
          <Button
            variant="secondary"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? tCommon("loadingMore")
              : loadMoreError
                ? tCommon("retry")
                : tCommon("loadMore")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------- Container --- */

export function DiagnosisClient({ projectId }: { readonly projectId: string }) {
  const workbenchLocale = useLocale();
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");

  const project = useProject(projectId);
  const findings = useProjectFindings(projectId);
  const snapshots = useProjectSnapshots(projectId);
  const createRun = useCreateDiagnosticRun(projectId);
  const findingEnvelope = mergeFindingPages(findings.data);

  const { refetch: refetchFindings } = findings;
  const { refetch: refetchProject } = project;
  const { refetch: refetchSnapshots } = snapshots;

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    readonly kind: "error" | "info";
    readonly text: string;
  } | null>(null);
  const handledRun = useRef<string | null>(null);

  const meta = findingEnvelope?.meta;
  const latestRun = meta?.latestRun ?? null;
  const runQuery = useProjectRun(projectId, activeRunId);

  // Resume polling if the findings meta reveals an in-flight run on load.
  const inflightRunId =
    latestRun !== null && !isRunTerminal(latestRun.status)
      ? latestRun.id
      : null;
  useEffect(() => {
    // Do NOT re-resume a run we already drove to terminal: after completion the
    // terminal effect clears activeRunId while findings.meta.latestRun is still
    // its stale non-terminal snapshot, which would otherwise restart polling and
    // wedge the screen "in progress" forever.
    if (
      inflightRunId !== null &&
      activeRunId === null &&
      inflightRunId !== handledRun.current
    ) {
      setActiveRunId(inflightRunId);
    }
  }, [inflightRunId, activeRunId]);

  // When the polled run reaches a terminal state, refetch findings exactly once.
  const polledStatus = runQuery.data?.status;
  const polledId = runQuery.data?.id;
  useEffect(() => {
    if (polledId === undefined || polledStatus === undefined) return;
    if (!isRunTerminal(polledStatus)) return;
    if (handledRun.current === polledId) return;
    handledRun.current = polledId;
    setActiveRunId(null);
    void refetchFindings();
    if (polledStatus === "failed") {
      setNotice({ kind: "error", text: t("runError") });
    }
  }, [polledId, polledStatus, refetchFindings, t]);

  // A failed status read does not prove the run stopped. Keep the active-run
  // fence in place and let the operator retry the status read explicitly.
  useEffect(() => {
    if (activeRunId !== null && runQuery.isError) {
      setNotice({ kind: "error", text: t("statusReadError") });
    }
  }, [activeRunId, runQuery.isError, t]);

  async function onRetryStatus(): Promise<void> {
    const result = await runQuery.refetch();
    if (result.data !== undefined && result.data.status !== "failed") {
      setNotice(null);
    }
  }

  function runErrorText(err: unknown): string {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "CRAWL_SNAPSHOT_REQUIRED":
          return t("needsCrawl");
        case "CONTEXT_INCOMPLETE":
          return t("needsContext");
        case "RUN_ALREADY_ACTIVE":
          return t("runActive");
        default:
          return tCommon("error");
      }
    }
    return tCommon("error");
  }

  async function onRun(): Promise<void> {
    const snaps = snapshots.data;
    const proj = project.data;
    if (
      snapshots.isError ||
      snapshots.isFetching ||
      snaps === undefined ||
      proj == null
    ) {
      return;
    }
    setNotice(null);
    try {
      const accepted = await createRun.mutateAsync({
        snapshotIds: selectLatestSnapshotIds(snaps),
        // Diagnostic summaries and limitations are workbench decisions, not
        // English market deliverables. Blog/Artifact locale is selected later
        // in Execution and must not leak into the audit reading language.
        outputLocale: workbenchLocale,
      });
      handledRun.current = null;
      setActiveRunId(accepted.run.id);
    } catch (err) {
      setNotice({ kind: "error", text: runErrorText(err) });
    }
  }

  // Project and findings own the visible Diagnosis read model. The complete
  // snapshot cursor chain is only a run precondition, so it must not hold the
  // already-available diagnosis body behind a whole-screen spinner.
  if (findings.isLoading || project.isLoading) {
    return (
      <div className={styles.state}>
        <Spinner size="lg" label={tCommon("loading")} />
        <p className={styles.stateText}>{tCommon("loading")}</p>
      </div>
    );
  }

  if (
    (findings.isError && findingEnvelope === undefined) ||
    project.error !== null ||
    findingEnvelope === undefined ||
    project.data === undefined
  ) {
    const screenError = findings.error ?? project.error ?? new Error("unknown");
    return (
      <div className={styles.state}>
        <ProblemState
          error={screenError}
          onRetry={() =>
            void Promise.all([
              refetchFindings(),
              refetchProject(),
              refetchSnapshots(),
            ])
          }
        />
      </div>
    );
  }

  const findingMeta = findingEnvelope.meta;
  const coverage = findingMeta.coverage;
  const ruleResults = findingMeta.ruleResults;
  const hasEverRun = latestRun !== null;

  const contextComplete =
    project.data.confirmedIcpProfileVersion !== null &&
    project.data.confirmedIcpProfileVersion !== undefined;
  // A failed snapshot read is never treated as a known-empty list. Keeping it
  // distinct from `ready` prevents both a false "needs crawl" message and a
  // diagnostic run based on an incomplete/unknown input manifest.
  const snapshotReadState: SnapshotReadState = snapshots.isError
    ? "error"
    : snapshots.data === undefined || snapshots.isFetching
      ? "loading"
      : "ready";
  const crawlReady =
    snapshotReadState === "ready" && hasCrawlSnapshot(snapshots.data ?? []);
  const polling = activeRunId !== null;
  const gate: RunGate = !contextComplete
    ? "context"
    : snapshotReadState === "ready" && !crawlReady
      ? "crawl"
      : null;
  const canRun = Boolean(
    contextComplete &&
    snapshotReadState === "ready" &&
    crawlReady &&
    !polling &&
    !createRun.isPending,
  );
  const headerRunStatus: RunStatus | null = polling
    ? (runQuery.data?.status ?? latestRun?.status ?? "queued")
    : (latestRun?.status ?? null);
  const completeDomainCount =
    coverage === null
      ? null
      : DOMAIN_KEYS.filter(
          (domain) => coverage.domains[domain] === "complete",
        ).length;
  const evidenceBackedCount = findingEnvelope.data.filter(
    (finding) => finding.evidence.length > 0,
  ).length;

  return (
    <div className={styles.page}>
      <RunHeader
        projectId={projectId}
        clientName={project.data.clientName}
        findingCount={findingEnvelope.data.length}
        completeDomainCount={completeDomainCount}
        evidenceBackedCount={evidenceBackedCount}
        canRun={canRun}
        gate={gate}
        hasEverRun={hasEverRun}
        polling={polling}
        pending={createRun.isPending}
        runStatus={headerRunStatus}
        snapshotReadState={snapshotReadState}
        statusPollError={polling && runQuery.isError}
        statusPollRetrying={runQuery.isFetching}
        notice={notice}
        onRun={() => void onRun()}
        onRetryStatus={() => void onRetryStatus()}
      />
      {snapshotReadState === "error" ? (
        <ProblemState
          error={snapshots.error ?? new Error("unknown")}
          onRetry={() => void refetchSnapshots()}
        />
      ) : null}
      <CoverageBand
        coverage={coverage}
        rules={ruleResults}
        hasEverRun={hasEverRun}
      />
      <div className={styles.workspaceGrid} data-diagnosis-layout="">
        <FindingsSection
          projectId={projectId}
          findings={findingEnvelope.data}
          hasEverRun={hasEverRun}
          hasMore={findings.hasNextPage}
          loadingMore={findings.isFetchingNextPage}
          loadMoreError={findings.isFetchNextPageError}
          onLoadMore={() => void findings.fetchNextPage()}
          onRefetch={() => void refetchFindings()}
        />
        <AuditRail
          coverage={coverage}
          rules={ruleResults}
          hasEverRun={hasEverRun}
        />
      </div>
    </div>
  );
}
