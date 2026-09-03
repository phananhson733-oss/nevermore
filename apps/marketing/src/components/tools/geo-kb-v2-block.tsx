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
      {/* A group label, not a card: the accent rule belongs to the section
          cards below, and repeating it here would put two things that look
          like the same level one inside the other. */}
      <h3 id={headingId} className="text-[13px] font-semibold uppercase tracking-[0.08em] text-text-dark-secondary">{t(id)}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-text-dark-secondary">{t(`${id}Body`)}</p>
    </div>
    {children}
  </section>;
}
