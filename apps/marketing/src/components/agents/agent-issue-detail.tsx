// @input  -- one projected issue, the confirmed Profile, and this run's provenance
// @output -- the expanded body of one issue: evidence, repair, validation, limits, handoff
// @pos    -- presentation only; drafts nothing, applies nothing, stores nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  SeoAuditRecord,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools";

import { AgentSolutionDraft, draftKindFor } from "./agent-solution-draft";
import type { AgentIssue } from "./agent-issue-model";
import {
  buildAgentIssuePrompt,
  type AgentIssuePromptRun,
} from "./agent-issue-prompt";
import { comparableUrl } from "./agent-result-helpers";
import { localePath } from "../../lib/locale-path";
import {
  TOOL_HANDOFF_LINK_PROPS,
  writeToolHandoff,
} from "../../lib/tools/tool-handoff";
import type { AgentProfileDraft } from "./agent-profile";
import { solutionTemplate } from "./agent-solution-templates";
import { useCopyToClipboard } from "../../lib/use-copy-to-clipboard";

/** Most evidence rows one issue shows before the rest stay in the record count. */
const EVIDENCE_ROW_LIMIT = 8;

function Block({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      data-issue-block
      className="min-w-0 rounded-row border border-brand-border-faint bg-brand-panel-sunken p-3.5"
    >
      <h5 className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
        {label}
      </h5>
      {/*
        `[&_p]` is doing real work here. `@layer base` sets a global
        `p { font-size: clamp(0.97rem, 1.4vw, 1.09rem) }` for the marketing
        site's prose, which is ~17px — larger than the issue title above it and
        larger than the sibling lines that carry an explicit size. Inside one
        block that produced three unrelated sizes and made the supporting line
        look like a footnote to a headline. The panel sets its own scale.
      */}
      <div className="mt-2 text-[12.5px] leading-[1.65] text-text-dark-primary [&_li]:text-[12.5px] [&_p]:text-[12.5px] [&_p]:leading-[1.65]">
        {children}
      </div>
    </section>
  );
}

/**
 * The key pages this check actually reached a problem verdict on.
 *
 * The row above states this as a count -- "9/12 key pages" -- and nothing on
 * screen ever named the nine. A reader could see that a problem was somewhere
 * in the selected set and had no way to find out where, which is the half of
 * the answer that costs the most to reconstruct by hand.
 *
 * Kept separate from the URL list below it, which comes from the record's own
 * observations. The two are different populations and merging them would let a
 * page appear as evidence for a verdict reached somewhere else.
 */
