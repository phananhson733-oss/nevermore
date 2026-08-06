// @input  -- GlossaryTerm[], locale string
// @output -- related terms card grid with links to other glossary term pages
// @pos    -- glossary term detail page section, cross-linking for SEO
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { GlossaryTerm } from "@/lib/glossary";
import { localePath } from "@/lib/locale-path";

interface RelatedTermsProps {
  readonly terms: readonly GlossaryTerm[];
  readonly locale: string;
}

export function RelatedTerms({ terms, locale }: RelatedTermsProps) {
  const t = useTranslations("glossary.termPage");

  if (terms.length === 0) {
    return null;
  }

  return (
    <section className="mt-16 border-t border-brand-border pt-14">
      <h2 className="mb-7 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
        {t("relatedTerms")}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {terms.map((term) => (
          <Link
            key={term.slug}
            href={localePath(locale, `/glossary/${term.slug}`)}
            className="group block rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors hover:border-brand-accent/40"
          >
            <span className="text-[15.5px] font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
              {term.term}
            </span>
            <p className="mt-2 line-clamp-2 text-[13px] leading-[1.6] text-text-dark-secondary">
              {term.definition}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
