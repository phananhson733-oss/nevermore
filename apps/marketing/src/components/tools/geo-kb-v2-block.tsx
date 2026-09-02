"use client";
// @input  -- one of the three named parts of the knowledge base
// @output -- a headed region, so the page reads as an asset with sections
// @pos    -- layout only
import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function GeoKbV2Block({ id, children }: { readonly id: "profile" | "supplement" | "run"; readonly children: ReactNode }) {
  const t = useTranslations("tools.geoKnowledgeBase.blocks");
  const headingId = useId();
  return <section data-geo-v2-block={id} aria-labelledby={headingId} className="min-w-0 space-y-4">
    <div>
      <h3 id={headingId} className="flex items-center gap-3 text-[17px] font-semibold text-text-dark-primary"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-accent" />{t(id)}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-text-dark-secondary">{t(`${id}Body`)}</p>
    </div>
    {children}
  </section>;
}
