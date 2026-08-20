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
import type {
  SeoAuditRecord,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools";
import {
  AgentSolutionDraft,
  draftKindFor,
} from "./agent-solution-draft";
import type {
  AgentAuditEngineState,
  AgentAuditEvaluatedCheck,
  AgentAuditResultState,
  AgentAuditTruthState,
} from "@sf/public-tools/agent-audit";

import type { AgentKind } from "./agent-types";
import type { AgentProfileDraft } from "./agent-profile";
import { AgentAiActionCopy } from "./agent-ai-action-copy";
import { AgentEvidenceDetails } from "./agent-evidence-details";
import {
  rankAgentRecommendations,
  type RankedAgentRecommendation,
} from "./agent-result-helpers";
import { solutionTemplate } from "./agent-solution-templates";

type SupportedLocale = "en" | "zh";

/**
 * Why the selected recommendation has no displayable observation.
 *
 * The three cases carry different truths and must never share one badge:
 * a source-gated check has no public evidence at all, a not-observed check
 * was measured and found nothing affected, and a not-captured check simply
 * kept no record for the selected page.
 */
type EvidencePresence =
  | "observed"
  | "not-observed"
  | "source-gated"
  | "not-captured";

const ENGINE_MESSAGE_KEY: Readonly<Record<AgentAuditEngineState, string>> = {
  ready: "ready",
  "needs-integration": "needsIntegration",
  "needs-supplement": "needsSupplement",
  "not-integrated": "notIntegrated",
  "access-required": "accessRequired",
};

const TRUTH_MESSAGE_KEY: Readonly<Record<AgentAuditTruthState, string>> = {
  observed: "observed",
  "not-observed": "notObserved",
  documented: "documented",
  inferred: "inferred",
  partial: "partial",
  "source-gated": "sourceGated",
  unavailable: "unavailable",
  illustrative: "illustrative",
};

const RESULT_MESSAGE_KEY: Readonly<Record<AgentAuditResultState, string>> = {
  blocker: "blocker",
  warning: "warning",
  tip: "tip",
  pass: "pass",
  excluded: "excluded",
};

function axisLabel(
  translate: (key: string) => string,
  group: string,
  segment: string | undefined,
  raw: string,
): string {
  return segment === undefined ? raw : translate(`${group}.${segment}`);
}

function evidencePresence(
  recommendation: RankedAgentRecommendation,
): EvidencePresence {
  if (recommendation.evidenceAvailable) return "observed";
  const truth = String(recommendation.check.truth);
  if (truth === "not-observed") return "not-observed";
  if (
    truth === "source-gated" ||
    truth === "unavailable" ||
    truth === "illustrative"
  ) {
    return "source-gated";
  }
  return "not-captured";
}

function localized(
  value: Readonly<Record<SupportedLocale, string>> | string | null,
  locale: string,
): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  return value[locale === "zh" ? "zh" : "en"];
}

const EMPTY_EVIDENCE_COPY: Readonly<
  Record<Exclude<EvidencePresence, "observed">, readonly [string, string]>
> = {
  "source-gated": ["evidenceUnavailable", "sourceGatedBoundary"],
  "not-observed": ["evidenceNotObservedTitle", "evidenceNotObservedBody"],
  "not-captured": ["evidenceNoObservationTitle", "evidenceNoObservationBody"],
};

function DetailSection({
  icon: Icon,
  label,
  children,
  testId,
}: {
  readonly icon: typeof AlertTriangle;
  readonly label: string;
  readonly children: React.ReactNode;
  readonly testId?: string;
}) {
  return (
    <section data-testid={testId}>
      <h4 className="flex items-center gap-2 text-[14px] leading-[1.4] font-semibold text-text-dark-primary">
        <Icon aria-hidden="true" className="size-3.5 text-brand-accent" />
        {label}
      </h4>
      <div className="mt-2 min-w-0 text-text-dark-secondary">{children}</div>
    </section>
  );
}

