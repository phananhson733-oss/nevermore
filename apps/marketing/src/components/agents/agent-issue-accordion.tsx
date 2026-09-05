// @input  -- the projected issue model for one Agent plus this run's provenance
// @output -- issue-first accordion, quiet lanes, and static group 2/4 On-Page handoffs
// @pos    -- replaces the single-selection Stage 03/04 pair; only the explicit tool links write a tab-scoped handoff
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools";

import { AgentIssueDetail } from "./agent-issue-detail";
import type {
  AgentIssue,
  AgentIssueModel,
  AgentIssueSeverity,
} from "./agent-issue-model";
import type { AgentIssuePromptRun } from "./agent-issue-prompt";
import type { AgentProfileDraft } from "./agent-profile";
import { normalizeAgentRunTargetUrl } from "../../lib/agents/agent-run-options.ts";
import { localePath } from "../../lib/locale-path";
import {
  TOOL_HANDOFF_LINK_PROPS,
  writeToolHandoff,
} from "../../lib/tools/tool-handoff";

type IssueFilter = "all" | AgentIssueSeverity | "investigation";

const FILTERS: readonly IssueFilter[] = [
  "all",
  "blocker",
  "warning",
  "suggestion",
  "investigation",
];

const SEVERITY_STYLE: Readonly<Record<AgentIssueSeverity, string>> = {
  blocker: "border-brand-error/35 bg-brand-error/10 text-brand-error",
  warning: "border-brand-warning/35 bg-brand-warning/10 text-brand-warning",
  suggestion: "border-brand-info/35 bg-brand-info/10 text-brand-info",
};

const SEVERITY_ICON = {
  blocker: AlertTriangle,
  warning: AlertTriangle,
  suggestion: CircleHelp,
} as const;

const ON_PAGE_GROUP_HINTS = [
  { groupId: "2" },
  { groupId: "4" },
] as const;

/**
 * Engine states, keyed to their message names.
 *
 * Kebab-case on the left because that is what the evaluator emits. The view
 * layer used to convert these to snake_case on the way in, which is how the
 * same state ended up with three spellings across three files.
 */
const ENGINE_KEY: Readonly<Record<string, string>> = {
  ready: "ready",
  "needs-integration": "needsIntegration",
  "needs-supplement": "needsSupplement",
  "not-integrated": "notIntegrated",
  "access-required": "accessRequired",
};

/** Truth states a row may state, keyed to their message names. */
/**
 * The part of a key page URL that distinguishes it from its siblings.
 *
 * Every row in a run shares an origin, so printing it spends the width that
 * the path needs and pushes the difference past the fold.
 */
function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

const TRUTH_KEY: Readonly<Record<string, string>> = {
  observed: "observed",
  "not-observed": "notObserved",
  partial: "partial",
  "source-gated": "sourceGated",
  unavailable: "unavailable",
};

function matchesFilter(issue: AgentIssue, filter: IssueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "investigation") return issue.lane === "investigation";
  return issue.severity === filter;
}

/** The count a row states, or null when this run could not measure one. */
function affectedLabelKey(issue: AgentIssue): string {
  if (issue.affected.mode === "unavailable") return "row.affectedUnavailable";
  if (issue.affected.mode === "not-captured") return "row.affectedNotCaptured";
  if (issue.affected.mode === "site-scope") return "row.affectedSite";
  return issue.affected.enumerated
    ? "row.affectedUrls"
    : "row.affectedUrlsAtLeast";
}

