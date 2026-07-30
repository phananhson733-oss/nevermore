// @input  -- next-intl, seo-audit-tool, next/link
// @output -- Homepage's zero-account SEO audit entry point
// @pos    -- Homepage block 2; turns intent into an immediate public-tool action
"use client";

import Link from "next/link";
import { ArrowRight, ScanSearch } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SeoAuditTool } from "@/components/tools/seo-audit-tool";

export function FreeAuditSection() {
  const t = useTranslations("home.freeAudit");
  const locale = useLocale();

  return (
    <section
      aria-labelledby="free-audit-title"
      className="border-y border-brand-border/70 bg-brand-bg-alt py-16 md:py-20"
    >
      <div className="mx-auto grid max-w-content gap-9 px-4 lg:grid-cols-[0.74fr_1.26fr] lg:gap-14">
        <div className="lg:pt-3">
          <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text">
            <ScanSearch aria-hidden="true" className="size-5" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
            {t("eyebrow")}
          </p>
          <h2
            id="free-audit-title"
            className="mt-3 max-w-md font-semibold text-text-dark-primary"
          >
            {t("title")}
          </h2>
          <p className="mt-4 max-w-md text-base text-text-dark-secondary">
            {t("body")}
          </p>
          <ul className="mt-7 space-y-3 text-sm text-text-dark-secondary">
            {["point1", "point2", "point3"].map((key) => (
              <li key={key} className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-accent" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-brand-accent/20 bg-brand-bg p-5 shadow-[0_20px_70px_rgba(0,0,0,0.18)] md:p-7">
          <SeoAuditTool locale={locale} />
          <Link
            href={`/${locale}/tools/seo-audit`}
            className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-brand-accent-text transition-colors hover:text-brand-accent-hover"
          >
            {t("fullReport")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
