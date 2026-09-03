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
import { pendingGeoProfileFact } from "./geo-kb-feature-candidates.ts";
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

function ProfileFactButton({ factKey, value, facts, onAddFact }: {
  readonly factKey: string;
  readonly value: string;
  readonly facts: readonly GeoKbFact[];
  readonly onAddFact?: (key: string, value: string) => void;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  if (onAddFact === undefined) return null;
  const candidate = pendingGeoProfileFact(factKey, value, facts);
  const labels = {
    ready: "featureCandidateAdd",
    exists: "featureCandidateExists",
    too_long: "featureCandidateTooLong",
    full: "featureCandidateFull",
  } as const;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={candidate.status !== "ready"}
      aria-label={`${t(`asset.${labels[candidate.status]}`)}: ${value}`}
      onClick={() => onAddFact(factKey, value)}
    >
      {t(`asset.${labels[candidate.status]}`)}
    </Button>
  );
}

function ReadOnlyProfileField({
  field,
  profile,
}: {
  readonly field: WebsiteProfileFieldName;
  readonly profile: MarketingWebsiteProfileV1;
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
      <div className="flex flex-wrap items-start gap-3">
        {COMPACT_FIELDS.has(field) ? (
          <Input
            className="min-w-0 flex-1"
            id={baseId}
            name={baseId}
            readOnly
            value={stringValue}
            placeholder={t("asset.emptyField")}
          />
        ) : (
          <Textarea
            className="min-w-0 flex-1"
            id={baseId}
            name={baseId}
            readOnly
            rows={3}
            value={stringValue}
            placeholder={t("asset.emptyField")}
          />
        )}
      </div>
    </div>
  );
}

