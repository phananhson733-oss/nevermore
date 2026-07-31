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
    <section className="mt-16">
      <h2 className="text-xl font-semibold text-text-dark-primary mb-6">
        {t("relatedTerms")}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {terms.map((term) => (
          <Link
            key={term.slug}
            href={localePath(locale, `/glossary/${term.slug}`)}
            className="group block rounded-lg border border-white/[0.06] bg-brand-bg-secondary p-4 transition-colors hover:border-brand-accent/40"
          >
            <span className="text-sm font-medium text-text-dark-primary group-hover:text-brand-accent transition-colors">
              {term.term}
            </span>
            <p className="mt-1 text-xs text-text-dark-secondary line-clamp-2">
              {term.definition}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
