"use client";

/**
 * Recheck Results view (Slice 1, Task 8). A read-only comparison of two
 * immutable runs for one confirmed Action: the prior run and the fresh recheck.
 * It reports the technical rule condition only ("Technical condition verified")
 * and never claims traffic, rank, revenue, or AI-citation movement. The prior
 * run is untouched; the honest empty state is shown when no recheck has run.
 */

import { useTranslations } from "next-intl";
import {
  Badge,
  EmptyState,
  Panel,
  Spinner,
  StatusPill,
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
    <dl className="sf-results__window">
      <div>
        <dt>{t("priorLabel")}</dt>
        <dd>{results.priorObservedAt}</dd>
      </div>
      <div>
        <dt>{t("currentLabel")}</dt>
        <dd>{results.currentObservedAt}</dd>
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
    <li className="sf-results__rule">
      <div className="sf-results__rule-head">
        <span className="sf-results__rule-id">{rule.ruleId}</span>
        <StatusPill tone={STATE_TONE[rule.state]}>{rule.label}</StatusPill>
      </div>
      <div className="sf-results__rule-transition">
        <Badge>{t(`ruleStatus.${rule.priorStatus}`)}</Badge>
        <span aria-hidden="true">→</span>
        <Badge>{t(`ruleStatus.${rule.currentStatus}`)}</Badge>
      </div>
      <details className="sf-results__rule-detail">
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
    <div className="sf-results__comparison">
      <ObservedWindow results={results} />
      {results.rules.length === 0 ? (
        <EmptyState title={t("noRulesTitle")} description={t("noRulesBody")} />
      ) : (
        <ul className="sf-results__rules">
          {results.rules.map((rule) => (
            <RuleComparisonRow key={rule.ruleId} rule={rule} />
          ))}
        </ul>
      )}
      {results.limitations.length > 0 && (
        <section className="sf-results__limitations">
          <h3>{t("limitationsTitle")}</h3>
          <ul>
            {results.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Read-only prior-vs-new recheck comparison for the canonical Results screen. */
export function ResultsClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("results");
  const query = useProjectResults(projectId);

  return (
    <div className="sf-results">
      <Panel aria-label={t("title")} className="sf-results__panel">
        <h2 className="sf-results__heading">{t("title")}</h2>
        <p className="sf-results__lead">{t("lead")}</p>
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <ResultsComparison results={query.data} />
        )}
      </Panel>
    </div>
  );
}
