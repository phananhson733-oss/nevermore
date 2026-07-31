// @input  -- language-neutral synchronous site-wide SeoAuditReport DTO
// @output -- crawl coverage, neutral audit records, evidence, and lazy collapsible page inventory
// @pos    -- audit-only result surface for the public SEO Audit tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import {
  ChevronDown,
  CircleHelp,
  FileSearch,
  Minus,
  Radar,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type {
  SeoAuditRecord,
  SeoAuditRecordState,
  SeoAuditReport,
} from "@sf/public-tools";

const STATE_STYLES: Record<SeoAuditRecordState, string> = {
  observed: "border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text",
  not_observed:
    "border-brand-border/80 bg-white/[0.025] text-text-dark-secondary",
  unverified: "border-brand-warning/25 bg-brand-warning/10 text-brand-warning",
};

const STATE_ICONS = {
  observed: FileSearch,
  not_observed: Minus,
  unverified: CircleHelp,
} as const;

function EvidenceValue({
  value,
}: {
  readonly value: string | number | boolean | null;
}) {
  const t = useTranslations("tools.seoAudit");
  if (value === null) return <>{t("notAvailable")}</>;
  if (typeof value === "boolean") {
    return <>{value ? t("booleanTrue") : t("booleanFalse")}</>;
  }
  return <>{String(value)}</>;
}

