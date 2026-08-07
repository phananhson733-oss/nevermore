// @input  -- next-intl, seo-audit-tool, next/link
// @output -- Homepage's zero-account SEO audit entry point
// @pos    -- Homepage block 2; turns intent into an immediate public-tool action
"use client";

import Link from "next/link";
import { ArrowRight, ScanSearch } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SeoAuditTool } from "@/components/tools/seo-audit-tool";
import { localePath } from "@/lib/locale-path";

export function FreeAuditSection() {
  const t = useTranslations("home.freeAudit");
  const locale = useLocale();

  return (
    <section
      aria-labelledby="free-audit-title"
      className="border-t border-brand-border bg-brand-bg-alt py-16 md:py-22"
    >
      <div className="max-w-content mx-auto grid items-center gap-9 px-6 md:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <div>
          <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("eyebrow")}
          </p>
          <h2 id="free-audit-title" className="mt-3.5 text-text-dark-primary">
            {t("title")}
          </h2>
          <p className="mt-4 text-[15px] leading-[1.7] text-text-dark-secondary">
            {t("body")}
          </p>
          <ul className="mt-6 space-y-2.5 text-[13.5px] text-text-dark-secondary">
            {["point1", "point2", "point3"].map((key) => (
              <li key={key} className="flex items-baseline gap-2.5">
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-[10px] text-brand-accent"
                >
                  ▸
                </span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          {/*
           * 这条替代的是「先修哪个」——产品的 record 里刻意没有 score /
           * severity / priority，所以方向由「属于哪一步」给，不由排序给。
           */}
          <p className="mt-6 border-l-2 border-brand-accent/40 pl-4 text-[13.5px] leading-[1.7] text-text-dark-secondary">
            {t("workflowNote")}
          </p>
        </div>

        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute -top-17 -right-15 size-70 rounded-full bg-[radial-gradient(circle,rgba(61,220,151,0.1),transparent_70%)] blur-[10px]"
          />
          <div className="relative rounded-[16px] border border-brand-border-card bg-brand-panel p-5 shadow-panel md:p-7">
            <div className="mb-4.5 flex items-center justify-between font-mono text-[10px] tracking-[0.1em] text-text-dark-secondary uppercase">
              <span className="inline-flex items-center gap-2">
                <ScanSearch
                  aria-hidden="true"
                  className="size-3.5 text-brand-accent"
                />
                {t("panelLabel")}
              </span>
              <span>{t("panelBadge")}</span>
            </div>
            <SeoAuditTool locale={locale} surface="bare" />
            <Link
              href={localePath(locale, "/tools/seo-audit")}
              className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
            >
              {t("fullReport")}
              <ArrowRight aria-hidden="true" className="size-3" />
            </Link>
            {/*
             * 孤岛判定是 internal-link-audit 的输出（sitemap 差集），不是
             * seo-audit 的。与其在一个结果里混两个工具的数据，不如在这里
             * 交叉引流——更诚实，也多一次自然的工具间流转。
             */}
            <p className="mt-5 border-t border-brand-border pt-4 text-[12.5px] leading-[1.65] text-text-dark-secondary">
              {t("orphanHint")}{" "}
              <Link
                href={localePath(locale, "/tools/internal-link-audit")}
                className="text-brand-accent-text underline-offset-4 transition-colors hover:text-brand-accent-hover hover:underline"
              >
                {t("orphanHintLink")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
