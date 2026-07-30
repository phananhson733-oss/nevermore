// @input  -- next-intl, current locale, canonical local Blog article slugs
// @output -- homepage editorial preview with a direct path to tool-linked methods
// @pos    -- homepage block 7; bridges product understanding to the Blog library
"use client";

import Link from "next/link";
import { ArrowRight, BookOpenCheck, Link2, ScanSearch, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

const ARTICLES: readonly {
  readonly slug: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly icon: LucideIcon;
}[] = [
  {
    slug: "evidence-first-growth-experiments",
    titleKey: "experimentTitle",
    bodyKey: "experimentBody",
    icon: BookOpenCheck,
  },
  {
    slug: "bounded-internal-link-crawl",
    titleKey: "linksTitle",
    bodyKey: "linksBody",
    icon: Link2,
  },
  {
    slug: "public-seo-audit-boundaries",
    titleKey: "auditTitle",
    bodyKey: "auditBody",
    icon: ScanSearch,
  },
];

export function EditorialPreviewSection() {
  const locale = useLocale();
  const t = useTranslations("home.editorial");

  return (
    <section className="border-y border-brand-border/60 bg-brand-bg-alt/45 py-16 md:py-24">
      <div className="mx-auto max-w-content px-4">
        <div className="flex flex-col justify-between gap-5 border-b border-brand-border/60 pb-9 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
              {t("eyebrow")}
            </p>
            <h2 className="mt-3 text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-text-dark-primary md:text-[40px]">
              {t("title")}
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-text-dark-secondary">
              {t("body")}
            </p>
          </div>
          <Link
            href={`/${locale}/blog`}
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-brand-accent-text transition-colors hover:text-brand-accent-hover"
          >
            {t("viewAll")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {ARTICLES.map((article, index) => {
            const Icon = article.icon;
            return (
              <Link
                key={article.slug}
                href={`/${locale}/blog/${article.slug}`}
                className="group rounded-2xl border border-brand-border/70 bg-brand-bg p-5 transition-colors hover:border-brand-accent/60"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-brand-accent-text">
                    0{index + 1}
                  </span>
                  <Icon aria-hidden="true" className="size-4 text-brand-accent-text" />
                </div>
                <h3 className="mt-8 text-[17px] font-semibold leading-snug tracking-[-0.02em] text-text-dark-primary group-hover:text-brand-accent-text">
                  {t(article.titleKey)}
                </h3>
                <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">
                  {t(article.bodyKey)}
                </p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-accent-text">
                  {t("read")}
                  <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
