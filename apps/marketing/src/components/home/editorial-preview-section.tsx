// @input  -- next-intl, current locale, canonical local Blog article slugs
// @output -- homepage editorial preview with a direct path to tool-linked methods
// @pos    -- homepage block 7; bridges product understanding to the Blog library
"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Link2,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { localePath } from "@/lib/locale-path";

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
    <section className="border-t border-brand-border bg-brand-bg py-16 md:py-22">
      <div className="max-w-content mx-auto px-6 md:px-8">
        <div className="flex flex-col justify-between gap-5 border-b border-brand-border pb-8 md:flex-row md:items-end">
          <div className="max-w-[640px]">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <h2 className="mt-3 text-text-dark-primary">{t("title")}</h2>
            <p className="mt-4 text-[15px] leading-[1.65] text-text-dark-secondary">
              {t("body")}
            </p>
          </div>
          <Link
            href={localePath(locale, "/blog")}
            className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap text-brand-accent-2 uppercase transition-colors hover:text-brand-info"
          >
            {t("viewAll")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>

        <div className="mt-6 grid gap-3.5 md:grid-cols-3">
          {ARTICLES.map((article, index) => {
            const Icon = article.icon;
            return (
              <Link
                key={article.slug}
                href={localePath(locale, `/blog/${article.slug}`)}
                className="group rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors hover:border-brand-accent/40"
              >
                <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.08em] text-brand-accent-text">
                  <span>NOTE_{String(index + 1).padStart(2, "0")}</span>
                  <Icon aria-hidden="true" className="size-3.5" />
                </div>
                <h3 className="mt-6.5 text-[16.5px] leading-[1.4] font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
                  {t(article.titleKey)}
                </h3>
                <p className="mt-2.5 text-[12.5px] leading-[1.65] text-text-dark-secondary">
                  {t(article.bodyKey)}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-brand-accent-text uppercase">
                  {t("read")}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
