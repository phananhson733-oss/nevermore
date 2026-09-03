"use client";

// @input  -- exact server-resolved Product Profile and optional canonical owner
// @output -- the Profile values GEO reads, read out and never editable here;
//            an archival caller additionally gets the snapshot they came from
// @pos    -- shared website settings and legacy GEO shortcut section

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { GeoInheritedProfile } from "../../lib/geo-tools/asset-context.ts";
import type { GeoKbFact } from "../../lib/geo-tools/kb-contract.ts";
import type { GeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import type { MarketingWebsiteProfileV1, WebsiteProfileFieldName } from "../../lib/account-websites/contracts.ts";
import { geoProfileFactSource, pendingGeoProfileFact } from "./geo-kb-feature-candidates.ts";
import { Button } from "../ui/button.tsx";
import { GeoKbFieldRow, GeoKbFieldRows, GeoKbReadout, GeoKbSection } from "./geo-kb-section.tsx";
import { GEO_PROFILE_SUBSET_FIELDS } from "../../lib/geo-tools/kb-profile-subset.ts";

/**
 * Only the Profile fields GEO reads. Showing all 28 presented fifteen values
 * that nothing in GEO consumes as though they were part of this asset; the
 * Profile editor one card above is where they are read and edited. The list is
 * derived from `GEO_PROFILE_SUBSET_FIELDS` rather than restated, so a field
 * added to what GEO consumes appears here without a second edit.
 */
const SHOWN = new Set<string>(GEO_PROFILE_SUBSET_FIELDS);
const GROUPS = ([
  { title: "productSection", fields: ["productName", "oneLinePositioning", "valueProposition", "coreFeatures", "categories", "businessModel", "primaryCta", "trustSignals", "firstOutcome"] },
  { title: "icpSection", fields: ["primaryIcp", "buyer", "user", "triggerPain", "icpInterests", "icpPain", "icpBehavior", "icpPositioning", "jtbd", "useCases", "outcomes", "barriers", "qualificationSignals", "disqualifiers"] },
  { title: "marketSection", fields: ["country", "locale"] },
  { title: "competitorSection", fields: ["directCompetitors", "indirectAlternatives", "excludedAlternatives"] },
] as const satisfies readonly { readonly title: string; readonly fields: readonly WebsiteProfileFieldName[] }[])
  .map(group => ({ title: group.title, fields: group.fields.filter(field => SHOWN.has(field)) }))
  .filter(group => group.fields.length > 0);

/**
 * The button writes a citation. When the Profile recorded this field as
 * observed on one public page, pressing it carries that page's address and
 * capture time into the new fact -- so the address is named here, before the
 * press, rather than appearing in a row whose basis the visitor never saw.
 */
function ProfileFactButton({ factKey, value, facts, describedBy, onAddFact }: {
  readonly factKey: string;
  readonly value: string;
  readonly facts: readonly GeoKbFact[];
  readonly describedBy?: string;
  readonly onAddFact?: (key: string, value: string) => void;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  if (onAddFact === undefined || value.trim() === "") return null;
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
      {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
      onClick={() => onAddFact(factKey, value)}
    >
      {t(`asset.${labels[candidate.status]}`)}
    </Button>
  );
}

function FactAction({ factKey, value, facts, profile, onAddFact }: {
  readonly factKey: string;
  readonly value: string;
  readonly facts: readonly GeoKbFact[];
  readonly profile: MarketingWebsiteProfileV1;
  readonly onAddFact?: (key: string, value: string) => void;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const noteId = useId();
  const source = geoProfileFactSource(profile, factKey);
  if (onAddFact === undefined || value.trim() === "") return null;
  // Only where an address is actually carried. The ordinary case is that the
  // Profile recorded no single observed page, the new fact's source field is
  // left empty, and saying so under every button was five wrapped lines of
  // nothing happening.
  if (source === null) return <ProfileFactButton factKey={factKey} value={value} facts={facts} onAddFact={onAddFact} />;
  return <div className="flex min-w-0 flex-col items-end gap-1">
    <ProfileFactButton factKey={factKey} value={value} facts={facts} describedBy={noteId} onAddFact={onAddFact} />
    <p id={noteId} data-fact-source={factKey} className="max-w-[22rem] break-all text-right text-[11px] leading-relaxed text-text-dark-secondary">
      {t("asset.factSourceCarried", { url: source.sourceUrl, time: source.observedAt })}
    </p>
  </div>;
}

/**
 * The 13 fields laid out the way the Profile editor lays out its own: the
 * group titles it uses, one field per row, rows separated by a rule, the label
 * above its value, and a list shown one entry per row. The values are read
 * out rather than put in inputs -- they are edited in the Profile, and a
 * read-only input offers a caret and a focus ring to someone who cannot type
 * into it, then hides an empty value's "not provided" text in a placeholder.
 */
function ProfileFields({ profile, facts, onAddFact, heading }: {
  readonly profile: MarketingWebsiteProfileV1;
  readonly facts: readonly GeoKbFact[];
  readonly onAddFact?: (key: string, value: string) => void;
  readonly heading: 2 | 3 | 4;
}) {
  // One level below the panel it sits in, the way `Sub` does it in
  // geo-kb-version-content.tsx. A styled <p> looks like a group title but
  // cannot be reached by heading navigation, and it replaced a <summary>,
  // which could.
  const Group = (heading === 2 ? "h3" : heading === 3 ? "h4" : "h5") as "h3" | "h4" | "h5";
  const labels = useTranslations("account.websites.fields");
  const sections = useTranslations("account.websites.editor");
  const t = useTranslations("tools.geoKnowledgeBase");
  const empty = t("asset.emptyField");
  return <div data-geo-profile-fields className="mt-5 space-y-7">
    {GROUPS.map(group => <div key={group.title} data-geo-profile-group={group.title} className="min-w-0">
      <Group className="mb-4 border-b border-brand-border-card pb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-dark-secondary">{sections(group.title)}</Group>
      <GeoKbFieldRows>
        {group.fields.map(field => {
          const value = profile[field];
          // `Array.isArray` is the whole test. A hand-kept set of list field
          // names beside it only added a drift case: a list field added to the
          // GEO subset but forgotten here rendered as an empty readout.
          const list = Array.isArray(value) ? value : null;
          // Only the three values a fact can be filled from carry the action;
          // the rest are here to be read against the product, nothing more.
          const action = field === "productName" || field === "oneLinePositioning"
            ? <FactAction factKey={field} value={typeof value === "string" ? value : ""} facts={facts} profile={profile} {...(onAddFact === undefined ? {} : { onAddFact })} />
            : undefined;
          return <GeoKbFieldRow key={field} data-geo-profile-field={field} label={labels(field)} {...(action === undefined ? {} : { action })}>
            {list === null ? <GeoKbReadout value={typeof value === "string" ? value : ""} empty={empty} />
              : list.length === 0 ? <GeoKbReadout value="" empty={empty} />
              : <ul className="grid gap-2">{list.map((item, index) => <li key={`${field}-${index}`} className="flex items-start gap-2">
                <div className="min-w-0 flex-1"><GeoKbReadout value={item} empty={empty} /></div>
                {field !== "coreFeatures" ? null : <FactAction factKey={`coreFeatures[${index}]`} value={item} facts={facts} profile={profile} {...(onAddFact === undefined ? {} : { onAddFact })} />}
              </li>)}</ul>}
          </GeoKbFieldRow>;
        })}
      </GeoKbFieldRows>
    </div>)}
  </div>;
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
  // One labelled row per value, with every row's action in the same place.
  // Trailing each action directly after the text it belongs to put the buttons
  // at a different width on every row. The values stay read-only text, not
  // controls: they are edited in the Profile, so a control here would offer a
  // focus ring and a caret to someone who cannot change anything, and an empty
  // one would hide its "not provided" text in a placeholder.
  // No per-row "inherited" badge: the section is already titled "from the
  // Product Profile", and stamping every row with it made one thing look like
  // two. What the visitor needs is the value and the one action on it.
  return (
    <div data-geo-profile-summary className="mt-4">
      <GeoKbFieldRows>
        <GeoKbFieldRow data-geo-summary-field="productName" label={t("asset.productName")} action={(<ProfileFactButton factKey="productName" value={productName} facts={facts} onAddFact={onAddFact} />)}>
          <GeoKbReadout value={productName} empty={t("asset.emptyField")} />
        </GeoKbFieldRow>
        <GeoKbFieldRow data-geo-summary-field="oneLinePositioning" label={t("asset.positioning")} action={(<ProfileFactButton factKey="oneLinePositioning" value={oneLinePositioning} facts={facts} onAddFact={onAddFact} />)}>
          <GeoKbReadout value={oneLinePositioning} empty={t("asset.emptyField")} />
        </GeoKbFieldRow>
        <GeoKbFieldRow data-geo-summary-field="coreFeatures" label={t("asset.features")} {...(onAddFact === undefined ? {} : { hint: t("asset.featureCandidateHelp") })}>
          {coreFeatures.length === 0
            ? <GeoKbReadout value="" empty={t("asset.emptyField")} />
            : <ul className="grid gap-2">{coreFeatures.map((feature, index) => (
              <li className="flex items-start gap-2" key={`${index}-${feature}`}>
                <div className="min-w-0 flex-1"><GeoKbReadout value={feature} empty={t("asset.emptyField")} /></div>
                <ProfileFactButton factKey={`coreFeatures[${index}]`} value={feature} facts={facts} onAddFact={onAddFact} />
              </li>
            ))}</ul>}
        </GeoKbFieldRow>
        <GeoKbFieldRow data-geo-summary-field="market" label={t("asset.market")}>
          <GeoKbReadout value={[market.country, market.language].filter(Boolean).join(" \u00b7 ")} empty={t("asset.emptyField")} />
        </GeoKbFieldRow>
      </GeoKbFieldRows>
    </div>
  );
}

export function GeoKbInheritedProfile({ profile, copy, websiteId, locale, profileState, facts = [], onAddFact, inline = false, frozen = false, copyDescription, repairMode = false, heading }: {
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
  /** Depth override for a host with its own outline; `inline` alone hard-coded 4. */
  readonly heading?: 2 | 3 | 4;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const owner = copy?.websiteId ?? profile?.reference.websiteId ?? websiteId;
  const depth = heading ?? (inline ? 4 : 2);
  return (
    <GeoKbSection title={t(copy ? "asset.copyTitle" : "asset.profileTitle")} heading={depth}>
      {copy !== undefined ? <>
        {copyDescription === undefined && !frozen ? null : <p className="text-[13px] leading-relaxed text-text-dark-secondary">{copyDescription ?? t("asset.frozenCopyBody")}</p>}
        <ProfileFields profile={copy.profile} facts={facts} heading={depth} {...(onAddFact === undefined ? {} : { onAddFact })} />
        {/* Which confirmed Profile revision this copy is, and its hash. The
            editor does not need it, but the two archival callers exist to
            record exactly that, and neither shows it anywhere else. */}
        {copyDescription === undefined && !frozen ? null : <div data-geo-copy-identity className="mt-5 border-t border-brand-border-card pt-4 text-xs text-text-dark-secondary">
          <p>{t("asset.revision", { revision: copy.snapshotRevision })}</p>
          <p className="mt-1 break-all font-mono">{t("asset.hash", { hash: copy.profileHash })}</p>
        </div>}
        {onAddFact === undefined ? null : <p className="mt-4 text-xs text-text-dark-secondary">{t("asset.profileFactBoundary")}</p>}
      </> : profile === null ? (
        <p className="text-sm text-text-dark-secondary">{t(profileState === "confirmed" || profileState === "unconfirmed_changes" ? "asset.profileUnavailable" : "asset.profileRequired")}</p>
      ) : (
        <>
          <p className="text-sm text-text-dark-secondary">{t("asset.profileBody")}</p>
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
    </GeoKbSection>
  );
}