function KeyPageHits({
  issue,
  targetUrl,
  locale,
  profile,
}: {
  readonly issue: AgentIssue;
  readonly targetUrl: string;
  readonly locale: string;
  readonly profile: AgentProfileDraft;
}) {
  const t = useTranslations("agents.workbench.issues");
  const [handoffFailed, setHandoffFailed] = useState(false);
  const reach = issue.affected.keyPages;
  if (reach === null || reach.hits === 0) return null;

  /*
    The checker is the same engine run against one page, which is exactly the
    capture the Agent is missing for every key page but the submitted one. So a
    page that needs repair guidance goes there, rather than the Agent growing a
    second text pipeline for a heading list it never collected.

    Gated on a confirmed query and a two-letter market, because the checker's
    keyword slots have nothing to judge without one and the handoff validator
    refuses a payload that carries neither.
  */
  const query = profile.targetQuery.trim();
  const market = profile.country.trim().toUpperCase();
  const language = profile.locale.trim().slice(0, 2).toLowerCase();
  const canHandOff =
    query !== "" &&
    /^[A-Z]{2}$/u.test(market) &&
    /^[a-z]{2}$/u.test(language) &&
    /^(?:[A-Z]\d{1,2}|\d{1,2}\.\d{1,2})$/u.test(issue.check.check.id);

  function prepare(page: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      let stored = false;
      try {
        stored = writeToolHandoff(window.sessionStorage, Date.now(), {
          source: "seo-agent-key-page",
          destination: "on-page-seo-check",
          scope: "query_page",
          property: null,
          query,
          page,
          evidenceId: issue.check.check.id,
          marketCode: market,
          languageCode: language,
        });
      } catch {
        // A denied storage getter is a failed handoff, never permission to go.
      }
      setHandoffFailed(!stored);
      if (!stored) event.preventDefault();
    };
  }

  const submitted = comparableUrl(targetUrl);
  const onlyTarget =
    reach.hits === 1 &&
    reach.urls.length === 1 &&
    comparableUrl(reach.urls[0] ?? "") === submitted;
  const rest = reach.hits - reach.urls.length;

  return (
    <div data-issue-key-page-hits className="mt-3">
      <p className="!text-[11.5px] leading-[1.6] font-medium text-text-dark-secondary">
        {t("affected.keyPagesHeading")}
      </p>
      {onlyTarget ? (
        <p className="mt-1.5 !text-[11.5px] leading-[1.6] text-text-dark-secondary">
          {t("affected.keyPagesOnlyTarget")}
        </p>
      ) : (
        <>
          <ul className="mt-1.5 grid gap-1.5">
            {reach.urls.map((url) => (
              <li
                key={url}
                data-key-page-hit
                data-key-page-is-target={
                  comparableUrl(url) === submitted ? "true" : "false"
                }
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
              >
                <span className="min-w-0 font-mono text-[11.5px] break-all text-brand-accent-text">
                  {url}
                </span>
                {canHandOff && comparableUrl(url) !== submitted ? (
                  <a
                    data-key-page-check={url}
                    href={localePath(locale, "/tools/on-page-seo-check")}
                    {...TOOL_HANDOFF_LINK_PROPS}
                    onClick={prepare(url)}
                    onMouseDown={prepare(url)}
                    onContextMenu={prepare(url)}
                    onAuxClick={prepare(url)}
                    className="shrink-0 rounded-[6px] border border-brand-border-strong px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-text-dark-secondary uppercase transition-colors hover:border-brand-accent/70 hover:text-text-dark-primary"
                  >
                    {t("affected.checkThisPage")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          {rest > 0 ? (
            <p className="mt-2 !text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("affected.keyPagesMore", { rest })}
            </p>
          ) : null}
          {handoffFailed ? (
            <p
              data-key-page-handoff-failed
              role="alert"
              className="mt-2 !text-[11.5px] leading-[1.6] text-brand-error"
            >
              {t("affected.checkHandoffFailed")}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function AffectedTargets({ issue }: { readonly issue: AgentIssue }) {
  const t = useTranslations("agents.workbench.issues");
  const { affected } = issue;

  if (affected.mode === "unavailable") {
    return (
      <p data-affected-mode="unavailable" className="text-text-dark-primary">
        {t("affected.unavailable")}
      </p>
    );
  }
  if (affected.mode === "not-captured") {
    return (
      <p data-affected-mode="not-captured" className="text-text-dark-primary">
        {t("affected.notCaptured")}
      </p>
    );
  }
  if (affected.mode === "site-scope") {
    // The record's own affected count survives here. Printing only the generic
    // scope sentence threw away a population the evaluator did measure.
    const counted = (affected.totalCount ?? 0) > 1;
    return (
      <div data-affected-mode="site-scope">
        <p className="text-text-dark-primary">
          {counted
            ? t("affected.siteScopeCounted", {
                count: affected.totalCount ?? 0,
              })
            : t("affected.siteScope")}
        </p>
        {affected.enumerated ? null : (
          <p
            data-affected-enumerated="false"
            className="mt-2 !text-[11.5px] leading-[1.6] text-text-dark-secondary"
          >
            {t("affected.notEnumerated")}
          </p>
        )}
      </div>
    );
  }
  if (affected.urls.length === 0) {
    return (
      <p data-affected-mode="urls" className="text-text-dark-primary">
        {t("affected.none")}
      </p>
    );
  }

  return (
    <div data-affected-mode="urls">
      <ul className="grid gap-1.5">
        {affected.urls.map((url) => (
          <li
            key={url}
            className="font-mono text-[11.5px] break-all text-brand-accent-text"
          >
            {url}
          </li>
        ))}
      </ul>
      {affected.enumerated ? null : (
        <p
          data-affected-enumerated="false"
          className="mt-2 !text-[11.5px] leading-[1.6] text-text-dark-secondary"
        >
          {t("affected.notEnumerated")}
        </p>
      )}
      {affected.overflowCount > 0 ? (
        <p className="mt-2 !text-[11.5px] leading-[1.6] text-text-dark-secondary">
          {t("affected.more", {
            shown: affected.urls.length,
            total: affected.totalCount ?? affected.urls.length,
            rest: affected.overflowCount,
          })}
        </p>
      ) : null}
    </div>
  );
}

function EvidenceChain({
  records,
}: {
  readonly records: readonly SeoAuditRecord[];
}) {
  const t = useTranslations("agents.workbench.issues");
  if (records.length === 0) {
    return <p className="text-text-dark-primary">{t("evidence.none")}</p>;
  }

  return (
    <div className="grid gap-2">
      {records.slice(0, EVIDENCE_ROW_LIMIT).map((record) => (
        <div
          key={record.id}
          data-evidence-record={record.id}
          className="rounded border border-brand-border-faint bg-brand-panel-raised p-2.5"
        >
          <p className="font-mono text-[10.5px] tracking-[0.06em] text-text-dark-faint uppercase">
            {record.id} · {t(`evidence.state.${record.state}`)}
          </p>
          <p className="mt-1 font-mono text-[11.5px] text-text-dark-primary">
            {t("evidence.counts", {
              tested: record.tested,
              affected: record.affected,
            })}
          </p>
          {record.limitation === null ? null : (
            <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
              {t("evidence.limitation")}: {record.limitation}
            </p>
          )}
        </div>
      ))}
      {records.length > EVIDENCE_ROW_LIMIT ? (
        <p className="text-[11.5px] text-text-dark-secondary">
          {t("evidence.more", { rest: records.length - EVIDENCE_ROW_LIMIT })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Hand this one issue to an assistant.
 *
 * The prompt is built inside the click handler from the issue this render is
 * showing, so a filter or a re-run cannot leave the button copying a stale
 * issue. Clipboard denial is ordinary, so the exact same text is revealed on
 * the page and selected on focus rather than reported as an error.
 */
function IssueHandoff({
  issue,
  locale,
  run,
  targetUrl,
}: {
  readonly issue: AgentIssue;
  readonly locale: string;
  readonly run: AgentIssuePromptRun;
  readonly targetUrl: string;
}) {
  const t = useTranslations("agents.workbench.issues");
  const { status, copiedKey, fallbackText, copy } = useCopyToClipboard();
  const [previewOpen, setPreviewOpen] = useState(false);
  const investigation = issue.copyMode === "investigation";
  const active = copiedKey === issue.id;
  const promptText = buildAgentIssuePrompt({
    issue,
    locale,
    run,
    targetUrl,
  });

  return (
    <section
      data-issue-handoff={issue.id}
      className="mb-4 rounded-row border border-brand-accent/25 bg-brand-accent/[0.05] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
        <div className="min-w-0">
          <h5 className="text-[12.5px] font-semibold text-text-dark-primary">
            {investigation ? t("ai.investigationTitle") : t("ai.repairTitle")}
          </h5>
          <p className="mt-1 !text-[12px] leading-[1.6] text-text-dark-secondary">
            {investigation ? t("ai.investigationBody") : t("ai.repairBody")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            data-issue-copy={issue.id}
            onClick={() => {
              void copy(
                issue.id,
                buildAgentIssuePrompt({ issue, locale, run, targetUrl }),
              );
            }}
            className="inline-flex h-9.5 items-center rounded-[8px] bg-brand-gradient px-3.5 text-[11.5px] font-semibold text-brand-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {investigation ? t("ai.copyInvestigation") : t("ai.copyRepair")}
          </button>
          <button
            type="button"
            data-issue-preview={issue.id}
            aria-expanded={previewOpen}
            aria-controls={`issue-preview-${issue.id}`}
            onClick={() => setPreviewOpen((open) => !open)}
            className="inline-flex h-9.5 items-center rounded-[8px] border border-brand-border-strong px-3.5 text-[11.5px] font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("ai.preview")}
          </button>
        </div>
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {active && status === "done" ? t("ai.copied") : null}
        {active && status === "failed" ? t("ai.copyFailed") : null}
      </div>

      {previewOpen ? (
        <pre
          id={`issue-preview-${issue.id}`}
          data-issue-preview-panel={issue.id}
          className="mt-3 max-h-80 overflow-auto rounded border border-brand-border bg-brand-panel-sunken p-3 font-mono text-[11px] leading-[1.6] whitespace-pre-wrap text-text-dark-primary"
        >
          {promptText}
        </pre>
      ) : null}

      {active && status === "failed" && fallbackText !== null ? (
        <div className="mt-3">
          <label
            htmlFor={`issue-fallback-${issue.id}`}
            className="text-[11.5px] text-text-dark-secondary"
          >
            {t("ai.fallbackLabel")}
          </label>
          <textarea
            id={`issue-fallback-${issue.id}`}
            data-issue-fallback={issue.id}
            readOnly
            value={fallbackText}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1.5 h-40 w-full rounded border border-brand-border-strong bg-brand-panel-sunken p-2.5 font-mono text-[11px] text-text-dark-primary"
          />
        </div>
      ) : null}
    </section>
  );
}

export interface AgentIssueDetailProps {
  readonly issue: AgentIssue;
  readonly locale: string;
  readonly profile: AgentProfileDraft;
  readonly run: AgentIssuePromptRun;
  readonly targetPageExtract: SeoAuditTargetPageExtract | null;
}

export function AgentIssueDetail({
  issue,
  locale,
  profile,
  run,
  targetPageExtract,
}: AgentIssueDetailProps) {
  const t = useTranslations("agents.workbench.issues");
  const recT = useTranslations("agents.workbench.recommendations");
  /**
   * Solution template keys already carry their own `recommendations.` prefix,
   * so they resolve one level up. Reaching for them from the narrower namespace
   * would need the prefix stripped back off by hand, and a key that misses
   * renders as its own path rather than failing.
   */
  const templateT = useTranslations("agents.workbench");
  const profileT = useTranslations("agents.workbench.profile");
  const check = issue.check.check;
  const investigation = issue.copyMode === "investigation";
  /**
   * Whether the submitted page is among the pages this issue was found on.
   *
   * The aggregate takes its verdict from the worst key page, while the draft,
   * the preview and the handoff all use the submitted page -- the only one
   * this run captured in full. False here means the repair guidance below is
   * about a page that passed, and the screen has to say so.
   */
  const hitIncludesTarget = (() => {
    const reach = issue.affected.keyPages;
    if (reach === null || reach.hits === 0) return true;
    const submitted = comparableUrl(profile.targetUrl);
    return reach.urls.some((url) => comparableUrl(url) === submitted);
  })();
  const localizedText = (value: { readonly en: string; readonly zh: string }) =>
    value[locale === "zh" ? "zh" : "en"];

  const deviceLabel = profileT(`options.device.${profile.device}`);
  const pageTypeLabel = profileT(`options.pageType.${profile.pageType}`);
  /**
   * Which confirmed Profile facts this advice was written against.
   *
   * The two Agents answer different questions, so they state different context:
   * naming the SEO Agent's CTA and audience beside a redirect chain would imply
   * the technical judgement depended on them.
   */
  const contextFacts: readonly (readonly [string, string])[] =
    issue.agent === "seo"
      ? [
          [recT("productLabel"), profile.productName],
          [recT("ctaLabel"), profile.primaryCta],
          [recT("queryLabel"), profile.targetQuery || recT("unconfirmedValue")],
          [recT("audienceLabel"), profile.primaryIcp],
        ]
      : [
          [recT("targetLabel"), profile.targetUrl],
          [recT("productLabel"), profile.productName],
          [
            recT("pageContextLabel"),
            [
              pageTypeLabel,
              deviceLabel,
              profileT(`options.auditScope.${profile.auditScope}`),
            ].join(" · "),
          ],
          [recT("audienceLabel"), profile.primaryIcp],
        ];
  const template = solutionTemplate(issue.agent, issue.check, {
    fillIn: recT("previewFillIn"),
    notCaptured: recT("previewNotCaptured"),
    targetUrl: profile.targetUrl,
    productName: profile.productName,
    targetQuery: profile.targetQuery,
    pageType: pageTypeLabel,
    searchContext: [profile.country, profile.locale, deviceLabel]
      .filter((value) => value.trim().length > 0)
      .join(" · "),
    measurement: issue.check.measurement
      ? localizedText(issue.check.measurement)
      : null,
    evidenceRecords: issue.evidenceRecords,
    // The page's own text, so a preview stops reporting a title the same run
    // collected as "not captured".
    targetPageExtract,
  });
  const draftKind = draftKindFor(template.kind);

  return (
    <div
      data-issue-detail={issue.id}
      className="border-t border-brand-border px-4 pt-4 pb-4 md:px-5"
    >
      {/*
        The handoff leads. Its two buttons are what a reader reaches for once
        they have decided this row matters, and hunting for them at the bottom
        of a long detail meant scrolling past the answer to find the action.
      */}
      <IssueHandoff
        issue={issue}
        locale={locale}
        run={run}
        targetUrl={profile.targetUrl}
      />

      {issue.copyMode === "investigation" ? (
        <p
          data-issue-investigation-note
          className="mb-4 rounded-row border border-brand-info/25 bg-brand-info/[0.06] px-3.5 py-2.5 !text-[12.5px] leading-[1.6] text-text-dark-primary"
        >
          {t("investigationNote")}
        </p>
      ) : null}

      {/*
        One column, read top to bottom: what the rule is, what it hit, what the
        evidence was, then what to do about it. The two-column split put the
        repair beside the rule it answers, so the eye had to cross the page to
        pair them, and neither column ended where the other did.
      */}
      <div className="grid gap-3">
        <Block label={t("sections.rule")}>
          <p>{localizedText(check.threshold)}</p>
          {issue.check.measurement ? (
            <p className="mt-1.5 font-mono !text-[11.5px] text-text-dark-secondary">
              {t("sections.measured")}: {localizedText(issue.check.measurement)}
            </p>
          ) : null}
        </Block>

        <Block label={t("sections.affected")}>
          <AffectedTargets issue={issue} />
          <KeyPageHits
            issue={issue}
            targetUrl={profile.targetUrl}
            locale={locale}
            profile={profile}
          />
        </Block>

        <Block label={t("sections.evidence")}>
          <EvidenceChain records={issue.evidenceRecords} />
          <p className="mt-2 !text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {t("sections.boundary")}: {localizedText(check.boundary)}
          </p>
        </Block>
        {/*
            A gated check reached no verdict, so it gets no repair guidance at
            all — not even relabelled as a "candidate direction". What it needs
            is the source that would answer it; printing the fix beside a note
            saying this is not a fix is the contradiction this replaces.
          */}
        {investigation ? (
          <Block label={t("sections.whatWouldAnswer")}>
            <p>
              {t("sections.requiredSource")}: {localizedText(check.dataSource)}
            </p>
            <p className="mt-1.5 !text-[11.5px] leading-[1.55] text-text-dark-secondary">
              {t("investigationNextStep")}
            </p>
          </Block>
        ) : (
          <Block label={t("sections.repair")}>
            {/*
              Which page this guidance is actually about. Naming the scope is
              the honest half; writing guidance for a page whose text was never
              captured is not something this run can do.
            */}
            <p
              data-repair-scope={hitIncludesTarget ? "target" : "elsewhere"}
              className="mb-2 !text-[11.5px] leading-[1.6] text-text-dark-secondary"
            >
              {hitIncludesTarget
                ? t("affected.repairScopeTarget", { url: profile.targetUrl })
                : t("affected.repairScopeElsewhere")}
            </p>
            <p>{localizedText(check.howToFix)}</p>
            <p className="mt-2 !text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {templateT(template.recommendationKey)}
            </p>
            {/*
                The preview prints what this run measured plus a slot for every
                sentence the owner still has to write. It wraps rather than
                widening the document, and scrolls inside its own box when a
                line genuinely cannot break.
              */}
            <pre
              data-issue-preview-shape={template.presentation}
              className="mt-2.5 max-w-full overflow-x-auto rounded border border-brand-border-dashed bg-brand-panel-raised p-3 font-mono text-[10.5px] leading-[1.7] whitespace-pre-wrap text-text-dark-primary"
            >
              {template.preview}
            </pre>
          </Block>
        )}

        <Block label={recT("contextLabel")}>
          <dl className="grid gap-1.5">
            {contextFacts.map(([label, value]) => (
              <div
                key={label}
                className="grid gap-0.5 sm:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)] sm:gap-3"
              >
                <dt className="font-mono text-[10.5px] tracking-[0.06em] text-text-dark-faint uppercase">
                  {label}
                </dt>
                <dd className="min-w-0 break-words text-[12px] text-text-dark-primary">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Block>

        {/*
            Validation steps verify a change, and the risk/limit lines describe
            making one. Neither exists for a check that reached no verdict, so
            the gated row states its own boundary instead of borrowing a
            repair's.
          */}
        {investigation ? (
          <Block label={t("sections.boundaries")}>
            <p>
              <span className="text-text-dark-faint">
                {t("sections.limits")}:{" "}
              </span>
              {localizedText(check.boundary)}
            </p>
          </Block>
        ) : (
          <>
            <Block label={t("sections.validation")}>
              <ol className="grid list-decimal gap-1 pl-4">
                {template.validationKeys.map((key) => (
                  <li key={key}>{templateT(key)}</li>
                ))}
              </ol>
            </Block>

            <Block label={t("sections.boundaries")}>
              <p>
                <span className="text-text-dark-faint">
                  {t("sections.impact")}:{" "}
                </span>
                {templateT(template.impactSurfaceKey)}
              </p>
              <p className="mt-1.5">
                <span className="text-text-dark-faint">
                  {t("sections.risks")}:{" "}
                </span>
                {templateT(template.risksKey)}
              </p>
              <p className="mt-1.5">
                <span className="text-text-dark-faint">
                  {t("sections.limits")}:{" "}
                </span>
                {templateT(template.limitsKey)}
              </p>
            </Block>
          </>
        )}
      </div>

      {draftKind !== null && issue.copyMode === "repair" ? (
        <AgentSolutionDraft
          kind={draftKind}
          targetUrl={profile.targetUrl}
          extract={targetPageExtract}
          targetQuery={profile.targetQuery}
          pageType={profile.pageType}
        />
      ) : null}

    </div>
  );
}
