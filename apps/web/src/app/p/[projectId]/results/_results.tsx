"use client";

/**
 * Canonical Results screen (R3 blueprint D1/D2): screen header, the read-only
 * recheck comparison block, then the client report block with its export rail.
 * The two data blocks are independent query boundaries — a recheck 404 never
 * swallows the report and a report failure never swallows the recheck. The
 * recheck block reports the technical rule condition only ("Technical
 * condition verified") and never claims traffic, rank, revenue, or AI-citation
 * movement. The screen header and recheck block are screen chrome: `@media
 * print` keeps only the report document (D6).
 */

import { useTranslations } from "next-intl";
import {
  Badge,
  EmptyState,
  LimitationHint,
  Panel,
  Spinner,
  StatusPill,
  cx,
  type StatusTone,
} from "@/components/ui";
import {
  useProjectResults,
  type ActionRecheckAccepted,
} from "@/lib/api/hooks-results";
import type {
  ActionRecheckResultsResponse,
  ActionRecheckRuleComparison,
  RecheckComparisonState,
} from "@sf/contracts";
import { MeasurementResultsSection } from "./_measurement-results.tsx";
import { ReportSection } from "./_report-section.tsx";
import styles from "./results.module.css";

const STATE_TONE: Readonly<Record<RecheckComparisonState, StatusTone>> = {
  verified: "success",
  observed: "warning",
  insufficient_data: "neutral",
};

// Keep the accepted-run type referenced so the recheck mutation contract stays
// co-located with the surface that consumes it.
export type { ActionRecheckAccepted };

function ObservedWindow({
  results,
}: {
  readonly results: ActionRecheckResultsResponse;
}) {
  const t = useTranslations("results");
  return (
    <dl className={styles.window}>
      <div>
        <dt>{t("priorLabel")}</dt>
        <dd>
          {/* Runtime provenance stays readable on screen; the semantic <time>
              plus the testid give the visual baseline two mask anchors (D7). */}
          <time
            dateTime={results.priorObservedAt}
            data-testid="results-dynamic-value"
          >
            {results.priorObservedAt}
          </time>
        </dd>
      </div>
      <div>
        <dt>{t("currentLabel")}</dt>
        <dd>
          <time
            dateTime={results.currentObservedAt}
            data-testid="results-dynamic-value"
          >
            {results.currentObservedAt}
          </time>
        </dd>
      </div>
    </dl>
  );
}

function RuleComparisonRow({
  rule,
}: {
  readonly rule: ActionRecheckRuleComparison;
}) {
  const t = useTranslations("results");
  return (
    <li className={styles.rule}>
      <div className={styles.ruleHead}>
        <span className={styles.ruleId}>{rule.ruleId}</span>
        <StatusPill tone={STATE_TONE[rule.state]}>{rule.label}</StatusPill>
      </div>
      <div className={styles.ruleTransition}>
        <Badge>{t(`ruleStatus.${rule.priorStatus}`)}</Badge>
        <span aria-hidden="true">→</span>
        <Badge>{t(`ruleStatus.${rule.currentStatus}`)}</Badge>
      </div>
      <details className={styles.ruleDetail}>
        <summary>{t("detailLabel")}</summary>
        <dl>
          <div>
            <dt>{t("dispositionLabel")}</dt>
            <dd>{t(`disposition.${rule.disposition}`)}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

function ResultsComparison({
  results,
}: {
  readonly results: ActionRecheckResultsResponse;
}) {
  const t = useTranslations("results");
  return (
    <div className={styles.comparison}>
      <ObservedWindow results={results} />
      {results.rules.length === 0 ? (
        <EmptyState title={t("noRulesTitle")} description={t("noRulesBody")} />
      ) : (
        <ul className={styles.rules}>
          {results.rules.map((rule) => (
            <RuleComparisonRow key={rule.ruleId} rule={rule} />
          ))}
        </ul>
      )}
      {results.limitations.length > 0 && (
        <div className={styles.limitations}>
          <LimitationHint
            label={t("limitationsTitle")}
            limitations={results.limitations}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The recheck block: sole owner of the `useProjectResults` query. Loading,
 * error (the honest empty state), and ready are handled entirely inside this
 * block (D2). `data-results-recheck-settled` marks the two terminal UIs so the
 * visual harness can wait for a settled block instead of a spinner (D7).
 */
function RecheckResultsSection({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("results");
  const query = useProjectResults(projectId);

  return (
    <Panel
      aria-label={t("title")}
      className={cx(styles.recheckPanel, styles.screenOnly)}
      data-results-recheck-settled={query.isPending ? undefined : ""}
    >
      <h2 className={styles.recheckHeading}>{t("title")}</h2>
      <p className={styles.recheckLead}>{t("lead")}</p>
      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ResultsComparison results={query.data} />
      )}
    </Panel>
  );
}

/**
 * Results screen client entry: screen h1, recheck comparison, client report.
 */
export function ResultsClient({
  projectId,
  initialOutputLocale,
}: {
  readonly projectId: string;
  readonly initialOutputLocale?: string | undefined;
}) {
  const t = useTranslations("results");
  return (
    <div className={styles.page} data-results-page="">
      <header className={cx(styles.hero, styles.screenOnly)}>
        <h1 className={styles.heroTitle} data-app-page-title="">
          {t("pageTitle")}
        </h1>
        <p className={styles.heroLead}>{t("pageLead")}</p>
      </header>
      <MeasurementResultsSection projectId={projectId} />
      <RecheckResultsSection projectId={projectId} />
      <ReportSection
        projectId={projectId}
        initialOutputLocale={initialOutputLocale}
      />
    </div>
  );
}
