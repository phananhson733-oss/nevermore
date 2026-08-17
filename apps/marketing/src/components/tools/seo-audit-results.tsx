// @input  -- site-wide report, locale, and the seo-audit-result-copy helpers
// @output -- coverage, count-ordered records with state legend and grouped
//            duplicate evidence, lazy page inventory, and a GSC-connect closing
// @pos    -- audit-only result surface for the public SEO Audit tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import {
  ArrowRight,
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
// Relative import: the shared Vitest config maps `@/` to apps/web only.
import { localePath } from "../../lib/locale-path";
import { LimitationHint } from "../ui/limitation-hint";
import {
  closingCopy,
  duplicateGroups,
  legendCopy,
  observedIssueRecords,
  pageCountLabel,
  partitionRecords,
  resultCopyLocale,
  zeroObservationSummary,
  type SeoAuditDuplicateGroup,
  type SeoAuditResultCopyLocale,
} from "./seo-audit-result-copy";

/* 状态只用描边 + 15% 底色的 chip 表达。 */
const STATE_STYLES: Record<SeoAuditRecordState, string> = {
  observed: "border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text",
  not_observed:
    "border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary",
  unverified: "border-brand-warning/30 bg-brand-warning/15 text-brand-warning",
};

/* "Observed" 在问题类检查里表示情况存在，在两条站点资源记录里只表示资源被
   找到。前者用 info 蓝与后者的 accent 绿区分开——这是语义区分，不是严重度。 */
const OBSERVED_CONDITION_STYLE =
  "border-brand-info/30 bg-brand-info/10 text-brand-info";

function stateChipClass(record: SeoAuditRecord): string {
  if (record.state === "observed" && record.unit !== "site_resource") {
    return OBSERVED_CONDITION_STYLE;
  }
  return STATE_STYLES[record.state];
}

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

