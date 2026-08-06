// @input  -- GlossaryTerm, locale, next-intl
// @output -- GlossaryCard component (single glossary term card)
// @pos    -- glossary index page card, used in glossary/page.tsx grid
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { GlossaryTerm } from "@/lib/glossary";
import { localePath } from "@/lib/locale-path";

interface GlossaryCardProps {
  readonly term: GlossaryTerm;
  readonly locale: string;
}

export function GlossaryCard({ term, locale }: GlossaryCardProps) {
  const t = useTranslations("glossary");

  return (
    <Link
      href={localePath(locale, `/glossary/${term.slug}`)}
      className="group block"
    >
      <article className="flex h-full flex-col rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors duration-200 group-hover:border-brand-accent/40">
        {/* Category chip */}
        <span className="w-fit rounded border border-brand-accent/30 px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
          {t(term.category)}
        </span>

        {/* Term name */}
        <h3 className="mt-4 text-[15.5px] leading-snug font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
          {term.term}
        </h3>

        {/* Definition (truncated to 2 lines) */}
        <p className="mt-2 line-clamp-2 text-[13px] leading-[1.6] text-text-dark-secondary">
          {term.definition}
        </p>

        {/* Footer: read more + arrow */}
        <span className="mt-auto flex items-center gap-1.5 pt-5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase">
          {t("readMore")}
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            &rarr;
          </span>
        </span>
      </article>
    </Link>
  );
}
