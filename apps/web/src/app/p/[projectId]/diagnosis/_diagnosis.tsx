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
import { useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
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
  selectLatestSnapshotIds,
  useCreateDiagnosticRun,
  useProjectFindings,
  useProjectRun,
  useProjectSnapshots,
  type DiagnosticRuleResult,
  type Finding,
  type RuleStatus,
  type RunStatus,
} from "@/lib/api/hooks-diagnosis";
import { FindingCard } from "./_finding-card.tsx";
import styles from "./diagnosis.module.css";

/** The five diagnosis domains, in the spec's canonical order (spec §4.2). */
const DOMAIN_KEYS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;

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

/** Overall coverage → pill tone + label (unavailable is the honest default). */
function coverageOverallMeta(overall: Coverage["overall"]): ToneLabel {
  switch (overall) {
    case "complete":
      return { tone: "success", labelKey: "ready" };
    case "partial":
      return { tone: "warning", labelKey: "partial" };
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

/** Rule-board status → pill tone. Each status is deliberately its own tone so a
 * `pass` (healthy) never looks like a `skipped`/`inconclusive` rule. */
function ruleStatusTone(status: RuleStatus): StatusTone {
  switch (status) {
    case "pass":
      return "success";
    case "candidate":
      return "priority";
    case "inconclusive":
      return "warning";
    default:
      return "neutral";
  }
}

/* ------------------------------------------------------------ Run header --- */

/** Which hard gate (if any) is blocking a run — drives the disabled explanation. */
type RunGate = "context" | "crawl" | null;

interface RunHeaderProps {
  readonly projectId: string;
  readonly canRun: boolean;
  readonly gate: RunGate;
  readonly hasEverRun: boolean;
  readonly polling: boolean;
  readonly pending: boolean;
  readonly runStatus: RunStatus | null;
  readonly notice: {
    readonly kind: "error" | "info";
    readonly text: string;
  } | null;
  readonly onRun: () => void;
}

function RunHeader({
  projectId,
  canRun,
  gate,
  hasEverRun,
  polling,
  pending,
  runStatus,
  notice,
  onRun,
}: RunHeaderProps) {
  const t = useTranslations("diagnosis");
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
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.subtitle}>{t("subtitle")}</p>
      </div>
      <div className={styles.runControl}>
        <Button
          variant="primary"
          onClick={onRun}
          disabled={!canRun}
          aria-describedby={gateText ? noteId : undefined}
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
        {runStatus !== null ? (
          <span className={styles.runStatusRow}>
            <span className={styles.runStatusLabel}>{t("lastRun")}</span>
            <StatusPill tone={runStatusTone(runStatus)}>
              {tRun(runStatus)}
            </StatusPill>
          </span>
        ) : null}
        {gateText ? (
          <p id={noteId} className={styles.runNote}>
            {gateText}
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
              notice.kind === "error" ? styles.noticeError : styles.noticeInfo,
            )}
            role="status"
          >
            {notice.text}
          </p>
        ) : null}
      </div>
    </header>
  );
}

/* --------------------------------------------------------- Coverage panel -- */

