// @input  -- UseCase, locale
// @output -- UseCaseCard component (single use case card)
// @pos    -- use-cases index page card, used in use-cases/page.tsx grid
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import type { UseCase } from "@/lib/use-cases";
import { getUseCaseContent } from "@/lib/use-cases";
import { localePath } from "@/lib/locale-path";

interface UseCaseCardProps {
  readonly useCase: UseCase;
}

export function UseCaseCard({ useCase }: UseCaseCardProps) {
  const locale = useLocale();
  const c = getUseCaseContent(useCase, locale);

  return (
    <Link
      href={localePath(locale, `/use-cases/${useCase.slug}`)}
      className="group block"
    >
      <article className="flex h-full flex-col rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors duration-200 group-hover:border-brand-accent/40">
        {/* Category chip */}
        <span className="w-fit rounded border border-brand-accent/30 px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
          {useCase.category}
        </span>

        <h3 className="mt-4 text-[16.5px] leading-snug font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
          {c.title}
        </h3>

        <p className="mt-2 line-clamp-3 text-[13px] leading-[1.6] text-text-dark-secondary">
          {c.description}
        </p>

        <span className="mt-auto flex items-center gap-1.5 pt-5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase">
          {locale === "zh" ? "了解更多" : "Learn more"}
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
