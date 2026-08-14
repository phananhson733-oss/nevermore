// @input  -- one authenticated Agent run plus its confirmed local Product/ICP Profile
// @output -- captured-evidence boundary and controlled Stage 02 -> 03 -> 04 workflow
// @pos    -- shared renderer whose state and defaults remain independent per Agent page

"use client";

import { FileSearch, Link2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

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
            <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
              {t("capturedReport")}
            </p>
            <h2
              id={`${agent}-capture-title`}
              className="mt-2 break-all text-[20px] font-semibold text-text-dark-primary"
            >
              {data.result.targetUrl}
            </h2>
            <p className="mt-2 font-mono text-[10.5px] text-text-dark-secondary">
              {t("capturedAt")}: {formatCapturedAt(data.result.scannedAt, locale)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-brand-accent/30 bg-brand-accent/10 px-2.5 py-1 font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
              <ShieldCheck aria-hidden="true" className="size-3" />
              {t(`availability.${data.result.coverage.availability}`)}
            </span>
            <span className="rounded border border-brand-border-strong px-2.5 py-1 font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {data.run.source.cache.status === "hit"
                ? t("cachedCapture")
                : t("newCapture")}
            </span>
          </div>
        </div>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-row border border-brand-border-card bg-brand-border-card sm:grid-cols-2 xl:grid-cols-4">
          {[
            [t("pagesInspected"), data.result.coverage.pagesInspected],
            [t("linksObserved"), data.result.coverage.linksObserved],
            [t("notCollected"), notCollected],
            [t("evaluatedChecks"), `${summary.evaluated} / ${summary.total}`],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-brand-panel-sunken p-4">
              <dt className="font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
                {label}
              </dt>
              <dd className="mt-2 font-mono text-[18px] font-medium text-text-dark-primary">
                {value === null ? auditT("availability.unavailable") : value}
              </dd>
            </div>
          ))}
        </dl>

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
        evaluatedChecks={model.evaluatedChecks.filter(
          (check) => check.check.scope === scope,
        )}
        records={data.result.records}
        profile={profile}
        selectedRecommendationId={selectedRecommendationIds[scope]}
        onSelectRecommendation={(recommendationId) =>
          setSelectedRecommendationIds((current) => ({
            ...current,
            [scope]: recommendationId,
          }))
        }
      />

      <p className="text-center font-mono text-[9.5px] tracking-[0.05em] text-text-dark-faint">
        {t("runBoundary", {
          agent: data.run.agent.toUpperCase(),
          schema: data.run.source.schemaVersion,
        })}
      </p>
    </section>
  );
}
