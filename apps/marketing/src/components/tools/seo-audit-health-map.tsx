// @input  -- language-neutral SeoAuditReport DTO
// @output -- five-second brief, repair priorities, and expandable signal matrix
// @pos    -- evidence-led result command deck for the public SEO Audit tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleHelp,
  RefreshCw,
  ScanLine,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
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

const STATUS_ORDER: readonly SeoAuditStatus[] = [
  "fail",
  "warning",
  "pass",
  "unverified",
];

function countStatuses(checks: readonly SeoAuditCheck[]) {
  return checks.reduce<Record<SeoAuditStatus, number>>(
    (counts, check) => ({
      ...counts,
      [check.status]: counts[check.status] + 1,
    }),
    { pass: 0, warning: 0, fail: 0, unverified: 0 },
  );
}

function CheckRow({ check }: { readonly check: SeoAuditCheck }) {
  const t = useTranslations("tools.seoAudit");
  const Icon = ICONS[check.status];

  return (
    <details
      data-testid={`seo-audit-check-${check.id}`}
      className="group/check border-t border-brand-border/50 first:border-t-0"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 py-4">
        <span
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${STATUS_STYLES[check.status]}`}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium text-text-dark-primary">
          {t(`checks.${check.id}.title`)}
        </span>
        <span className="hidden text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary sm:inline">
          {t(`statuses.${check.status}`)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 text-text-dark-secondary transition-transform group-open/check:rotate-180"
        />
      </summary>
      <div className="pb-5 pl-10">
        <div className="grid gap-4 rounded-xl border border-brand-border/60 bg-black/10 p-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary">
              {t("observedEvidenceLabel")}
            </p>
            <dl className="grid gap-3 sm:grid-cols-2">
              {check.evidence.map((item) => (
                <div key={`${item.label}:${String(item.value)}`}>
                  <dt className="text-[10px] uppercase tracking-wide text-text-dark-secondary">
                    {t(`evidence.${item.label}`)}
                  </dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px] text-text-dark-primary">
                    {item.value === null
                      ? t("notAvailable")
                      : String(item.value)}
                  </dd>
                  <dd className="mt-1 text-[9px] uppercase tracking-[0.1em] text-brand-accent-text/80">
                    {t(`sources.${item.source}`)}
                  </dd>
                </div>
              ))}
            </dl>
            {check.limitation ? (
              <p className="mt-4 border-l border-brand-warning/50 pl-3 text-[10px] leading-relaxed text-text-dark-secondary">
                <span className="mr-1 text-text-dark-primary">
                  {t("limitationLabel")}:
                </span>
                {t(`limitations.${check.limitation}`)}
              </p>
            ) : null}
          </div>
          <div className="border-t border-brand-border/50 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary">
              {t("recommendationLabel")}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-text-dark-primary">
              {t(`checks.${check.id}.recommendation`)}
            </p>
            <p className="mt-4 flex gap-2 text-[10px] leading-relaxed text-text-dark-secondary">
              <RefreshCw
                aria-hidden="true"
                className="mt-0.5 h-3 w-3 shrink-0 text-brand-accent-text"
              />
              <span>
                <span className="mr-1 text-text-dark-primary">
                  {t("verificationLabel")}:
                </span>
                {t("verificationText")}
              </span>
            </p>
          </div>
        </div>
      </div>
    </details>
  );
}

function PriorityRow({
  check,
  index,
}: {
  readonly check: SeoAuditCheck;
  readonly index: number;
}) {
  const t = useTranslations("tools.seoAudit");
  const Icon = ICONS[check.status];
  const firstEvidence = check.evidence[0];

  return (
    <li
      data-testid={`seo-audit-priority-${index + 1}`}
      className="grid gap-4 border-t border-brand-border/60 py-5 first:border-t-0 md:grid-cols-[48px_1fr_1.05fr]"
    >
      <span className="font-mono text-[11px] text-brand-accent-text">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${STATUS_STYLES[check.status]}`}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-[14px] font-semibold text-text-dark-primary">
            {t(`checks.${check.id}.title`)}
          </h3>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.11em]">
          <span
            className={`rounded-full border px-2 py-1 ${STATUS_STYLES[check.status]}`}
          >
            {t(`statuses.${check.status}`)}
          </span>
          <span className="rounded-full border border-brand-border bg-white/[0.03] px-2 py-1 text-text-dark-secondary">
            {t("severityLabel", {
              severity: t(`severities.${check.severity}`),
            })}
          </span>
        </div>
        <div className="mt-4">
          <p className="text-[9px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {t("observedEvidenceLabel")}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-text-dark-primary">
            {firstEvidence
              ? `${t(`evidence.${firstEvidence.label}`)}: ${
                  firstEvidence.value === null
                    ? t("notAvailable")
                    : String(firstEvidence.value)
                }`
              : t("notAvailable")}
          </p>
          {firstEvidence ? (
            <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-brand-accent-text/80">
              {t(`sources.${firstEvidence.source}`)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="border-t border-brand-border/50 pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
        <p className="text-[9px] uppercase tracking-[0.12em] text-text-dark-secondary">
          {t("recommendationLabel")}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-text-dark-primary">
          {t(`checks.${check.id}.recommendation`)}
        </p>
        <p className="mt-4 flex gap-2 text-[10px] leading-relaxed text-text-dark-secondary">
          <RefreshCw
            aria-hidden="true"
            className="mt-0.5 h-3 w-3 shrink-0 text-brand-accent-text"
          />
          <span>
            <span className="mr-1 text-text-dark-primary">
              {t("verificationLabel")}:
            </span>
            {t("verificationText")}
          </span>
        </p>
      </div>
    </li>
  );
}

function ModuleRow({
  module,
}: {
  readonly module: SeoAuditReport["modules"][number];
}) {
  const t = useTranslations("tools.seoAudit");
  const counts = countStatuses(module.checks);

  return (
    <details
      data-testid={`seo-audit-module-${module.id}`}
      className="group/module border-t border-brand-border/60 first:border-t-0"
    >
      <summary className="cursor-pointer list-none px-4 py-5 md:px-5">
        <div className="grid gap-4 md:grid-cols-[1.05fr_0.9fr_0.9fr] md:items-center">
          <div className="flex items-center gap-3">
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-brand-accent-text transition-transform group-open/module:rotate-180"
            />
            <div>
              <h3 className="text-[13px] font-semibold text-text-dark-primary">
                {t(`modules.${module.id}`)}
              </h3>
              <p className="mt-1 text-[10px] text-text-dark-secondary">
                {t("checksMeasuredShort", {
                  measured: module.measuredChecks,
                  total: module.totalChecks,
                })}
              </p>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dark-secondary">
                {t("moduleScoreLabel")}
              </span>
              <span className="font-mono text-text-dark-primary">
                {module.score === null ? "--" : module.score}
              </span>
            </div>
            <div
              aria-hidden="true"
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
            >
              <span
                className="block h-full rounded-full bg-brand-accent"
                style={{ width: `${module.score ?? 0}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dark-secondary">
                {t("moduleCoverage", { percent: module.coveragePercent })}
              </span>
              <span className="font-mono text-text-dark-primary">
                {module.measuredWeight}/{module.totalWeight}
              </span>
            </div>
            <div
              aria-hidden="true"
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
            >
              <span
                className="block h-full rounded-full bg-brand-success"
                style={{ width: `${module.coveragePercent}%` }}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 pl-7">
          {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
            <span
              key={status}
              className={`rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.1em] ${STATUS_STYLES[status]}`}
            >
              {t(`statuses.${status}`)} · {counts[status]}
            </span>
          ))}
          {module.checks.length === 0 ? (
            <span className="text-[10px] text-text-dark-secondary">
              {t("noChecks")}
            </span>
          ) : null}
        </div>
      </summary>
      {module.checks.length ? (
        <div className="border-t border-brand-border/60 px-4 md:px-5">
          {module.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

export function SeoAuditHealthMap({
  report,
}: {
  readonly report: SeoAuditReport;
}) {
  const t = useTranslations("tools.seoAudit");
  const resultsRef = useRef<HTMLElement>(null);
  const visiblePriorities = report.priorities.slice(0, 3);
  const primaryPriority = visiblePriorities[0];
  const allChecks = report.modules.flatMap((module) => module.checks);
  const overallCounts = countStatuses(allChecks);

  useEffect(() => {
    resultsRef.current?.focus();
  }, []);

  return (
    <section
      ref={resultsRef}
      tabIndex={-1}
      aria-labelledby="seo-audit-results"
      className="space-y-8 pt-5 outline-none"
    >
      <div
        data-testid="seo-audit-summary"
        className="overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border/60 px-5 py-4 md:px-6">
          <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-brand-accent-text">
            <ScanLine aria-hidden="true" className="h-3.5 w-3.5" />
            {t("resultsTitle")}
          </p>
          <span className="rounded-full border border-brand-border bg-white/[0.025] px-3 py-1 text-[9px] uppercase tracking-[0.11em] text-text-dark-secondary">
            {t("scopeBadge")}
          </span>
        </header>
        <div className="grid lg:grid-cols-[1.45fr_0.55fr]">
          <div className="p-5 md:p-7">
            <p className="text-[10px] uppercase tracking-[0.16em] text-text-dark-secondary">
              {t("summaryLabel")}
            </p>
            <h2
              id="seo-audit-results"
              className="mt-3 text-[24px] font-semibold tracking-[-0.025em] text-text-dark-primary"
            >
              {t("fixFirstTitle")}
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-dark-secondary">
              {primaryPriority
                ? t("summaryWithPriority", {
                    priority: t(`checks.${primaryPriority.id}.title`),
                    percent: report.coveragePercent,
                  })
                : t("summaryWithoutPriority", {
                    percent: report.coveragePercent,
                  })}
            </p>
            <div className="mt-6 border-l border-brand-accent/50 pl-4">
              <p className="text-[9px] uppercase tracking-[0.13em] text-text-dark-secondary">
                {t("targetLabel")}
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-text-dark-primary">
                {report.finalUrl}
              </p>
            </div>
          </div>
          <aside className="border-t border-brand-border/60 bg-brand-accent/[0.045] p-5 lg:border-l lg:border-t-0 md:p-6">
            <p className="text-[10px] uppercase tracking-[0.15em] text-brand-accent-text">
              {t("scoreLabel")}
            </p>
            <div className="mt-3 flex items-end gap-2">
              <span className="text-[38px] font-semibold leading-none tracking-[-0.05em] text-text-dark-primary">
                {report.score ?? "--"}
              </span>
              <span className="pb-1 text-[11px] text-text-dark-secondary">
                /100
              </span>
            </div>
            <p className="mt-4 text-[10px] leading-relaxed text-text-dark-secondary">
              {t("coverage", {
                percent: report.coveragePercent,
                measured: report.measuredChecks,
                total: report.totalChecks,
              })}
            </p>
            <p className="mt-4 border-t border-brand-border/60 pt-4 text-[10px] leading-relaxed text-text-dark-secondary">
              {t("scoreDisclaimer")}
            </p>
          </aside>
        </div>
        <div className="grid grid-cols-2 border-t border-brand-border/60 sm:grid-cols-4">
          {STATUS_ORDER.map((status) => {
            const Icon = ICONS[status];
            return (
              <div
                key={status}
                className="flex items-center gap-2 border-brand-border/60 px-4 py-3 even:border-l sm:border-l sm:first:border-l-0"
              >
                <Icon
                  aria-hidden="true"
                  className="h-3 w-3 text-text-dark-secondary"
                />
                <span className="text-[9px] uppercase tracking-[0.1em] text-text-dark-secondary">
                  {t(`statuses.${status}`)}
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-dark-primary">
                  {overallCounts[status]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <section
        data-testid="seo-audit-priorities"
        aria-labelledby="seo-audit-priorities-title"
        className="rounded-2xl border border-brand-border/70 bg-[#171718] px-5 md:px-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-brand-border/60 py-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-brand-accent-text">
              {t("priorities")}
            </p>
            <h2
              id="seo-audit-priorities-title"
              className="mt-2 text-[17px] font-semibold text-text-dark-primary"
            >
              {t("priorityListTitle")}
            </h2>
          </div>
          <p className="max-w-md text-[10px] leading-relaxed text-text-dark-secondary">
            {t("priorityListBody")}
          </p>
        </div>
        {visiblePriorities.length ? (
          <ol>
            {visiblePriorities.map((check, index) => (
              <PriorityRow key={check.id} check={check} index={index} />
            ))}
          </ol>
        ) : (
          <p className="py-7 text-[12px] leading-relaxed text-text-dark-secondary">
            {t("noPriorities")}
          </p>
        )}
      </section>

      <section
        data-testid="seo-audit-signal-map"
        aria-labelledby="seo-audit-signal-map-title"
      >
        <div className="mb-4 grid gap-3 md:grid-cols-[0.7fr_1.3fr] md:items-end">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-brand-accent-text">
              {t("signalMapEyebrow")}
            </p>
            <h2
              id="seo-audit-signal-map-title"
              className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-text-dark-primary"
            >
              {t("signalMapTitle")}
            </h2>
          </div>
          <p className="text-[11px] leading-relaxed text-text-dark-secondary">
            {t("signalMapBody")}
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]">
          {report.modules.map((module) => (
            <ModuleRow key={module.id} module={module} />
          ))}
        </div>
      </section>
    </section>
  );
}