function DuplicateGroupList({
  groups,
  copyLocale,
}: {
  readonly groups: readonly SeoAuditDuplicateGroup[];
  readonly copyLocale: SeoAuditResultCopyLocale;
}) {
  return (
    <div className="grid gap-3">
      {groups.map((group) => (
        <article
          key={group.value}
          data-testid="seo-audit-duplicate-group"
          className="rounded-row border border-brand-border bg-brand-panel-raised p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 text-[12.5px] leading-[1.55] font-medium break-words text-text-dark-primary">
              {group.value}
            </p>
            <span className="shrink-0 rounded border border-brand-border-strong px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {pageCountLabel(group.pageCount, copyLocale)}
            </span>
          </div>
          <ul className="mt-2.5 space-y-1">
            {group.urls.map((url) => (
              <li
                key={url}
                className="font-mono text-[10.5px] break-all text-brand-accent-text"
              >
                {url}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function AuditRecordRow({
  record,
  copyLocale,
}: {
  readonly record: SeoAuditRecord;
  readonly copyLocale: SeoAuditResultCopyLocale;
}) {
  const t = useTranslations("tools.seoAudit");
  const Icon = STATE_ICONS[record.state];
  const chipClass = stateChipClass(record);
  const groups = duplicateGroups(record);

  return (
    <details
      data-testid={`seo-audit-record-${record.id}`}
      className="group/record border-t border-brand-border-faint first:border-t-0"
    >
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center md:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] border ${chipClass}`}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h4 className="text-[13.5px] font-semibold text-text-dark-primary">
              {t(`records.${record.id}.title`)}
            </h4>
            <p className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
              {t(`records.${record.id}.description`)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-10 sm:pl-0">
          <span
            className={`rounded border px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] uppercase ${chipClass}`}
          >
            {t(`recordStates.${record.state}`)}
          </span>
          <span className="rounded border border-brand-border-strong px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary">
            {t("recordCount", {
              affected: record.affected,
              tested: record.tested,
              unit: t(`recordUnits.${record.unit}`),
            })}
          </span>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="hidden size-4 text-text-dark-secondary transition-transform group-open/record:rotate-180 sm:block"
        />
      </summary>

      <div className="border-t border-brand-border-faint bg-brand-panel-sunken px-4 py-4 md:px-5">
        {groups ? (
          <DuplicateGroupList groups={groups} copyLocale={copyLocale} />
        ) : record.observations.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {record.observations.map((observation, index) => (
              <article
                key={`${observation.url ?? "site"}:${index}`}
                className="rounded-row border border-brand-border bg-brand-panel-raised p-4"
              >
                <p className="break-all font-mono text-[10.5px] text-brand-accent-text">
                  {observation.url ?? t("siteLevelObservation")}
                </p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {observation.values.map((entry) => (
                    <div key={entry.label} className="min-w-0">
                      <dt className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                        {t(`evidence.${entry.label}`)}
                      </dt>
                      <dd className="mt-1 break-all font-mono text-[11px] text-text-dark-primary">
                        <EvidenceValue value={entry.value} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {record.state === "unverified"
              ? t("noVerifiableObservation")
              : t("noMatchingObservation")}
          </p>
        )}
        {record.limitation ? (
          <LimitationHint
            className="mt-4"
            label={t("limitationLabel")}
            limitations={[t(`limitations.${record.limitation}`)]}
          />
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
      className="group/pages overflow-hidden rounded-card border border-brand-border-card bg-brand-panel"
    >
      <summary
        data-testid="seo-audit-pages-toggle"
        className="grid cursor-pointer list-none gap-4 px-5 py-5 transition-colors hover:bg-hover-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center [&::-webkit-details-marker]:hidden"
      >
        <div>
          <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("pagesEyebrow")}
          </p>
          <h3
            id="seo-audit-pages-title"
            className="mt-2 text-[16.5px] font-semibold text-text-dark-primary"
          >
            {t("pagesTitle")}
          </h3>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("pagesBody", { count: report.pages.length })}
          </p>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-[8px] border border-brand-border-strong bg-brand-panel-raised px-3 py-2 font-mono text-[10px] tracking-[0.08em] text-text-dark-primary uppercase transition-colors group-open/pages:border-brand-accent/35 group-open/pages:text-brand-accent-text">
          <span className="group-open/pages:hidden">
            {t("pagesExpand", { count: report.pages.length })}
          </span>
          <span className="hidden group-open/pages:inline">
            {t("pagesCollapse")}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 transition-transform duration-200 group-open/pages:rotate-180"
          />
        </span>
      </summary>

      {isOpen ? (
        <div className="overflow-x-auto border-t border-brand-border">
          <table className="min-w-[1120px] border-collapse text-left">
            <thead>
              <tr className="border-b border-brand-border font-mono text-[9.5px] tracking-[0.1em] text-text-dark-secondary uppercase">
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
                  className="border-b border-brand-border-faint align-top last:border-b-0"
                >
                  <td className="max-w-[300px] px-5 py-4">
                    <p className="break-all font-mono text-[11px] text-text-dark-primary">
                      {page.url}
                    </p>
                    {page.redirectHops > 0 ? (
                      <p className="mt-1 break-all font-mono text-[10px] text-text-dark-secondary">
                        → {page.finalUrl}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-4 font-mono text-[11px] text-text-dark-primary">
                    {page.initialStatus ?? t("notAvailable")}
                    {page.redirectHops > 0
                      ? ` → ${page.finalStatus ?? t("notAvailable")}`
                      : null}
                  </td>
                  <td className="px-3 py-4 font-mono text-[11px] text-text-dark-primary">
                    {page.depth}
                  </td>
                  <td className="px-3 py-4 font-mono text-[11px] text-text-dark-primary">
                    {page.robotsDirectiveState
                      ? t(`robotsDirectiveStates.${page.robotsDirectiveState}`)
                      : t("notAvailable")}
                  </td>
                  <td className="max-w-[180px] px-3 py-4 text-[11.5px] leading-[1.55] text-text-dark-primary">
                    {page.title ?? t("notAvailable")}
                  </td>
                  <td className="max-w-[220px] px-3 py-4 text-[11.5px] leading-[1.55] text-text-dark-secondary">
                    {page.metaDescription ?? t("notAvailable")}
                  </td>
                  <td className="px-3 py-4 font-mono text-[11px] text-text-dark-primary">
                    {page.h1Count}
                  </td>
                  <td className="px-3 py-4 font-mono text-[11px] text-text-dark-primary">
                    {page.inboundLinks} / {page.outboundLinks}
                  </td>
                  <td className="px-3 py-4 font-mono text-[11px] text-text-dark-primary">
                    {page.sitemapMember ? t("booleanTrue") : t("booleanFalse")}
                  </td>
                  <td className="max-w-[180px] px-5 py-4 font-mono text-[11px] leading-[1.55] text-text-dark-secondary">
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

function ClosingSection({
  report,
  copyLocale,
}: {
  readonly report: SeoAuditReport;
  readonly copyLocale: SeoAuditResultCopyLocale;
}) {
  const t = useTranslations("tools.seoAudit");
  const issueRecords = observedIssueRecords(report.records);
  const copy = closingCopy(
    {
      pagesInspected: report.coverage.pagesInspected,
      issueTypeCount: issueRecords.length,
    },
    copyLocale,
  );
  const topIssues = issueRecords.slice(0, 3);
  const connectHref = `/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
    localePath(copyLocale, "/tools/seo-quick-wins"),
  )}`;

  return (
    <section
      data-testid="seo-audit-closing"
      aria-labelledby="seo-audit-closing-title"
      className="rounded-card border border-brand-border-card bg-brand-panel p-6 md:p-7"
    >
      <h3
        id="seo-audit-closing-title"
        className="max-w-2xl text-[16.5px] font-semibold text-text-dark-primary"
      >
        {copy.heading}
      </h3>
      {topIssues.length > 0 ? (
        <ol className="mt-4 grid gap-px overflow-hidden rounded-row border border-brand-border-card bg-brand-border-card">
          {topIssues.map((issue, index) => (
            <li
              key={issue.id}
              className="grid gap-3 bg-brand-panel-sunken px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <p className="flex min-w-0 items-baseline gap-3">
                <span className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint">
                  0{index + 1}
                </span>
                <span className="text-[13.5px] font-medium text-text-dark-primary">
                  {t(`records.${issue.id}.title`)}
                </span>
              </p>
              <span className="w-fit rounded border border-brand-border-strong px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
                {t("recordCount", {
                  affected: issue.affected,
                  tested: issue.tested,
                  unit: t(`recordUnits.${issue.unit}`),
                })}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {copy.topNote === null ? null : (
        <p className="mt-2.5 font-mono text-[10.5px] tracking-[0.06em] text-text-dark-faint">
          {copy.topNote}
        </p>
      )}
      <p className="mt-5 max-w-2xl text-[12.5px] leading-[1.65] text-text-dark-secondary">
        {copy.boundary}
      </p>
      <a
        href={connectHref}
        className="mt-6 inline-flex h-11.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        {copy.cta}
        <ArrowRight aria-hidden="true" className="size-4" />
      </a>
    </section>
  );
}

export function SeoAuditResults({
  report,
  locale,
}: {
  readonly report: SeoAuditReport;
  readonly locale: string;
}) {
  const t = useTranslations("tools.seoAudit");
  const coverage = report.coverage;
  const copyLocale = resultCopyLocale(locale);
  const legend = legendCopy(copyLocale);
  const { observed, unverified, nothingObserved } = partitionRecords(
    report.records,
  );

  return (
    <section
      data-testid="seo-audit-results"
      className="space-y-4"
      aria-labelledby="seo-audit-results-title"
    >
      <div className="overflow-hidden rounded-card border border-brand-border-card bg-brand-panel">
        <div className="grid gap-6 border-b border-brand-border px-5 py-6 md:grid-cols-[1fr_auto] md:items-end md:px-6">
          <div>
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("resultsEyebrow")}
            </p>
            <h2
              id="seo-audit-results-title"
              className="mt-2 break-all font-mono text-[19px] tracking-[-0.01em] text-text-dark-primary"
            >
              {report.targetUrl}
            </h2>
            <p className="mt-2 font-mono text-[10.5px] tracking-[0.04em] text-text-dark-secondary">
              {t("scannedAt", {
                value: new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(report.scannedAt)),
              })}
            </p>
          </div>
          <div
            className={`w-fit rounded border px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] uppercase ${
              coverage.availability === "partial"
                ? "border-brand-warning/30 bg-brand-warning/15 text-brand-warning"
                : "border-brand-border-strong text-text-dark-secondary"
            }`}
          >
            {t(`availability.${coverage.availability}`)}
          </div>
        </div>

        {/* 指标格：1px gap + 分隔色底的伪表格 */}
        <dl className="grid grid-cols-2 gap-px bg-brand-border-card lg:grid-cols-4">
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
            <div
              key={item.label}
              className="bg-brand-panel-sunken p-[18px_20px]"
            >
              <dt className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                {item.label}
              </dt>
              <dd className="mt-2 font-mono text-[22px] text-text-dark-primary">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-4 border-t border-brand-border px-5 py-5 md:grid-cols-[1fr_auto] md:items-center md:px-6">
          <p className="flex items-start gap-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            <Radar
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-brand-accent-text"
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
          <p className="font-mono text-[10px] tracking-[0.04em] text-text-dark-secondary">
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
        className="overflow-hidden rounded-card border border-brand-border-card bg-brand-panel"
      >
        <div className="border-b border-brand-border px-5 py-5">
          <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("recordsEyebrow")}
          </p>
          <h3
            id="seo-audit-records-title"
            className="mt-2 text-[16.5px] font-semibold text-text-dark-primary"
          >
            {t("recordsTitle")}
          </h3>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("recordsBody")}
          </p>
          <dl
            data-testid="seo-audit-state-legend"
            aria-label={legend.title}
            className="mt-4 max-w-3xl rounded-row border border-brand-border bg-brand-panel-sunken px-4 py-3.5"
          >
            <dt className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
              {legend.title}
            </dt>
            {[legend.observed, legend.notObserved, legend.unverified].map(
              (entry) => (
                <dd
                  key={entry}
                  className="mt-2 text-[11.5px] leading-[1.6] text-text-dark-secondary"
                >
                  {entry}
                </dd>
              ),
            )}
          </dl>
        </div>
        <div>
          {/* 观察数降序是算术排序，不是严重度排序；0 observed 折叠为一行，
              unverified 是「没能查」而非「查了没有」，因此单独保留。 */}
          {[...observed, ...unverified].map((auditRecord) => (
            <AuditRecordRow
              key={auditRecord.id}
              record={auditRecord}
              copyLocale={copyLocale}
            />
          ))}
          {nothingObserved.length > 0 ? (
            <details
              data-testid="seo-audit-zero-records"
              className="group/zero border-t border-brand-border-faint"
            >
              <summary className="grid cursor-pointer list-none gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:px-5 [&::-webkit-details-marker]:hidden">
                <p className="flex min-w-0 items-start gap-3 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  <span
                    className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] border ${STATE_STYLES.not_observed}`}
                  >
                    <Minus aria-hidden="true" className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    {zeroObservationSummary(
                      nothingObserved.map((entry) =>
                        t(`records.${entry.id}.title`),
                      ),
                      copyLocale,
                    )}
                  </span>
                </p>
                <ChevronDown
                  aria-hidden="true"
                  className="hidden size-4 text-text-dark-secondary transition-transform group-open/zero:rotate-180 sm:block"
                />
              </summary>
              <div className="border-t border-brand-border-faint">
                {nothingObserved.map((auditRecord) => (
                  <AuditRecordRow
                    key={auditRecord.id}
                    record={auditRecord}
                    copyLocale={copyLocale}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </section>

      <PageInventory report={report} />

      <ClosingSection report={report} copyLocale={copyLocale} />
    </section>
  );
}
