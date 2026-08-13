// @input  -- one Agent-owned Product/ICP draft and local state callbacks
// @output -- compact source-backed review, explicit assumptions, and confirmation UI
// @pos    -- Stage 01 panel shared visually but never by state across SEO/Tech pages

"use client";

import { Check, ChevronDown, FileText, Radar, Sparkles } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";

import {
  confirmAgentProfile,
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
}

const TEXT_FIELDS = [
  "productName",
  "oneLinePositioning",
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
  "categories",
  "trustSignals",
  "icpInterests",
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
] as const satisfies readonly AgentProfileEditableField[];

const PRODUCT_FIELDS = new Set<AgentProfileEditableField>([
  "productName",
  "oneLinePositioning",
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

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-t border-brand-border-faint pt-2.5 first:border-0 first:pt-0">
      <dt className="font-mono text-[9px] tracking-[0.08em] text-text-dark-faint uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-[11.5px] leading-[1.5] text-text-dark-secondary">
        {value}
      </dd>
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
    onChange(
      updateAgentProfile(profile, {
        [field]: value,
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

  const canConfirm =
    !disabled &&
    profile.targetUrl.trim().length > 0 &&
    profile.productName.trim().length > 0 &&
    profile.primaryIcp.trim().length > 0 &&
    profile.buyer.trim().length > 0 &&
    profile.user.trim().length > 0 &&
    profile.triggerPain.trim().length > 0 &&
    profile.jtbd.trim().length > 0;

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
          <span className="flex h-12 items-center gap-2.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 transition-colors focus-within:border-brand-accent/70">
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

        <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <article
            data-profile-card="product"
            className="rounded-row border border-brand-border bg-brand-panel-sunken p-4"
          >
            <SourceChip
              source={profile.sources.product}
              label={t(`sources.${profile.sources.product}`)}
            />
            {productAdjusted ? (
              <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
            ) : null}
            <p className="mt-4 font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
              {t("cards.product")}
            </p>
            <h3 className="mt-1.5 text-[16px] font-semibold text-text-dark-primary">
              {profile.productName}
            </h3>
            <p className="mt-2 min-h-[3.25rem] text-[11.5px] leading-[1.55] text-text-dark-secondary">
              {profile.oneLinePositioning}
            </p>
            <dl className="mt-4 grid gap-2.5">
              <Fact label={t("facts.category")} value={profile.categories.join(" · ")} />
              <Fact label={t("facts.businessModel")} value={profile.businessModel} />
              <Fact label={t("facts.primaryCta")} value={profile.primaryCta} />
              <Fact
                label={t("facts.trustSignals")}
                value={
                  profile.trustSignals.length > 0
                    ? profile.trustSignals.join(" · ")
                    : t("values.unavailable")
                }
              />
            </dl>
          </article>

          <article
            data-profile-card="icp"
            className="rounded-row border border-brand-border bg-brand-panel-sunken p-4"
          >
            <SourceChip
              source={profile.sources.icp}
              label={t(`sources.${profile.sources.icp}`)}
            />
            {icpAdjusted ? (
              <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
            ) : null}
            <p className="mt-4 font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
              {t("cards.icp")}
            </p>
            <h3 className="mt-1.5 text-[16px] font-semibold text-text-dark-primary">
              {profile.primaryIcp}
            </h3>
            <dl className="mt-4 grid gap-2.5">
              <Fact
                label={t("facts.interests")}
                value={
                  profile.icpInterests.length > 0
                    ? profile.icpInterests.join(" · ")
                    : t("values.unavailable")
                }
              />
              <Fact label={t("facts.buyer")} value={profile.buyer} />
              <Fact label={t("facts.user")} value={profile.user} />
              <Fact label={t("facts.triggerPain")} value={profile.triggerPain} />
              <Fact label={t("fields.jtbd")} value={profile.jtbd} />
              <Fact label={t("facts.pain")} value={profile.icpPain} />
              <Fact label={t("facts.positioning")} value={profile.icpPositioning} />
            </dl>
          </article>

          <article
            data-profile-card="competitor"
            className="rounded-row border border-brand-border bg-brand-panel-sunken p-4"
          >
            <SourceChip
              source={profile.sources.competitor}
              label={t(`sources.${profile.sources.competitor}`)}
            />
            {competitorAdjusted ? (
              <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
            ) : null}
            <p className="mt-4 font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
              {t("cards.competitor")}
            </p>
            <h3 className="mt-1.5 text-[16px] font-semibold text-text-dark-primary">
              {t("values.confirmationRequired")}
            </h3>
            <dl className="mt-4 grid gap-2.5">
              <Fact
                label={t("facts.directCompetitors")}
                value={
                  profile.directCompetitors.length > 0
                    ? profile.directCompetitors.join(" · ")
                    : t("values.confirmationRequired")
                }
              />
              <Fact
                label={t("facts.indirectAlternatives")}
                value={
                  profile.indirectAlternatives.length > 0
                    ? profile.indirectAlternatives.join(" · ")
                    : t("values.confirmationRequired")
                }
              />
              <Fact
                label={t("facts.excludedAlternatives")}
                value={
                  profile.excludedAlternatives.length > 0
                    ? profile.excludedAlternatives.join(" · ")
                    : t("values.confirmationRequired")
                }
              />
            </dl>
          </article>

          <article
            data-profile-card="context"
            className="rounded-row border border-brand-border bg-brand-panel-sunken p-4"
          >
            <SourceChip
              source={profile.sources.run}
              label={t(`sources.${profile.sources.run}`)}
            />
            {contextAdjusted ? (
              <LocalAdjustmentChip label={t("sources.locally_adjusted")} />
            ) : null}
            <p className="mt-4 font-mono text-[9px] tracking-[0.1em] text-text-dark-faint uppercase">
              {t("cards.context")}
            </p>
            <h3 className="mt-1.5 text-[16px] font-semibold text-text-dark-primary">
              {profile.firstOutcome}
            </h3>
            <dl className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              <Fact label={t("fields.country")} value={profile.country} />
              <Fact label={t("fields.locale")} value={profile.locale} />
              <Fact label={t("fields.device")} value={t(`options.device.${profile.device}`)} />
              <Fact label={t("fields.pageType")} value={t(`options.pageType.${profile.pageType}`)} />
              <Fact
                label={t("fields.targetQuery")}
                value={profile.targetQuery || t("values.unavailable")}
              />
              <Fact
                label={t("fields.auditScope")}
                value={t(`options.auditScope.${profile.auditScope}`)}
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
                  className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none transition-colors focus:border-brand-accent/70 disabled:opacity-60"
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
                  className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none transition-colors focus:border-brand-accent/70 disabled:opacity-60"
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
                className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none focus:border-brand-accent/70 disabled:opacity-60"
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
                className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none focus:border-brand-accent/70 disabled:opacity-60"
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
                className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[12.5px] text-text-dark-primary outline-none focus:border-brand-accent/70 disabled:opacity-60"
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
          <p className="max-w-2xl text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {t("boundary")}
          </p>
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
