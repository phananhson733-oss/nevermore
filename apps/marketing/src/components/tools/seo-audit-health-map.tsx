// @input  -- language-neutral SeoAuditReport DTO
// @output -- measured score, coverage, priorities, and five-module health map
// @pos    -- evidence-led result visualization for the public SEO Audit tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { AlertTriangle, Check, CircleHelp, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  SeoAuditCheck,
  SeoAuditReport,
  SeoAuditStatus,
} from "@sf/public-tools";

const STATUS_STYLES: Record<SeoAuditStatus, string> = {
  pass: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  fail: "border-red-400/20 bg-red-400/10 text-red-200",
  unverified: "border-brand-border bg-white/[0.03] text-text-dark-secondary",
};

const ICONS = {
  pass: Check,
  warning: AlertTriangle,
  fail: X,
  unverified: CircleHelp,
} as const;

function CheckRow({ check }: { readonly check: SeoAuditCheck }) {
  const t = useTranslations("tools.seoAudit");
  const Icon = ICONS[check.status];

  return (
    <details className="group border-t border-brand-border/50 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3.5">
        <span
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${STATUS_STYLES[check.status]}`}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium text-text-dark-primary">
          {t(`checks.${check.id}.title`)}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
          {t(`statuses.${check.status}`)}
        </span>
      </summary>
      <div className="pb-4 pl-10">
        <dl className="mb-3 grid gap-2 sm:grid-cols-2">
          {check.evidence.map((item) => (
            <div key={`${item.label}:${String(item.value)}`}>
              <dt className="text-[10px] uppercase tracking-wide text-text-dark-secondary">
                {t(`evidence.${item.label}`)}
              </dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-text-dark-primary">
                {item.value === null ? t("notAvailable") : String(item.value)}
              </dd>
              <dd className="mt-1 text-[9px] uppercase tracking-[0.1em] text-brand-accent-text/80">
                {t(`sources.${item.source}`)}
              </dd>
            </div>
          ))}
        </dl>
        {check.limitation ? (
          <p className="mb-3 rounded-lg border border-brand-border/60 bg-white/[0.02] px-3 py-2 text-[10px] leading-relaxed text-text-dark-secondary">
            <span className="mr-1 text-text-dark-primary">
              {t("limitationLabel")}:
            </span>
            {t(`limitations.${check.limitation}`)}
          </p>
        ) : null}
        <p className="text-[11px] leading-relaxed text-text-dark-secondary">
          <span className="mr-1 text-text-dark-primary">
            {t("recommendationLabel")}:
          </span>
          {t(`checks.${check.id}.recommendation`)}
        </p>
      </div>
    </details>
  );
}

export function SeoAuditHealthMap({
  report,
}: {
  readonly report: SeoAuditReport;
}) {
  const t = useTranslations("tools.seoAudit");

  return (
    <section aria-labelledby="seo-audit-results" className="space-y-6 pt-5">
      <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
        <div className="rounded-2xl border border-brand-accent/25 bg-brand-accent/[0.06] p-6">
          <p className="text-[11px] uppercase tracking-[0.16em] text-brand-accent-text">
            {t("scoreLabel")}
          </p>
          <div className="mt-3 flex items-end gap-2">
            <span className="text-[52px] font-semibold leading-none tracking-[-0.05em] text-text-dark-primary">
              {report.score ?? "--"}
            </span>
            <span className="pb-1 text-[13px] text-text-dark-secondary">/100</span>
          </div>
          <p className="mt-4 text-[12px] text-text-dark-secondary">
            {t("coverage", {
              measured: report.measuredChecks,
              total: report.totalChecks,
            })}
          </p>
        </div>
        <div className="rounded-2xl border border-brand-border/70 bg-[#171718] p-6">
          <h2
            id="seo-audit-results"
            className="text-[17px] font-semibold text-text-dark-primary"
          >
            {t("resultsTitle")}
          </h2>
          <p className="mt-2 break-all font-mono text-[11px] text-text-dark-secondary">
            {report.finalUrl}
          </p>
          {report.priorities.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {report.priorities.map((check) => (
                <span
                  key={check.id}
                  className={`rounded-full border px-2.5 py-1 text-[10px] ${STATUS_STYLES[check.status]}`}
                >
                  {t(`checks.${check.id}.title`)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {report.modules.map((module) => (
          <article
            key={module.id}
            className="rounded-2xl border border-brand-border/70 bg-[#171718] px-5"
          >
            <header className="flex items-center justify-between py-5">
              <h3 className="text-[14px] font-semibold text-text-dark-primary">
                {t(`modules.${module.id}`)}
              </h3>
              <span className="font-mono text-[12px] text-brand-accent-text">
                {module.score === null ? "--" : module.score}
                <span className="ml-2 text-[9px] text-text-dark-secondary">
                  {module.measuredChecks}/{module.totalChecks}
                </span>
              </span>
            </header>
            {module.checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