function IssueRow({
  issue,
  open,
  onToggle,
  locale,
  profile,
  run,
  targetPageExtract,
}: {
  readonly issue: AgentIssue;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly locale: string;
  readonly profile: AgentProfileDraft;
  readonly run: AgentIssuePromptRun;
  readonly targetPageExtract: SeoAuditTargetPageExtract | null;
}) {
  const t = useTranslations("agents.workbench.issues");
  const check = issue.check.check;
  const title = check.title[locale === "zh" ? "zh" : "en"];
  const investigation = issue.lane === "investigation";
  const reach = issue.affected.keyPages;
  /**
   * Pages outside the key set that carry the same problem.
   *
   * Clamped at zero rather than trusted: the key pages are a subset of the
   * crawl, so a negative here would mean the two counts disagree, and a
   * negative "another -2 pages" is worse than saying nothing.
   */
  const elsewhere =
    reach === null
      ? 0
      : Math.max(0, (issue.affected.totalCount ?? 0) - reach.hits);
  const Icon = issue.severity === null ? Search : SEVERITY_ICON[issue.severity];
  const truthKey = TRUTH_KEY[String(issue.check.truth)];

  return (
    <details
      data-issue-row={issue.id}
      data-issue-lane={issue.lane}
      data-issue-severity={issue.severity ?? "none"}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="overflow-hidden rounded-card border border-brand-border-card bg-brand-panel"
    >
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10.5px] tracking-[0.06em] uppercase ${
                investigation
                  ? "border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary"
                  : SEVERITY_STYLE[issue.severity ?? "suggestion"]
              }`}
            >
              <Icon aria-hidden="true" className="size-3" />
              {investigation ? null : issue.priority === null ? null : (
                <span data-issue-priority>{issue.priority}</span>
              )}
              {investigation
                ? t("lane.investigation")
                : t(`severity.${issue.severity ?? "suggestion"}`)}
            </span>
            <span className="font-mono text-[10.5px] text-brand-accent-text">
              {check.id}
            </span>
          </div>
          <strong className="mt-1.5 block text-[13.5px] font-semibold text-text-dark-primary">
            {title}
          </strong>
          {/*
            The page this row is about, when a check that failed on several key
            pages was split into one row each. The path alone: the origin is on
            every row and repeating it pushes the part that differs off the
            end of the line.
          */}
          {issue.keyPage === null ? null : (
            <p
              data-issue-key-page={issue.keyPage.url}
              data-issue-key-page-is-target={
                issue.keyPage.isTarget ? "true" : "false"
              }
              className="mt-1 font-mono text-[11px] break-all text-brand-accent-text"
            >
              {pagePath(issue.keyPage.url)}
              <span className="ml-2 text-[10.5px] text-text-dark-faint">
                {t("row.keyPageIndex", {
                  index: issue.keyPage.index,
                  total: issue.keyPage.total,
                })}
              </span>
            </p>
          )}
          <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {t(affectedLabelKey(issue), {
              count: issue.affected.totalCount ?? 0,
            })}
          </p>
          {/*
            Two populations, stated separately on purpose: the pages this
            Profile pointed at, and everywhere else the same problem was seen.
            Collapsing them would let "3 pages" mean either one.
          */}
          {reach === null ? null : (
            <p
              data-issue-key-page-reach
              className="mt-1 font-mono text-[10.5px] text-text-dark-faint"
            >
              {reach.hits === 0
                ? /*
                    An actionable row with no key-page hit found the problem
                    somewhere else on the site. An investigation row reached no
                    verdict at all. Neither may say "passing" -- the wording
                    that belongs to the passed lane, which this row is not in.
                  */
                  t("row.keyPageScope", {
                    evaluated: reach.evaluated,
                    total: reach.total,
                  })
                : elsewhere === 0
                  ? t("row.keyPageHitsOnly", {
                      hits: reach.hits,
                      total: reach.total,
                    })
                  : t(
                      issue.affected.enumerated
                        ? "row.keyPageHits"
                        : "row.keyPageHitsAtLeast",
                      {
                        hits: reach.hits,
                        total: reach.total,
                        rest: elsewhere,
                      },
                    )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-brand-border-strong bg-brand-panel-raised px-2 py-1 font-mono text-[10.5px] tracking-[0.06em] text-text-dark-secondary uppercase">
            {truthKey === undefined
              ? t("unrecognizedState")
              : t(`truth.${truthKey}`)}
          </span>
          <span className="rounded border border-brand-border-strong bg-brand-panel-raised px-2 py-1 font-mono text-[10.5px] tracking-[0.06em] text-text-dark-secondary uppercase">
            {issue.agent.toUpperCase()}
          </span>
        </div>
      </summary>

      {open ? (
        <AgentIssueDetail
          issue={issue}
          locale={locale}
          profile={profile}
          run={run}
          targetPageExtract={targetPageExtract}
        />
      ) : null}
    </details>
  );
}

function QuietLane({
  testId,
  title,
  hint,
  issues,
  locale,
  onChooseFullSite,
}: {
  readonly testId: string;
  readonly title: string;
  readonly hint: string;
  readonly issues: readonly AgentIssue[];
  readonly locale: string;
  readonly onChooseFullSite?: () => void;
}) {
  const t = useTranslations("agents.workbench.issues");
  if (issues.length === 0) return null;

  return (
    <details
      data-testid={testId}
      className="overflow-hidden rounded-card border border-brand-border bg-brand-panel-sunken"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-5">
        <span className="text-[12.5px] font-medium text-text-dark-primary">
          {title}
        </span>
        <span className="font-mono text-[11px] text-text-dark-secondary">
          {issues.length} · {hint}
        </span>
      </summary>
      <ul className="grid gap-1.5 border-t border-brand-border px-4 py-3 md:px-5">
        {issues.map((issue) => (
          <li
            key={issue.id}
            data-quiet-issue={issue.id}
            className="grid gap-1 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
          >
            <span className="font-mono text-[10.5px] text-text-dark-faint">
              {issue.check.check.id}
            </span>
            <span className="min-w-0 text-[11.5px] text-text-dark-secondary">
              {issue.check.check.title[locale === "zh" ? "zh" : "en"]}
              {issue.affected.keyPages === null ? null : (
                <span
                  data-issue-key-page-reach
                  className="ml-2 font-mono text-[10.5px] text-text-dark-faint"
                >
                  {/*
                    Per lane. Only the passed lane may say "passing": a check
                    excluded on every page would otherwise read "0/12 key pages
                    evaluated · passing", which claims a verdict it never
                    reached, and a measured-not-judged row would contradict the
                    lane heading directly above it.
                  */}
                  {t(
                    issue.lane === "passed"
                      ? "row.keyPagePass"
                      : issue.lane === "observed-only"
                        ? "row.keyPageObserved"
                        : "row.keyPageScope",
                    {
                      evaluated: issue.affected.keyPages.evaluated,
                      total: issue.affected.keyPages.total,
                    },
                  )}
                </span>
              )}
            </span>
            {issue.recognized ? (
              // Why a check reached no conclusion, on the row itself. Folded
              // away is not the same as unexplained: a reader deciding whether
              // to connect a source needs to know which checks it would unlock.
              issue.lane === "excluded" ? (
                <span
                  data-issue-engine={issue.check.engine}
                  className="justify-self-start font-mono text-[10px] tracking-[0.06em] text-text-dark-faint uppercase sm:justify-self-end"
                >
                  {issue.requiresFullSite
                    ? t("excludedLane.fullSiteOnly")
                    : t(`engine.${ENGINE_KEY[issue.check.engine] ?? "unknown"}`)}
                </span>
              ) : null
            ) : (
              <span className="justify-self-start rounded border border-brand-warning/30 bg-brand-warning/[0.07] px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-brand-warning uppercase sm:justify-self-end">
                {t("unrecognizedState")}
              </span>
            )}
          </li>
        ))}
      </ul>
      {onChooseFullSite && issues.some((issue) => issue.requiresFullSite) ? (
        <div className="border-t border-brand-border px-4 py-3 md:px-5">
          <p className="mb-2 text-[11.5px] text-text-dark-secondary">{t("excludedLane.fullSiteHelp")}</p>
          <button type="button" data-choose-full-site onClick={onChooseFullSite}
            className="rounded-md border border-brand-accent/40 px-3 py-2 text-[12px] font-medium text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
            {t("excludedLane.chooseFullSite")}
          </button>
        </div>
      ) : null}
    </details>
  );
}

/**
 * Static guidance for keyword placement checks delegated to the single-page
 * checker. These are links, not checks: they never enter the issue model,
 * actionable lanes, or health denominator.
 */
function OnPageGroupHint({
  groupId,
  locale,
  profile,
}: {
  readonly groupId: (typeof ON_PAGE_GROUP_HINTS)[number]["groupId"];
  readonly locale: string;
  readonly profile: AgentProfileDraft;
}) {
  const t = useTranslations("agents.workbench.issues");
  if (profile.agent !== "seo") return null;

  const query = profile.targetQuery.trim();
  const page = normalizeAgentRunTargetUrl(profile.targetUrl);
  const market = profile.country.trim().toUpperCase();
  const language = profile.locale.trim().slice(0, 2).toLowerCase();
  const canHandOff =
    profile.reviewState === "confirmed" &&
    query !== "" &&
    page !== null &&
    /^[A-Z]{2}$/u.test(market) &&
    /^[a-z]{2}$/u.test(language);

  function prepare(): void {
    if (!canHandOff || page === null) return;
    try {
      writeToolHandoff(window.sessionStorage, Date.now(), {
        source: "seo-agent-key-page",
        destination: "on-page-seo-check",
        scope: "query_page",
        property: null,
        query,
        page,
        evidenceId: null,
        marketCode: market,
        languageCode: language,
      });
    } catch {
      // The href remains a usable plain checker link when storage is denied.
    }
  }

  return (
    <p
      data-on-page-group-hint={groupId}
      className="rounded-card border border-brand-border bg-brand-panel-sunken px-4 py-3 text-[12px] leading-[1.65] text-text-dark-secondary md:px-5"
    >
      {t.rich(`groupHint.${groupId}`, {
        checker: (chunks) => (
          <a
            href={localePath(locale, "/tools/on-page-seo-check")}
            {...TOOL_HANDOFF_LINK_PROPS}
            onClick={() => prepare()}
            onMouseDown={() => prepare()}
            onContextMenu={() => prepare()}
            onAuxClick={() => prepare()}
            className="font-medium text-brand-accent-text underline decoration-brand-accent/45 underline-offset-2 transition-colors hover:text-text-dark-primary"
          >
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}

export interface AgentIssueAccordionProps {
  readonly model: AgentIssueModel;
  readonly locale: string;
  readonly profile: AgentProfileDraft;
  readonly run: AgentIssuePromptRun;
  readonly targetPageExtract: SeoAuditTargetPageExtract | null;
  readonly onChooseFullSite?: () => void;
}

/**
 * Read the run as a list of issues rather than a catalogue of checks.
 *
 * Every actionable issue is its own disclosure and several may stay open at
 * once, because comparing two findings is the common task and a single-selection
 * panel made it impossible. Passing and excluded checks keep their own quiet
 * lanes: they are evidence about coverage, never items to act on.
 */
export function AgentIssueAccordion({
  model,
  locale,
  profile,
  run,
  targetPageExtract,
  onChooseFullSite,
}: AgentIssueAccordionProps) {
  const t = useTranslations("agents.workbench.issues");
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  const visible = model.actionable.filter((issue) =>
    matchesFilter(issue, filter),
  );
  const lastVisibleHintIndex = new Map<string, number>();
  for (const [index, issue] of visible.entries()) {
    if (issue.check.check.scope !== "page") continue;
    if (
      ON_PAGE_GROUP_HINTS.some(
        (hint) => hint.groupId === issue.check.check.groupId,
      )
    ) {
      lastVisibleHintIndex.set(issue.check.check.groupId, index);
    }
  }

  function setOpen(id: string, open: boolean): void {
    setOpenIds((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const filterCount = (candidate: IssueFilter): number =>
    candidate === "all"
      ? model.actionable.length
      : model.actionable.filter((issue) => matchesFilter(issue, candidate))
          .length;

  return (
    <section
      data-testid="agent-issue-accordion"
      data-actionable-count={model.actionable.length}
      className="mt-8 space-y-4"
      aria-labelledby="agent-issues-title"
    >
      <header className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6">
        <p className="font-mono text-[10.5px] tracking-[0.12em] text-brand-accent-text uppercase">
          {t("eyebrow")}
        </p>
        <h2
          id="agent-issues-title"
          className="mt-2 text-[20px] font-semibold text-text-dark-primary"
        >
          {t("title")}
        </h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {t("body")}
        </p>

        <div className="mt-5 grid gap-px overflow-hidden rounded-row border border-brand-border-faint bg-brand-border-faint sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["blocker", model.counts.blocker],
              ["warning", model.counts.warning],
              ["suggestion", model.counts.suggestion],
              ["investigation", model.counts.investigation],
              ["passed", model.counts.passed],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="min-w-0 bg-brand-panel-sunken px-3.5 py-3">
              <p className="font-mono text-[10.5px] tracking-[0.09em] text-text-dark-faint uppercase">
                {t(`summary.${key}`)}
              </p>
              <strong
                data-summary-count={key}
                className="mt-1 block text-[20px] font-semibold text-text-dark-primary"
              >
                {value}
              </strong>
            </div>
          ))}
        </div>
      </header>

      {/*
        A check this build cannot read is not a quiet exclusion. It is stated
        up front, because the alternative is a reader concluding "nothing to do"
        from a lane that was never evaluated.
      */}
      {model.counts.quarantined > 0 ? (
        <div
          data-testid="agent-issues-quarantined"
          data-quarantined-count={model.counts.quarantined}
          className="rounded-card border border-brand-warning/30 bg-brand-warning/[0.07] p-4 md:p-5"
        >
          <p className="flex items-center gap-2 text-[13px] font-semibold text-text-dark-primary">
            <AlertTriangle aria-hidden="true" className="size-4 text-brand-warning" />
            {t("quarantined.title")}
          </p>
          <p className="mt-2 text-[12.5px] leading-[1.65] text-text-dark-secondary">
            {t("quarantined.body", { count: model.counts.quarantined })}
          </p>
        </div>
      ) : null}

      {model.evaluatedNothing ? (
        <div
          data-testid="agent-issues-not-evaluated"
          className="rounded-card border border-brand-warning/30 bg-brand-warning/[0.07] p-5 md:p-6"
        >
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-text-dark-primary">
            <AlertTriangle aria-hidden="true" className="size-4 text-brand-warning" />
            {t("clean.notEvaluated.title")}
          </p>
          <p className="mt-2 text-[12.5px] leading-[1.65] text-text-dark-secondary">
            {t("clean.notEvaluated.body")}
          </p>
        </div>
      ) : model.isClean ? (
        <div
          data-testid="agent-issues-clean"
          className="rounded-card border border-brand-success/25 bg-brand-success/[0.06] p-5 md:p-6"
        >
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-text-dark-primary">
            <CheckCircle2 aria-hidden="true" className="size-4 text-brand-success" />
            {t("clean.title")}
          </p>
          <p className="mt-2 text-[12.5px] leading-[1.65] text-text-dark-secondary">
            {t("clean.body")}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand-border-card bg-brand-panel px-4 py-3 md:px-5">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((candidate) => {
                const selected = candidate === filter;
                return (
                  <button
                    key={candidate}
                    type="button"
                    data-issue-filter={candidate}
                    aria-pressed={selected}
                    onClick={() => setFilter(candidate)}
                    className={`rounded-[8px] border px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] transition-colors ${
                      selected
                        ? "border-brand-accent/40 bg-brand-accent/[0.08] text-brand-accent-text"
                        : "border-brand-border-strong text-text-dark-secondary hover:text-text-dark-primary"
                    }`}
                  >
                    {t(`filters.${candidate}`)} · {filterCount(candidate)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-issue-control="expand-visible"
                onClick={() =>
                  setOpenIds(new Set(visible.map((issue) => issue.id)))
                }
                className="rounded-[8px] border border-brand-border-strong px-3 py-1.5 font-mono text-[11px] text-text-dark-secondary transition-colors hover:text-text-dark-primary"
              >
                {t("controls.expandVisible")}
              </button>
              <button
                type="button"
                data-issue-control="collapse-all"
                onClick={() => setOpenIds(new Set())}
                className="rounded-[8px] border border-brand-border-strong px-3 py-1.5 font-mono text-[11px] text-text-dark-secondary transition-colors hover:text-text-dark-primary"
              >
                {t("controls.collapseAll")}
              </button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p
              data-testid="agent-issues-filter-empty"
              className="rounded-card border border-brand-border bg-brand-panel-sunken px-4 py-6 text-center text-[12.5px] text-text-dark-secondary"
            >
              {t("filterEmpty")}
            </p>
          ) : (
            <div className="grid gap-2.5">
              {visible.map((issue, index) => {
                const hint = ON_PAGE_GROUP_HINTS.find(
                  (entry) =>
                    entry.groupId === issue.check.check.groupId &&
                    lastVisibleHintIndex.get(entry.groupId) === index,
                );
                return (
                  <div key={issue.id} className="grid gap-2.5">
                    <IssueRow
                      issue={issue}
                      open={openIds.has(issue.id)}
                      onToggle={(open) => setOpen(issue.id, open)}
                      locale={locale}
                      profile={profile}
                      run={run}
                      targetPageExtract={targetPageExtract}
                    />
                    {hint === undefined ? null : (
                      <OnPageGroupHint
                        groupId={hint.groupId}
                        locale={locale}
                        profile={profile}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/*
        Its own lane, beside the passed list rather than inside it. A measured
        density is not a page that passed a density check, because there is no
        density check to pass.
      */}
      <QuietLane
        testId="agent-issues-observed-only"
        title={t("observedOnlyLane.title")}
        hint={t("observedOnlyLane.hint")}
        issues={model.observedOnly}
        locale={locale}
      />
      <QuietLane
        testId="agent-issues-passed"
        title={t("passedLane.title")}
        hint={t("passedLane.hint")}
        issues={model.passed}
        locale={locale}
      />
      <QuietLane
        testId="agent-issues-excluded"
        title={t("excludedLane.title")}
        hint={t("excludedLane.hint")}
        issues={model.excluded}
        locale={locale}
        {...(onChooseFullSite ? { onChooseFullSite } : {})}
      />
    </section>
  );
}
