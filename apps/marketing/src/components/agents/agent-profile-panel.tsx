// @input  -- one Agent-owned Product/ICP draft and local state callbacks
// @output -- compact source-backed review, explicit assumptions, and confirmation UI
// @pos    -- Stage 01 panel shared visually but never by state across SEO/Tech pages

"use client";

import {
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  LoaderCircle,
  Radar,
  Sparkles,
} from "lucide-react";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { AgentProfileSearchData } from "../../lib/agents/profile-search-contract";
import type {
  AgentProfileRefreshData,
  AgentProfileRefreshMode,
} from "../../lib/agents/profile-refresh-contract";
import {
  classifyAgentCompetitorProfile,
  deriveAgentCompetitorSuggestions,
} from "./agent-competitor-candidates";
import {
  AgentProfileSearch,
  type AgentCompetitorClassification,
  type AgentProfileSearchCopy,
} from "./agent-profile-search";
import {
  AGENT_PROFILE_READY_FIELDS,
  acceptAgentProfileRefreshFields,
  confirmAgentProfile,
  isAgentProfileReady,
  listAgentProfileRefreshProposals,
  redraftAgentProfileForUrl,
  summarizeAgentProfileRefresh,
  updateAgentProfile,
  type AgentProfileDraft,
  type AgentProfileEditableField,
  type AgentProfileEdits,
  type AgentProfileFieldSource,
  type AgentProfileSourceId,
} from "./agent-profile";
import { getSuppliedProductInformation } from "./agent-product-information";
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
  readonly profileRefresh?: {
    readonly loading: boolean;
    readonly data: AgentProfileRefreshData | null;
    readonly errorCode: string | null;
  };
  readonly onRefresh?: (mode: AgentProfileRefreshMode) => void;
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
const PRODUCT_INFORMATION_UNSUPPORTED_ICP_FIELDS = [
  "buyer",
  "icpPain",
  "icpBehavior",
  "barriers",
  "disqualifiers",
] as const satisfies readonly AgentProfileEditableField[];

const PROFILE_MARKET_SUGGESTIONS = [
  "US",
  "CN",
  "GB",
  "CA",
  "AU",
  "DE",
  "FR",
  "JP",
  "KR",
  "SG",
  "IN",
  "BR",
] as const;
const PROFILE_LANGUAGE_SUGGESTIONS = [
  "en-US",
  "zh-CN",
  "en-GB",
  "de-DE",
  "fr-FR",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "es-ES",
] as const;
const PROFILE_REFRESH_ERROR_KEYS = new Set([
  "profile_timeout",
  "profile_response_invalid",
  "profile_source_unavailable",
  "auth_required",
  "auth_unavailable",
  "intent_unavailable",
  "rate_limited",
  "request_failed",
  "unknown",
]);

type ProfileSourceClass =
  | "supplied"
  | "manual"
  | "live_public_page"
  | "inferred"
  | "missing";
type ProfileSectionSourceClass = ProfileSourceClass | "mixed";

function profileSourceClass(source: AgentProfileFieldSource): ProfileSourceClass {
  if (
    source === "supplied_product_information" ||
    source === "supplied_marketing_strategy"
  ) {
    return "supplied";
  }
  if (source === "user_edit") return "manual";
  if (source === "public_page") return "live_public_page";
  if (source === "not_available") return "missing";
  return "inferred";
}

function proposalValue(value: string | readonly string[]): string {
  return typeof value === "string" ? value : value.join(" · ");
}

function canonicalLanguageTag(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 35) return null;
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
}

