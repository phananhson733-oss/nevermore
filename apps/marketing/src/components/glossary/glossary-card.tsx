// @input  -- GlossaryTerm, locale, next-intl
// @output -- GlossaryCard component (single glossary term card)
// @pos    -- glossary index page card, used in glossary/page.tsx grid
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { GlossaryTerm } from "@/lib/glossary";

interface GlossaryCardProps {
  readonly term: GlossaryTerm;
  readonly locale: string;
}

export function GlossaryCard({ term, locale }: GlossaryCardProps) {
  const t = useTranslations("glossary");

  return (
    <Link href={`/${locale}/glossary/${term.slug}`} className="group block">
      <article className="h-full rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-5 transition-all duration-200 group-hover:border-brand-accent/50 group-hover:bg-brand-bg-alt/60">
        {/* Category badge */}
        <div className="mb-3">
          <span className="text-brand-accent-text text-[11px] font-medium tracking-wider uppercase">
            {t(term.category)}
          </span>
        </div>

        {/* Term name */}
        <h3 className="text-text-dark-primary font-semibold text-[17px] leading-snug mb-2 group-hover:text-brand-accent-text transition-colors">
          {term.term}
        </h3>

        {/* Definition (truncated to 1 line) */}
        <p className="text-text-dark-secondary text-[13px] leading-relaxed line-clamp-2 mb-4">
          {term.definition}
        </p>

        {/* Footer: read more + arrow */}
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-text-dark-secondary">{t("readMore")}</span>
          <span className="text-brand-accent-text opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            &rarr;
          </span>
        </div>
      </article>
    </Link>
  );
}
