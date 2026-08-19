// @input  -- one authenticated Agent run plus its confirmed local Product/ICP Profile
// @output -- captured-evidence boundary and controlled Stage 02 -> 03 -> 04 workflow
// @pos    -- shared renderer whose state and defaults remain independent per Agent page

"use client";

import { FileSearch, Link2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { allAgentAuditRecords } from "../../lib/agents/audit-contract";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import {
  buildAgentAuditViewModel,
  type AgentAuditScope,
  type AgentDiagnosisContext,
} from "./agent-audit-model";
import { AgentDiagnosis } from "./agent-diagnosis";
import type { AgentProfileDraft } from "./agent-profile";
import { AgentRecommendations } from "./agent-recommendations";
import {
  analyzeAgentRecommendations,
  notCollectedUrlCount,
  summarizeAgentRecords,
} from "./agent-result-helpers";
import type { AgentKind } from "./agent-types";

function formatCapturedAt(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function profileContext(profile: AgentProfileDraft): AgentDiagnosisContext {
  return {
    reviewState: profile.reviewState,
    productName: profile.productName,
    primaryIcp: profile.primaryIcp,
    country: profile.country,
    locale: profile.locale,
    device: profile.device,
    pageType: profile.pageType,
    targetQuery: profile.targetQuery,
    auditScope: profile.auditScope,
  };
}

interface CapturedFact {
  readonly label: string;
  readonly value: number | string | null;
  readonly hint: string | null;
}

export interface AgentResultsProps {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly data: AgentAuditSuccessData;
  readonly profile: AgentProfileDraft;
}

export function AgentResults({
  agent,
  locale,
  data,
  profile,
}: AgentResultsProps) {
  const t = useTranslations("agents.workbench");
  const auditT = useTranslations("tools.seoAudit");
  const model = useMemo(
    () =>
      buildAgentAuditViewModel({
        agent,
        locale,
        context: profileContext(profile),
        data,
      }),
    [agent, data, locale, profile],
  );
  const initialScope: AgentAuditScope =
    profile.auditScope === "page-only" ? "page" : "site";
  const [scope, setScope] = useState<AgentAuditScope>(initialScope);
  const [selectedGroupIds, setSelectedGroupIds] = useState(() => ({
    site: model.defaults.siteGroupId,
    page: model.defaults.pageGroupId,
  }));
  const [selectedCheckIds, setSelectedCheckIds] = useState<
    Record<AgentAuditScope, string | null>
  >({ site: null, page: null });
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<
    Record<AgentAuditScope, string | null>
  >({ site: null, page: null });
  const summary = summarizeAgentRecords(data.result.records);
  const notCollected = notCollectedUrlCount(data.result.coverage);
  const scopedChecks = useMemo(
    () => model.evaluatedChecks.filter((check) => check.check.scope === scope),
    [model, scope],
  );
  const recommendationAnalysis = useMemo(
    () =>
      analyzeAgentRecommendations(agent, scopedChecks, data.result.records, {
        targetUrl: data.result.targetUrl,
      }),
    [agent, data.result.records, data.result.targetUrl, scopedChecks],
  );
  /**
   * Evidence records are collected measurements, so they are labelled as
   * records here. The Diagnosis panel counts checks, which is a different unit.
   */
  const capturedFacts: readonly CapturedFact[] = [
    {
      label: t("pagesInspected"),
      value: data.result.coverage.pagesInspected,
      hint: null,
    },
    {
      label: t("linksObserved"),
      value: data.result.coverage.linksObserved,
      hint: null,
    },
    { label: t("notCollected"), value: notCollected, hint: null },
    {
      label: t("evidenceRecords"),
      value: `${summary.evaluated} / ${summary.total}`,
      hint: t("evaluatedBreakdown", {
        observed: summary.observed,
        notObserved: summary.notObserved,
      }),
    },
  ];

  function handleScopeChange(nextScope: AgentAuditScope): void {
    setScope(nextScope);
  }

  function handleGroupChange(groupId: string): void {
    setSelectedGroupIds((current) => ({ ...current, [scope]: groupId }));
    setSelectedCheckIds((current) => ({ ...current, [scope]: null }));
  }

  function handleCheckChange(checkId: string): void {
    setSelectedCheckIds((current) => ({ ...current, [scope]: checkId }));
  }

  return (
    <section
      data-testid={`agent-results-${agent}`}
      className="mt-8 space-y-5"
      aria-labelledby={`${agent}-capture-title`}
    >
      <header className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] tracking-[0.12em] text-brand-accent-text uppercase">
              {t("capturedReport")}
            </p>
            <h2
              id={`${agent}-capture-title`}
              className="mt-2 break-all text-[20px] font-semibold text-text-dark-primary"
            >
              {data.result.targetUrl}
            </h2>
            <p className="mt-2 font-mono text-[10.5px] text-text-dark-secondary">
              {t("capturedAt")}:{" "}
              {formatCapturedAt(data.result.scannedAt, locale)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-brand-accent/30 bg-brand-accent/10 px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-brand-accent-text uppercase">
              <ShieldCheck aria-hidden="true" className="size-3" />
              {t(`availability.${data.result.coverage.availability}`)}
            </span>
            <span className="rounded border border-brand-border-strong px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {data.run.source.cache.status === "hit"
                ? t("cachedCapture")
                : t("newCapture")}
            </span>
          </div>
        </div>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-row border border-brand-border-card bg-brand-border-card sm:grid-cols-2 xl:grid-cols-4">
          {capturedFacts.map(({ label, value, hint }) => (
            <div key={label} className="bg-brand-panel-sunken p-4">
              <dt className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
                {label}
              </dt>
              <dd className="mt-2 font-mono text-[18px] font-medium text-text-dark-primary">
                {value === null ? auditT("availability.unavailable") : value}
              </dd>
              {hint ? (
                <dd className="mt-1.5 font-mono text-[11px] text-text-dark-faint">
                  {hint}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[10.5px] leading-[1.6] text-text-dark-faint">
          {t("evidenceRecordsBoundary")}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-3.5">
            <FileSearch
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-brand-accent"
            />
            <div>
              <p className="text-[12px] font-semibold text-text-dark-primary">
                {t("collectionBoundary")}
              </p>
              <p className="mt-1 text-[11px] text-text-dark-secondary">
                {t("boundedHtmlOnly")}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-3.5">
            <Link2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-brand-info"
            />
            <div>
              <p className="text-[12px] font-semibold text-text-dark-primary">
                {t("finalOrigin")}
              </p>
              <p className="mt-1 break-all text-[11px] text-text-dark-secondary">
                {data.result.siteOrigin}
              </p>
            </div>
          </div>
        </div>

        {data.result.coverage.stopReason ? (
          <p className="mt-4 rounded-row border border-brand-warning/20 bg-brand-warning/[0.06] px-4 py-3 text-[11.5px] text-text-dark-secondary">
            {t("stopReason", { reason: data.result.coverage.stopReason })}
          </p>
        ) : null}
      </header>

      <AgentDiagnosis
        model={model}
        scope={scope}
        selectedGroupId={selectedGroupIds[scope]}
        selectedCheckId={selectedCheckIds[scope]}
        onScopeChange={handleScopeChange}
        onGroupChange={handleGroupChange}
        onCheckChange={handleCheckChange}
      />

      <AgentRecommendations
        agent={agent}
        locale={locale}
        targetUrl={data.result.targetUrl}
        evaluatedChecks={scopedChecks}
        // The same joined list the evaluator decided from. Handing the crawl
        // ledger alone would show a search check that decided beside no
        // evidence at all, because its record lives in the other list.
        records={allAgentAuditRecords(data)}
        targetPageExtract={data.result.targetPageExtract}
        profile={profile}
        selectedRecommendationId={selectedRecommendationIds[scope]}
        onSelectRecommendation={(recommendationId) =>
          setSelectedRecommendationIds((current) => ({
            ...current,
            [scope]: recommendationId,
          }))
        }
      />

      {recommendationAnalysis.hiddenCount > 0 ||
      recommendationAnalysis.dataSourceGaps.length > 0 ? (
        <div
          data-testid="agent-recommendation-disclosure"
          data-ranked-shown={recommendationAnalysis.ranked.length}
          data-ranked-total={recommendationAnalysis.rankedTotal}
          data-source-gaps={recommendationAnalysis.dataSourceGaps.length}
          className="rounded-row border border-brand-border bg-brand-panel-sunken px-4 py-3"
        >
          {recommendationAnalysis.hiddenCount > 0 ? (
            <p className="text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("recommendations.rankedDisclosure", {
                shown: recommendationAnalysis.ranked.length,
                total: recommendationAnalysis.rankedTotal,
              })}
            </p>
          ) : null}
          {recommendationAnalysis.dataSourceGaps.length > 0 ? (
            <p className="mt-1.5 text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("recommendations.dataSourceGaps", {
                count: recommendationAnalysis.dataSourceGaps.length,
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-center font-mono text-[11px] tracking-[0.05em] text-text-dark-faint">
        {t("runBoundary", {
          agent: data.run.agent.toUpperCase(),
          schema: data.run.source.schemaVersion,
        })}
      </p>
    </section>
  );
}