function profileRefreshErrorKey(errorCode: string): string {
  return PROFILE_REFRESH_ERROR_KEYS.has(errorCode)
    ? errorCode
    : "request_failed";
}

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
  sectionSource,
}: {
  readonly source: AgentProfileSourceId;
  readonly label: string;
  readonly sectionSource: ProfileSectionSourceClass;
}) {
  const supplied = sectionSource === "supplied";
  return (
    <span
      data-profile-source={source}
      data-profile-section-source={sectionSource}
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
    readonly sourceClass: ProfileSourceClass;
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
          data-profile-source-class={provenance.sourceClass}
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

function ProductInformationSection({
  section,
  label,
  children,
}: {
  readonly section: "overview" | "experience" | "commercial" | "technical";
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      data-product-information-section={section}
      className="min-w-0 rounded-row border border-brand-border bg-brand-bg/35 p-4"
    >
      <div className="mb-4 flex min-w-0 items-center gap-2">
        <FileText aria-hidden="true" className="size-3.5 shrink-0 text-brand-accent" />
        <h4 className="min-w-0 font-mono text-[10px] font-semibold tracking-[0.08em] text-text-dark-secondary uppercase">
          {label}
        </h4>
      </div>
      {children}
    </section>
  );
}

function ProfileRefreshSourceLink({
  sourceUrl,
}: {
  readonly sourceUrl: string;
}) {
  return (
    <a
      data-profile-refresh-source
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 text-[10.5px] text-brand-info underline decoration-brand-info/35 underline-offset-2 hover:decoration-brand-info"
    >
      <span className="max-w-[28rem] truncate">{sourceUrl}</span>
      <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
    </a>
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
  profileRefresh,
  onRefresh,
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

  function handleCompetitorClassification(
    domain: string,
    classification: AgentCompetitorClassification,
  ): void {
    if (disabled) return;
    onChange(classifyAgentCompetitorProfile(profile, domain, classification));
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
  const hasBusinessFrame =
    profile.directCompetitors.length > 0 ||
    profile.indirectAlternatives.length > 0 ||
    profile.excludedAlternatives.length > 0;
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
    profile.country === "CN" && !profile.targetQuery.trim()
      ? t("fields.targetQuery")
      : null,
  ].filter((value): value is string => value !== null);
  const searchDisabled = disabled || missingSearchPrerequisites.length > 0;
  const refreshData = profileRefresh?.data ?? null;
  const refreshSummary = refreshData
    ? summarizeAgentProfileRefresh(profile, refreshData)
    : null;
  const refreshProposals = refreshData
    ? listAgentProfileRefreshProposals(profile, refreshData)
    : [];
  const actionableRefreshProposals = refreshProposals.filter(
    (proposal) => proposal.currentSource !== "user_edit",
  );
  const targetLanguageValid = canonicalLanguageTag(profile.locale) !== null;
  const marketOptionsId = `${agent}-profile-market-options`;
  const languageOptionsId = `${agent}-profile-language-options`;
  const suppliedProductInformation = getSuppliedProductInformation(
    profile,
    locale,
  );
  const missingProductInformationIcpFields =
    PRODUCT_INFORMATION_UNSUPPORTED_ICP_FIELDS.filter((field) =>
      profile.fieldProvenance.some(
        (entry) =>
          entry.path === `/${field}` &&
          entry.source !== "supplied_product_information" &&
          entry.source !== "user_edit",
      ),
    );

  function sectionSourceClass(
    fields: readonly AgentProfileEditableField[],
  ): ProfileSectionSourceClass {
    const classes = new Set(
      fields.flatMap((field) => {
        const provenance = profile.fieldProvenance.find(
          (entry) => entry.path === `/${field}`,
        );
        return provenance ? [profileSourceClass(provenance.source)] : [];
      }),
    );
    if (classes.size > 1) return "mixed";
    return classes.values().next().value ?? "missing";
  }

  function sectionSourceLabel(
    source: AgentProfileSourceId,
    sourceClass: ProfileSectionSourceClass,
  ): string {
    if (sourceClass === "mixed") return t("sources.mixed_sources");
    if (sourceClass === "live_public_page") {
      return t("sources.public_page_refresh");
    }
    if (sourceClass === "manual") return t("sources.locally_adjusted");
    if (sourceClass === "missing") return t("sources.confirmation_required");
    return t(`sources.${source}`);
  }

  function acceptRefreshFields(
    paths: readonly (typeof refreshProposals)[number]["path"][],
  ): void {
    if (!refreshData || disabled) return;
    onChange(acceptAgentProfileRefreshFields(profile, refreshData, paths));
  }

  function fieldProvenance(field: AgentProfileEditableField) {
    const provenance = profile.fieldProvenance.find(
      (entry) => entry.path === `/${field}`,
    );
    const sourceClass = provenance
      ? profileSourceClass(provenance.source)
      : "missing";
    return provenance
      ? {
          derivation: provenance.derivation,
          sourceClass,
          label: `${t(`provenance.derivations.${provenance.derivation}`)} · ${t(`provenance.confidence.${provenance.confidence}`)} · ${t(`provenance.sourceClasses.${sourceClass}`)}`,
        }
      : undefined;
  }
  function contextFieldValue(
    field: "country" | "locale" | "targetQuery",
  ): string {
    return profile[field].trim() || t("values.confirmationRequired");
  }
  function contextFieldProvenance(
    field: "country" | "locale" | "targetQuery",
  ) {
    return profile[field].trim()
      ? fieldProvenance(field)
      : {
          derivation: "missing",
          sourceClass: "missing" as const,
          label: `${t("provenance.derivations.missing")} · ${t("provenance.confidence.unknown")} · ${t("provenance.sourceClasses.missing")}`,
        };
  }

  const productSectionSource = sectionSourceClass([
    "productName",
    "oneLinePositioning",
    ...PRODUCT_FIELDS,
  ]);
  const icpSectionSource = sectionSourceClass([
    "primaryIcp",
    ...ICP_FIELDS,
  ]);
  const competitorSectionSource = sectionSourceClass([
    ...COMPETITOR_FIELDS,
  ]);
  const contextSectionSource = sectionSourceClass([
    "firstOutcome",
    "country",
    "locale",
    "device",
    "pageType",
    "targetQuery",
    "auditScope",
  ]);
  const competitorSuggestions = profileSearch?.data
    ? deriveAgentCompetitorSuggestions(profileSearch.data, profile.host)
    : [];
  let searchSummary: { readonly state: string; readonly label: string } | null =
    null;
  if (profileSearch?.loading) {
    searchSummary = { state: "loading", label: t("search.summary.loading") };
  } else if (profileSearch?.errorCode) {
    searchSummary = {
      state:
        profileSearch.errorCode === "search_timeout"
          ? "search_timeout"
          : "request_error",
      label: t("search.summary.requestError"),
    };
  } else if (profileSearch?.data?.availability === "available") {
    searchSummary = {
      state: "available",
      label: t("search.summary.available", {
        count: competitorSuggestions.length,
      }),
    };
  } else if (profileSearch?.data?.availability === "no_data") {
    searchSummary = { state: "no_data", label: t("search.summary.noData") };
  } else if (profileSearch?.data?.availability === "source_unavailable") {
    searchSummary = {
      state: "source_unavailable",
      label: t("search.summary.sourceUnavailable"),
    };
  } else if (profileSearch?.data?.availability === "market_unsupported") {
    searchSummary = {
      state: "market_unsupported",
      label: t("search.summary.marketUnsupported"),
    };
  } else if (profileSearch) {
    searchSummary = { state: "idle", label: t("search.summary.idle") };
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
          : profileSearch?.errorCode === "search_timeout"
            ? t("search.errors.searchTimeout")
          : profileSearch?.errorCode === "rate_limited"
            ? t("search.errors.rateLimited")
            : t("search.errors.requestFailed"),
    domainLabel: t("search.domainLabel"),
    intersectionsLabel: t("search.intersectionsLabel"),
    averagePositionLabel: t("search.averagePositionLabel"),
    trafficLabel: t("search.trafficLabel"),
    rankLabel: t("search.rankLabel"),
    observedAtLabel: t("search.observedAtLabel"),
    unavailableMetricLabel: t("search.unavailableMetricLabel"),
    providerCountLabel: t("search.counts.providerLabel"),
    confirmedCountLabel: t("search.counts.confirmedLabel"),
    excludedCountLabel: t("search.counts.excludedLabel"),
    providerEvidenceLabel: t("search.review.providerEvidence"),
    needsReviewLabel: t("search.review.needsReview"),
    higherOverlapLabel: t("search.review.higherOverlap"),
    adjacentOverlapLabel: t("search.review.adjacentOverlap"),
    unclassifiedLabel: t("search.review.targetQueryObserved"),
    currentDirectLabel: t("search.review.currentDirect"),
    currentIndirectLabel: t("search.review.currentIndirect"),
    currentExcludedLabel: t("search.review.currentExcluded"),
    directAction: t("search.review.actions.direct"),
    indirectAction: t("search.review.actions.indirect"),
    excludeAction: t("search.review.actions.exclude"),
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
        <div
          data-profile-refresh-control
          aria-busy={profileRefresh?.loading || undefined}
          className="grid gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-4 lg:grid-cols-[minmax(18rem,1fr)_minmax(9rem,0.28fr)_minmax(10rem,0.32fr)_auto] lg:items-end"
        >
          <label className="block" htmlFor={`${agent}-profile-target-url`}>
            <span className="mb-2 block font-mono text-[9.5px] tracking-[0.1em] text-text-dark-secondary uppercase">
              {t("fields.targetUrl")}
            </span>
            <span className="flex h-12 items-center gap-2.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 transition-colors focus-within:border-brand-accent/70 focus-within:ring-2 focus-within:ring-brand-accent/30">
              <Radar aria-hidden="true" className="size-3.5 shrink-0 text-brand-accent" />
              <input
                id={`${agent}-profile-target-url`}
                data-profile-refresh-field="url"
                aria-label={t("fields.targetUrl")}
                type="text"
                inputMode="url"
                autoComplete="url"
                maxLength={2_048}
                disabled={disabled || profileRefresh?.loading}
                value={profile.targetUrl}
                onChange={handleUrlChange}
                aria-invalid={urlInvalid}
                aria-describedby={errorId}
                placeholder={t("fields.targetUrlPlaceholder")}
                className="min-w-0 flex-1 bg-transparent font-mono text-[13.5px] text-text-dark-primary outline-none placeholder:text-text-dark-faint disabled:opacity-60"
              />
            </span>
          </label>

          <label className="block" htmlFor={`${agent}-profile-market`}>
            <span className="mb-2 block font-mono text-[9.5px] tracking-[0.1em] text-text-dark-secondary uppercase">
              {t("refresh.fields.market")}
            </span>
            <input
              id={`${agent}-profile-market`}
              data-profile-refresh-field="market"
              aria-label={t("refresh.fields.market")}
              type="text"
              inputMode="text"
              autoComplete="country"
              list={marketOptionsId}
              maxLength={2}
              disabled={disabled || profileRefresh?.loading}
              value={profile.country}
              onChange={(event) =>
                handleFieldChange("country", event.target.value)
              }
              placeholder={t("refresh.fields.marketPlaceholder")}
              className="h-12 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-3 font-mono text-[13px] text-text-dark-primary outline-none transition-colors placeholder:text-text-dark-faint focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/30 disabled:opacity-60"
            />
            <datalist id={marketOptionsId}>
              {PROFILE_MARKET_SUGGESTIONS.map((market) => (
                <option key={market} value={market} />
              ))}
            </datalist>
          </label>

          <label className="block" htmlFor={`${agent}-profile-language`}>
            <span className="mb-2 block font-mono text-[9.5px] tracking-[0.1em] text-text-dark-secondary uppercase">
              {t("refresh.fields.language")}
            </span>
            <input
              id={`${agent}-profile-language`}
              data-profile-refresh-field="language"
              aria-label={t("refresh.fields.language")}
              type="text"
              inputMode="text"
              list={languageOptionsId}
              maxLength={35}
              disabled={disabled || profileRefresh?.loading}
              aria-invalid={
                profile.locale.trim() && !targetLanguageValid ? true : undefined
              }
              value={profile.locale}
              onChange={(event) =>
                handleFieldChange("locale", event.target.value)
              }
              placeholder={t("refresh.fields.languagePlaceholder")}
              className="h-12 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-3 font-mono text-[13px] text-text-dark-primary outline-none transition-colors placeholder:text-text-dark-faint focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/30 disabled:opacity-60"
            />
            <datalist id={languageOptionsId}>
              {PROFILE_LANGUAGE_SUGGESTIONS.map((language) => (
                <option key={language} value={language} />
              ))}
            </datalist>
          </label>

          <button
            type="button"
            data-profile-refresh-action="run"
            disabled={
              disabled ||
              profileRefresh?.loading ||
              !onRefresh ||
              !profile.targetUrl.trim() ||
              !/^[A-Z]{2}$/.test(profile.country) ||
              !targetLanguageValid
            }
            onClick={() =>
              onRefresh?.(refreshData ? "refresh" : "prefer_cache")
            }
            className="inline-flex h-12 w-full items-center justify-center rounded-[10px] bg-brand-gradient px-5 text-[12.5px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none lg:w-auto"
          >
            {profileRefresh?.loading ? (
              <LoaderCircle aria-hidden="true" className="mr-2 size-3.5 animate-spin" />
            ) : null}
            {refreshData
              ? t("refresh.actions.refresh")
              : t("refresh.actions.run")}
          </button>

          {profileRefresh?.loading ? (
            <p
              data-profile-refresh-status="loading"
              role="status"
              aria-live="polite"
              className="text-[11.5px] leading-[1.55] text-text-dark-secondary lg:col-span-4"
            >
              {t("refresh.loading")}
            </p>
          ) : profileRefresh?.errorCode ? (
            <p
              data-profile-refresh-status="error"
              role="alert"
              className="rounded-md border border-brand-error/35 bg-brand-error/[0.07] px-3 py-2 text-[11.5px] leading-[1.55] text-brand-error lg:col-span-4"
            >
              {t(
                `refresh.errors.${profileRefreshErrorKey(profileRefresh.errorCode)}`,
              )}
            </p>
          ) : refreshData ? (
            <div
              data-profile-refresh-status={String(
                refreshData.availability,
              )}
              className="grid gap-3 border-t border-brand-border-faint pt-3 lg:col-span-4"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <strong className="text-[12px] font-semibold text-text-dark-primary">
                  {t(
                    `refresh.availability.${String(refreshData.availability)}`,
                  )}
                </strong>
                <span
                  data-profile-refresh-cache={refreshData.cache.status}
                  className="rounded border border-brand-accent/25 bg-brand-accent/[0.06] px-2 py-1 font-mono text-[9px] tracking-[0.05em] text-brand-accent-text uppercase"
                >
                  {t(`refresh.cache.${refreshData.cache.status}`)}
                </span>
                <time
                  dateTime={refreshData.cache.capturedAt}
                  className="font-mono text-[9.5px] text-text-dark-faint"
                >
                  {refreshData.cache.capturedAt}
                </time>
              </div>

              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(
                  [
                    [
                      "pages",
                      refreshData.diagnostics.pagesFetched,
                      t("refresh.metrics.pages"),
                    ],
                    [
                      "product-pages",
                      refreshData.diagnostics.productPagesFetched,
                      t("refresh.metrics.productPages"),
                    ],
                    [
                      "sources",
                      refreshData.diagnostics.sourceUrls.length,
                      t("refresh.metrics.sources"),
                    ],
                  ] as const
                ).map(([hook, value, label]) => {
                  return (
                    <div
                      key={hook}
                      data-profile-refresh-metric={hook}
                      className="rounded-md border border-brand-border-faint bg-brand-bg px-3 py-2"
                    >
                      <dt className="font-mono text-[8.5px] tracking-[0.06em] text-text-dark-faint uppercase">
                        {label}
                      </dt>
                      <dd className="mt-1 text-[13px] font-semibold text-text-dark-primary">
                        {String(value)}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              {refreshSummary ? (
                <dl
                  data-profile-refresh-adoption
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                >
                  {(
                    [
                      ["found", refreshSummary.found],
                      ["applied", refreshSummary.applied],
                      ["retained", refreshSummary.retained],
                      ["unavailable", refreshSummary.unavailable],
                    ] as const
                  ).map(([name, value]) => (
                    <div
                      key={name}
                      data-profile-refresh-count={name}
                      className="rounded-md border border-brand-border-faint bg-brand-bg px-3 py-2"
                    >
                      <dt className="font-mono text-[8.5px] tracking-[0.06em] text-text-dark-faint uppercase">
                        {t(`refresh.counts.${name}`)}
                      </dt>
                      <dd className="mt-1 text-[13px] font-semibold text-text-dark-primary">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {refreshData.diagnostics.fieldsMissing > 0 ? (
                <div
                  data-profile-refresh-unavailable-fields
                  className="grid gap-2 rounded-md border border-brand-warning/20 bg-brand-warning/[0.045] px-3 py-2.5"
                >
                  <p className="text-[10.5px] leading-[1.5] text-text-dark-secondary">
                    {t("refresh.diagnostics.unavailableFields")}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {refreshData.fields
                      .filter((field) => field.state === "unavailable")
                      .map((field) => (
                        <li
                          key={field.path}
                          className="rounded border border-brand-border-faint bg-brand-bg px-2 py-1 font-mono text-[9px] leading-[1.35] text-text-dark-secondary"
                        >
                          {t(`fields.${field.path}`)}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {refreshProposals.length > 0 ? (
                <section
                  data-profile-refresh-proposals
                  aria-labelledby={`${agent}-profile-refresh-proposals`}
                  className="grid gap-3 rounded-row border border-brand-info/20 bg-brand-info/[0.035] p-3.5"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="font-mono text-[9px] tracking-[0.08em] text-brand-info uppercase">
                        {t("refresh.proposals.eyebrow")}
                      </p>
                      <h3
                        id={`${agent}-profile-refresh-proposals`}
                        className="mt-1 text-[13px] font-semibold text-text-dark-primary"
                      >
                        {t("refresh.proposals.title")}
                      </h3>
                      <p className="mt-1 max-w-3xl text-[10.5px] leading-[1.55] text-text-dark-secondary">
                        {t("refresh.proposals.description")}
                      </p>
                    </div>
                    {actionableRefreshProposals.length > 0 ? (
                      <button
                        type="button"
                        data-profile-refresh-proposal-action="all"
                        disabled={disabled}
                        onClick={() =>
                          acceptRefreshFields(
                            actionableRefreshProposals.map(
                              (proposal) => proposal.path,
                            ),
                          )
                        }
                        className="inline-flex w-full shrink-0 items-center justify-center rounded-md border border-brand-info/35 bg-brand-info/[0.09] px-3 py-2 text-[10.5px] font-semibold text-brand-info transition-colors hover:bg-brand-info/[0.14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-info disabled:opacity-50 md:w-auto"
                      >
                        {t("refresh.proposals.applyAll")}
                      </button>
                    ) : null}
                  </div>

                  <ul className="grid gap-2">
                    {refreshProposals.map((proposal) => {
                      const manual = proposal.currentSource === "user_edit";
                      const evidenceLabel = t("refresh.proposals.evidence", {
                        count: proposal.evidenceUrls.length,
                      });
                      return (
                        <li
                          key={proposal.path}
                          data-profile-refresh-proposal={proposal.path}
                          className="grid min-w-0 gap-3 rounded-md border border-brand-border-faint bg-brand-bg p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start"
                        >
                          <div
                            data-profile-refresh-proposal-current
                            className="min-w-0"
                          >
                            <p className="font-mono text-[8.5px] tracking-[0.07em] text-text-dark-faint uppercase">
                              {t("refresh.proposals.current")}
                            </p>
                            <p className="mt-1 break-words text-[11px] leading-[1.5] text-text-dark-secondary">
                              {proposalValue(proposal.currentValue)}
                            </p>
                            <p className="mt-1 font-mono text-[8.5px] tracking-[0.04em] text-text-dark-faint uppercase">
                              {t(
                                `provenance.sourceClasses.${profileSourceClass(proposal.currentSource)}`,
                              )}
                            </p>
                          </div>
                          <div
                            data-profile-refresh-proposal-live
                            className="min-w-0"
                          >
                            <p className="font-mono text-[8.5px] tracking-[0.07em] text-brand-info uppercase">
                              {t("refresh.proposals.live")}
                            </p>
                            <p className="mt-1 break-words text-[11px] leading-[1.5] text-text-dark-primary">
                              {proposalValue(proposal.liveValue)}
                            </p>
                            {proposal.evidenceUrls.length === 1 ? (
                              <a
                                data-profile-refresh-proposal-evidence
                                data-profile-refresh-proposal-evidence-url
                                href={proposal.evidenceUrls[0]}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex max-w-full items-center gap-1 text-[9.5px] text-brand-info underline decoration-brand-info/35 underline-offset-2"
                              >
                                <span className="truncate">{evidenceLabel}</span>
                                <ExternalLink
                                  aria-hidden="true"
                                  className="size-3 shrink-0"
                                />
                              </a>
                            ) : (
                              <details
                                data-profile-refresh-proposal-evidence
                                className="group mt-1.5 rounded border border-brand-info/15 bg-brand-info/[0.025] px-2 py-1.5"
                              >
                                <summary className="cursor-pointer text-[9.5px] font-medium text-brand-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-info">
                                  {evidenceLabel}
                                </summary>
                                <ul className="mt-1.5 grid gap-1.5">
                                  {proposal.evidenceUrls.map((evidenceUrl) => (
                                    <li key={evidenceUrl} className="min-w-0">
                                      <a
                                        data-profile-refresh-proposal-evidence-url
                                        href={evidenceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex max-w-full items-center gap-1 text-[9px] text-brand-info underline decoration-brand-info/35 underline-offset-2"
                                      >
                                        <span className="truncate">
                                          {evidenceUrl}
                                        </span>
                                        <ExternalLink
                                          aria-hidden="true"
                                          className="size-3 shrink-0"
                                        />
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                          <div className="md:pt-0.5">
                            <button
                              type="button"
                              data-profile-refresh-proposal-action={
                                proposal.path
                              }
                              aria-label={t("refresh.proposals.useLabel", {
                                field: t(`fields.${proposal.path}`),
                              })}
                              disabled={disabled || manual}
                              onClick={() =>
                                acceptRefreshFields([proposal.path])
                              }
                              className="inline-flex w-full items-center justify-center rounded-md border border-brand-border-strong bg-brand-panel-raised px-3 py-2 text-[10px] font-semibold text-text-dark-primary transition-colors hover:border-brand-info/55 hover:text-brand-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-info disabled:cursor-not-allowed disabled:opacity-55 md:w-auto"
                            >
                              {manual
                                ? t("refresh.proposals.manualRetained")
                                : t("refresh.proposals.use")}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {!refreshData.diagnostics.contextSufficient ||
              refreshData.diagnostics.stopReason ? (
                <div className="grid gap-1 text-[10.5px] leading-[1.55] text-brand-warning">
                  {!refreshData.diagnostics.contextSufficient ? (
                    <p data-profile-refresh-limitation>
                      {t("refresh.diagnostics.insufficient")}
                    </p>
                  ) : null}
                  {refreshData.diagnostics.stopReason ? (
                    <p
                      data-profile-refresh-stop-reason={
                        refreshData.diagnostics.stopReason
                      }
                    >
                      {refreshData.diagnostics.stopReason === "max_urls"
                        ? t("refresh.diagnostics.stopReasons.max_urls", {
                            pages: refreshData.diagnostics.pagesFetched,
                          })
                        : t(
                            `refresh.diagnostics.stopReasons.${refreshData.diagnostics.stopReason}`,
                          )}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-2">
                <p
                  data-profile-refresh-source-total
                  className="font-mono text-[9px] tracking-[0.06em] text-text-dark-faint uppercase"
                >
                  <strong className="text-text-dark-secondary">
                    {refreshData.diagnostics.sourceUrls.length}
                  </strong>{" "}
                  {t("refresh.sources.total")}
                </p>
                <ul
                  data-profile-refresh-source-preview
                  className="flex flex-wrap gap-x-4 gap-y-1.5"
                >
                  {refreshData.diagnostics.sourceUrls
                    .slice(0, 3)
                    .map((sourceUrl) => (
                      <li key={sourceUrl}>
                        <ProfileRefreshSourceLink sourceUrl={sourceUrl} />
                      </li>
                    ))}
                </ul>
                {refreshData.diagnostics.sourceUrls.length > 3 ? (
                  <details
                    data-profile-refresh-source-details
                    className="group rounded-md border border-brand-border-faint bg-brand-bg px-3 py-2"
                  >
                    <summary className="cursor-pointer text-[10.5px] font-medium text-brand-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-info">
                      {t("refresh.sources.expand", {
                        count: refreshData.diagnostics.sourceUrls.length - 3,
                      })}
                    </summary>
                    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {refreshData.diagnostics.sourceUrls
                        .slice(3)
                        .map((sourceUrl) => (
                          <li key={sourceUrl}>
                            <ProfileRefreshSourceLink sourceUrl={sourceUrl} />
                          </li>
                        ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div
          data-profile-layout="vertical-rail"
          className="relative mt-5 grid gap-3 md:gap-4"
        >
          <article
            data-profile-card="product"
            data-profile-stage="01"
            className="relative min-w-0 overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken p-4 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-brand-gradient before:opacity-70 md:p-5"
          >
            <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
              <div className="min-w-0">
                <StageHeader number="01" label={t("cards.product")} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SourceChip
                    source={profile.sources.product}
                    sectionSource={productSectionSource}
                    label={sectionSourceLabel(
                      profile.sources.product,
                      productSectionSource,
                    )}
                  />
                  {productAdjusted ? (
                    <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
                  ) : null}
                </div>
                <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                  {profile.productName}
                </h3>
                <p className="mt-2 max-w-xl text-[13px] leading-[1.65] text-text-dark-secondary">
                  {profile.oneLinePositioning}
                </p>
              </div>
              {suppliedProductInformation ? (
                <p className="min-w-0 self-end border-l border-brand-accent/45 pl-4 text-[12px] leading-[1.65] text-text-dark-secondary">
                  {t("document.boundary")}
                </p>
              ) : null}
            </div>

            {suppliedProductInformation ? (
              <div className="mt-5 grid min-w-0 gap-3">
                <ProductInformationSection
                  section="overview"
                  label={t("document.sections.overview")}
                >
                  <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Fact
                      label={t("document.facts.website")}
                      value={
                        suppliedProductInformation?.website ||
                        profile.host ||
                        t("values.unavailable")
                      }
                    />
                    <Fact
                      label={t("document.facts.productType")}
                      value={
                        suppliedProductInformation?.productType ??
                        t("values.unavailable")
                      }
                    />
                    <Fact
                      label={t("facts.category")}
                      value={
                        profile.categories.length > 0
                          ? profile.categories.join(" · ")
                          : t("values.unavailable")
                      }
                      provenance={fieldProvenance("categories")}
                    />
                    <Fact
                      label={t("document.facts.targetCustomers")}
                      value={
                        suppliedProductInformation?.targetCustomers ??
                        profile.primaryIcp
                      }
                    />
                  </dl>
                </ProductInformationSection>

                <ProductInformationSection
                  section="experience"
                  label={t("document.sections.experience")}
                >
                  <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fact
                      label={t("document.facts.functionOverview")}
                      value={
                        suppliedProductInformation?.functionOverview ??
                        profile.oneLinePositioning
                      }
                    />
                    <Fact
                      label={t("facts.valueProposition")}
                      value={profile.valueProposition}
                      provenance={fieldProvenance("valueProposition")}
                    />
                  </dl>
                  <ol
                    data-product-information-features
                    className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    {(suppliedProductInformation?.features ??
                      profile.coreFeatures.map((name) => ({
                        name,
                        detail: t("values.unavailable"),
                      }))).map((feature, index) => (
                      <li
                        key={`${feature.name}-${index}`}
                        className="min-w-0 rounded-md border border-brand-border-faint bg-brand-panel-raised/55 p-3"
                      >
                        <p className="text-[12px] font-semibold leading-[1.45] text-text-dark-primary">
                          {feature.name}
                        </p>
                        <p className="mt-1 text-[11px] leading-[1.55] text-text-dark-secondary">
                          {feature.detail}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
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
                      label={t("facts.primaryCta")}
                      value={profile.primaryCta}
                      provenance={fieldProvenance("primaryCta")}
                    />
                  </dl>
                </ProductInformationSection>

                <ProductInformationSection
                  section="commercial"
                  label={t("document.sections.commercial")}
                >
                  <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fact
                      label={t("facts.businessModel")}
                      value={profile.businessModel}
                      provenance={fieldProvenance("businessModel")}
                    />
                    <Fact
                      label={t("document.facts.payment")}
                      value={
                        suppliedProductInformation?.paymentProcessor ??
                        t("values.unavailable")
                      }
                    />
                  </dl>
                  {suppliedProductInformation ? (
                    <div
                      data-product-information-pricing
                      className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4"
                    >
                      {suppliedProductInformation.pricing.map((tier) => (
                        <div
                          key={tier.name}
                          className="min-w-0 rounded-md border border-brand-border-faint bg-brand-panel-raised/55 p-3"
                        >
                          <p className="font-mono text-[9px] tracking-[0.08em] text-text-dark-faint uppercase">
                            {tier.name}
                          </p>
                          <p className="mt-1.5 text-[15px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                            {tier.price}
                          </p>
                          <p className="mt-1 text-[10.5px] leading-[1.5] text-text-dark-secondary">
                            {tier.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-[11.5px] text-text-dark-secondary">
                      {t("values.unavailable")}
                    </p>
                  )}
                  <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fact
                      label={t("document.facts.pricing")}
                      value={
                        suppliedProductInformation
                          ? suppliedProductInformation.pricing
                              .map((tier) => `${tier.name}: ${tier.price}`)
                              .join(" · ")
                          : t("values.unavailable")
                      }
                    />
                    <Fact
                      label={t("document.facts.currencies")}
                      value={
                        suppliedProductInformation?.currencies.join(" · ") ??
                        t("values.unavailable")
                      }
                    />
                  </dl>
                </ProductInformationSection>

                <ProductInformationSection
                  section="technical"
                  label={t("document.sections.technical")}
                >
                  <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {(suppliedProductInformation?.technicalSignals ??
                      profile.trustSignals).map((signal) => (
                      <li
                        key={signal}
                        className="min-w-0 rounded-md border border-brand-border-faint bg-brand-panel-raised/55 px-3 py-2.5 text-[11.5px] leading-[1.55] text-text-dark-secondary"
                      >
                        {signal}
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-4">
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
                </ProductInformationSection>
              </div>
            ) : (
              <dl className="mt-5 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
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
                  value={
                    profile.categories.length > 0
                      ? profile.categories.join(" · ")
                      : t("values.unavailable")
                  }
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
            )}
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
                  sectionSource={icpSectionSource}
                  label={sectionSourceLabel(
                    profile.sources.icp,
                    icpSectionSource,
                  )}
                />
                {icpAdjusted ? (
                  <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
                ) : null}
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                {profile.primaryIcp}
              </h3>
            </div>
            <div className="min-w-0">
              <dl className="grid min-w-0 gap-x-6 gap-y-3 self-start sm:grid-cols-2">
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
                  label={t("facts.outcomes")}
                  value={
                    profile.outcomes.length > 0
                      ? profile.outcomes.join(" · ")
                      : t("values.unavailable")
                  }
                  provenance={fieldProvenance("outcomes")}
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
                  label={t("facts.positioning")}
                  value={profile.icpPositioning}
                  provenance={fieldProvenance("icpPositioning")}
                />
              </dl>
              <div className="mt-4 rounded-row border border-brand-border-faint bg-brand-bg/35 p-3">
                <h4 className="font-mono text-[9px] tracking-[0.08em] text-text-dark-faint uppercase">
                  {t("document.confirmationTitle")}
                </h4>
                <dl className="mt-1 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Fact
                    label={t("facts.buyer")}
                    value={profile.buyer}
                    provenance={fieldProvenance("buyer")}
                  />
                  <Fact
                    label={t("facts.pain")}
                    value={profile.icpPain}
                    provenance={fieldProvenance("icpPain")}
                  />
                  <Fact
                    label={t("fields.icpBehavior")}
                    value={profile.icpBehavior}
                    provenance={fieldProvenance("icpBehavior")}
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
                    label={t("facts.disqualifiers")}
                    value={
                      profile.disqualifiers.length > 0
                        ? profile.disqualifiers.join(" · ")
                        : t("values.unavailable")
                    }
                    provenance={fieldProvenance("disqualifiers")}
                  />
                </dl>
              </div>
              {missingProductInformationIcpFields.length > 0 ? (
                <div
                  data-product-information-missing-icp
                  className="mt-4 rounded-md border border-brand-warning/30 bg-brand-warning/[0.06] px-3 py-2.5"
                >
                  <p className="text-[11px] leading-[1.55] text-text-dark-secondary">
                    {t("document.missingIcp", {
                      fields: missingProductInformationIcpFields
                        .map((field) => t(`fields.${field}`))
                        .join(", "),
                    })}
                  </p>
                </div>
              ) : null}
            </div>
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
                  sectionSource={competitorSectionSource}
                  label={sectionSourceLabel(
                    profile.sources.competitor,
                    competitorSectionSource,
                  )}
                />
                {competitorAdjusted ? (
                  <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
                ) : null}
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
                {hasBusinessFrame
                  ? t("values.businessFrameReviewed")
                  : competitorSuggestions.length > 0
                    ? t("search.review.candidatesReady")
                    : t("values.confirmationRequired")}
              </h3>
              {searchSummary ? (
                <p
                  data-profile-search-summary={searchSummary.state}
                  className="mt-2 max-w-xl text-[11.5px] leading-[1.6] text-text-dark-secondary"
                >
                  {searchSummary.label}
                </p>
              ) : null}
            </div>
            <dl className="grid min-w-0 gap-x-6 gap-y-3 self-start sm:grid-cols-3">
              <Fact
                label={t("facts.directCompetitors")}
                value={
                  profile.directCompetitors.length > 0
                    ? profile.directCompetitors.join(" · ")
                    : competitorSuggestions.length > 0
                      ? t("search.review.awaitingClassification", {
                          count: competitorSuggestions.length,
                        })
                      : t("values.confirmationRequired")
                }
                provenance={fieldProvenance("directCompetitors")}
              />
              <Fact
                label={t("facts.indirectAlternatives")}
                value={
                  profile.indirectAlternatives.length > 0
                    ? profile.indirectAlternatives.join(" · ")
                    : competitorSuggestions.length > 0
                      ? t("search.review.awaitingClassification", {
                          count: competitorSuggestions.length,
                        })
                      : t("values.confirmationRequired")
                }
                provenance={fieldProvenance("indirectAlternatives")}
              />
              <Fact
                label={t("facts.excludedAlternatives")}
                value={
                  profile.excludedAlternatives.length > 0
                    ? profile.excludedAlternatives.join(" · ")
                    : competitorSuggestions.length > 0
                      ? t("search.review.noneExcluded")
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
                  reviewDisabled={disabled}
                  suggestions={competitorSuggestions}
                  classifications={{
                    direct: profile.directCompetitors,
                    indirect: profile.indirectAlternatives,
                    excluded: profile.excludedAlternatives,
                  }}
                  onClassify={handleCompetitorClassification}
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
                  sectionSource={contextSectionSource}
                  label={sectionSourceLabel(
                    profile.sources.run,
                    contextSectionSource,
                  )}
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
                value={contextFieldValue("country")}
                provenance={contextFieldProvenance("country")}
              />
              <Fact
                label={t("fields.locale")}
                value={contextFieldValue("locale")}
                provenance={contextFieldProvenance("locale")}
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
                value={contextFieldValue("targetQuery")}
                provenance={contextFieldProvenance("targetQuery")}
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
