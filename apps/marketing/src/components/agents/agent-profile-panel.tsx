// @input  -- one Agent-owned Product/ICP draft and local state callbacks
// @output -- compact source-backed review, explicit assumptions, and confirmation UI
// @pos    -- Stage 01 panel shared visually but never by state across SEO/Tech pages

"use client";

import { Check, ChevronDown, FileText, Radar, Sparkles } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";

import type { AgentProfileSearchData } from "../../lib/agents/profile-search-contract";
import {
  AgentProfileSearch,
  type AgentProfileSearchCopy,
} from "./agent-profile-search";
import {
  AGENT_PROFILE_READY_FIELDS,
  confirmAgentProfile,
  isAgentProfileReady,
  redraftAgentProfileForUrl,
  updateAgentProfile,
  type AgentProfileDraft,
  type AgentProfileEditableField,
  type AgentProfileEdits,
  type AgentProfileSourceId,
} from "./agent-profile";
import type { AgentKind } from "./agent-types";

export interface AgentProfilePanelProps {
  readonly agent: AgentKind;
  readonly locale?: string;
  readonly profile: AgentProfileDraft;
  readonly disabled?: boolean;
  readonly onChange: (profile: AgentProfileDraft) => void;
  readonly onConfirm: (profile: AgentProfileDraft) => void;
  readonly errorId?: string;
  readonly urlInvalid?: boolean;
  readonly profileSearch?: {
    readonly loading: boolean;
    readonly data: AgentProfileSearchData | null;
    readonly errorCode: string | null;
    readonly onDiscover: () => void;
  };
}

const TEXT_FIELDS = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "businessModel",
  "primaryCta",
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpPain",
  "icpBehavior",
  "icpPositioning",
  "jtbd",
  "firstOutcome",
  "country",
  "locale",
  "targetQuery",
] as const satisfies readonly AgentProfileEditableField[];

const LIST_FIELDS = [
  "coreFeatures",
  "categories",
  "trustSignals",
  "icpInterests",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
] as const satisfies readonly AgentProfileEditableField[];

const PRODUCT_FIELDS = new Set<AgentProfileEditableField>([
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
  "categories",
  "businessModel",
  "primaryCta",
  "trustSignals",
]);
const ICP_FIELDS = new Set<AgentProfileEditableField>([
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpInterests",
  "icpPain",
  "icpBehavior",
  "icpPositioning",
  "jtbd",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
]);
const COMPETITOR_FIELDS = new Set<AgentProfileEditableField>([
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
]);

