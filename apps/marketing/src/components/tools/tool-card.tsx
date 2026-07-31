// @input  -- slug, title, description, category, locale props
// @output -- ToolCard component (single free-tool card with category and continuation label)
// @pos    -- tools index page card, used in tools/page.tsx grid
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import Link from "next/link";
import { localePath } from "@/lib/locale-path";

interface ToolCardProps {
  slug: string;
  title: string;
  description: string;
  category: string;
  locale: string;
  ctaLabel?: string;
}

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  testing: { en: "Testing", zh: "测试" },
  analytics: { en: "Analytics", zh: "分析" },
  seo: { en: "SEO", zh: "SEO" },
  diagnosis: { en: "Website diagnosis", zh: "网站诊断" },
  planning: { en: "Planning", zh: "规划" },
};

export function ToolCard({
  slug,
  title,
  description,
  category,
  locale,
  ctaLabel,
}: ToolCardProps) {
  const categoryLabel =
    CATEGORY_LABELS[category]?.[locale] ?? category;

  return (
    <Link
      href={localePath(locale, `/tools/${slug}`)}
      className="group block"
    >
      <article className="h-full rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-6 transition-all duration-200 group-hover:border-brand-accent/50 group-hover:bg-brand-bg-alt/60">
        {/* Category badge */}
        <div className="mb-3">
          <span className="text-brand-accent-text text-[11px] font-medium tracking-wider uppercase">
            {categoryLabel}
          </span>
        </div>

        {/* Tool name */}
        <h3 className="text-text-dark-primary font-semibold text-[17px] leading-snug mb-2 group-hover:text-brand-accent-text transition-colors">
          {title}
        </h3>

        {/* Description */}
        <p className="text-text-dark-secondary text-[13px] leading-relaxed line-clamp-3 mb-4">
          {description}
        </p>

        {/* Footer: try it + arrow */}
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-text-dark-secondary">
            {ctaLabel ?? (locale === "en" ? "Try it free" : "免费使用")}
          </span>
          <span className="text-brand-accent-text opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            &rarr;
          </span>
        </div>
      </article>
    </Link>
  );
}