function SelectedSolution({
  recommendation,
  locale,
  targetUrl,
  profile,
  targetPageExtract,
}: {
  readonly recommendation: RankedAgentRecommendation;
  readonly locale: string;
  readonly targetUrl: string;
  readonly profile: AgentProfileDraft;
  readonly targetPageExtract: SeoAuditTargetPageExtract | null;
}) {
  const t = useTranslations("agents.workbench.recommendations");
  const diagnosisT = useTranslations("agents.workbench.diagnosis");
  const profileT = useTranslations("agents.workbench.profile");
  const evaluated = recommendation.check;
  const check = evaluated.check;
  const presence = evidencePresence(recommendation);
  const gated = presence === "source-gated";
  const deviceLabel = profileT(`options.device.${profile.device}`);
  const pageTypeLabel = profileT(`options.pageType.${profile.pageType}`);
  const pageContext = [
    pageTypeLabel,
    deviceLabel,
    profileT(`options.auditScope.${profile.auditScope}`),
  ].join(" · ");
  const searchContext = [profile.country, profile.locale, deviceLabel]
    .filter((value) => value.trim().length > 0)
    .join(" · ");
  const measurement = evaluated.measurement
    ? localized(evaluated.measurement, locale)
    : null;
  const template = solutionTemplate(recommendation.agent, evaluated, {
    fillIn: t("previewFillIn"),
    notCaptured: t("previewNotCaptured"),
    targetUrl: profile.targetUrl,
    productName: profile.productName,
    targetQuery: profile.targetQuery,
    pageType: pageTypeLabel,
    searchContext,
    measurement,
    evidenceRecords: recommendation.evidenceRecords,
  });
  const resolvedRecommendation = t(
    template.recommendationKey.replace("recommendations.", ""),
  );
  const resolvedApplicableContext = t(
    template.applicableContextKey.replace("recommendations.", ""),
  );
  const resolvedValidation = template.validationKeys.map((key) =>
    t(key.replace("recommendations.", "")),
  );
  const resolvedImpact = t(
    template.impactSurfaceKey.replace("recommendations.", ""),
  );
  const resolvedRisks = t(template.risksKey.replace("recommendations.", ""));
  const resolvedLimits = t(template.limitsKey.replace("recommendations.", ""));
  const draftKind = draftKindFor(template.kind);
  const contextFacts =
    recommendation.agent === "seo"
      ? [
          [t("productLabel"), profile.productName],
          [t("ctaLabel"), profile.primaryCta],
          [t("queryLabel"), profile.targetQuery || t("unconfirmedValue")],
          [t("audienceLabel"), profile.primaryIcp],
          [t("outcomeLabel"), profile.firstOutcome],
        ]
      : [
          [t("targetLabel"), profile.targetUrl],
          [t("productLabel"), profile.productName],
          [t("pageContextLabel"), pageContext],
          [t("audienceLabel"), profile.primaryIcp],
          [t("outcomeLabel"), profile.firstOutcome],
        ];

  return (
    <article
      id={`${recommendation.agent}-selected-solution`}
      data-stage="04"
      data-testid="agent-selected-solution"
      aria-labelledby={`${recommendation.agent}-stage4-title`}
      className="relative w-full overflow-hidden rounded-card border border-brand-border-card bg-brand-panel"
    >
      <span
        data-testid="agent-stage4-accent"
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5 bg-brand-gradient"
      />
      <header
        data-testid="agent-stage4-header"
        className="border-b border-brand-border px-[18px] py-[22px] md:px-8 md:pt-[30px] md:pb-[26px]"
      >
        <div
          data-testid="agent-stage4-header-layout"
          className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
        >
          <div className="flex min-w-0 items-start gap-[15px]">
            <span
              data-testid="agent-stage4-index"
              className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-full border border-brand-accent/40 bg-brand-accent/[0.08] font-mono text-[11px] leading-none font-semibold text-brand-accent-text"
            >
              04
            </span>
            <div className="min-w-0">
              <p
                data-testid="agent-stage4-eyebrow"
                className="font-mono !text-[10px] !leading-[1.2] tracking-[0.13em] text-brand-accent-text uppercase"
              >
                {t("stage4")}
              </p>
              <h3
                id={`${recommendation.agent}-stage4-title`}
                data-testid="agent-stage4-title"
                className="mt-3 text-[26px] leading-[1.14] font-semibold tracking-[-0.035em] text-text-dark-primary md:text-[32px]"
              >
                {t("stage4Title")}
              </h3>
              <p className="mt-3 !text-[13px] !leading-[1.65] text-text-dark-secondary">
                {t("stage4Body")}
              </p>
            </div>
          </div>
          <span
            data-testid="agent-solution-boundary"
            className={`rounded border px-2.5 py-1 font-mono text-[10.5px] tracking-[0.08em] uppercase ${
              gated
                ? "border-brand-warning/30 bg-brand-warning/10 text-brand-warning"
                : "border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary"
            }`}
          >
            {gated ? t("unavailableInvestigation") : t("previewOnly")}
          </span>
        </div>
      </header>

      <div
        data-testid="agent-stage4-body"
        className="grid gap-5 px-[18px] py-[22px] md:px-8 md:py-[30px] lg:grid-cols-2"
      >
        <div className="grid min-w-0 gap-5">
          <DetailSection
            icon={AlertTriangle}
            label={t("issueLabel")}
            testId="agent-stage4-issue"
          >
            <h5
              data-testid="agent-stage4-issue-title"
              className="text-[18px] leading-[1.25] font-semibold text-text-dark-primary md:text-[19px]"
            >
              {localized(check.title, locale)}
            </h5>
            <p className="mt-3 !text-[13px] !leading-[1.65]">
              {localized(check.impact, locale)}
            </p>
            <p
              data-testid="agent-solution-recommendation"
              className="mt-3 !text-[13px] !leading-[1.65] text-text-dark-primary"
            >
              {resolvedRecommendation}
            </p>
          </DetailSection>

          <DetailSection
            icon={FileSearch}
            label={t("evidenceLabel")}
            testId="agent-stage4-evidence"
          >
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-row border border-brand-border bg-brand-panel-sunken p-3">
                <span
                  data-testid="agent-stage4-evidence-label"
                  className="font-mono text-[10px] leading-[1.3] tracking-[0.08em] text-text-dark-faint uppercase"
                >
                  {t("measuredLabel")}
                </span>
                <p
                  data-testid="agent-stage4-evidence-value"
                  className="mt-1 !text-[12px] !leading-[1.65] text-text-dark-primary"
                >
                  {measurement ?? t("evidenceUnavailable")}
                </p>
              </div>
              <div className="rounded-row border border-brand-border bg-brand-panel-sunken p-3">
                <span className="font-mono text-[10px] leading-[1.3] tracking-[0.08em] text-text-dark-faint uppercase">
                  {t("sourceLabel")}
                </span>
                <p className="mt-1 !text-[12px] !leading-[1.65] text-text-dark-primary">
                  {localized(check.dataSource, locale)}
                </p>
              </div>
            </div>
            <AgentEvidenceDetails
              key={`${check.scope}:${check.id}`}
              check={evaluated}
              records={recommendation.evidenceRecords}
              targetUrl={targetUrl}
              locale={locale}
              className="[&_p]:!leading-[1.65] [&_dd]:!leading-[1.65]"
            />
          </DetailSection>

          <DetailSection icon={Braces} label={t("fixLabel")}>
            <p className="mb-3 !text-[13px] !leading-[1.65]">
              {localized(check.howToFix, locale)}
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-row border border-brand-border-dashed bg-brand-panel-sunken p-4 font-mono text-[12px] leading-[1.65] text-text-dark-strong">
              {gated
                ? `${t("unavailableInvestigation")}\n\n${template.preview}`
                : template.preview}
            </pre>
            {gated || draftKind === null ? null : (
              <div
                data-testid="agent-stage4-draft"
                className="[&_p]:!leading-[1.65] [&_dd]:!leading-[1.65]"
              >
                <AgentSolutionDraft
                  key={`${profile.targetUrl}:${check.id}:${draftKind}`}
                  kind={draftKind}
                  targetUrl={profile.targetUrl}
                  extract={targetPageExtract}
                  targetQuery={profile.targetQuery}
                  pageType={pageTypeLabel}
                />
              </div>
            )}
          </DetailSection>
        </div>

        <div className="grid min-w-0 gap-5">
          <DetailSection
            icon={Gauge}
            label={t("contextLabel")}
            testId="agent-stage4-context"
          >
            <p className="!text-[13px] !leading-[1.65]">
              {resolvedApplicableContext}
            </p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {contextFacts.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-row border border-brand-border bg-brand-panel-sunken p-3"
                >
                  <dt className="font-mono text-[10px] leading-[1.3] tracking-[0.08em] text-text-dark-faint uppercase">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words !text-[12px] !leading-[1.65] text-text-dark-primary">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p
              data-testid="agent-solution-states"
              className="mt-2 font-mono !text-[10.5px] !leading-[1.65] text-text-dark-faint"
            >
              {t("statesLabel")}:{" "}
              {axisLabel(
                diagnosisT,
                "results",
                RESULT_MESSAGE_KEY[evaluated.result],
                String(evaluated.result),
              )}{" "}
              ·{" "}
              {axisLabel(
                diagnosisT,
                "engines",
                ENGINE_MESSAGE_KEY[evaluated.engine],
                String(evaluated.engine),
              )}{" "}
              ·{" "}
              {axisLabel(
                diagnosisT,
                "truth",
                TRUTH_MESSAGE_KEY[evaluated.truth],
                String(evaluated.truth),
              )}
            </p>
          </DetailSection>

          <DetailSection icon={CheckCircle2} label={t("validationLabel")}>
            <ol
              data-testid="agent-solution-validation"
              className="grid gap-2 pl-5 [list-style:decimal] [&_li]:!text-[13px] [&_li]:!leading-[1.65]"
            >
              {resolvedValidation.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ol>
          </DetailSection>

          <DetailSection icon={Gauge} label={t("impactLabel")}>
            <p
              data-testid="agent-solution-impact"
              className="!text-[13px] !leading-[1.65]"
            >
              {resolvedImpact}
            </p>
          </DetailSection>

          <DetailSection icon={ShieldAlert} label={t("risksLabel")}>
            <p
              data-testid="agent-solution-risks"
              className="!text-[13px] !leading-[1.65]"
            >
              {resolvedRisks}
            </p>
          </DetailSection>

          <DetailSection icon={CircleHelp} label={t("limitsLabel")}>
            <p
              data-testid="agent-solution-limits"
              className="!text-[13px] !leading-[1.65]"
            >
              {resolvedLimits}
            </p>
            <p className="mt-2 rounded-row border border-brand-warning/25 bg-brand-warning/[0.06] p-3 !text-[13px] !leading-[1.65] text-brand-warning">
              {t("previewBoundary")}
            </p>
          </DetailSection>

          {recommendation.agent === "seo" ? (
            <AgentAiActionCopy
              locale={locale === "zh" ? "zh" : "en"}
              selectedCheck={evaluated}
              evidenceRecords={recommendation.evidenceRecords}
              targetUrl={targetUrl}
              profile={profile}
              solution={template}
              className="[&_p]:!leading-[1.65]"
              content={{
                recommendation: resolvedRecommendation,
                applicableContext: resolvedApplicableContext,
                validation: resolvedValidation,
                impact: resolvedImpact,
                risks: resolvedRisks,
                limits: resolvedLimits,
              }}
            />
          ) : null}
        </div>
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
  /**
   * The inspected page's own static text.
   *
   * Passed to the draft endpoint rather than re-crawled: this is exactly the
   * text the reader is looking at, and fetching it again would spend a request
   * to learn nothing new. Null when the target was never collected as a page,
   * which is also when a draft would have nothing true to work from.
   */
  readonly targetPageExtract: SeoAuditTargetPageExtract | null;
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
  targetPageExtract,
  profile,
  selectedRecommendationId,
  onSelectRecommendation,
  className = "",
}: AgentRecommendationsProps) {
  const t = useTranslations("agents.workbench.recommendations");
  const diagnosisT = useTranslations("agents.workbench.diagnosis");
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
      <section
        className={`rounded-card border border-brand-border-card bg-brand-panel p-6 ${className}`}
      >
        <p className="font-mono text-[10.5px] tracking-[0.12em] text-brand-accent-text uppercase">
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
      data-layout="vertical"
      className={`grid gap-5 ${className}`}
    >
      <section
        data-stage="03"
        aria-labelledby={`${agent}-recommendations-title`}
        className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6"
      >
        <p className="font-mono text-[10.5px] tracking-[0.12em] text-brand-accent-text uppercase">
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
            const presence = evidencePresence(recommendation);
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
                    <span className="font-mono text-[10.5px] tracking-[0.08em] text-brand-accent-text uppercase">
                      {recommendation.priority} ·{" "}
                      {axisLabel(
                        diagnosisT,
                        "results",
                        RESULT_MESSAGE_KEY[recommendation.check.result],
                        String(recommendation.check.result),
                      )}
                    </span>
                    <span className="font-mono text-[10.5px] text-text-dark-faint">
                      {presence === "observed"
                        ? t("reach", { count: recommendation.reach })
                        : t(EMPTY_EVIDENCE_COPY[presence][0])}
                    </span>
                  </span>
                  <strong className="mt-3 block text-[13px] leading-[1.45] font-semibold text-text-dark-primary">
                    {localized(check.title, locale)}
                  </strong>
                  <span className="mt-2 block text-[11.5px] leading-[1.55] text-text-dark-secondary">
                    {localized(check.impact, locale)}
                  </span>
                  {active ? (
                    <span className="mt-3 block font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase">
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
        targetUrl={targetUrl}
        profile={profile}
        targetPageExtract={targetPageExtract}
      />
    </div>
  );
}
