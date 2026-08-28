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
  geo: { en: "AI visibility", zh: "AI 可见性" },
};

export function ToolCard({
  slug,
  title,
  description,
  category,
  locale,
  ctaLabel,
}: ToolCardProps) {
  const categoryLabel = CATEGORY_LABELS[category]?.[locale] ?? category;

  return (
    <Link href={localePath(locale, `/tools/${slug}`)} className="group block">
      <article className="flex h-full flex-col rounded-card border border-brand-border-card bg-brand-panel p-[26px] transition-colors duration-200 group-hover:border-brand-accent/40">
        <div className="flex flex-wrap items-center gap-2">
          {/* Category chip */}
          <span className="rounded border border-brand-accent/30 px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
            {categoryLabel}
          </span>
        </div>

        {/* Tool name */}
        <h3 className="mt-4 text-[16.5px] leading-snug font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
          {title}
        </h3>

        {/* Description */}
        <p className="mt-2 line-clamp-3 text-[13px] leading-[1.6] text-text-dark-secondary">
          {description}
        </p>

        {/* Footer: continuation label + arrow */}
        <span className="mt-auto flex items-center gap-1.5 pt-5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase">
          {ctaLabel ?? (locale === "en" ? "Try it free" : "免费使用")}
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
