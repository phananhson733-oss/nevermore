// @input  -- one projected issue, the confirmed Profile, and this run's provenance
// @output -- the expanded body of one issue: evidence, repair, validation, limits, handoff
// @pos    -- presentation only; drafts nothing, applies nothing, stores nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
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
    <section className="min-w-0 rounded-row border border-brand-border-faint bg-brand-panel-sunken p-3.5">
      <h5 className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
        {label}
      </h5>
      <div className="mt-2 text-[12.5px] leading-[1.65] text-text-dark-primary">
        {children}
      </div>
    </section>
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
    return (
      <p data-affected-mode="site-scope" className="text-text-dark-primary">
        {t("affected.siteScope")}
      </p>
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
          className="mt-2 text-[11.5px] text-text-dark-secondary"
        >
          {t("affected.notEnumerated")}
        </p>
      )}
      {affected.overflowCount > 0 ? (
        <p className="mt-2 text-[11.5px] text-text-dark-secondary">
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
      className="mt-4 rounded-row border border-brand-accent/25 bg-brand-accent/[0.05] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h5 className="text-[12.5px] font-semibold text-text-dark-primary">
            {investigation ? t("ai.investigationTitle") : t("ai.repairTitle")}
          </h5>
          <p className="mt-1 text-[12px] leading-[1.6] text-text-dark-secondary">
            {investigation ? t("ai.investigationBody") : t("ai.repairBody")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
  });
  const draftKind = draftKindFor(template.kind);

  return (
    <div
      data-issue-detail={issue.id}
      className="border-t border-brand-border px-4 pt-4 pb-4 md:px-5"
    >
      {issue.copyMode === "investigation" ? (
        <p
          data-issue-investigation-note
          className="mb-4 rounded-row border border-brand-info/25 bg-brand-info/[0.06] px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-text-dark-primary"
        >
          {t("investigationNote")}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid gap-3">
          <Block label={t("sections.rule")}>
            <p>{localizedText(check.threshold)}</p>
            {issue.check.measurement ? (
              <p className="mt-1.5 font-mono text-[11.5px] text-text-dark-secondary">
                {t("sections.measured")}:{" "}
                {localizedText(issue.check.measurement)}
              </p>
            ) : null}
          </Block>

          <Block label={t("sections.affected")}>
            <AffectedTargets issue={issue} />
          </Block>

          <Block label={t("sections.evidence")}>
            <EvidenceChain records={issue.evidenceRecords} />
            <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-secondary">
              {t("sections.boundary")}: {localizedText(check.boundary)}
            </p>
          </Block>
        </div>

        <div className="grid gap-3">
          {/*
            A gated check reached no verdict, so it gets no repair guidance at
            all — not even relabelled as a "candidate direction". What it needs
            is the source that would answer it; printing the fix beside a note
            saying this is not a fix is the contradiction this replaces.
          */}
          {investigation ? (
            <Block label={t("sections.whatWouldAnswer")}>
              <p>
                {t("sections.requiredSource")}:{" "}
                {localizedText(check.dataSource)}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-[1.55] text-text-dark-secondary">
                {t("investigationNextStep")}
              </p>
            </Block>
          ) : (
            <Block label={t("sections.repair")}>
              <p>{localizedText(check.howToFix)}</p>
              <p className="mt-2 text-[11.5px] text-text-dark-secondary">
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

      <IssueHandoff
        issue={issue}
        locale={locale}
        run={run}
        targetUrl={profile.targetUrl}
      />
    </div>
  );
}
