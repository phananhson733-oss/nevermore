"use client";
// @input  -- the account of one orchestrated build, as the editor recorded it
// @output -- what was written and what was left for the visitor, in that order
// @pos    -- presentation only; it decides nothing and starts nothing
import { useTranslations } from "next-intl";
import type { GeoKbV2BuildReport as Report } from "./use-geo-kb-v2-editor.ts";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";

/**
 * A build that quietly did nothing reads exactly like a build that wrote
 * everything, so each part reports its own outcome rather than one banner
 * standing in for all of them. Where a part was left alone, the reason names
 * the panel that can still change it.
 */
export function GeoKbV2BuildReport({ report, locale }: { readonly report: Report; readonly locale: string }) {
  const te = useTranslations("tools.geoKnowledgeBase.editor");
  const c = geoKbV2Copy(locale);
  const names: Record<"officialName" | "categoryTerms" | "market", string> = { officialName: c.fields.officialName, categoryTerms: c.fields.categories, market: c.fields.market };
  return <section data-geo-v2-build-report className="space-y-2 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 text-[13px] leading-relaxed">
    <h4 className="font-semibold text-text-dark-primary">{te("buildTitle")}</h4>
    <ul className="grid gap-1.5 text-text-dark-secondary">
      <li data-build-fields>{report.fields.length === 0 ? te("buildNoFields") : te("buildFields", { fields: report.fields.map(field => names[field]).join(" · ") })}</li>
      <li data-build-aliases>{te(`buildAliases.${report.aliases}`)}</li>
      <li data-build-competitors>{te(`buildCompetitors.${report.competitors}`)}</li>
      <li data-build-outcome className="text-text-dark-primary">{report.stoppedAt === null ? te("buildDone") : te(`buildStopped.${report.stoppedAt}`)}</li>
    </ul>
  </section>;
}
