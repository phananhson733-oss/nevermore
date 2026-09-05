// @input  -- one authenticated Agent run plus its confirmed local Product/ICP Profile
// @output -- captured-evidence boundary and controlled Stage 02 -> 03 -> 04 workflow
// @pos    -- shared renderer whose state and defaults remain independent per Agent page

"use client";

import { FileSearch, Link2, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { allAgentAuditRecords } from "../../lib/agents/audit-contract";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import {
  buildAgentAuditViewModel,
  type AgentDiagnosisContext,
} from "./agent-audit-model";
import { AgentIssueAccordion } from "./agent-issue-accordion";
import { buildAgentIssueModel } from "./agent-issue-model";
import type { AgentProfileDraft } from "./agent-profile";
import {
  notCollectedUrlCount,
  summarizeAgentRecords,
} from "./agent-result-helpers";
import type { AgentKind } from "./agent-types";

/**
 * The URL the crawl landed on, when that is not the URL it requested.
 *
 * Both halves are canonical: `inspectedTargetUrl` is the collected page's own
 * `fetchUrl` and `landedTargetUrl` is that page's `finalUrl`. Comparing them
 * isolates an actual redirect. Comparing either to `targetUrl` would not --
 * that one is the submitted string, kept verbatim, so it differs from both
 * whenever the visitor pasted a `utm_source` or a capitalised host.
 */
function landedElsewhere(
  result: AgentAuditSuccessData["result"],
): string | null {
  const { inspectedTargetUrl: requested, landedTargetUrl: landed } = result;
  if (requested === null || landed === null || landed === requested) {
    return null;
  }
  return landed;
}

function formatCapturedAt(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function profileContext(profile: AgentProfileDraft): AgentDiagnosisContext {
  return {
    reviewState: profile.reviewState,
    productName: profile.productName,
    primaryIcp: profile.primaryIcp,
    country: profile.country,
    locale: profile.locale,
    device: profile.device,
    pageType: profile.pageType,
    targetQuery: profile.targetQuery,
    auditScope: profile.auditScope,
  };
}

interface CapturedFact {
  readonly label: string;
  readonly value: number | string | null;
  readonly hint: string | null;
}

function summarizeKeyPageReasons(
  pages: AgentAuditSuccessData["result"]["keyPages"],
): {
  readonly navigation: number;
  readonly clusterPages: number;
  readonly content: number;
  readonly manual: number;
  readonly fullSite: number;
  readonly prefixes: readonly string[];
} {
  let navigation = 0;
  let clusterPages = 0;
  let content = 0;
  let manual = 0;
  let fullSite = 0;
  const prefixes = new Set<string>();
  for (const page of pages ?? []) {
    const { reason } = page;
    if (reason === "navigation") navigation += 1;
    else if (reason === "manual") manual += 1;
    else if (reason === "full-site") fullSite += 1;
    else if (typeof reason === "object" && reason.kind === "cluster") {
      clusterPages += 1;
      prefixes.add(reason.prefix);
    } else if (typeof reason === "object" && reason.kind === "content") {
      content += 1;
    }
  }
  return {
    navigation,
    clusterPages,
    content,
    manual,
    fullSite,
    prefixes: [...prefixes].toSorted(),
  };
}

export interface AgentResultsProps {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly data: AgentAuditSuccessData;
  readonly profile: AgentProfileDraft;
  readonly onChooseFullSite?: () => void;
}

export function AgentResults({
  agent,
  locale,
  data,
  profile,
  onChooseFullSite,
}: AgentResultsProps) {
  const t = useTranslations("agents.workbench");
  const landed = landedElsewhere(data.result);
  const auditT = useTranslations("tools.seoAudit");
  const model = useMemo(
    () =>
      buildAgentAuditViewModel({
        agent,
        locale,
        context: profileContext(profile),
        data,
        // The Profile stays on this side of the wire: the response is
        // projected from a payload cached across visitors, so which pages
        // matter to THIS product is asked here, never there.
        coreFeatures: profile.coreFeatures,
      }),
    [agent, data, locale, profile],
  );
  const summary = summarizeAgentRecords(data.result.records);
  const notCollected = notCollectedUrlCount(data.result.coverage);
  /**
   * The same joined list the evaluator decided from. Handing the crawl ledger
   * alone would show a search check that decided beside no evidence at all,
   * because its record lives in the other list.
   */
  const joinedRecords = useMemo(() => allAgentAuditRecords(data), [data]);
  const issueModel = useMemo(
    () =>
      buildAgentIssueModel({
        agent,
        checks: model.evaluatedChecks,
        keyPageReach: model.keyPageReach,
        records: joinedRecords,
        targetUrl: data.result.targetUrl,
        // The form observations carry, which is not the submitted string on a
        // site whose entry redirects between host forms.
        inspectedTargetUrl: data.result.inspectedTargetUrl ?? undefined,
      }),
    [
      agent,
      data.result.targetUrl,
      data.result.inspectedTargetUrl,
      joinedRecords,
      model.evaluatedChecks,
      model.keyPageReach,
    ],
  );
  /**
   * Evidence records are collected measurements, so they are labelled as
   * records here. The Diagnosis panel counts checks, which is a different unit.
   */
  /** Checks this run reached a conclusion on, out of the whole catalogue. */
  const evaluatedChecks = model.evaluatedChecks.filter(
    (check) => check.result !== "excluded",
  ).length;
  const capturedFacts: readonly CapturedFact[] = [
    {
      label: t("pagesInspected"),
      value: data.result.coverage.pagesInspected,
      hint: null,
    },
    {
      label: t("linksObserved"),
      value: data.result.coverage.linksObserved,
      hint: null,
    },
    { label: t("notCollected"), value: notCollected, hint: null },
    {
      label: t("evidenceRecords"),
      value: `${summary.evaluated} / ${summary.total}`,
      hint: t("evaluatedBreakdown", {
        observed: summary.observed,
        notObserved: summary.notObserved,
      }),
    },
  ];
  const keyPageReasons = summarizeKeyPageReasons(model.candidatePages);
  const evaluatesAllCollectedPages =
    agent === "seo" && data.result.crawlTier === "full-site";




  return (
    <section
      data-testid={`agent-results-${agent}`}
      className="mt-8 space-y-5"
      aria-labelledby={`${agent}-capture-title`}
    >
      <header className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] tracking-[0.12em] text-brand-accent-text uppercase">
              {t("capturedReport")}
            </p>
            <h2
              id={`${agent}-capture-title`}
              className="mt-2 break-all text-[20px] font-semibold text-text-dark-primary"
            >
              {data.result.targetUrl}
            </h2>
            {/*
              Where the crawl landed, when that is not where it was sent.

              This route does not require the entry to keep its subject, so a
              URL that redirects across pages DOES produce a report here -- of
              the destination, under a heading naming the URL that was typed.
              The On-Page Checker cannot reach that state at all: it runs with
              `requireSameEntrySubject`, so a cross-page redirect is refused
              with `target_redirected` before a report exists, and its refusal
              screen already names the destination and offers to re-run on it.

              Compared against `inspectedTargetUrl`, never `targetUrl`. The
              submitted string is not canonicalised, so comparing to it prints
              this line for `?utm_source=` or a capitalised host -- a
              normalisation, not a redirect, and the reader cannot tell the
              difference from a line that says one happened.
            */}
            {landed === null ? null : (
              <p
                data-capture-landed
                className="mt-2 font-mono text-[12.5px] break-all text-brand-warning"
              >
                {t("capturedLanded", { url: landed })}
              </p>
            )}
            <p className="mt-2 font-mono text-[10.5px] text-text-dark-secondary">
              {t("capturedAt")}:{" "}
              {formatCapturedAt(data.result.scannedAt, locale)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-brand-accent/30 bg-brand-accent/10 px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-brand-accent-text uppercase">
              <ShieldCheck aria-hidden="true" className="size-3" />
              {t(`availability.${data.result.coverage.availability}`)}
            </span>
            <span className="rounded border border-brand-border-strong px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {data.run.source.cache.status === "hit"
                ? t("cachedCapture")
                : t("newCapture")}
            </span>
          </div>
        </div>

        {/*
          One line above the fold, the rest one disclosure away. The header
          used to spend a four-cell grid, two boundary cards and an origin line
          before the reader reached a single finding.
        */}
        <p
          data-capture-summary
          className="mt-4 font-mono text-[12px] text-text-dark-secondary"
        >
          {/*
            No key page count when no shortlist was selected. The submitted
            page is always judged, so a count would read "1 key page" directly
            above a line saying there are none.
          */}
          {evaluatesAllCollectedPages
            ? t("captureSummaryFullSite", {
                pages: data.result.coverage.pagesInspected,
                evaluablePages: model.candidatePages.length,
                evaluated: evaluatedChecks,
                total: model.evaluatedChecks.length,
              })
            : model.keyPagesWereSelected
              ? t("captureSummary", {
                  pages: data.result.coverage.pagesInspected,
                  keyPages: model.candidatePages.length,
                  evaluated: evaluatedChecks,
                  total: model.evaluatedChecks.length,
                })
              : t("captureSummaryTargetOnly", {
                  pages: data.result.coverage.pagesInspected,
                  evaluated: evaluatedChecks,
                  total: model.evaluatedChecks.length,
                })}
        </p>

        {model.keyPagesWereSelected ? (
          <div
            data-key-page-selection-summary
            className="mt-2 text-[11.5px] leading-[1.6] text-text-dark-secondary"
          >
            <p>
              {t(
                evaluatesAllCollectedPages
                  ? "fullSiteSelectionSummary"
                  : "keyPageSelectionSummary",
                {
                  count: model.candidatePages.length,
                  navigation: keyPageReasons.navigation,
                  clusterPages: keyPageReasons.clusterPages,
                  prefixes:
                    keyPageReasons.prefixes.length > 0
                      ? keyPageReasons.prefixes.join(" ")
                      : "—",
                  content: keyPageReasons.content,
                  manual: keyPageReasons.manual,
                  fullSite: keyPageReasons.fullSite,
                },
              )}
            </p>
            <p className="mt-1 text-text-dark-faint">
              {t("keyPageSelectionFixed")}
            </p>
            <p className="mt-1 text-text-dark-faint">
              {t("keyPageSelectionBoundary")}
            </p>
          </div>
        ) : null}

        {model.omittedUrls.length > 0 ? (
          <div
            data-key-page-omitted
            className="mt-3 rounded-row border border-brand-warning/20 bg-brand-warning/[0.06] px-4 py-3"
          >
            <p className="text-[11.5px] font-medium text-text-dark-primary">
              {t("keyPageOmittedHeading", {
                count: model.omittedUrls.length,
              })}
            </p>
            <ul className="mt-2 space-y-1 font-mono text-[10.5px] text-text-dark-secondary">
              {model.omittedUrls.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {model.manualUnavailableUrls.length > 0 ? (
          <div
            data-key-page-manual-unavailable
            className="mt-3 rounded-row border border-brand-info/20 bg-brand-info/[0.06] px-4 py-3"
          >
            <p className="text-[11.5px] font-medium text-text-dark-primary">
              {t("keyPageManualUnavailableHeading", {
                count: model.manualUnavailableUrls.length,
              })}
            </p>
            <ul className="mt-2 space-y-1 font-mono text-[10.5px] text-text-dark-secondary">
              {model.manualUnavailableUrls.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
          Stated, not implied. A run that judged one page looks exactly like
          one that judged twelve unless it says so.

          Keyed on whether a shortlist was selected, not on how many pages were
          judged: the submitted URL is always judged, from a synthetic row when
          it is not a candidate, so the count is never zero and a count-based
          condition printed "no key pages" beside a header reading "1".
        */}
        {model.keyPagesWereSelected ? null : (
          <p
            data-key-pages-none
            className="mt-2 text-[11.5px] leading-[1.6] text-text-dark-secondary"
          >
            {t("keyPagesNone")}
          </p>
        )}

        <details
          data-capture-detail
          className="mt-4 rounded-row border border-brand-border bg-brand-panel-sunken"
        >
          <summary className="cursor-pointer list-none px-4 py-2.5 font-mono text-[11px] tracking-[0.06em] text-text-dark-secondary uppercase">
            {t("captureDetailLabel")}
          </summary>
          <div className="px-4 pb-4">
        <dl className="mt-5 grid gap-px overflow-hidden rounded-row border border-brand-border-card bg-brand-border-card sm:grid-cols-2 xl:grid-cols-4">
          {capturedFacts.map(({ label, value, hint }) => (
            <div key={label} className="bg-brand-panel-sunken p-4">
              <dt className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
                {label}
              </dt>
              <dd className="mt-2 font-mono text-[18px] font-medium text-text-dark-primary">
                {value === null ? auditT("availability.unavailable") : value}
              </dd>
              {hint ? (
                <dd className="mt-1.5 font-mono text-[11px] text-text-dark-faint">
                  {hint}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[10.5px] leading-[1.6] text-text-dark-faint">
          {t("evidenceRecordsBoundary")}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-3.5">
            <FileSearch
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-brand-accent"
            />
            <div>
              <p className="text-[12px] font-semibold text-text-dark-primary">
                {t("collectionBoundary")}
              </p>
              <p className="mt-1 text-[11px] text-text-dark-secondary">
                {t("boundedHtmlOnly")}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-3.5">
            <Link2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-brand-info"
            />
            <div>
              <p className="text-[12px] font-semibold text-text-dark-primary">
                {t("finalOrigin")}
              </p>
              <p className="mt-1 break-all text-[11px] text-text-dark-secondary">
                {data.result.siteOrigin}
              </p>
            </div>
          </div>
        </div>

        {data.result.coverage.stopReason ? (
          <p className="mt-4 rounded-row border border-brand-warning/20 bg-brand-warning/[0.06] px-4 py-3 text-[11.5px] text-text-dark-secondary">
            {t("stopReason", { reason: data.result.coverage.stopReason })}
          </p>
        ) : null}
          </div>
        </details>
      </header>

      {/*
        One list, site-wide and page-level together. The scope switch this
        replaced made a reader guess which half a finding was filed under
        before they could see it; the row states its own scope instead.
      */}
      <AgentIssueAccordion
        model={issueModel}
        locale={locale}
        profile={profile}
        run={{
          completedAt: data.run.source.completedAt,
          sourceTool: data.run.source.tool,
          schemaVersion: data.run.source.schemaVersion,
        }}
        targetPageExtract={data.result.targetPageExtract}
        {...(onChooseFullSite ? { onChooseFullSite } : {})}
      />

      <p className="text-center font-mono text-[11px] tracking-[0.05em] text-text-dark-faint">
        {t("runBoundary", {
          agent: data.run.agent.toUpperCase(),
          schema: data.run.source.schemaVersion,
        })}
      </p>
    </section>
  );
}
