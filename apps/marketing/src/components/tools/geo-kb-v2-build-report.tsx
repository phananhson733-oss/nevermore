"use client";
// @input  -- the account of one orchestrated build, as the editor recorded it
// @output -- what was written and what was left for the visitor, in that order
// @pos    -- presentation only; it decides nothing and starts nothing
import { useTranslations } from "next-intl";
import type { GeoKbV2BuildReport as Report } from "./use-geo-kb-v2-editor.ts";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import type { GeoV2MeasurementField } from "../../lib/geo-tools/kb-v2-measurement.ts";

/**
 * A build that quietly did nothing reads exactly like a build that wrote
 * everything, so each part reports its own outcome rather than one banner
 * standing in for all of them. A run that never reached the derivation reports
 * no parts at all: three rows saying "already matched" would be the result of
 * a comparison nobody performed.
 *
 * The region is always mounted and always live, because a node inserted only
 * when there is something to say is not reliably announced.
 */
export function GeoKbV2BuildReport({ report, locale }: { readonly report: Report | null; readonly locale: string }) {
  const te = useTranslations("tools.geoKnowledgeBase.editor");
  const c = geoKbV2Copy(locale);
  const names: Record<GeoV2MeasurementField, string> = { officialName: c.fields.officialName, categoryTerms: c.fields.categories, market: c.fields.market };
  const list = (fields: readonly GeoV2MeasurementField[]) => fields.map(field => names[field]).join(" · ");
  return <section data-geo-v2-build-report role="status" aria-live="polite" aria-atomic="true" className={report === null ? "sr-only" : "space-y-2 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 text-[13px] leading-relaxed"}>
    {report === null ? null : <>
      <p className="font-semibold text-text-dark-primary">{te("buildTitle")}</p>
      <ul className="grid gap-1.5 text-text-dark-secondary">
        {report.derived === null ? null : <>
          <li data-build-fields>{report.derived.fields.length === 0 ? te("buildNoFields") : te("buildFields", { fields: list(report.derived.fields) })}</li>
          {report.derived.unavailable.length === 0 ? null : <li data-build-unavailable>{te("buildUnavailable", { fields: list(report.derived.unavailable) })}</li>}
          <li data-build-aliases>{te(`buildAliases.${report.derived.aliases}`)}</li>
          <li data-build-competitors>{te(`buildCompetitors.${report.derived.competitors}`)}</li>
        </>}
        <li data-build-outcome className="text-text-dark-primary">{report.stoppedAt === null ? te("buildDone") : te(`buildStopped.${report.stoppedAt}`)}</li>
      </ul>
    </>}
  </section>;
}
