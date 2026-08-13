// @input  -- authenticated Agent run projection and tools.seoAudit/agents messages
// @output -- evidence summary, Top 3 reach list, and adaptable selected solution
// @pos    -- shared report surface mounted independently by SEO and Tech pages

"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileSearch,
  Link2,
  Minus,
  SearchCode,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  SeoAuditEvidenceValue,
  SeoAuditRecord,
  SeoAuditRecordState,
} from "@sf/public-tools";

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import { LimitationHint } from "../ui/limitation-hint";
import type { AgentKind } from "./agent-types";
import {
  notCollectedUrlCount,
  summarizeAgentRecords,
  topObservedOpportunities,
} from "./agent-result-helpers";
import { solutionTemplate } from "./agent-solution-templates";

const STATE_STYLE: Readonly<Record<SeoAuditRecordState, string>> = {
  observed: "border-brand-info/30 bg-brand-info/10 text-brand-info",
  not_observed:
    "border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary",
  unverified: "border-brand-warning/30 bg-brand-warning/15 text-brand-warning",
};

const STATE_ICON = {
  observed: FileSearch,
  not_observed: Minus,
  unverified: CircleHelp,
} as const;

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

function EvidenceValue({ value }: { readonly value: SeoAuditEvidenceValue }) {
  const t = useTranslations("tools.seoAudit");
  if (value === null) return <>{t("notAvailable")}</>;
  if (typeof value === "boolean") {
    return <>{value ? t("booleanTrue") : t("booleanFalse")}</>;
  }
  return <>{String(value)}</>;
}

