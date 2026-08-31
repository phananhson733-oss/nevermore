"use client";

// @input  -- exact server-resolved Product Profile and optional canonical owner
// @output -- inherited facts with immutable provenance, always read-only
// @pos    -- shared website settings and legacy GEO shortcut section

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { GeoInheritedProfile } from "../../lib/geo-tools/asset-context.ts";
import type { GeoKbFact } from "../../lib/geo-tools/kb-contract.ts";
import type { GeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import type { MarketingWebsiteProfileV1, WebsiteProfileFieldName } from "../../lib/account-websites/contracts.ts";
import { pendingGeoFeatureFact } from "./geo-kb-feature-candidates.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";

const GROUPS = [
  { title: "productSection", fields: ["productName", "oneLinePositioning", "valueProposition", "coreFeatures", "categories", "businessModel", "primaryCta", "trustSignals", "firstOutcome"] },
  { title: "icpSection", fields: ["primaryIcp", "buyer", "user", "triggerPain", "icpInterests", "icpPain", "icpBehavior", "icpPositioning", "jtbd", "useCases", "outcomes", "barriers", "qualificationSignals", "disqualifiers"] },
  { title: "marketSection", fields: ["country", "locale"] },
  { title: "competitorSection", fields: ["directCompetitors", "indirectAlternatives", "excludedAlternatives"] },
] as const satisfies readonly { readonly title: string; readonly fields: readonly WebsiteProfileFieldName[] }[];

const COMPACT_FIELDS = new Set<WebsiteProfileFieldName>([
  "productName",
  "primaryCta",
  "country",
  "locale",
]);

const LIST_FIELDS = new Set<WebsiteProfileFieldName>([
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
]);

function ReadOnlyProfileField({
  field,
  profile,
  facts,
  onAddFeature,
}: {
  readonly field: WebsiteProfileFieldName;
  readonly profile: MarketingWebsiteProfileV1;
  readonly facts: readonly GeoKbFact[];
  readonly onAddFeature?: (feature: string) => void;
}) {
  const labels = useTranslations("account.websites.fields");
  const t = useTranslations("tools.geoKnowledgeBase");
  const value = profile[field];
  const instanceId = useId();
  const baseId = `geo-profile-copy-${field}-${instanceId}`;
  if (LIST_FIELDS.has(field) && Array.isArray(value)) {
    return (
      <div data-geo-profile-field={field} className="min-w-0 space-y-3 py-5">
        <Label htmlFor={`${baseId}-0`} className="text-[14px] font-medium text-text-dark-primary">
          {labels(field)}
        </Label>
        {value.length === 0 ? (
          <Input
            id={`${baseId}-0`}
            name={`${baseId}-0`}
            readOnly
            value=""
            placeholder={t("asset.emptyField")}
          />
        ) : (
          <div className="grid gap-3">
            {value.map((item, index) => {
              const candidate =
                field === "coreFeatures" ? pendingGeoFeatureFact(item, facts) : null;
              const actionLabels = {
                ready: "featureCandidateAdd",
                exists: "featureCandidateExists",
                too_long: "featureCandidateTooLong",
                full: "featureCandidateFull",
              } as const;
              return (
                <div className="flex flex-wrap items-start gap-3" key={`${field}-${index}`}>
                  <Input
                    id={`${baseId}-${index}`}
                    name={`${baseId}-${index}`}
                    aria-label={`${labels(field)} ${index + 1}`}
                    autoComplete="off"
                    readOnly
                    value={item}
                  />
                  {candidate === null || onAddFeature === undefined ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={candidate.status !== "ready"}
                      onClick={() => onAddFeature(item)}
                    >
                      {t(`asset.${actionLabels[candidate.status]}`)}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const stringValue = typeof value === "string" ? value : "";
  return (
    <div data-geo-profile-field={field} className="min-w-0 space-y-3 py-5">
      <Label htmlFor={baseId} className="text-[14px] font-medium text-text-dark-primary">
        {labels(field)}
      </Label>
      {COMPACT_FIELDS.has(field) ? (
        <Input
          id={baseId}
          name={baseId}
          readOnly
          value={stringValue}
          placeholder={t("asset.emptyField")}
        />
      ) : (
        <Textarea
          id={baseId}
          name={baseId}
          readOnly
          rows={3}
          value={stringValue}
          placeholder={t("asset.emptyField")}
        />
      )}
    </div>
  );
}

function CompleteProfileFields({ profile, facts, onAddFeature }: {
  readonly profile: MarketingWebsiteProfileV1;
  readonly facts: readonly GeoKbFact[];
  readonly onAddFeature?: (feature: string) => void;
}) {
  const labels = useTranslations("account.websites.fields");
  const sections = useTranslations("account.websites.editor");
  const t = useTranslations("tools.geoKnowledgeBase");
  return <div className="mt-5 divide-y divide-brand-border-card">
    {GROUPS.map((group, index) => <details key={group.title} open={index === 0} className="py-4">
      <summary className="cursor-pointer text-[14px] font-semibold text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{sections(group.title)}</summary>
      <div className="divide-y divide-brand-border-card">
        {group.fields.map((field) => (
          <ReadOnlyProfileField
            key={field}
            field={field}
            profile={profile}
            facts={facts}
            {...(onAddFeature === undefined ? {} : { onAddFeature })}
          />
        ))}
      </div>
    </details>)}
    <details className="py-4">
      <summary className="cursor-pointer text-[14px] font-semibold text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{t("asset.provenanceTitle")}</summary>
      <ul className="mt-4 space-y-4 text-[12px] text-text-dark-secondary">
        {profile.fieldProvenance.map((entry) => <li key={entry.path} className="min-w-0 space-y-2">
          <p>{labels(entry.path.slice(1) as WebsiteProfileFieldName)} · {entry.source} · {entry.derivation} · {entry.confidence}</p>
          {entry.observedAt === null ? null : <p>{t("asset.observedAt", { time: entry.observedAt })}</p>}
          {entry.limitation === null ? null : <p className="break-words">{entry.limitation}</p>}
          {entry.evidenceUrls.map((url) => <a key={url} className="block break-all text-brand-accent-text underline-offset-2 hover:underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a>)}
        </li>)}
      </ul>
    </details>
  </div>;
}

export function GeoKbInheritedProfile({ profile, copy, websiteId, locale, profileState, facts = [], onAddFeature, inline = false, frozen = false }: {
  readonly profile: GeoInheritedProfile | null;
  readonly copy?: GeoProfileCopy;
  readonly websiteId?: string;
  readonly locale: string;
  readonly profileState?: string;
  readonly facts?: readonly GeoKbFact[];
  readonly onAddFeature?: (feature: string) => void;
  readonly inline?: boolean;
  readonly frozen?: boolean;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const owner = copy?.websiteId ?? profile?.reference.websiteId ?? websiteId;
  const Heading = inline ? "h3" : "h2";
  return (
    <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
      <Heading className="flex items-center gap-3 text-[17px] font-semibold text-text-dark-primary"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-accent" />{t(copy ? "asset.copyTitle" : "asset.profileTitle")}</Heading>
      {copy !== undefined ? <>
        <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">{t(frozen ? "asset.frozenCopyBody" : "asset.copyBody")}</p>
        <p className="mt-2 text-xs text-text-dark-secondary">{t("asset.revision", { revision: copy.snapshotRevision })}</p>
        <p className="mt-1 break-all font-mono text-xs text-text-dark-secondary">{t("asset.hash", { hash: copy.profileHash })}</p>
        <CompleteProfileFields profile={copy.profile} facts={facts} {...(onAddFeature === undefined ? {} : { onAddFeature })} />
      </> : profile === null ? (
        <p className="mt-3 text-sm text-text-dark-secondary">{t(profileState === "confirmed" || profileState === "unconfirmed_changes" ? "asset.profileUnavailable" : "asset.profileRequired")}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-text-dark-secondary">{t("asset.profileBody")}</p>
          <dl className="mt-4 grid gap-3 text-sm">
            <div><dt className="text-text-dark-secondary">{t("asset.productName")}</dt><dd>{profile.productName}</dd></div>
            <div><dt className="text-text-dark-secondary">{t("asset.positioning")}</dt><dd>{profile.oneLinePositioning}</dd></div>
            <div><dt className="text-text-dark-secondary">{t("asset.features")}</dt><dd><ul className="grid gap-2">{profile.coreFeatures.map((feature, index) => {
              const candidate = pendingGeoFeatureFact(feature, facts);
              const labels = { ready: "featureCandidateAdd", exists: "featureCandidateExists", too_long: "featureCandidateTooLong", full: "featureCandidateFull" } as const;
              return <li className="flex flex-wrap items-start gap-3" key={`${index}-${feature}`}>
                <span className="break-words">{feature}</span>
                {onAddFeature === undefined ? null : <button type="button" disabled={candidate.status !== "ready"}
                  className="rounded border border-brand-border-card px-2 py-1 text-xs text-brand-accent-text disabled:opacity-50"
                  onClick={() => onAddFeature(feature)}>{t(`asset.${labels[candidate.status]}`)}</button>}
              </li>;
            })}</ul>{onAddFeature === undefined ? null : <p className="mt-2 text-xs text-text-dark-secondary">{t("asset.featureCandidateHelp")}</p>}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-text-dark-secondary">{t("asset.revision", { revision: profile.reference.snapshotRevision })}</p>
          <p className="mt-1 break-all font-mono text-xs text-text-dark-secondary">{t("asset.hash", { hash: profile.reference.profileHash })}</p>
        </>
      )}
      {owner === undefined ? (
        <a className="mt-4 inline-block text-sm text-brand-accent-text" href={`/${locale}/account/websites`}>{t("asset.backToWebsites")}</a>
      ) : (
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-brand-accent-text">
          <a href={inline ? "#website-profile" : `/${locale}/account/websites/${owner}`}>{t("asset.editProfile")}</a>
          {inline ? null : <a href={`/${locale}/account/websites/${owner}/geo`}>{t("asset.canonicalLink")}</a>}
        </div>
      )}
    </section>
  );
}
