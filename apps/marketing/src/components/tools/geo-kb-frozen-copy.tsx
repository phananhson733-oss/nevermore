"use client";
// @input -- one exact frozen payload, not the current draft or live Profile
// @output -- complete historical knowledge base inspection, or explicit legacy limitation
// @pos -- history is displayed as stored, never retroactively supplemented
import { useTranslations } from "next-intl";
import type { GeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { normalizeAccountWebsiteUrl } from "../../lib/account-websites/contracts.ts";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";

function FactSource({ url }: { readonly url: string }) {
  // Historical payloads allowed plain strings here. Preserve those values,
  // but do not turn them into executable or GenGrowth-relative navigation.
  return /^https?:\/\//iu.test(url) && normalizeAccountWebsiteUrl(url) !== null
    ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-brand-accent-text underline">{url}</a>
    : <span className="break-all">{url}</span>;
}

export function GeoKbFrozenCopy({ payload, locale, revision }: {
  readonly payload: GeoKbPayload | undefined;
  readonly locale: string;
  readonly revision: number;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  return <details data-frozen-knowledge-base className="mt-5 min-w-0 rounded-card border border-brand-border-card bg-brand-bg p-4">
    <summary className="cursor-pointer text-sm font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{t("asset.frozenCopyTitle")} · v{revision}</summary>
    <div className="mt-5 space-y-4">
      {payload?.profileCopy === undefined ? <p className="text-sm text-text-dark-secondary">{t("asset.frozenLegacy")}</p>
        : <GeoKbInheritedProfile profile={null} copy={payload.profileCopy} locale={locale} inline frozen />}
      {payload === undefined ? null : <div>
        <h4 className="mb-3 text-sm font-semibold">{t("asset.frozenOperations")}</h4>
        <dl className="grid gap-4 text-sm">
          <div><dt className="text-text-dark-secondary">{t("brand.officialNameLabel")}</dt><dd className="break-words">{payload.officialName}</dd></div>
          <div><dt className="text-text-dark-secondary">{t("brand.aliasesLabel")}</dt><dd className="break-words">{payload.aliases.join(" · ")}</dd></div>
          <div><dt className="text-text-dark-secondary">{t("brand.categoryLabel")}</dt><dd className="break-words">{payload.categoryTerms.join(" · ")}</dd></div>
          <div><dt className="text-text-dark-secondary">{t("brand.countryLabel")} / {t("brand.languageLabel")}</dt><dd>{payload.market.country} / {payload.market.language}</dd></div>
          <div><dt className="text-text-dark-secondary">{t("roles.title")}</dt><dd><ul className="space-y-3">{payload.roles.map(role => <li key={role.id} className="whitespace-pre-wrap break-words">{[role.label, role.segment, role.painPoints.join(" · "), role.decisionCriteria.join(" · "), role.vocabulary.join(" · ")].filter(Boolean).join("\n")}</li>)}</ul></dd></div>
          <div><dt className="text-text-dark-secondary">{t("competitors.title")}</dt><dd><ul className="space-y-2">{payload.competitors.map((rival, index) => <li key={index} className="break-words">{[rival.domain, rival.brandName, ...(rival.aliases ?? []), t(rival.confirmed ? "competitors.confirmLabel" : "competitors.unconfirmed")].filter(Boolean).join(" · ")}</li>)}</ul></dd></div>
          <div><dt className="text-text-dark-secondary">{t("facts.title")}</dt><dd><ul className="space-y-2">{payload.facts.map(fact => <li key={fact.key} className="break-words">{fact.key} · {fact.value || t(`facts.reasons.${fact.reason || "lowConfidence"}`)}{fact.sourceUrl ? <> · <FactSource url={fact.sourceUrl} /></> : null}{fact.observedAt ? ` · ${fact.observedAt}` : ""}</li>)}</ul></dd></div>
        </dl>
      </div>}
    </div>
  </details>;
}