function RecordEvidence({ record }: { readonly record: SeoAuditRecord }) {
  const auditT = useTranslations("tools.seoAudit");
  const t = useTranslations("agents.workbench");
  const Icon = STATE_ICON[record.state];

  return (
    <details className="group/evidence overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken">
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border ${STATE_STYLE[record.state]}`}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="min-w-0">
            <strong className="block text-[13px] font-semibold text-text-dark-primary">
              {auditT(`records.${record.id}.title`)}
            </strong>
            <span className="mt-1 block text-[12px] leading-[1.55] text-text-dark-secondary">
              {auditT(`records.${record.id}.description`)}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2 pl-10 sm:pl-0">
          <span
            className={`rounded border px-2 py-[3px] font-mono text-[9px] tracking-[0.08em] uppercase ${STATE_STYLE[record.state]}`}
          >
            {auditT(`recordStates.${record.state}`)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 text-text-dark-secondary transition-transform group-open/evidence:rotate-180"
          />
        </span>
      </summary>
      <div className="border-t border-brand-border-faint px-4 py-4">
        {record.observations.length > 0 ? (
          <div className="grid gap-3">
            {record.observations.map((observation, index) => (
              <article
                key={`${observation.url ?? "site"}:${index}`}
                className="rounded-[9px] border border-brand-border-faint bg-brand-panel-raised p-3.5"
              >
                <p className="break-all font-mono text-[10.5px] text-brand-accent-text">
                  {observation.url ?? auditT("siteLevelObservation")}
                </p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {observation.values.map((entry) => (
                    <div key={entry.label} className="min-w-0">
                      <dt className="font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
                        {auditT(`evidence.${entry.label}`)}
                      </dt>
                      <dd className="mt-1 break-all font-mono text-[10.5px] text-text-dark-primary">
                        <EvidenceValue value={entry.value} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-text-dark-secondary">
            {record.state === "unverified"
              ? auditT("noVerifiableObservation")
              : auditT("noMatchingObservation")}
          </p>
        )}
        {record.limitation ? (
          <LimitationHint
            className="mt-3"
            label={auditT("limitationLabel")}
            limitations={[auditT(`limitations.${record.limitation}`)]}
          />
        ) : null}
        <p className="mt-3 font-mono text-[10px] text-text-dark-faint">
          {t("reachCount", {
            affected: record.affected,
            tested: record.tested,
            unit: auditT(`recordUnits.${record.unit}`),
          })}
        </p>
      </div>
    </details>
  );
}

function SelectedSolution({ record }: { readonly record: SeoAuditRecord }) {
  const auditT = useTranslations("tools.seoAudit");
  const t = useTranslations("agents.workbench");
  const template = solutionTemplate(record.category);

  return (
    <article
      data-testid="agent-selected-solution"
      className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-border pb-5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
            {t("stage4")}
          </p>
          <h3 className="mt-2 text-[18px] font-semibold text-text-dark-primary">
            {auditT(`records.${record.id}.title`)}
          </h3>
        </div>
        <span className="rounded border border-brand-warning/30 bg-brand-warning/10 px-2.5 py-1 font-mono text-[9px] tracking-[0.08em] text-brand-warning uppercase">
          {t("adaptablePreview")}
        </span>
      </div>

      <div className="mt-5 grid gap-5">
        <section>
          <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-text-dark-primary">
            <AlertTriangle aria-hidden="true" className="size-3.5 text-brand-info" />
            {t("issueLabel")}
          </h4>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {auditT(`records.${record.id}.description`)}
          </p>
        </section>

        <section>
          <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-text-dark-primary">
            <SearchCode aria-hidden="true" className="size-3.5 text-brand-accent" />
            {t("evidenceLabel")}
          </h4>
          <div className="mt-2">
            <RecordEvidence record={record} />
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-row border border-brand-border bg-brand-panel-sunken p-4">
            <h4 className="text-[12.5px] font-semibold text-text-dark-primary">
              {t("potentialImpactLabel")}
            </h4>
            <p className="mt-2 text-[12px] leading-[1.6] text-text-dark-secondary">
              {t(template.impactKey)}
            </p>
          </div>
          <div className="rounded-row border border-brand-border bg-brand-panel-sunken p-4">
            <h4 className="text-[12.5px] font-semibold text-text-dark-primary">
              {t("recommendationLabel")}
            </h4>
            <p className="mt-2 text-[12px] leading-[1.6] text-text-dark-secondary">
              {t(`categories.${template.category}.recommendation`)}
            </p>
          </div>
        </section>

        <section className="rounded-row border border-brand-border-dashed bg-brand-panel-sunken p-4">
          <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-text-dark-primary">
            <ClipboardCheck aria-hidden="true" className="size-3.5 text-brand-accent-2" />
            {t("implementationLabel")}
          </h4>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-[1.65] text-text-dark-strong">
            {t(template.implementationKey)}
          </pre>
        </section>

        <section>
          <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-text-dark-primary">
            <CheckCircle2 aria-hidden="true" className="size-3.5 text-brand-success" />
            {t("validationLabel")}
          </h4>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t(template.validationKey)}
          </p>
        </section>

        <LimitationHint
          label={t("boundaryLabel")}
          limitations={[
            record.limitation
              ? auditT(`limitations.${record.limitation}`)
              : t("recordBoundary"),
            t("previewBoundary"),
          ]}
        />
      </div>
    </article>
  );
}

export function AgentResults({
  agent,
  locale,
  data,
  selectedId,
  onSelect,
}: {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly data: AgentAuditSuccessData;
  readonly selectedId: string | null;
  readonly onSelect: (recordId: string) => void;
}) {
  const t = useTranslations("agents.workbench");
  const auditT = useTranslations("tools.seoAudit");
  const summary = summarizeAgentRecords(data.result.records);
  const opportunities = topObservedOpportunities(data.result.records);
  const selected =
    opportunities.find((record) => record.id === selectedId) ??
    opportunities[0] ??
    null;
  const notCollected = notCollectedUrlCount(data.result.coverage);

  return (
    <section
      data-testid={`agent-results-${agent}`}
      className="mt-8 space-y-5"
      aria-labelledby={`${agent}-agent-result-title`}
    >
      <header className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
              {t("capturedReport")}
            </p>
            <h2
              id={`${agent}-agent-result-title`}
              className="mt-2 break-all text-[20px] font-semibold text-text-dark-primary"
            >
              {data.result.targetUrl}
            </h2>
            <dl className="mt-3 grid gap-2 font-mono text-[10.5px] text-text-dark-secondary sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="inline text-text-dark-faint">{t("finalOrigin")}: </dt>
                <dd className="inline break-all text-text-dark-strong">
                  {data.result.siteOrigin}
                </dd>
              </div>
              <div>
                <dt className="inline text-text-dark-faint">{t("capturedAt")}: </dt>
                <dd className="inline text-text-dark-strong">
                  {formatCapturedAt(data.result.scannedAt, locale)}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-brand-accent/30 bg-brand-accent/10 px-2.5 py-1 font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
              {t(`availability.${data.result.coverage.availability}`)}
            </span>
            <span className="rounded border border-brand-border-strong px-2.5 py-1 font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {data.run.source.cache.status === "hit"
                ? t("cachedCapture")
                : t("newCapture")}
            </span>
          </div>
        </div>

        <dl className="mt-6 grid gap-px overflow-hidden rounded-row border border-brand-border-card bg-brand-border-card sm:grid-cols-2 lg:grid-cols-4">
          {[
            [t("pagesInspected"), data.result.coverage.pagesInspected],
            [t("linksObserved"), data.result.coverage.linksObserved],
            [t("sitemapUrls"), data.result.coverage.sitemapUrlsObserved],
            [t("notCollected"), notCollected],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-brand-panel-sunken p-4">
              <dt className="font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
                {label}
              </dt>
              <dd className="mt-2 font-mono text-[22px] font-medium text-text-dark-primary">
                {value === null
                  ? auditT("availability.unavailable")
                  : value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-row border border-brand-border bg-brand-panel-sunken p-4">
            <p className="font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
              {t("evaluatedChecks")}
            </p>
            <p className="mt-2 font-mono text-[18px] text-text-dark-primary">
              {summary.evaluated} / {summary.total}
            </p>
            <p className="mt-1 text-[11.5px] text-text-dark-secondary">
              {t("evaluatedBreakdown", {
                observed: summary.observed,
                notObserved: summary.notObserved,
              })}
            </p>
          </div>
          <div className="rounded-row border border-brand-warning/20 bg-brand-warning/[0.06] p-4">
            <p className="font-mono text-[9px] tracking-[0.1em] text-brand-warning uppercase">
              {t("unverifiedChecks")}
            </p>
            <p className="mt-2 font-mono text-[18px] text-text-dark-primary">
              {summary.unverified}
            </p>
            <p className="mt-1 text-[11.5px] text-text-dark-secondary">
              {t("unverifiedBoundary")}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-3.5">
            <FileSearch aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-accent" />
            <div>
              <p className="text-[12px] font-semibold text-text-dark-primary">
                {t("robotsStatus")}
              </p>
              <p className="mt-1 text-[11px] text-text-dark-secondary">
                {data.result.siteResources.robotsFetched
                  ? t("resourceFetched")
                  : t("resourceNotVerified")}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-3.5">
            <SearchCode aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-accent-2" />
            <div>
              <p className="text-[12px] font-semibold text-text-dark-primary">
                {t("sitemapStatus")}
              </p>
              <p className="mt-1 text-[11px] text-text-dark-secondary">
                {data.result.siteResources.sitemapFetched
                  ? t("resourceFetched")
                  : t("resourceNotVerified")}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-3.5">
            <Link2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-info" />
            <div>
              <p className="text-[12px] font-semibold text-text-dark-primary">
                {t("collectionBoundary")}
              </p>
              <p className="mt-1 text-[11px] text-text-dark-secondary">
                {t("boundedHtmlOnly")}
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

      {opportunities.length > 0 && selected ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)] lg:items-start">
          <section
            aria-labelledby={`${agent}-agent-opportunities-title`}
            className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6"
          >
            <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
              {t("stage3")}
            </p>
            <h3
              id={`${agent}-agent-opportunities-title`}
              className="mt-2 text-[18px] font-semibold text-text-dark-primary"
            >
              {t("opportunitiesTitle")}
            </h3>
            <p className="mt-2 text-[12px] leading-[1.6] text-text-dark-secondary">
              {t("reachBoundary")}
            </p>
            <ol className="mt-5 grid gap-2.5">
              {opportunities.map((record, index) => {
                const active = record.id === selected.id;
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      data-testid={`agent-opportunity-${record.id}`}
                      aria-pressed={active}
                      onClick={() => onSelect(record.id)}
                      className={`w-full rounded-row border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent ${
                        active
                          ? "border-brand-accent/45 bg-brand-accent/[0.08]"
                          : "border-brand-border bg-brand-panel-sunken hover:border-brand-border-strong"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-mono text-[9px] tracking-[0.08em] text-text-dark-faint">
                          0{index + 1}
                        </span>
                        <span className="rounded border border-brand-info/25 bg-brand-info/[0.08] px-2 py-[3px] font-mono text-[9px] tracking-[0.06em] text-brand-info uppercase">
                          {t("reachLabel", { count: record.affected })}
                        </span>
                      </span>
                      <strong className="mt-3 block text-[13px] leading-[1.45] font-semibold text-text-dark-primary">
                        {auditT(`records.${record.id}.title`)}
                      </strong>
                      <span className="mt-2 block text-[11.5px] leading-[1.55] text-text-dark-secondary">
                        {auditT(`records.${record.id}.description`)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
          <SelectedSolution record={selected} />
        </div>
      ) : (
        <section className="rounded-card border border-brand-border-card bg-brand-panel p-6">
          <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
            {t("stage3")}
          </p>
          <h3 className="mt-2 text-[18px] font-semibold text-text-dark-primary">
            {t("noObservedTitle")}
          </h3>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("noObservedBody")}
          </p>
        </section>
      )}

      <details className="group/ledger overflow-hidden rounded-card border border-brand-border-card bg-brand-panel">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
          <div>
            <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
              {t("ledgerEyebrow")}
            </p>
            <h3 className="mt-2 text-[16px] font-semibold text-text-dark-primary">
              {t("ledgerTitle", { count: data.result.records.length })}
            </h3>
          </div>
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-text-dark-secondary transition-transform group-open/ledger:rotate-180"
          />
        </summary>
        <div className="grid gap-3 border-t border-brand-border p-4 md:p-5">
          {data.result.records.map((record) => (
            <RecordEvidence key={record.id} record={record} />
          ))}
        </div>
      </details>

      <p className="text-center font-mono text-[9.5px] tracking-[0.05em] text-text-dark-faint">
        {t("runBoundary", {
          agent: data.run.agent.toUpperCase(),
          schema: data.run.source.schemaVersion,
        })}
      </p>
    </section>
  );
}