function LocalAdjustmentChip({ label }: { readonly label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-md border border-brand-info/30 bg-brand-info/[0.07] px-2 py-1 font-mono text-[9px] tracking-[0.06em] text-brand-info uppercase">
      <Check aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
}

function SourceChip({
  source,
  label,
}: {
  readonly source: AgentProfileSourceId;
  readonly label: string;
}) {
  const supplied =
    source === "product_information_supplied" ||
    source === "marketing_strategy_supplied";
  return (
    <span
      data-profile-source={source}
      className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[9px] tracking-[0.06em] uppercase ${
        supplied
          ? "border-brand-accent/30 bg-brand-accent/[0.07] text-brand-accent-text"
          : "border-brand-warning/30 bg-brand-warning/[0.07] text-brand-warning"
      }`}
    >
      {supplied ? (
        <FileText aria-hidden="true" className="size-3" />
      ) : (
        <Sparkles aria-hidden="true" className="size-3" />
      )}
      {label}
    </span>
  );
}

function Fact({
  label,
  value,
  provenance,
}: {
  readonly label: string;
  readonly value: string;
  readonly provenance?: {
    readonly derivation: string;
    readonly label: string;
  };
}) {
  return (
    <div className="min-w-0 border-t border-brand-border-faint pt-2.5">
      <dt className="font-mono text-[9px] tracking-[0.08em] text-text-dark-faint uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-[11.5px] leading-[1.5] text-text-dark-secondary">
        {value}
      </dd>
      {provenance ? (
        <dd
          data-profile-provenance={provenance.derivation}
          className="mt-2 inline-flex max-w-full rounded border border-brand-border-faint bg-brand-panel-raised px-1.5 py-0.5 font-mono text-[9.5px] leading-[1.35] tracking-[0.04em] text-text-dark-secondary uppercase"
        >
          {provenance.label}
        </dd>
      ) : null}
    </div>
  );
}

function StageHeader({
  number,
  label,
}: {
  readonly number: string;
  readonly label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-accent/35 bg-brand-accent/[0.07] font-mono text-[9px] font-semibold tracking-[0.08em] text-brand-accent-text"
      >
        {number}
      </span>
      <p className="min-w-0 font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
        {label}
      </p>
    </div>
  );
}

export function AgentProfilePanel({
  agent,
  locale = "en",
  profile,
  disabled = false,
  onChange,
  onConfirm,
  errorId,
  urlInvalid = false,
  profileSearch,
}: AgentProfilePanelProps) {
  const t = useTranslations("agents.workbench.profile");
  const [reviewing, setReviewing] = useState(false);
  const titleId = `${agent}-profile-heading`;

  function handleUrlChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(redraftAgentProfileForUrl(profile, event.target.value, locale));
  }

  function handleFieldChange(
    field: AgentProfileEditableField,
    value: string,
  ): void {
    const nextValue =
      field === "country" ? value.trim().toUpperCase().slice(0, 2) : value;
    onChange(
      updateAgentProfile(profile, {
        [field]: nextValue,
      } as AgentProfileEdits),
    );
  }

  function handleListFieldChange(
    field: (typeof LIST_FIELDS)[number],
    value: string,
  ): void {
    onChange(
      updateAgentProfile(profile, {
        [field]: value
          .split(/[,\n]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 16),
      }),
    );
  }

  const productAdjusted = profile.editedFields.some((field) =>
    PRODUCT_FIELDS.has(field),
  );
  const icpAdjusted = profile.editedFields.some((field) =>
    ICP_FIELDS.has(field),
  );
  const competitorAdjusted = profile.editedFields.some((field) =>
    COMPETITOR_FIELDS.has(field),
  );
  const contextAdjusted = profile.editedFields.some(
    (field) =>
      !PRODUCT_FIELDS.has(field) &&
      !ICP_FIELDS.has(field) &&
      !COMPETITOR_FIELDS.has(field),
  );

  const canConfirm = !disabled && isAgentProfileReady(profile);
  const missingReadyFields = AGENT_PROFILE_READY_FIELDS.filter((field) => {
    const value = profile[field];
    const source = profile.fieldProvenance.find(
      (entry) => entry.path === `/${field}`,
    );
    return (
      source?.derivation === "missing" ||
      (Array.isArray(value)
        ? value.length === 0
        : typeof value !== "string" || value.trim().length === 0)
    );
  });
  const readinessMessageId = `${agent}-profile-readiness`;
  const missingSearchPrerequisites = [
    profile.targetUrl.trim() ? null : t("fields.targetUrl"),
    /^[A-Z]{2}$/.test(profile.country) ? null : t("fields.country"),
    profile.locale.trim() ? null : t("fields.locale"),
  ].filter((value): value is string => value !== null);
  const searchDisabled = disabled || missingSearchPrerequisites.length > 0;
  function fieldProvenance(field: AgentProfileEditableField) {
    const provenance = profile.fieldProvenance.find(
      (entry) => entry.path === `/${field}`,
    );
    return provenance
      ? {
          derivation: provenance.derivation,
          label: `${t(`provenance.derivations.${provenance.derivation}`)} · ${t(`provenance.confidence.${provenance.confidence}`)}`,
        }
      : undefined;
  }
  const profileSearchCopy: AgentProfileSearchCopy = {
    eyebrow: t("search.eyebrow"),
    title: t("search.title"),
    description: t("search.description"),
    action: t("search.action"),
    loadingAction: t("search.loadingAction"),
    organicBoundary: t("search.organicBoundary"),
    serpBoundary: t("search.serpBoundary"),
    noData: t("search.noData"),
    marketUnsupported: t("search.marketUnsupported"),
    sourceUnavailable: t("search.sourceUnavailable"),
    requestError:
      profileSearch?.errorCode === "auth_required"
        ? t("search.errors.authRequired")
        : profileSearch?.errorCode === "auth_unavailable"
          ? t("search.errors.authUnavailable")
          : profileSearch?.errorCode === "rate_limited"
            ? t("search.errors.rateLimited")
            : t("search.errors.requestFailed"),
    domainLabel: t("search.domainLabel"),
    intersectionsLabel: t("search.intersectionsLabel"),
    averagePositionLabel: t("search.averagePositionLabel"),
    trafficLabel: t("search.trafficLabel"),
    rankLabel: t("search.rankLabel"),
    observedAtLabel: t("search.observedAtLabel"),
  };

  return (
    <section
      data-profile-agent={agent}
      data-profile-review-state={profile.reviewState}
      aria-labelledby={titleId}
      className="relative overflow-hidden rounded-card border border-brand-border-card bg-brand-panel"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-brand-gradient opacity-80"
      />
      <header className="grid gap-4 border-b border-brand-border-faint p-5 md:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <p className="font-mono text-[10px] tracking-[0.13em] text-brand-accent-text uppercase">
            {t("stage")}
          </p>
          <h2
            id={titleId}
            className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-text-dark-primary"
          >
            {t(`${agent}.title`)}
          </h2>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t(`${agent}.body`)}
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-md border border-brand-border-strong bg-brand-panel-sunken px-3 py-2 font-mono text-[9.5px] tracking-[0.06em] text-text-dark-secondary uppercase">
          {profile.reviewState === "confirmed" ? (
            <Check aria-hidden="true" className="size-3 text-brand-accent" />
          ) : (
            <Radar aria-hidden="true" className="size-3 text-brand-warning" />
          )}
          {t(`states.${profile.reviewState}`)}
        </span>
      </header>

      <div className="p-5 md:p-6">
        <label className="block" htmlFor={`${agent}-profile-target-url`}>
          <span className="mb-2 block font-mono text-[9.5px] tracking-[0.1em] text-text-dark-secondary uppercase">
            {t("fields.targetUrl")}
          </span>
          <span className="flex h-12 items-center gap-2.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 transition-colors focus-within:border-brand-accent/70 focus-within:ring-2 focus-within:ring-brand-accent/30">
            <Radar aria-hidden="true" className="size-3.5 shrink-0 text-brand-accent" />
            <input
              id={`${agent}-profile-target-url`}
              aria-label={t("fields.targetUrl")}
              type="text"
              inputMode="url"
              autoComplete="url"
              maxLength={2_048}
              disabled={disabled}
              value={profile.targetUrl}
              onChange={handleUrlChange}
              aria-invalid={urlInvalid}
              aria-describedby={errorId}
              placeholder={t("fields.targetUrlPlaceholder")}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13.5px] text-text-dark-primary outline-none placeholder:text-text-dark-faint disabled:opacity-60"
            />
          </span>
        </label>

        <div
          data-profile-layout="vertical-rail"
          className="relative mt-5 grid gap-3 md:gap-4"
        >
          <article
            data-profile-card="product"
            data-profile-stage="01"
            className="relative grid min-w-0 gap-5 overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken p-4 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-brand-gradient before:opacity-70 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:p-5"
          >
            <div className="min-w-0">
              <StageHeader number="01" label={t("cards.product")} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SourceChip
                  source={profile.sources.product}
                  label={t(`sources.${profile.sources.product}`)}
                />
                {productAdjusted ? (
                  <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
                ) : null}
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                {profile.productName}
              </h3>
              <p className="mt-2 max-w-xl text-[11.5px] leading-[1.6] text-text-dark-secondary">
                {profile.oneLinePositioning}
              </p>
            </div>
            <dl className="grid min-w-0 gap-x-6 gap-y-3 self-start sm:grid-cols-2">
              <Fact
                label={t("facts.valueProposition")}
                value={profile.valueProposition}
                provenance={fieldProvenance("valueProposition")}
              />
              <Fact
                label={t("facts.coreFeatures")}
                value={
                  profile.coreFeatures.length > 0
                    ? profile.coreFeatures.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("coreFeatures")}
              />
              <Fact
                label={t("facts.category")}
                value={profile.categories.join(" · ")}
                provenance={fieldProvenance("categories")}
              />
              <Fact
                label={t("facts.businessModel")}
                value={profile.businessModel}
                provenance={fieldProvenance("businessModel")}
              />
              <Fact
                label={t("facts.primaryCta")}
                value={profile.primaryCta}
                provenance={fieldProvenance("primaryCta")}
              />
              <Fact
                label={t("facts.trustSignals")}
                value={
                  profile.trustSignals.length > 0
                    ? profile.trustSignals.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("trustSignals")}
              />
            </dl>
          </article>

          <article
            data-profile-card="icp"
            data-profile-stage="02"
            className="relative grid min-w-0 gap-5 overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken p-4 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-brand-gradient before:opacity-70 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:p-5"
          >
            <div className="min-w-0">
              <StageHeader number="02" label={t("cards.icp")} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SourceChip
                  source={profile.sources.icp}
                  label={t(`sources.${profile.sources.icp}`)}
                />
                {icpAdjusted ? (
                  <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
                ) : null}
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                {profile.primaryIcp}
              </h3>
            </div>
            <dl className="grid min-w-0 gap-x-6 gap-y-3 self-start sm:grid-cols-2 xl:grid-cols-3">
              <Fact
                label={t("facts.interests")}
                value={
                  profile.icpInterests.length > 0
                    ? profile.icpInterests.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("icpInterests")}
              />
              <Fact
                label={t("facts.buyer")}
                value={profile.buyer}
                provenance={fieldProvenance("buyer")}
              />
              <Fact
                label={t("facts.user")}
                value={profile.user}
                provenance={fieldProvenance("user")}
              />
              <Fact
                label={t("facts.triggerPain")}
                value={profile.triggerPain}
                provenance={fieldProvenance("triggerPain")}
              />
              <Fact
                label={t("facts.useCases")}
                value={
                  profile.useCases.length > 0
                    ? profile.useCases.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("useCases")}
              />
              <Fact
                label={t("fields.jtbd")}
                value={profile.jtbd}
                provenance={fieldProvenance("jtbd")}
              />
              <Fact
                label={t("facts.pain")}
                value={profile.icpPain}
                provenance={fieldProvenance("icpPain")}
              />
              <Fact
                label={t("facts.outcomes")}
                value={
                  profile.outcomes.length > 0
                    ? profile.outcomes.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("outcomes")}
              />
              <Fact
                label={t("facts.barriers")}
                value={
                  profile.barriers.length > 0
                    ? profile.barriers.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("barriers")}
              />
              <Fact
                label={t("facts.qualificationSignals")}
                value={
                  profile.qualificationSignals.length > 0
                    ? profile.qualificationSignals.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("qualificationSignals")}
              />
              <Fact
                label={t("facts.disqualifiers")}
                value={
                  profile.disqualifiers.length > 0
                    ? profile.disqualifiers.join(" · ")
                    : t("values.unavailable")
                }
                provenance={fieldProvenance("disqualifiers")}
              />
              <Fact
                label={t("facts.positioning")}
                value={profile.icpPositioning}
                provenance={fieldProvenance("icpPositioning")}
              />
            </dl>
          </article>

          <article
            data-profile-card="competitor"
            data-profile-stage="03"
            className="relative grid min-w-0 gap-5 overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken p-4 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-brand-gradient before:opacity-70 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:p-5"
          >
            <div className="min-w-0">
              <StageHeader number="03" label={t("cards.competitor")} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SourceChip
                  source={profile.sources.competitor}
                  label={t(`sources.${profile.sources.competitor}`)}
                />
                {competitorAdjusted ? (
                  <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
                ) : null}
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                {t("values.confirmationRequired")}
              </h3>
            </div>
            <dl className="grid min-w-0 gap-x-6 gap-y-3 self-start sm:grid-cols-3">
              <Fact
                label={t("facts.directCompetitors")}
                value={
                  profile.directCompetitors.length > 0
                    ? profile.directCompetitors.join(" · ")
                    : t("values.confirmationRequired")
                }
                provenance={fieldProvenance("directCompetitors")}
              />
              <Fact
                label={t("facts.indirectAlternatives")}
                value={
                  profile.indirectAlternatives.length > 0
                    ? profile.indirectAlternatives.join(" · ")
                    : t("values.confirmationRequired")
                }
                provenance={fieldProvenance("indirectAlternatives")}
              />
              <Fact
                label={t("facts.excludedAlternatives")}
                value={
                  profile.excludedAlternatives.length > 0
                    ? profile.excludedAlternatives.join(" · ")
                    : t("values.confirmationRequired")
                }
                provenance={fieldProvenance("excludedAlternatives")}
              />
            </dl>
            {profileSearch ? (
              <div className="min-w-0 md:col-span-2">
                <AgentProfileSearch
                  loading={profileSearch.loading}
                  data={profileSearch.data}
                  errorCode={profileSearch.errorCode}
                  onDiscover={profileSearch.onDiscover}
                  locale={locale}
                  disabled={searchDisabled}
                  disabledReason={
                    missingSearchPrerequisites.length > 0
                      ? t("search.missingPrerequisite", {
                          fields: missingSearchPrerequisites.join(", "),
                        })
                      : undefined
                  }
                  copy={profileSearchCopy}
                />
              </div>
            ) : null}
          </article>

          <article
            data-profile-card="context"
            data-profile-stage="04"
            className="relative grid min-w-0 gap-5 overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken p-4 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-brand-gradient before:opacity-70 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:p-5"
          >
            <div className="min-w-0">
              <StageHeader number="04" label={t("cards.context")} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SourceChip
                  source={profile.sources.run}
                  label={t(`sources.${profile.sources.run}`)}
                />
                {contextAdjusted ? (
                  <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
                ) : null}
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                {profile.firstOutcome}
              </h3>
            </div>
            <dl className="grid min-w-0 gap-x-6 gap-y-3 self-start sm:grid-cols-2 xl:grid-cols-3">
              <Fact
                label={t("fields.country")}
                value={profile.country || t("values.unavailable")}
                provenance={fieldProvenance("country")}
              />
              <Fact
                label={t("fields.locale")}
                value={profile.locale}
                provenance={fieldProvenance("locale")}
              />
              <Fact
                label={t("fields.device")}
                value={t(`options.device.${profile.device}`)}
                provenance={fieldProvenance("device")}
              />
              <Fact
                label={t("fields.pageType")}
                value={t(`options.pageType.${profile.pageType}`)}
                provenance={fieldProvenance("pageType")}
              />
              <Fact
                label={t("fields.targetQuery")}
                value={profile.targetQuery || t("values.unavailable")}
                provenance={fieldProvenance("targetQuery")}
              />
              <Fact
                label={t("fields.auditScope")}
                value={t(`options.auditScope.${profile.auditScope}`)}
                provenance={fieldProvenance("auditScope")}
              />
            </dl>
          </article>
        </div>

        {reviewing ? (
          <div
            id={`${agent}-profile-editor`}
            className="mt-5 grid gap-4 rounded-row border border-brand-border-dashed bg-brand-bg p-4 md:grid-cols-2"
          >
            {TEXT_FIELDS.map((field) => (
              <label
                key={field}
                className={
                  field === "oneLinePositioning" ||
                  field === "valueProposition" ||
                  field === "businessModel" ||
                  field === "primaryCta" ||
                  field === "buyer" ||
                  field === "user" ||
                  field === "triggerPain" ||
                  field === "icpPain" ||
                  field === "icpBehavior" ||
                  field === "icpPositioning" ||
                  field === "jtbd" ||
                  field === "firstOutcome" ||
                  field === "targetQuery"
                    ? "block md:col-span-2"
                    : "block"
                }
              >
                <span className="mb-1.5 block font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
                  {t(`fields.${field}`)}
                </span>
                <input
                  aria-label={t(`fields.${field}`)}
                  type="text"
                  maxLength={2_048}
                  disabled={disabled}
                  value={profile[field]}
                  onChange={(event) =>
                    handleFieldChange(field, event.target.value)
                  }
                  className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none transition-colors focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/35 disabled:opacity-60"
                />
              </label>
            ))}

            {LIST_FIELDS.map((field) => (
              <label key={field} className="block md:col-span-2">
                <span className="mb-1.5 block font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
                  {t(`fields.${field}`)}
                </span>
                <input
                  aria-label={t(`fields.${field}`)}
                  type="text"
                  maxLength={2_048}
                  disabled={disabled}
                  value={profile[field].join(", ")}
                  onChange={(event) =>
                    handleListFieldChange(field, event.target.value)
                  }
                  className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none transition-colors focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/35 disabled:opacity-60"
                />
              </label>
            ))}

            <label className="block">
              <span className="mb-1.5 block font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
                {t("fields.device")}
              </span>
              <select
                aria-label={t("fields.device")}
                disabled={disabled}
                value={profile.device}
                onChange={(event) =>
                  handleFieldChange("device", event.target.value)
                }
                className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/35 disabled:opacity-60"
              >
                <option value="mobile">{t("options.device.mobile")}</option>
                <option value="desktop">{t("options.device.desktop")}</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
                {t("fields.pageType")}
              </span>
              <select
                aria-label={t("fields.pageType")}
                disabled={disabled}
                value={profile.pageType}
                onChange={(event) =>
                  handleFieldChange("pageType", event.target.value)
                }
                className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/35 disabled:opacity-60"
              >
                {(["homepage", "product", "tool", "guide"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(`options.pageType.${value}`)}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1.5 block font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
                {t("fields.auditScope")}
              </span>
              <select
                aria-label={t("fields.auditScope")}
                disabled={disabled}
                value={profile.auditScope}
                onChange={(event) =>
                  handleFieldChange("auditScope", event.target.value)
                }
                className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/35 disabled:opacity-60"
              >
                <option value="site-first">
                  {t("options.auditScope.site-first")}
                </option>
                <option value="page-only">
                  {t("options.auditScope.page-only")}
                </option>
              </select>
            </label>
          </div>
        ) : null}

        <footer className="mt-5 flex flex-col gap-4 border-t border-brand-border-faint pt-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11.5px] leading-[1.55] text-text-dark-secondary">
              {t("boundary")}
            </p>
            {missingReadyFields.length > 0 ? (
              <p
                id={readinessMessageId}
                className="mt-2 text-[11px] leading-[1.5] text-brand-warning"
              >
                {t("readiness.missing", {
                  fields: missingReadyFields
                    .map((field) => t(`fields.${field}`))
                    .join(", "),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              data-profile-action="review"
              aria-controls={`${agent}-profile-editor`}
              aria-expanded={reviewing}
              disabled={disabled}
              onClick={() => setReviewing((current) => !current)}
              className="inline-flex h-10.5 items-center justify-center gap-2 rounded-[9px] border border-brand-border-strong bg-brand-panel-sunken px-4 text-[12.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60"
            >
              {t("actions.review")}
              <ChevronDown
                aria-hidden="true"
                className={`size-3.5 transition-transform ${reviewing ? "rotate-180" : ""}`}
              />
            </button>
            <button
              type="button"
              data-profile-action="confirm"
              disabled={!canConfirm}
              aria-describedby={
                missingReadyFields.length > 0 ? readinessMessageId : undefined
              }
              onClick={() => onConfirm(confirmAgentProfile(profile))}
              className="inline-flex h-10.5 items-center justify-center gap-2 rounded-[9px] bg-brand-gradient px-4 text-[12.5px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {t("actions.confirmRun")}
              <Check aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </footer>
      </div>
    </section>
  );
}
