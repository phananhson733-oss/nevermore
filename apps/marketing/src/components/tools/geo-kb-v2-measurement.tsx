"use client";
// @input  -- the confirmed Profile copy this draft carries, plus the live draft
// @output -- a named difference and an explicit, bounded adoption gesture
// @pos    -- V2 measurement inputs; roles and facts keep their own review path
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { MarketingWebsiteProfileV1 } from "../../lib/account-websites/contracts.ts";
import { GEO_KB_LIMITS } from "../../lib/geo-tools/kb-contract.ts";
import type { GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import { applyGeoV2Measurement, geoV2MeasurementGapFrom, geoV2MeasurementProposal, hasGeoV2MeasurementGap, GEO_V2_MEASUREMENT_FIELDS, type GeoV2MeasurementField } from "../../lib/geo-tools/kb-v2-measurement.ts";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { Button } from "../ui/button.tsx";
import { GeoKbSection } from "./geo-kb-section.tsx";

function describe(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("\n");
  const market = value as GeoKbPayloadV2["market"];
  return `${market.country} · ${market.language}`;
}

export function GeoKbV2MeasurementReview({ profile, payload, locale, disabled, onChange }: {
  readonly profile: MarketingWebsiteProfileV1;
  readonly payload: GeoKbPayloadV2;
  readonly locale: string;
  readonly disabled: boolean;
  readonly onChange: (payload: GeoKbPayloadV2) => void;
}) {
  const t = useTranslations("tools.geoKnowledgeBase.measurementReview");
  const c = geoKbV2Copy(locale);
  // The proposal reads only the draft's competitors, so it survives keystrokes
  // elsewhere; the gap is cheap and is recomputed from it each render.
  const proposal = useMemo(() => geoV2MeasurementProposal(profile, payload), [profile, payload.competitors]);
  const gap = geoV2MeasurementGapFrom(proposal, payload);
  const [chosenFields, setFields] = useState<readonly GeoV2MeasurementField[]>([]);
  const [replaceCompetitors, setReplaceCompetitors] = useState(false);
  const [chosenCompetitors, setCompetitors] = useState<readonly number[]>([]);
  // A choice made against an earlier proposal may no longer be adoptable; it
  // is dropped here rather than left as a ticked box that cannot be applied.
  const fields = chosenFields.filter(field => proposal.fields[field] !== null);
  const competitors = chosenCompetitors.filter(index => proposal.competitors[index]?.value);
  if (!hasGeoV2MeasurementGap(gap)) return null;
  const names: Readonly<Record<GeoV2MeasurementField, string>> = { officialName: c.fields.officialName, categoryTerms: c.fields.categories, market: c.fields.market };
  let next: GeoKbPayloadV2 | null = null;
  try { next = applyGeoV2Measurement(payload, proposal, { fields, competitorIndices: replaceCompetitors ? competitors : null }); }
  catch { /* An over-limit or duplicate selection stays visible and cannot be applied. */ }
  return <GeoKbSection title={t("gapTitle")} heading={4}>
    <div data-geo-v2-measurement className="grid gap-2 text-sm text-text-dark-secondary">
      {gap.fields.length === 0 ? null : <p data-gap-fields>{t("gapFields", { fields: gap.fields.map(field => names[field]).join(" · ") })}</p>}
      {gap.competitorsDiffer ? <p data-gap-competitors>{t("gapCompetitors", { source: gap.sourceCompetitorCount, draft: gap.draftCompetitorCount, missing: gap.missingCompetitorCount })}</p> : null}
      {gap.competitorsDiffer && gap.overCompetitorLimit ? <p data-gap-limit>{t("competitorsBody", { sourceCount: gap.sourceCompetitorCount, limit: GEO_KB_LIMITS.competitors })}</p> : null}
    </div>
    <details className="mt-4 border-t border-brand-border-card pt-4" data-measurement-review-v2>
      <summary className="cursor-pointer text-[13px] font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{t("title")}</summary>
      <p className="mt-4 text-sm leading-relaxed text-text-dark-secondary">{t("body")}</p>
      <p className="mt-2 text-xs leading-relaxed text-text-dark-secondary">{t("rolesExcluded")}</p>
      <div className="mt-5 grid gap-4">
        {GEO_V2_MEASUREMENT_FIELDS.map(field => <div key={field} className="rounded-lg border border-brand-border-card p-4">
          <label className="flex items-start gap-3 text-sm font-medium">
            <input type="checkbox" data-measurement-field={field} className="mt-1" disabled={disabled || proposal.fields[field] === null} checked={fields.includes(field)} onChange={event => setFields(event.target.checked ? [...fields, field] : fields.filter(value => value !== field))} />
            {t(`fields.${field}`)}
          </label>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-text-dark-secondary">{t("current")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{describe(payload[field])}</dd></div>
            <div><dt className="text-text-dark-secondary">{t("proposed")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{proposal.fields[field] === null ? t("requiresManual") : describe(proposal.fields[field])}</dd></div>
          </dl>
        </div>)}
      </div>
      <fieldset className="mt-5 rounded-lg border border-brand-border-card p-4">
        <legend className="px-2 text-sm font-medium">{t("competitorsTitle")}</legend>
        <p className="text-sm leading-relaxed text-text-dark-secondary">{t("competitorsBody", { sourceCount: proposal.competitors.length, limit: GEO_KB_LIMITS.competitors })}</p>
        <p className="mt-3 text-sm">{t("current")}: {payload.competitors.map(row => row.brandName || row.domain).join(" · ") || "—"}</p>
        <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" data-replace-competitors checked={replaceCompetitors} disabled={disabled} onChange={event => setReplaceCompetitors(event.target.checked)} />{t("replaceCompetitors")}</label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{proposal.competitors.map((row, index) => <label key={`${index}-${row.sourceValue}`} className="flex min-w-0 items-start gap-3 text-sm">
          <input type="checkbox" data-competitor-choice className="mt-1" checked={competitors.includes(index)} disabled={disabled || !replaceCompetitors || row.value === null || (!competitors.includes(index) && competitors.length >= GEO_KB_LIMITS.competitors)} onChange={event => setCompetitors(event.target.checked ? [...competitors, index] : competitors.filter(value => value !== index))} />
          <span className="break-words">{row.sourceValue}<span className="mt-1 block text-xs text-text-dark-secondary">{row.value === null ? t("requiresManual") : row.value.confirmed ? t("confirmedPreserved") : t("unconfirmed")}</span></span>
        </label>)}</div>
        <p className="mt-4 text-xs text-text-dark-secondary">{t("selected", { count: competitors.length, limit: GEO_KB_LIMITS.competitors })}</p>
      </fieldset>
      <Button type="button" variant="outline" data-apply-measurements className="mt-5" disabled={disabled || (!fields.length && !replaceCompetitors) || (replaceCompetitors && competitors.length === 0) || next === null} onClick={() => {
        if (next === null) return;
        onChange(next); setFields([]); setCompetitors([]); setReplaceCompetitors(false);
      }}>{t("apply")}</Button>
    </details>
  </GeoKbSection>;
}