function AuditRecordRow({ record }: { readonly record: SeoAuditRecord }) {
  const t = useTranslations("tools.seoAudit");
  const Icon = STATE_ICONS[record.state];

  return (
    <details
      data-testid={`seo-audit-record-${record.id}`}
      className="group/record border-t border-brand-border/55 first:border-t-0"
    >
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center md:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${STATE_STYLES[record.state]}`}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h4 className="text-[13px] font-semibold text-text-dark-primary">
              {t(`records.${record.id}.title`)}
            </h4>
            <p className="mt-1 text-[10px] leading-relaxed text-text-dark-secondary">
              {t(`records.${record.id}.description`)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-10 sm:pl-0">
          <span
            className={`rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.1em] ${STATE_STYLES[record.state]}`}
          >
            {t(`recordStates.${record.state}`)}
          </span>
          <span className="rounded-full border border-brand-border/70 px-2 py-1 font-mono text-[9px] text-text-dark-secondary">
            {t("recordCount", {
              affected: record.affected,
              tested: record.tested,
              unit: t(`recordUnits.${record.unit}`),
            })}
          </span>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="hidden h-4 w-4 text-text-dark-secondary transition-transform group-open/record:rotate-180 sm:block"
        />
      </summary>

      <div className="border-t border-brand-border/45 bg-black/10 px-4 py-4 md:px-5">
        {record.observations.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {record.observations.map((observation, index) => (
              <article
                key={`${observation.url ?? "site"}:${index}`}
                className="rounded-xl border border-brand-border/60 bg-[#171718] p-4"
              >
                <p className="break-all font-mono text-[10px] text-brand-accent-text">
                  {observation.url ?? t("siteLevelObservation")}
                </p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {observation.values.map((entry) => (
                    <div key={entry.label} className="min-w-0">
                      <dt className="text-[9px] uppercase tracking-[0.11em] text-text-dark-secondary">
                        {t(`evidence.${entry.label}`)}
                      </dt>
                      <dd className="mt-1 break-all font-mono text-[10px] text-text-dark-primary">
                        <EvidenceValue value={entry.value} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-[10px] leading-relaxed text-text-dark-secondary">
            {record.state === "unverified"
              ? t("noVerifiableObservation")
              : t("noMatchingObservation")}
          </p>
        )}
        {record.limitation ? (
          <p className="mt-4 border-l border-brand-warning/50 pl-3 text-[10px] leading-relaxed text-text-dark-secondary">
            <span className="mr-1 text-text-dark-primary">
              {t("limitationLabel")}:
            </span>
            {t(`limitations.${record.limitation}`)}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function PageInventory({ report }: { readonly report: SeoAuditReport }) {
  const t = useTranslations("tools.seoAudit");
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      aria-labelledby="seo-audit-pages-title"
      data-testid="seo-audit-pages"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="group/pages overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]"
    >
      <summary
        data-testid="seo-audit-pages-toggle"
        className="grid cursor-pointer list-none gap-4 px-5 py-5 transition-colors hover:bg-white/[0.018] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center [&::-webkit-details-marker]:hidden"
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-brand-accent-text">
            {t("pagesEyebrow")}
          </p>
          <h3
            id="seo-audit-pages-title"
            className="mt-2 text-[18px] font-semibold text-text-dark-primary"
          >
            {t("pagesTitle")}
          </h3>
          <p className="mt-2 max-w-3xl text-[10px] leading-relaxed text-text-dark-secondary">
            {t("pagesBody", { count: report.pages.length })}
          </p>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-brand-border/80 bg-white/[0.025] px-3 py-2 text-[10px] font-medium text-text-dark-primary transition-colors group-open/pages:border-brand-accent/35 group-open/pages:text-brand-accent-text">
          <span className="group-open/pages:hidden">
            {t("pagesExpand", { count: report.pages.length })}
          </span>
          <span className="hidden group-open/pages:inline">
            {t("pagesCollapse")}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-3.5 w-3.5 transition-transform duration-200 group-open/pages:rotate-180"
          />
        </span>
      </summary>

      {isOpen ? (
        <div className="overflow-x-auto border-t border-brand-border/60">
          <table className="min-w-[1120px] border-collapse text-left">
            <thead>
              <tr className="border-b border-brand-border/60 text-[9px] uppercase tracking-[0.11em] text-text-dark-secondary">
                <th scope="col" className="px-5 py-3 font-medium">
                  {t("pageColumns.url")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.response")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.depth")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.indexable")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.title")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.description")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.h1")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.links")}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("pageColumns.sitemap")}
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  {t("pageColumns.jsonLd")}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.pages.map((page) => (
                <tr
                  key={page.url}
                  data-testid="seo-audit-page-row"
                  className="border-b border-brand-border/45 align-top last:border-b-0"
                >
                  <td className="max-w-[300px] px-5 py-4">
                    <p className="break-all font-mono text-[10px] text-text-dark-primary">
                      {page.url}
                    </p>
                    {page.redirectHops > 0 ? (
                      <p className="mt-1 break-all font-mono text-[9px] text-text-dark-secondary">
                        → {page.finalUrl}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-4 font-mono text-[10px] text-text-dark-primary">
                    {page.initialStatus ?? t("notAvailable")}
                    {page.redirectHops > 0
                      ? ` → ${page.finalStatus ?? t("notAvailable")}`
                      : null}
                  </td>
                  <td className="px-3 py-4 font-mono text-[10px] text-text-dark-primary">
                    {page.depth}
                  </td>
                  <td className="px-3 py-4 font-mono text-[10px] text-text-dark-primary">
                    {page.robotsDirectiveState
                      ? t(
                          `robotsDirectiveStates.${page.robotsDirectiveState}`,
                        )
                      : t("notAvailable")}
                  </td>
                  <td className="max-w-[180px] px-3 py-4 text-[10px] leading-relaxed text-text-dark-primary">
                    {page.title ?? t("notAvailable")}
                  </td>
                  <td className="max-w-[220px] px-3 py-4 text-[10px] leading-relaxed text-text-dark-secondary">
                    {page.metaDescription ?? t("notAvailable")}
                  </td>
                  <td className="px-3 py-4 font-mono text-[10px] text-text-dark-primary">
                    {page.h1Count}
                  </td>
                  <td className="px-3 py-4 font-mono text-[10px] text-text-dark-primary">
                    {page.inboundLinks} / {page.outboundLinks}
                  </td>
                  <td className="px-3 py-4 text-[10px] text-text-dark-primary">
                    {page.sitemapMember
                      ? t("booleanTrue")
                      : t("booleanFalse")}
                  </td>
                  <td className="max-w-[180px] px-5 py-4 text-[10px] leading-relaxed text-text-dark-secondary">
                    {page.jsonLdTypes.join(", ") || t("notAvailable")}
                    {page.jsonLdErrorCount > 0 ? (
                      <span className="mt-1 block text-brand-warning">
                        {t("jsonLdErrors", {
                          count: page.jsonLdErrorCount,
                        })}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}

export function SeoAuditResults({
  report,
}: {
  readonly report: SeoAuditReport;
}) {
  const t = useTranslations("tools.seoAudit");
  const coverage = report.coverage;

  return (
    <section
      data-testid="seo-audit-results"
      className="space-y-5"
      aria-labelledby="seo-audit-results-title"
    >
      <div className="overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]">
        <div className="grid gap-6 border-b border-brand-border/60 px-5 py-6 md:grid-cols-[1fr_auto] md:items-end md:px-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.17em] text-brand-accent-text">
              {t("resultsEyebrow")}
            </p>
            <h2
              id="seo-audit-results-title"
              className="mt-2 break-all text-[22px] font-semibold tracking-[-0.025em] text-text-dark-primary"
            >
              {report.targetUrl}
            </h2>
            <p className="mt-2 text-[10px] text-text-dark-secondary">
              {t("scannedAt", {
                value: new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(report.scannedAt)),
              })}
            </p>
          </div>
          <div
            className={`w-fit rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.11em] ${
              coverage.availability === "partial"
                ? "border-brand-warning/30 bg-brand-warning/10 text-brand-warning"
                : "border-brand-border/80 bg-white/[0.025] text-text-dark-secondary"
            }`}
          >
            {t(`availability.${coverage.availability}`)}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px bg-brand-border/60 lg:grid-cols-4">
          {[
            {
              label: t("coveragePages"),
              value: String(coverage.pagesInspected),
            },
            {
              label: t("coverageLinks"),
              value: String(coverage.linksObserved),
            },
            {
              label: t("coverageSitemap"),
              value: String(coverage.sitemapUrlsObserved),
            },
            {
              label: t("coverageNotCollected"),
              value: String(
                coverage.urlsSkipped +
                  coverage.urlsBlocked +
                  coverage.urlsDisallowed +
                  coverage.urlsErrored,
              ),
            },
          ].map((item) => (
            <div key={item.label} className="bg-[#171718] px-5 py-5">
              <dt className="text-[9px] uppercase tracking-[0.12em] text-text-dark-secondary">
                {item.label}
              </dt>
              <dd className="mt-2 font-mono text-[18px] text-text-dark-primary">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-4 border-t border-brand-border/60 px-5 py-5 md:grid-cols-[1fr_auto] md:items-center md:px-6">
          <p className="flex items-start gap-2 text-[10px] leading-relaxed text-text-dark-secondary">
            <Radar
              aria-hidden="true"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent-text"
            />
            <span>
              {coverage.availability === "partial"
                ? t("partialCoverage", {
                    reason: coverage.stopReason
                      ? t(`stopReasons.${coverage.stopReason}`)
                      : t("notAvailable"),
                  })
                : t("boundedCoverage")}
            </span>
          </p>
          <p className="font-mono text-[9px] text-text-dark-secondary">
            {t("crawlCounters", {
              skipped: coverage.urlsSkipped,
              blocked: coverage.urlsBlocked,
              disallowed: coverage.urlsDisallowed,
              errors: coverage.urlsErrored,
            })}
          </p>
        </div>
      </div>

      <section
        aria-labelledby="seo-audit-records-title"
        className="overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]"
      >
        <div className="border-b border-brand-border/60 px-5 py-5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-brand-accent-text">
            {t("recordsEyebrow")}
          </p>
          <h3
            id="seo-audit-records-title"
            className="mt-2 text-[18px] font-semibold text-text-dark-primary"
          >
            {t("recordsTitle")}
          </h3>
          <p className="mt-2 max-w-3xl text-[10px] leading-relaxed text-text-dark-secondary">
            {t("recordsBody")}
          </p>
        </div>
        <div>
          {report.records.map((auditRecord) => (
            <AuditRecordRow key={auditRecord.id} record={auditRecord} />
          ))}
        </div>
      </section>

      <PageInventory report={report} />
    </section>
  );
}