function CoveragePanel({ coverage }: { readonly coverage: Coverage }) {
  const t = useTranslations("diagnosis");
  const tCoverage = useTranslations("coverage");
  const tDomain = useTranslations("domain");
  const overall = coverageOverallMeta(coverage.overall);
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-coverage-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-coverage-title" className={styles.panelTitle}>
          {t("coverageTitle")}
        </h2>
        <StatusPill tone={overall.tone}>
          {tCoverage(overall.labelKey)}
        </StatusPill>
      </div>
      <ul className={styles.domainList}>
        {DOMAIN_KEYS.map((key) => {
          const meta = domainCoverageMeta(coverage.domains[key]);
          return (
            <li key={key} className={styles.domainRow}>
              <span className={styles.domainName}>{tDomain(key)}</span>
              <StatusPill tone={meta.tone}>
                {tCoverage(meta.labelKey)}
              </StatusPill>
            </li>
          );
        })}
      </ul>
      {coverage.limitations.length > 0 ? (
        <ul className={styles.limitationList}>
          {coverage.limitations.map((text, index) => (
            <li key={`${index}:${text}`} className={styles.limitationItem}>
              {text}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------- Rule board -- */

function RuleRow({ rule }: { readonly rule: DiagnosticRuleResult }) {
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
    <li className={styles.ruleRow}>
      <div className={styles.ruleMain}>
        <span className={styles.ruleTitle}>{tRule(rule.ruleId)}</span>
        {detail ? <span className={styles.ruleReason}>{detail}</span> : null}
      </div>
      <StatusPill tone={ruleStatusTone(rule.status)}>
        {t(`ruleStatus.${rule.status}`)}
      </StatusPill>
    </li>
  );
}

function RuleBoard({
  rules,
}: {
  readonly rules: readonly DiagnosticRuleResult[];
}) {
  const t = useTranslations("diagnosis");
  const tDomain = useTranslations("domain");
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-ruleboard-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-ruleboard-title" className={styles.panelTitle}>
          {t("ruleBoard")}
        </h2>
      </div>
      {rules.length === 0 ? (
        <p className={styles.boardEmpty}>{t("ruleBoardEmpty")}</p>
      ) : (
        <div className={styles.domainGroups}>
          {DOMAIN_KEYS.map((domain) => {
            const domainRules = rules.filter((rule) => rule.domain === domain);
            if (domainRules.length === 0) return null;
            return (
              <section key={domain} className={styles.domainGroup}>
                <h3 className={styles.domainGroupTitle}>{tDomain(domain)}</h3>
                <ul className={styles.ruleList}>
                  {domainRules.map((rule) => (
                    <RuleRow key={rule.ruleId} rule={rule} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------- Findings list --- */

function FindingsSection({
  projectId,
  findings,
  hasEverRun,
  onRefetch,
}: {
  readonly projectId: string;
  readonly findings: readonly Finding[];
  readonly hasEverRun: boolean;
  readonly onRefetch: () => void;
}) {
  const t = useTranslations("diagnosis");
  return (
    <section
      className={styles.findingsSection}
      aria-labelledby="sf-findings-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-findings-title" className={styles.panelTitle}>
          {t("findings")}
        </h2>
      </div>
      {findings.length === 0 ? (
        <Panel padding="lg">
          <EmptyState
            title={hasEverRun ? t("noFindings") : t("notDiagnosed")}
            description={
              hasEverRun ? t("noFindingsHint") : t("notDiagnosedHint")
            }
          />
        </Panel>
      ) : (
        <div className={styles.findingList}>
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              projectId={projectId}
              finding={finding}
              onRefetch={onRefetch}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- Container --- */

export function DiagnosisClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");

  const project = useProject(projectId);
  const findings = useProjectFindings(projectId);
  const snapshots = useProjectSnapshots(projectId);
  const createRun = useCreateDiagnosticRun(projectId);

  const { refetch: refetchFindings } = findings;

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    readonly kind: "error" | "info";
    readonly text: string;
  } | null>(null);
  const handledRun = useRef<string | null>(null);

  const meta = findings.data?.meta;
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

  // If the status poll itself errors (network/404/5xx), don't hang "in progress":
  // clear the active run so the button re-enables and surface the error.
  useEffect(() => {
    if (activeRunId !== null && runQuery.isError) {
      handledRun.current = activeRunId;
      setActiveRunId(null);
      setNotice({ kind: "error", text: t("runError") });
    }
  }, [activeRunId, runQuery.isError, t]);

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
          return err.message;
      }
    }
    return tCommon("error");
  }

  async function onRun(): Promise<void> {
    const snaps = snapshots.data;
    const proj = project.data;
    if (snaps === undefined || proj == null) return;
    setNotice(null);
    try {
      const accepted = await createRun.mutateAsync({
        snapshotIds: selectLatestSnapshotIds(snaps),
        outputLocale: proj.defaultDeliveryLocale,
      });
      handledRun.current = null;
      setActiveRunId(accepted.run.id);
    } catch (err) {
      setNotice({ kind: "error", text: runErrorText(err) });
    }
  }

  // Whole-screen loading / error mirror the overview conventions.
  if (findings.isLoading || project.isLoading) {
    return (
      <div className={styles.state}>
        <Spinner size="lg" label={tCommon("loading")} />
        <p className={styles.stateText}>{tCommon("loading")}</p>
      </div>
    );
  }

  if (findings.error !== null || findings.data === undefined) {
    return (
      <div className={styles.state}>
        <EmptyState title={tCommon("error")}>
          <Button variant="secondary" onClick={() => void refetchFindings()}>
            {tCommon("retry")}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const findingMeta = findings.data.meta;
  const coverage = findingMeta.coverage;
  const ruleResults = findingMeta.ruleResults;
  const hasEverRun = latestRun !== null;

  const snapshotsLoaded = snapshots.data !== undefined;
  const contextComplete = project.data?.contextStatus === "complete";
  const crawlReady = snapshotsLoaded && hasCrawlSnapshot(snapshots.data ?? []);
  const polling = activeRunId !== null;
  const gate: RunGate = !contextComplete
    ? "context"
    : snapshotsLoaded && !crawlReady
      ? "crawl"
      : null;
  const canRun = Boolean(
    contextComplete &&
    crawlReady &&
    snapshotsLoaded &&
    !polling &&
    !createRun.isPending,
  );
  const headerRunStatus: RunStatus | null = polling
    ? (runQuery.data?.status ?? latestRun?.status ?? "queued")
    : (latestRun?.status ?? null);

  return (
    <div className={styles.page}>
      <RunHeader
        projectId={projectId}
        canRun={canRun}
        gate={gate}
        hasEverRun={hasEverRun}
        polling={polling}
        pending={createRun.isPending}
        runStatus={headerRunStatus}
        notice={notice}
        onRun={() => void onRun()}
      />
      {coverage !== null ? <CoveragePanel coverage={coverage} /> : null}
      <RuleBoard rules={ruleResults} />
      <FindingsSection
        projectId={projectId}
        findings={findings.data.data}
        hasEverRun={hasEverRun}
        onRefetch={() => void refetchFindings()}
      />
    </div>
  );
}
