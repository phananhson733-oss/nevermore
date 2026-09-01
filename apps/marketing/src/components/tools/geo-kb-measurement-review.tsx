"use client";
// @input -- an explicitly copied full Profile and the current GEO draft
// @output -- field-by-field opt-in measurement changes; no save or freeze
// @pos -- makes shared source data and run-specific overrides visibly separate
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { MarketingWebsiteProfileV1 } from "../../lib/account-websites/contracts.ts";
import { GEO_KB_LIMITS, type GeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { applyGeoProfileSuggestions, buildGeoProfileSuggestions, GEO_MEASUREMENT_FIELDS, type GeoMeasurementField } from "../../lib/geo-tools/kb-profile-suggestions.ts";
import { Button } from "../ui/button.tsx";
function describe(value: unknown): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(row => typeof row === "string" ? row : [row.label, row.segment, ...row.painPoints, ...row.decisionCriteria, ...row.vocabulary].filter(Boolean).join(" · ")).join("\n");
  const market = value as GeoKbPayload["market"];
  return `${market.country} · ${market.language}`;
}
export function GeoKbMeasurementReview({ profile, payload, disabled, onApply }: {
  readonly profile: MarketingWebsiteProfileV1;
  readonly payload: GeoKbPayload;
  readonly disabled: boolean;
  readonly onApply: (next: GeoKbPayload) => void;
}) {
  const t = useTranslations("tools.geoKnowledgeBase.measurementReview");
  const proposal = useMemo(() => buildGeoProfileSuggestions(profile, payload), [profile, payload]);
  const [fields, setFields] = useState<readonly GeoMeasurementField[]>([]);
  const [replaceCompetitors, setReplaceCompetitors] = useState(false);
  const [competitors, setCompetitors] = useState<readonly number[]>([]);
  let next: GeoKbPayload | null = null;
  try { next = applyGeoProfileSuggestions(payload, proposal, { fields, competitorIndices: replaceCompetitors ? competitors : null }); } catch { /* Invalid selections remain visible and cannot be applied. */ }
  return <details className="rounded-card border border-brand-border-card bg-brand-panel px-5 py-5 sm:px-7" data-measurement-review>
    <summary className="cursor-pointer text-[15px] font-semibold text-text-dark-primary">{t("title")}</summary>
    <p className="mt-4 text-sm leading-relaxed text-text-dark-secondary">{t("body")}</p>
    <div className="mt-5 grid gap-4">
      {GEO_MEASUREMENT_FIELDS.map(field => <div key={field} className="rounded-lg border border-brand-border-card p-4">
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
      <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={replaceCompetitors} disabled={disabled} onChange={event => setReplaceCompetitors(event.target.checked)} />{t("replaceCompetitors")}</label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{proposal.competitors.map((row, index) => <label key={`${index}-${row.sourceValue}`} className="flex min-w-0 items-start gap-3 text-sm">
        <input type="checkbox" data-competitor-choice className="mt-1" checked={competitors.includes(index)} disabled={disabled || !replaceCompetitors || row.value === null || (!competitors.includes(index) && competitors.length >= GEO_KB_LIMITS.competitors)} onChange={event => setCompetitors(event.target.checked ? [...competitors, index] : competitors.filter(value => value !== index))} />
        <span className="break-words">{row.sourceValue}<span className="mt-1 block text-xs text-text-dark-secondary">{row.value === null ? t("requiresManual") : row.value.confirmed ? t("confirmedPreserved") : t("unconfirmed")}</span></span>
      </label>)}</div>
      <p className="mt-4 text-xs text-text-dark-secondary">{t("selected", { count: competitors.length, limit: GEO_KB_LIMITS.competitors })}</p>
    </fieldset>
    <Button type="button" variant="outline" data-apply-measurements className="mt-5" disabled={disabled || (!fields.length && !replaceCompetitors) || next === null} onClick={() => {
      if (next === null) return;
      onApply(next); setFields([]); setCompetitors([]); setReplaceCompetitors(false);
    }}>{t("apply")}</Button>
  </details>;
}
