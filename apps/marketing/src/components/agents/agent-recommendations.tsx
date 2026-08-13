// @input  -- Agent-local evaluated checks, preserved records, and controlled selection
// @output -- Stage 03 recommendation selector and Stage 04 inline solution review
// @pos    -- independent SEO/Tech decision surface; preview-only, never an executor

"use client";

import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  CircleHelp,
  FileSearch,
  Gauge,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { SeoAuditEvidenceValue, SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import type { AgentKind } from "./agent-types";
import type { AgentProfileDraft } from "./agent-profile";
import {
  rankAgentRecommendations,
  type RankedAgentRecommendation,
} from "./agent-result-helpers";
import { solutionTemplate } from "./agent-solution-templates";

type SupportedLocale = "en" | "zh";

function localized(
  value: Readonly<Record<SupportedLocale, string>> | string | null,
  locale: string,
): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  return value[locale === "zh" ? "zh" : "en"];
}

function evidenceValue(value: SeoAuditEvidenceValue): string {
  if (value === null) return "—";
  return String(value);
}

function EvidenceList({
  records,
}: {
  readonly records: readonly SeoAuditRecord[];
}) {
  const auditT = useTranslations("tools.seoAudit");
  const t = useTranslations("agents.workbench.recommendations");

  if (records.length === 0) {
    return (
      <div className="rounded-row border border-brand-warning/25 bg-brand-warning/[0.06] p-4">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-brand-warning">
          <CircleHelp aria-hidden="true" className="size-3.5" />
          {t("evidenceUnavailable")}
        </p>
        <p className="mt-2 text-[11.5px] leading-[1.6] text-text-dark-secondary">
          {t("sourceGatedBoundary")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      {records.flatMap((record) =>
        record.observations.slice(0, 3).map((observation, index) => (
          <article
            key={`${record.id}:${observation.url ?? "site"}:${index}`}
            className="rounded-row border border-brand-border bg-brand-panel-sunken p-3.5"
          >
            <p className="break-all font-mono text-[10px] text-brand-accent-text">
              {observation.url ?? auditT("siteLevelObservation")}
            </p>
            {observation.values.length > 0 ? (
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {observation.values.map((entry) => (
                  <div key={entry.label} className="min-w-0">
                    <dt className="font-mono text-[8.5px] tracking-[0.08em] text-text-dark-faint uppercase">
                      {auditT(`evidence.${entry.label}`)}
                    </dt>
                    <dd className="mt-1 break-all font-mono text-[10.5px] text-text-dark-primary">
                      {evidenceValue(entry.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </article>
        )),
      )}
    </div>
  );
}

function DetailSection({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: typeof AlertTriangle;
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-text-dark-primary">
        <Icon aria-hidden="true" className="size-3.5 text-brand-accent" />
        {label}
      </h4>
      <div className="mt-2 text-[12px] leading-[1.65] text-text-dark-secondary">
        {children}
      </div>
    </section>
  );
}

function SelectedSolution({
  recommendation,
  locale,
  profile,
}: {
  readonly recommendation: RankedAgentRecommendation;
  readonly locale: string;
  readonly profile: AgentProfileDraft;
}) {
  const t = useTranslations("agents.workbench.recommendations");
  const template = solutionTemplate(
    recommendation.agent,
    recommendation.check,
  );
  const check = recommendation.check.check;
  const unavailable = !recommendation.evidenceAvailable;
  const contextFacts =
    recommendation.agent === "seo"
      ? [
          [t("productLabel"), profile.productName],
          [t("ctaLabel"), profile.primaryCta],
          [
            t("queryLabel"),
            profile.targetQuery || t("unconfirmedValue"),
          ],
          [t("audienceLabel"), profile.primaryIcp],
          [t("outcomeLabel"), profile.firstOutcome],
        ]
      : [
          [t("targetLabel"), profile.targetUrl],
          [t("productLabel"), profile.productName],
          [
            t("pageContextLabel"),
            `${profile.pageType} · ${profile.device} · ${profile.auditScope}`,
          ],
          [t("audienceLabel"), profile.primaryIcp],
          [t("outcomeLabel"), profile.firstOutcome],
        ];
  const previewContext = contextFacts
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

  return (
    <article
      id={`${recommendation.agent}-selected-solution`}
      data-stage="04"
      data-testid="agent-selected-solution"
      className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-border pb-5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
            {t("stage4")}
          </p>
          <h3 className="mt-2 text-[18px] font-semibold text-text-dark-primary">
            {localized(check.title, locale)}
          </h3>
          <p className="mt-2 text-[11.5px] text-text-dark-secondary">
            {t("stage4Body")}
          </p>
        </div>
        <span className="rounded border border-brand-warning/30 bg-brand-warning/10 px-2.5 py-1 font-mono text-[9px] tracking-[0.08em] text-brand-warning uppercase">
          {unavailable ? t("unavailableInvestigation") : t("previewOnly")}
        </span>
      </header>

      <div className="mt-5 grid gap-5">
        <DetailSection icon={AlertTriangle} label={t("issueLabel")}>
          <p>{localized(check.impact, locale)}</p>
          <p className="mt-2 text-text-dark-primary">
            {t(template.recommendationKey.replace("recommendations.", ""))}
          </p>
        </DetailSection>

        <DetailSection icon={FileSearch} label={t("evidenceLabel")}>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-row border border-brand-border bg-brand-panel-sunken p-3">
              <span className="font-mono text-[8.5px] tracking-[0.08em] text-text-dark-faint uppercase">
                {t("measuredLabel")}
              </span>
              <p className="mt-1 text-[11px] text-text-dark-primary">
                {recommendation.check.measurement
                  ? localized(recommendation.check.measurement, locale)
                  : t("evidenceUnavailable")}
              </p>
            </div>
            <div className="rounded-row border border-brand-border bg-brand-panel-sunken p-3">
              <span className="font-mono text-[8.5px] tracking-[0.08em] text-text-dark-faint uppercase">
                {t("sourceLabel")}
              </span>
              <p className="mt-1 text-[11px] text-text-dark-primary">
                {localized(check.dataSource, locale)}
              </p>
            </div>
          </div>
          <EvidenceList records={recommendation.evidenceRecords} />
        </DetailSection>

        <DetailSection icon={Braces} label={t("fixLabel")}>
          <p className="mb-3">{localized(check.howToFix, locale)}</p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-row border border-brand-border-dashed bg-brand-panel-sunken p-4 font-mono text-[10.5px] leading-[1.7] text-text-dark-strong">
            {`${unavailable ? `${t("unavailableInvestigation")}\n` : ""}${previewContext}\n\n${template.preview}`}
          </pre>
        </DetailSection>

        <DetailSection icon={Gauge} label={t("contextLabel")}>
          <p>
            {t(template.applicableContextKey.replace("recommendations.", ""))}
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {contextFacts.map(([label, value]) => (
              <div
                key={label}
                className="rounded-row border border-brand-border bg-brand-panel-sunken p-3"
              >
                <dt className="font-mono text-[8.5px] tracking-[0.08em] text-text-dark-faint uppercase">
                  {label}
                </dt>
                <dd className="mt-1 break-words text-[11px] text-text-dark-primary">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 font-mono text-[10px] text-text-dark-faint">
            {t("statesLabel")}: {String(recommendation.check.result)} ·{" "}
            {String(recommendation.check.engine)} ·{" "}
            {String(recommendation.check.truth)}
          </p>
        </DetailSection>

        <DetailSection icon={CheckCircle2} label={t("validationLabel")}>
          <ol className="grid gap-2 pl-5 [list-style:decimal]">
            {template.validationKeys.map((key) => (
              <li key={key}>{t(key.replace("recommendations.", ""))}</li>
            ))}
          </ol>
        </DetailSection>

        <div className="grid gap-4 sm:grid-cols-2">
          <DetailSection icon={Gauge} label={t("impactLabel")}>
            <p>{t(template.impactSurfaceKey.replace("recommendations.", ""))}</p>
          </DetailSection>
          <DetailSection icon={ShieldAlert} label={t("risksLabel")}>
            <p>{t(template.risksKey.replace("recommendations.", ""))}</p>
          </DetailSection>
        </div>

        <DetailSection icon={CircleHelp} label={t("limitsLabel")}>
          <p>{t(template.limitsKey.replace("recommendations.", ""))}</p>
          <p className="mt-2 rounded-row border border-brand-warning/25 bg-brand-warning/[0.06] p-3 text-brand-warning">
            {t("previewBoundary")}
          </p>
        </DetailSection>
      </div>
    </article>
  );
}

export interface AgentRecommendationsProps {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly targetUrl: string;
  readonly evaluatedChecks: readonly AgentAuditEvaluatedCheck[];
  readonly records: readonly SeoAuditRecord[];
  readonly profile: AgentProfileDraft;
  readonly selectedRecommendationId: string | null;
  readonly onSelectRecommendation: (recommendationId: string) => void;
  readonly className?: string;
}

export function AgentRecommendations({
  agent,
  locale,
  targetUrl,
  evaluatedChecks,
  records,
  profile,
  selectedRecommendationId,
  onSelectRecommendation,
  className = "",
}: AgentRecommendationsProps) {
  const t = useTranslations("agents.workbench.recommendations");
  const recommendations = rankAgentRecommendations(
    agent,
    evaluatedChecks,
    records,
    { targetUrl },
  );
  const selected =
    recommendations.find(
      (recommendation) => recommendation.id === selectedRecommendationId,
    ) ??
    recommendations[0] ??
    null;

  if (!selected) {
    return (
      <section className={`rounded-card border border-brand-border-card bg-brand-panel p-6 ${className}`}>
        <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
          {t("stage3")}
        </p>
        <h3 className="mt-2 text-[18px] font-semibold text-text-dark-primary">
          {t("noRecommendationsTitle")}
        </h3>
        <p className="mt-2 text-[12px] text-text-dark-secondary">
          {t("noRecommendationsBody")}
        </p>
      </section>
    );
  }

  return (
    <div
      data-testid="agent-recommendation-row"
      className={`grid gap-5 min-[981px]:grid-cols-[minmax(260px,0.39fr)_minmax(0,0.61fr)] min-[981px]:items-start ${className}`}
    >
      <section
        data-stage="03"
        aria-labelledby={`${agent}-recommendations-title`}
        className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6"
      >
        <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
          {t("stage3")}
        </p>
        <h3
          id={`${agent}-recommendations-title`}
          className="mt-2 text-[18px] font-semibold text-text-dark-primary"
        >
          {t("stage3Title")}
        </h3>
        <p className="mt-2 text-[12px] leading-[1.6] text-text-dark-secondary">
          {t("stage3Body")}
        </p>

        <ol className="mt-5 grid gap-2.5">
          {recommendations.map((recommendation) => {
            const active = recommendation.id === selected.id;
            const check = recommendation.check.check;
            return (
              <li key={recommendation.id}>
                <button
                  type="button"
                  data-testid={`agent-recommendation-${recommendation.id}`}
                  aria-pressed={active}
                  aria-controls={`${agent}-selected-solution`}
                  onClick={() => onSelectRecommendation(recommendation.id)}
                  className={`w-full rounded-row border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent ${
                    active
                      ? "border-brand-accent/45 bg-brand-accent/[0.08]"
                      : "border-brand-border bg-brand-panel-sunken hover:border-brand-border-strong"
                  }`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[9px] tracking-[0.08em] text-brand-accent-text uppercase">
                      {recommendation.priority} · {String(recommendation.check.result)}
                    </span>
                    <span className="font-mono text-[9px] text-text-dark-faint">
                      {recommendation.evidenceAvailable
                        ? t("reach", { count: recommendation.reach })
                        : t("evidenceUnavailable")}
                    </span>
                  </span>
                  <strong className="mt-3 block text-[13px] leading-[1.45] font-semibold text-text-dark-primary">
                    {localized(check.title, locale)}
                  </strong>
                  <span className="mt-2 block text-[11.5px] leading-[1.55] text-text-dark-secondary">
                    {localized(check.impact, locale)}
                  </span>
                  {active ? (
                    <span className="mt-3 block font-mono text-[9px] tracking-[0.06em] text-brand-accent-text uppercase">
                      {t("selected")}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <SelectedSolution
        recommendation={selected}
        locale={locale}
        profile={profile}
      />
    </div>
  );
}
