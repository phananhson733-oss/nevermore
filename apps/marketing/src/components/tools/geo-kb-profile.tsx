"use client";

// @input  -- exact server-resolved Product Profile and optional canonical owner
// @output -- inherited facts with immutable provenance, always read-only
// @pos    -- shared website settings and legacy GEO shortcut section

import { useTranslations } from "next-intl";
import type { GeoInheritedProfile } from "../../lib/geo-tools/asset-context.ts";
import type { GeoKbFact } from "../../lib/geo-tools/kb-contract.ts";
import { pendingGeoProfileFact } from "./geo-kb-feature-candidates.ts";

export function GeoKbInheritedProfile({ profile, websiteId, locale, profileState, facts = [], onAddFact, repairMode = false }: {
  readonly profile: GeoInheritedProfile | null;
  readonly websiteId?: string;
  readonly locale: string;
  readonly profileState?: string;
  readonly facts?: readonly GeoKbFact[];
  readonly onAddFact?: (key: string, value: string) => void;
  readonly repairMode?: boolean;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const owner = profile?.reference.websiteId ?? websiteId;
  const candidateButton = (key: string, value: string) => {
    if (onAddFact === undefined) return null;
    const candidate = pendingGeoProfileFact(key, value, facts);
    const labels = { ready: "featureCandidateAdd", exists: "featureCandidateExists", too_long: "featureCandidateTooLong", full: "featureCandidateFull" } as const;
    const fieldLabel = key === "productName" ? t("asset.productName") : key === "oneLinePositioning" ? t("asset.positioning") : value;
    return <button type="button" disabled={candidate.status !== "ready"}
      aria-label={`${t(`asset.${labels[candidate.status]}`)}: ${fieldLabel}`}
      className="rounded border border-brand-border-card px-2 py-1 text-xs text-brand-accent-text disabled:opacity-50"
      onClick={() => onAddFact(key, value)}>{t(`asset.${labels[candidate.status]}`)}</button>;
  };
  return (
    <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
      <h2 className="text-[19px] text-text-dark-primary">{t("asset.profileTitle")}</h2>
      {profile === null ? (
        <p className="mt-3 text-sm text-text-dark-secondary">{t(profileState === "confirmed" || profileState === "unconfirmed_changes" ? "asset.profileUnavailable" : "asset.profileRequired")}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-text-dark-secondary">{t("asset.profileBody")}</p>
          <dl className="mt-4 grid gap-3 text-sm">
            <div><dt className="text-text-dark-secondary">{t("asset.productName")}</dt><dd className="flex flex-wrap items-start gap-3"><span>{profile.productName}</span>{candidateButton("productName", profile.productName)}</dd></div>
            <div><dt className="text-text-dark-secondary">{t("asset.positioning")}</dt><dd className="flex flex-wrap items-start gap-3"><span>{profile.oneLinePositioning}</span>{candidateButton("oneLinePositioning", profile.oneLinePositioning)}</dd></div>
            <div><dt className="text-text-dark-secondary">{t("asset.features")}</dt><dd><ul className="grid gap-2">{profile.coreFeatures.map((feature, index) => {
              return <li className="flex flex-wrap items-start gap-3" key={`${index}-${feature}`}>
                <span className="break-words">{feature}</span>
                {candidateButton(`coreFeatures[${index}]`, feature)}
              </li>;
            })}</ul>{onAddFact === undefined ? null : <p className="mt-2 text-xs text-text-dark-secondary">{t("asset.featureCandidateHelp")}</p>}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-text-dark-secondary">{t("asset.profileFactBoundary")}</p>
          <p className="mt-4 text-xs text-text-dark-secondary">{t("asset.revision", { revision: profile.reference.snapshotRevision })}</p>
          <p className="mt-1 break-all font-mono text-xs text-text-dark-secondary">{t("asset.hash", { hash: profile.reference.profileHash })}</p>
        </>
      )}
      {owner === undefined ? (
        <a className="mt-4 inline-block text-sm text-brand-accent-text" href={`/${locale}/account/websites`}>{t("asset.backToWebsites")}</a>
      ) : (
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-brand-accent-text">
          <a href={`/${locale}/account/websites/${owner}`} target={repairMode ? "_blank" : undefined} rel={repairMode ? "noopener" : undefined}>{t("asset.editProfile")}</a>
          <a href={`/${locale}/account/websites/${owner}/geo`} target={repairMode ? "_blank" : undefined} rel={repairMode ? "noopener" : undefined}>{t("asset.canonicalLink")}</a>
        </div>
      )}
      {repairMode && owner !== undefined ? <p className="mt-3 text-xs text-text-dark-secondary">{t("repair.profileNewTab")}</p> : null}
    </section>
  );
}
