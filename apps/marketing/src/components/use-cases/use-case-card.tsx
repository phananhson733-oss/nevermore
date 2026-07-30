// @input  -- UseCase, locale
// @output -- UseCaseCard component (single use case card)
// @pos    -- use-cases index page card, used in use-cases/page.tsx grid
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import type { UseCase } from "@/lib/use-cases";
import { getUseCaseContent } from "@/lib/use-cases";

interface UseCaseCardProps {
  readonly useCase: UseCase;
}

export function UseCaseCard({ useCase }: UseCaseCardProps) {
  const locale = useLocale();
  const c = getUseCaseContent(useCase, locale);

  return (
    <Link href={`/${locale}/use-cases/${useCase.slug}`} className="group block">
      <article className="h-full rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-6 transition-all duration-200 group-hover:border-brand-accent/50 group-hover:bg-brand-bg-alt/60">
        <div className="mb-3">
          <span className="text-brand-accent-text text-[11px] font-medium tracking-wider uppercase">
            {useCase.category}
          </span>
        </div>
        <h3 className="text-text-dark-primary font-semibold text-[17px] leading-snug mb-2 group-hover:text-brand-accent-text transition-colors">
          {c.title}
        </h3>
        <p className="text-text-dark-secondary text-[13px] leading-relaxed line-clamp-3 mb-4">
          {c.description}
        </p>
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-text-dark-secondary">
            {locale === "zh" ? "了解更多" : "Learn more"}
          </span>
          <span className="text-brand-accent-text opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            &rarr;
          </span>
        </div>
      </article>
    </Link>
  );
}