function ProfileSummary({ productName, oneLinePositioning, coreFeatures, market, facts, onAddFact }: {
  readonly productName: string;
  readonly oneLinePositioning: string;
  readonly coreFeatures: readonly string[];
  readonly market: { readonly country: string; readonly language: string };
  readonly facts: readonly GeoKbFact[];
  readonly onAddFact?: (key: string, value: string) => void;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  return (
    <dl data-geo-profile-summary className="mt-4 grid gap-3 text-sm">
      <div><dt className="text-text-dark-secondary">{t("asset.productName")}</dt><dd className="flex flex-wrap items-start gap-3"><span className="break-words">{productName || t("asset.emptyField")}</span><ProfileFactButton factKey="productName" value={productName} facts={facts} onAddFact={onAddFact} /></dd></div>
      <div><dt className="text-text-dark-secondary">{t("asset.positioning")}</dt><dd className="flex flex-wrap items-start gap-3"><span className="break-words">{oneLinePositioning || t("asset.emptyField")}</span><ProfileFactButton factKey="oneLinePositioning" value={oneLinePositioning} facts={facts} onAddFact={onAddFact} /></dd></div>
      <div><dt className="text-text-dark-secondary">{t("asset.features")}</dt><dd>{coreFeatures.length === 0 ? <span className="text-text-dark-secondary">{t("asset.emptyField")}</span> : <ul className="grid gap-2">{coreFeatures.map((feature, index) => (
        <li className="flex flex-wrap items-start gap-3" key={`${index}-${feature}`}>
          <span className="break-words">{feature}</span>
          <ProfileFactButton factKey={`coreFeatures[${index}]`} value={feature} facts={facts} onAddFact={onAddFact} />
        </li>
      ))}</ul>}{onAddFact === undefined ? null : <p className="mt-2 text-xs text-text-dark-secondary">{t("asset.featureCandidateHelp")}</p>}</dd></div>
      <div><dt className="text-text-dark-secondary">{t("asset.market")}</dt><dd className="break-words">{[market.country, market.language].filter(Boolean).join(" · ") || t("asset.emptyField")}</dd></div>
    </dl>
  );
}

function CompleteProfileFields({ profile }: {
  readonly profile: MarketingWebsiteProfileV1;
}) {
  const labels = useTranslations("account.websites.fields");
  const sections = useTranslations("account.websites.editor");
  const t = useTranslations("tools.geoKnowledgeBase");
  return <div className="mt-5 divide-y divide-brand-border-card">
    {GROUPS.map((group, index) => <details key={group.title} open={index === 0} className="py-4">
      <summary className="cursor-pointer text-[14px] font-semibold text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{sections(group.title)}</summary>
      <div className="divide-y divide-brand-border-card">
        {group.fields.map((field) => (
          <ReadOnlyProfileField key={field} field={field} profile={profile} />
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

export function GeoKbInheritedProfile({ profile, copy, websiteId, locale, profileState, facts = [], onAddFact, inline = false, frozen = false, copyDescription, repairMode = false }: {
  readonly profile: GeoInheritedProfile | null;
  readonly copy?: GeoProfileCopy;
  readonly websiteId?: string;
  readonly locale: string;
  readonly profileState?: string;
  readonly facts?: readonly GeoKbFact[];
  readonly onAddFact?: (key: string, value: string) => void;
  readonly inline?: boolean;
  readonly frozen?: boolean;
  readonly copyDescription?: string;
  readonly repairMode?: boolean;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const owner = copy?.websiteId ?? profile?.reference.websiteId ?? websiteId;
  const Heading = inline ? "h4" : "h2";
  return (
    <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
      <Heading className={inline ? "text-[15px] font-semibold text-text-dark-primary" : "flex items-center gap-3 text-[17px] font-semibold text-text-dark-primary"}>{inline ? null : <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-accent" />}{t(copy ? "asset.copyTitle" : "asset.profileTitle")}</Heading>
      {copy !== undefined ? <>
        <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">{copyDescription ?? t(frozen ? "asset.frozenCopyBody" : "asset.copyBody")}</p>
        <p className="mt-2 text-xs text-text-dark-secondary">{t("asset.revision", { revision: copy.snapshotRevision })}</p>
        <ProfileSummary
          productName={copy.profile.productName}
          oneLinePositioning={copy.profile.oneLinePositioning}
          coreFeatures={copy.profile.coreFeatures}
          market={{ country: copy.profile.country, language: copy.profile.locale }}
          facts={facts}
          {...(onAddFact === undefined ? {} : { onAddFact })}
        />
        {onAddFact === undefined ? null : <p className="mt-3 text-xs text-text-dark-secondary">{t("asset.profileFactBoundary")}</p>}
        <p className="mt-4 text-xs leading-relaxed text-text-dark-secondary">{t("asset.copyScopeNote")}</p>
        <details data-geo-copy-complete className="mt-4 border-t border-brand-border-card pt-4">
          <summary className="cursor-pointer text-[13px] font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{t("asset.copyFieldsToggle")}</summary>
          <p className="mt-3 break-all font-mono text-xs text-text-dark-secondary">{t("asset.hash", { hash: copy.profileHash })}</p>
          <CompleteProfileFields profile={copy.profile} />
        </details>
      </> : profile === null ? (
        <p className="mt-3 text-sm text-text-dark-secondary">{t(profileState === "confirmed" || profileState === "unconfirmed_changes" ? "asset.profileUnavailable" : "asset.profileRequired")}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-text-dark-secondary">{t("asset.profileBody")}</p>
          <ProfileSummary
            productName={profile.productName}
            oneLinePositioning={profile.oneLinePositioning}
            coreFeatures={profile.coreFeatures}
            market={profile.market}
            facts={facts}
            {...(onAddFact === undefined ? {} : { onAddFact })}
          />
          {onAddFact === undefined ? null : <p className="mt-3 text-xs text-text-dark-secondary">{t("asset.profileFactBoundary")}</p>}
          <p className="mt-4 text-xs text-text-dark-secondary">{t("asset.revision", { revision: profile.reference.snapshotRevision })}</p>
          <p className="mt-1 break-all font-mono text-xs text-text-dark-secondary">{t("asset.hash", { hash: profile.reference.profileHash })}</p>
        </>
      )}
      {owner === undefined ? (
        <a className="mt-4 inline-block text-sm text-brand-accent-text" href={`/${locale}/account/websites`}>{t("asset.backToWebsites")}</a>
      ) : (
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-brand-accent-text">
          <a href={inline ? "#website-profile" : `/${locale}/account/websites/${owner}`} target={!inline && repairMode ? "_blank" : undefined} rel={!inline && repairMode ? "noopener" : undefined}>{t("asset.editProfile")}</a>
          {inline ? null : <a href={`/${locale}/account/websites/${owner}/geo`} target={repairMode ? "_blank" : undefined} rel={repairMode ? "noopener" : undefined}>{t("asset.canonicalLink")}</a>}
        </div>
      )}
      {repairMode && !inline && owner !== undefined ? <p className="mt-3 text-xs text-text-dark-secondary">{t("repair.profileNewTab")}</p> : null}
    </section>
  );
}
