// @input -- a parsed frozen Brief v2/v3, locale and explicit local confirmation/recovery callbacks
// @output -- keyword-first Artifact result with real source counts and editable confirmed outline
// @pos -- Marketing-local research Brief presentation; never fabricates legacy evidence
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { BriefV2Read, ConfirmedBriefV2, ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { ACTION_BUTTON, BODY_TEXT, CARD, SECTION_TITLE, chipTone, collectedTime, number, safePageUrl, seconds } from "./content-brief-results-shared.ts";
import { buildBriefV2Observations } from "../../lib/tools/content-brief-v2-observations.ts";
import { SourceLayerBadge } from "./content-brief-source-chip.tsx";
import { ContentBriefV2Editor } from "./content-brief-v2-editor.tsx";
import styles from "./content-brief-presentation.module.css";

type Translate = ReturnType<typeof useTranslations<"tools.contentBrief.v2">>;
const SUMMARY = "cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const CODE = "max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[3px] bg-brand-panel-sunken p-3 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary";
const BADGE = "inline-flex rounded-[3px] border border-brand-border-strong px-1.5 py-0.5 font-mono text-[10px] text-text-dark-secondary";
type Observations = ReturnType<typeof buildBriefV2Observations>;

function PageLink({ url, children }: { readonly url: string; readonly children?: ReactNode }) {
  const href = safePageUrl(url);
  return href === null ? <span>{children ?? url}</span> : <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-brand-accent-text underline decoration-brand-border-strong underline-offset-2">{children ?? url}</a>;
}

function ReadStrip({ brief, t }: { readonly brief: ContentBriefV2; readonly t: Translate }) {
  function label(read: BriefV2Read) { return read.reason === "not_requested" ? t("states.notUsed") : t(`states.${read.status}`); }
  return <div data-source-summary aria-label={t("sourceSummary")} className="grid grid-cols-2 overflow-hidden rounded-[4px] border border-brand-border-card bg-brand-panel md:grid-cols-3">
    {brief.run.reads.map((read) => <div key={read.source} data-source-summary-item={read.source} className="min-w-0 border-b border-r border-brand-border-card px-3 py-2.5">
      <div className="font-mono text-[9.5px] tracking-[0.05em] text-text-dark-secondary">{t(`sources.${read.source}`)}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {read.status !== "unavailable" ? <span className="font-mono text-[14px] font-semibold text-text-dark-primary">{read.retained ?? t("unknown")}/{read.attempted ?? t("unknown")}</span> : null}
        <span data-read-status={read.reason === "not_requested" ? "not_used" : read.status} className={`text-[11px] ${read.reason === "not_requested" ? "text-text-dark-secondary" : read.status === "complete" ? "text-brand-success" : read.status === "partial" ? "text-brand-warning" : "text-brand-error"}`}>{label(read)}</span>
      </div>
      {read.status !== "unavailable" ? <div className="mt-1 text-[10px] leading-[1.4] text-text-dark-secondary">{t(`readUnits.${read.source}`)}</div> : null}
    </div>)}
  </div>;
}

function Fields({ brief, observations, locale, t }: { readonly brief: ContentBriefV2; readonly observations: Observations; readonly locale: string; readonly t: Translate }) {
  const baseT = useTranslations("tools.contentBrief");
  const formats = observations.formats;
  const isSerp = formats.method === "url_title_heuristic";
  return <div data-field-cards className={`${styles.fieldCards} grid gap-3 md:grid-cols-3`}>
    {(["intent", "format"] as const).map((field) => {
      const value = brief.generated?.[field];
      return <section key={field} data-field-card={field} className={CARD}>
        <h3 className="text-[11px] font-semibold text-text-dark-secondary">{t(field)}</h3>
        <div className="mt-2 text-[18px] font-semibold text-text-dark-primary">{value ? t(`${field === "intent" ? "intents" : "formats"}.${value.value}`) : t("unknown")}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5"><SourceLayerBadge tone="model" t={baseT} /><span className="text-[10.5px] text-text-dark-secondary">{t("modelJudgment")}</span></div>
        {field === "intent" ? <details data-field-details="intent" className={styles.fieldDetails}><summary className={SUMMARY}>{t("fieldDetails", { field: t("intent") })}</summary><p data-field-rationale className={`mt-2 ${BODY_TEXT}`}>{value ? value.rationale : t("noModelRecommendation")}</p></details> : null}
        {field === "format" ? <div data-observed-formats className="mt-3 border-t border-brand-border-card pt-3">
          <div className="flex flex-wrap items-center gap-1.5"><span className="text-[11px] font-semibold text-text-dark-primary">{t("observedFormats")}</span><SourceLayerBadge tone="third" t={baseT} /></div>
          {formats.denominator > 0 ? <>
            <div className={styles.formatBar} aria-hidden="true">{formats.counts.filter(item => item.count > 0).map(item => <span key={item.format} data-format-portion={item.format} style={{ width: `${item.count / formats.denominator * 100}%` }} />)}</div>
            <ul className={styles.formatCounts}>{formats.counts.filter((item) => item.count > 0).map((item) => <li key={item.format} data-format-count={item.format}><span>{t(`observedFormatNames.${item.format}`)}</span><span className="font-mono">{item.count}/{formats.denominator}</span></li>)}</ul>
            <p className="mt-2 text-[11.5px] text-text-dark-secondary">{formats.majority ? t("formatMajority", { format: t(`observedFormatNames.${formats.majority}`) }) : t("formatNoMajorityShort")}</p>
          </> : <p className={`mt-2 ${BODY_TEXT}`}>{t("states.unavailable")}</p>}
          {formats.read && formats.read.status !== "unavailable" ? <p data-serp-format-coverage className="mt-2 font-mono text-[10.5px] text-text-dark-secondary">{t("serpFormatCoverage", { returned: formats.read.returned, requested: formats.read.requested, unresolved: formats.read.unresolved, status: t(`states.${formats.read.status}`) })}</p> : null}
          <details data-field-details="format" className={styles.fieldDetails}><summary className={SUMMARY}>{t(isSerp ? "serpFormatEvidence" : "formatEvidence")}</summary>
            <p data-field-rationale className={`mt-2 ${BODY_TEXT}`}>{value ? value.rationale : t("noModelRecommendation")}</p>
            <p data-format-method className="mt-2 text-[11.5px] text-text-dark-secondary">{t(isSerp ? "serpFormatMethod" : "formatMethod")}</p>
            <p data-format-boundary className="mt-2 text-[10.5px] text-text-dark-secondary">{isSerp ? t("serpFormatBoundary") : t("formatScope", { count: formats.denominator, partial: formats.partial_page_count ?? t("unknown") })}</p>
            {formats.denominator === 0 ? <p className={`mt-2 ${BODY_TEXT}`}>{t(isSerp ? "serpFormatsUnavailable" : "formatsUnavailable")}</p> : <p className="mt-2 text-[11.5px] text-text-dark-secondary">{formats.majority ? t("formatMajority", { format: t(`observedFormatNames.${formats.majority}`) }) : t("formatNoMajority")}</p>}
            {formats.candidates.length > 1 ? <p className="mt-2 text-[11.5px] text-text-dark-secondary">{t("formatCandidates", { formats: formats.candidates.map((format) => t(`observedFormatNames.${format}`)).join(" · ") })}</p> : null}
            {formats.pages.length > 0 ? <ul className="mt-2 space-y-2">{formats.pages.map((page) => <li key={page.page_ref} data-format-source={page.page_ref} className="text-[10.5px] text-text-dark-secondary"><span className="font-mono">{page.page_ref} · {t(`observedFormatNames.${page.format}`)}</span>{page.title ? <div className="mt-1 text-text-dark-primary">{page.title}</div> : null}<div>{page.url ? <PageLink url={page.url} /> : t("formatUrlUnavailable")}</div><div>{t("formatRules", { rules: page.rules_hit.join(", ") || t("none") })}</div></li>)}</ul> : null}
          </details>
        </div> : null}
      </section>;
    })}
    <section data-field-card="length" className={CARD}>
      <h3 className="text-[11px] font-semibold text-text-dark-secondary">{t("observedLength")}</h3>
      {observations.lengths.length === 0 ? <p className={`mt-2 ${BODY_TEXT}`}>{t("lengthUnavailable")}</p> : observations.lengths.map((group) => <div key={group.unit} className="mt-3">
        <div data-observed-length={group.unit} className="text-[16px] font-semibold text-text-dark-primary">{t("lengthValue", { value: number(group.median, locale, 1), unit: t(`lengthUnits.${group.unit}`) })}</div>
        <dl data-length-quantiles={group.unit} className={styles.quantiles}>{(["p25", "median", "p75"] as const).map((quantile) => <div key={quantile}><dt>{quantile === "median" ? t("median") : quantile.toUpperCase()}</dt><dd>{number(group[quantile], locale, 1)}</dd></div>)}</dl>
        <p data-length-sample className={`mt-2 ${BODY_TEXT}`}>{t("lengthRange", { min: number(group.min, locale), max: number(group.max, locale), count: group.count })}</p>
      </div>)}
      <div className="mt-2"><SourceLayerBadge tone="third" t={baseT} /></div>
      <p data-length-boundary className={`mt-2 ${BODY_TEXT}`}>{t("lengthBoundaryShort")}</p>
      <details data-field-details="length" className={styles.fieldDetails}><summary className={SUMMARY}>{t("fieldDetails", { field: t("observedLength") })}</summary><p className={`mt-2 ${BODY_TEXT}`}>{t("lengthBoundary")}</p><p data-quantile-method className="mt-2 text-[10.5px] text-text-dark-secondary">{t("quantileMethod")}</p></details>
    </section>
  </div>;
}

function OwnedEvidence({ brief, t }: { readonly brief: ContentBriefV2; readonly t: Translate }) {
  const baseT = useTranslations("tools.contentBrief");
  return <div data-owned-evidence>
    <div className="mt-3 flex flex-wrap items-center gap-2"><SourceLayerBadge tone="first" t={baseT} /><span className="text-[11.5px] text-text-dark-secondary">{t("gscWindow")}</span></div>
    <p className={`mt-2 ${BODY_TEXT}`}>{brief.context.gsc.property ?? (brief.context.gsc.reason === "not_requested" ? t("states.notUsed") : t("unknown"))}{brief.context.gsc.window ? ` · ${brief.context.gsc.window.start} – ${brief.context.gsc.window.end}` : ""}</p>
    {brief.context.gsc.matches.length > 0 ? <ul className="mt-3 space-y-3">{brief.context.gsc.matches.map((match) => <li key={match.id} data-gsc-match={match.id} className="text-[11.5px] text-text-dark-secondary"><div className="flex flex-wrap items-center gap-2"><span className={BADGE}>{match.id} · {t(`scopes.${match.scope}`)}</span><span>{match.query}</span></div><div className="mt-1"><PageLink url={match.page} /></div><div className="mt-1">{t("gscMetrics", { clicks: match.clicks, impressions: match.impressions, position: match.position ?? t("unknown") })}</div></li>)}</ul> : <p className={`mt-2 ${BODY_TEXT}`}>{brief.context.gsc.status === "unavailable" ? brief.context.gsc.reason === "not_requested" ? t("states.notUsed") : t("states.unavailable") : t("noMatchedQueries")}</p>}
    {brief.context.gsc.omitted_matches > 0 ? <p className={`mt-2 ${BODY_TEXT}`}>{t("omittedGsc", { count: brief.context.gsc.omitted_matches })}</p> : null}
    {brief.context.candidates.length > 0 ? <ul className="mt-3 space-y-2 border-t border-brand-border-card pt-3">{brief.context.candidates.map((candidate) => <li key={candidate.id} data-owned-candidate={candidate.id} className="text-[11.5px] text-text-dark-secondary"><span className="font-mono">{candidate.id} · {t(`readStates.${candidate.read}`)}</span><div><PageLink url={candidate.url} /></div></li>)}</ul> : null}
  </div>;
}

function PagePlan({ brief, t }: { readonly brief: ContentBriefV2; readonly t: Translate }) {
  const baseT = useTranslations("tools.contentBrief");
  const plan = brief.generated!.page_plan;
  const target = brief.context.candidates.find((candidate) => candidate.id === plan.target_ref);
  const targetHref = safePageUrl(target?.url ?? null);
  return <section data-verdict-card className={`border ${chipTone(plan.action === "undecidable" ? "caution" : "positive")}`}>
    <div className="font-mono text-[10.5px] tracking-[0.1em] uppercase">{t("pageRecommendation")}</div>
    <h3 data-verdict-title className="mt-2 font-semibold tracking-[-0.03em]">{t(`actions.${plan.action}`)}</h3>
    <div className="mt-3"><SourceLayerBadge tone="model" t={baseT} /></div>
    <p className={`mt-3 ${BODY_TEXT}`}>{plan.rationale}</p>
    {target ? <div className="mt-3 space-y-1 text-[12px]"><div className="text-text-dark-secondary">{t("targetPage")} · {t(`readStates.${target.read}`)}</div>{targetHref ? <a data-target-page href={targetHref} target="_blank" rel="noopener noreferrer" className="break-all text-brand-accent-text underline underline-offset-2">{target.url}</a> : <span>{target.url}</span>}</div> : null}
    {plan.steps.length > 0 ? <ol className="mt-4 space-y-3 border-t border-brand-border-card pt-3">{plan.steps.map((step, index) => <li key={index} data-plan-step className="text-[12.5px] text-text-dark-primary"><div className="flex items-start gap-2"><span className={BADGE}>{t(`stepKinds.${step.kind}`)}</span><span>{step.instruction}</span></div><div className="mt-1 text-[10.5px] text-text-dark-secondary">{t("stepEvidence", { answers: step.answers.join(", ") || t("none"), sources: step.sources.join(", ") || t("none") })}</div></li>)}</ol> : null}
    <details data-page-evidence className="mt-3 border-t border-brand-border-card pt-3"><summary className={SUMMARY}>{t("pageEvidenceTitle")}</summary>
      <OwnedEvidence brief={brief} t={t} />
    </details>
    <p className={`mt-3 border-t border-brand-border-card pt-3 ${BODY_TEXT}`}>{t("sampleBoundary")}</p>
  </section>;
}

function Questions({ brief, denominator, t }: { readonly brief: ContentBriefV2; readonly denominator: number; readonly t: Translate }) {
  const baseT = useTranslations("tools.contentBrief");
  const questions = brief.generated!.research.questions;
  const research = brief.context.research;
  return <section data-must-answer>
    <div className="flex flex-wrap items-baseline gap-2 border-b border-brand-border-card pb-2"><h3 className={SECTION_TITLE}>{t("questions")}</h3><SourceLayerBadge tone="model" t={baseT} /><span className="ml-auto text-[11px] text-text-dark-secondary">{t("questionCount", { count: questions.length })}</span></div>
    {questions.length > 0 ? <div className="mt-3 overflow-hidden rounded-[4px] border border-brand-border-card bg-brand-panel"><table aria-label={t("questions")} className="w-full table-fixed text-left"><thead className="sr-only"><tr><th>ID</th><th>{t("questionColumn")}</th><th>{t("coverageColumn")}</th></tr></thead><colgroup><col className="w-10" /><col /><col className="w-24" /></colgroup><tbody>
      {questions.map((question) => <tr key={question.id} data-question-row={question.id} className="border-b border-brand-border-card align-top last:border-0">
        <th scope="row" className="px-2 py-3 font-mono text-[10.5px] font-medium text-text-dark-secondary">{question.id}</th>
        <td className="min-w-0 px-2 py-3"><div data-must-answer-q className="text-[13px] leading-[1.45] text-text-dark-primary">{question.q}</div><div className="mt-1.5 flex flex-wrap gap-1">{question.paa_refs.length > 0 ? <span className={BADGE}>PAA · {question.paa_refs.join(", ")}</span> : null}{question.source_refs.some((id) => research.units.find((unit) => unit.id === id)?.kind === "page") ? <span className={BADGE}>{t("pageEvidence")}</span> : null}{question.paa_refs.length > 0 || question.covered_by > 0 ? <SourceLayerBadge tone="third" t={baseT} /> : null}{question.source_refs.some((id) => { const unit = research.units.find((item) => item.id === id); return unit?.kind === "page" && research.pages.some((page) => page.id === unit.page_ref && page.role === "owned"); }) ? <SourceLayerBadge tone="first" t={baseT} /> : null}</div>
          <details className="mt-2"><summary className={SUMMARY}>{t("questionEvidence", { id: question.id })}</summary><ul className="mt-2 space-y-3">{question.source_refs.map((id) => {
            const unit = research.units.find((item) => item.id === id);
            if (unit?.kind === "paa") { const item = research.paa.find((paa) => paa.id === unit.paa_ref); return <li key={id} className="text-[11.5px] text-text-dark-secondary"><span className="font-mono">{id} · PAA · {unit.paa_ref}</span><div>{item?.question}</div></li>; }
            if (unit?.kind !== "page") return null;
            const page = research.pages.find((item) => item.id === unit.page_ref); const segment = page?.research.segments[unit.segment_index];
            return <li key={id} className="text-[11.5px] text-text-dark-secondary"><div className="font-mono">{id} · {unit.page_ref} · {t(`sources.${page?.role === "owned" ? "owned_pages" : "competitors"}`)}</div>{page ? <PageLink url={page.final_url} /> : null}{segment?.heading ? <div className="mt-1 font-medium">{segment.heading.level.toUpperCase()} · {segment.heading.text}</div> : null}<blockquote className="mt-1 border-l-2 border-brand-border-strong pl-2">{segment?.text}</blockquote></li>;
          })}</ul></details>
        </td>
        <td data-covered-by aria-label={t("coverageColumn")} className="px-2 py-3 text-right font-mono text-[11px] text-text-dark-secondary"><span>{denominator > 0 ? `${question.covered_by}/${denominator}` : t("coveredPages", { count: question.covered_by })}</span>{denominator > 0 ? <span data-question-coverage-bar role="img" aria-label={t("questionCoverageValue", { count: question.covered_by, total: denominator })} className={styles.questionCoverageBar}><span style={{ width: `${question.covered_by / denominator * 100}%` }} /></span> : <span className="mt-1 block text-[10px]">{t("coverageNoDenominator")}</span>}</td>
      </tr>)}
    </tbody></table></div> : null}
    <p data-paa-boundary className={`mt-3 ${BODY_TEXT}`}>{t("paaBoundary")}</p>
    <p data-question-coverage-boundary className={`mt-2 ${BODY_TEXT}`}>{t("questionCoverageBoundary", { count: denominator })}</p>
    <p className="mt-2 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary">{t("researchBudget", { retained: research.budget.page_units_retained, available: research.budget.page_units_available, omitted: research.budget.page_units_omitted, paaRetained: research.budget.paa_retained, paaAvailable: research.budget.paa_available, paaDuplicates: research.budget.paa_duplicates, paaOmitted: research.budget.paa_omitted })}</p>
  </section>;
}

function GenerationFailure({ brief, t, onReturnToSettings }: { readonly brief: ContentBriefV2; readonly t: Translate; readonly onReturnToSettings?: (() => void) | undefined }) {
  const reason = brief.run.llm.status === "unavailable" ? brief.run.llm.reason : "validation_failed";
  return <section data-generation-failure role="alert" className={styles.generationFailure}>
    <div className="font-mono text-[10.5px] tracking-[0.1em] uppercase text-brand-error">{t("generationUnavailable")}</div>
    <h3 data-generation-cause className="mt-2 text-[24px] leading-[1.2] font-semibold tracking-[-0.025em] text-text-dark-primary">{t(`generationCauses.${reason}`)}</h3>
    <p data-no-outline className={`mt-3 ${BODY_TEXT}`}>{t("noGeneration")}</p>
    <p className={`mt-2 ${BODY_TEXT}`}>{t(`recoveryActions.${reason}`)}</p>
    {onReturnToSettings ? <button type="button" data-return-to-settings onClick={onReturnToSettings} className={`mt-4 ${ACTION_BUTTON}`}>{t("returnToSettings")}</button> : null}
    <p data-recovery-boundary className={`mt-3 border-t border-brand-border-card pt-3 ${BODY_TEXT}`}>{t("recoveryBoundary")}</p>
  </section>;
}

function RetainedEvidence({ brief, t }: { readonly brief: ContentBriefV2; readonly t: Translate }) {
  const baseT = useTranslations("tools.contentBrief");
  const paaRead = brief.run.reads.find((read) => read.source === "paa");
  return <>
    <section className={CARD}>
      <h3 className={SECTION_TITLE}>{t("pageEvidenceTitle")}</h3>
      <OwnedEvidence brief={brief} t={t} />
      <p className={`mt-3 border-t border-brand-border-card pt-3 ${BODY_TEXT}`}>{t("noPageDecision")}</p>
      <p className={`mt-2 ${BODY_TEXT}`}>{t("sampleBoundary")}</p>
    </section>
    <section data-raw-paa-candidates>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border-card pb-2"><h3 className={SECTION_TITLE}>{t("rawPaaTitle")}</h3><SourceLayerBadge tone="third" t={baseT} /></div>
      <p className={`mt-2 ${BODY_TEXT}`}>{t("rawPaaBoundary")}</p>
      {brief.context.research.paa.length > 0 ? <ul className="mt-3 divide-y divide-brand-border-card rounded-[3px] border border-brand-border-card bg-brand-panel">{brief.context.research.paa.map((item) => <li key={item.id} data-raw-paa={item.id} className="flex gap-3 px-4 py-3 text-[13px] text-text-dark-primary"><span className="font-mono text-[10.5px] text-text-dark-secondary">{item.id}</span><span>{item.question}</span></li>)}</ul> : <p className={`mt-3 ${BODY_TEXT}`}>{t("rawPaaUnavailable")}</p>}
      <p className="mt-2 text-[11px] text-text-dark-secondary">{paaRead?.status === "unavailable" ? `${t("sources.paa")} · ${t("states.unavailable")}` : t("rawPaaCounts", { retained: brief.context.research.budget.paa_retained, available: brief.context.research.budget.paa_available, duplicates: brief.context.research.budget.paa_duplicates, omitted: brief.context.research.budget.paa_omitted })}</p>
    </section>
  </>;
}

function Recommendations({ brief, t }: { readonly brief: ContentBriefV2; readonly t: Translate }) {
  const generated = brief.generated!;
  return <>
    <section data-gap-angle><h3 className={SECTION_TITLE}>{t("gapAngle")}</h3>{generated.gap_angle ? <div className="mt-3 rounded-[4px] border border-brand-border-card bg-brand-panel p-4"><div className="text-[14px] font-semibold text-text-dark-primary">{generated.gap_angle.value}</div><p className={`mt-2 ${BODY_TEXT}`}>{generated.gap_angle.rationale}</p><div className="mt-2 font-mono text-[10.5px] text-text-dark-secondary">{t("gapRefs", { facts: generated.gap_angle.fact_refs.join(", "), sources: generated.gap_angle.sources.join(", ") })}</div></div> : <p className={`mt-3 ${BODY_TEXT}`}>{brief.run.reads.find((read) => read.source === "profile")?.reason === "not_requested" ? t("states.notUsed") : t("gapUnavailable")}</p>}</section>
    {(["internal_links", "do_not_cover"] as const).map((kind) => <section key={kind} data-links-card={kind}><h3 className={SECTION_TITLE}>{t(kind === "internal_links" ? "internalLinks" : "doNotCover")}</h3>{generated[kind].length > 0 ? <ul className="mt-3 space-y-3 rounded-[4px] border border-brand-border-card bg-brand-panel p-4">{generated[kind].map((item) => { const page = brief.context.candidates.find((candidate) => candidate.id === item.page_ref); return <li key={item.page_ref} className="text-[12.5px] text-text-dark-primary"><div>{"anchor" in item ? item.anchor : item.topic}</div>{page ? <PageLink url={page.url} /> : null}<p className={`mt-1 ${BODY_TEXT}`}>{item.why}</p></li>; })}</ul> : <p className={`mt-3 ${BODY_TEXT}`}>{brief.context.gsc.reason === "not_requested" ? t("states.notUsed") : t("noLinkSuggestion")}</p>}</section>)}
  </>;
}

function TechnicalDetails({ brief, locale, t }: { readonly brief: ContentBriefV2; readonly locale: string; readonly t: Translate }) {
  const { run, context } = brief; const llm = run.llm;
  const reported = (value: number | null) => value === null ? t("unknown") : number(value, locale, 6);
  return <details data-run-details className="border-t border-brand-border-card pt-3"><summary className={SUMMARY}>{t("technicalDetails")}</summary>
    <dl className="mt-4 grid gap-x-5 gap-y-3 text-[11.5px] text-text-dark-secondary sm:grid-cols-2">
      <div><dt>{t("collectedAt")}</dt><dd>{collectedTime(run.collected_at, locale)} UTC</dd></div>
      <div><dt>{t("duration")}</dt><dd>{seconds(run.elapsed_ms)}s / {seconds(run.budget_ms)}s</dd></div>
      <div><dt>{t("model")}</dt><dd>{llm.model_id ?? t("unknown")}</dd></div>
      <div><dt>{t("calls")}</dt><dd>{llm.calls}</dd></div>
      <div><dt>{t("requestedTemperature")}</dt><dd>{llm.status === "complete" ? llm.temperature_requested : t("unknown")}</dd></div>
      <div><dt>{t("effectiveTemperature")}</dt><dd data-temperature-effective>{llm.status === "complete" ? reported(llm.temperature_effective) : t("unknown")}</dd></div>
      <div><dt>{t("tokens")}</dt><dd>{reported(llm.input_tokens)} / {reported(llm.output_tokens)}</dd></div>
      <div><dt>{t("serpCost")}</dt><dd data-serp-cost>{reported(run.serp_cost_usd)}</dd></div>
      <div><dt>{t("promptBytes")}</dt><dd>{number(run.prompt_bytes, locale)}</dd><dd>{t("promptBoundary")}</dd></div>
      <div><dt>{t("gscWindow")}</dt><dd data-gsc-window>{context.gsc.property ?? (context.gsc.reason === "not_requested" ? t("states.notUsed") : t("states.unavailable"))}{context.gsc.window ? ` · ${context.gsc.window.start} – ${context.gsc.window.end} (${context.gsc.window.lookback_days})` : ""}</dd></div>
      <div className="sm:col-span-2"><dt>{t("profileSnapshot")}</dt><dd data-profile-snapshot className="break-all">{context.profile_snapshot ? `${context.profile_snapshot.website_id} · ${context.profile_snapshot.revision} · ${context.profile_snapshot.hash}` : run.reads.find((read) => read.source === "profile")?.reason === "not_requested" ? t("states.notUsed") : t("states.unavailable")}</dd></div>
      <div className="sm:col-span-2"><dt>{t("fingerprint")}</dt><dd data-run-fingerprint className="break-all font-mono">{run.fingerprint}</dd><dd className="mt-1">{t("fingerprintBoundary")}</dd></div>
    </dl>
    <h4 className="mt-4 mb-2 text-[12px] font-semibold text-text-dark-primary">{t("sourceDetails")}</h4><ul className="space-y-2 text-[11.5px] text-text-dark-secondary">{run.reads.map((read) => <li key={read.source}>{t(`sources.${read.source}`)} · {read.reason === "not_requested" ? t("states.notUsed") : t(`states.${read.status}`)} · {read.reason ?? `${read.retained}/${read.attempted}`}</li>)}</ul>
    <h4 className="mt-4 mb-2 text-[12px] font-semibold text-text-dark-primary">{t("rawRun")}</h4><pre data-run-ledger className={CODE}>{JSON.stringify(run, null, 2)}</pre>
    <h4 className="mt-4 mb-2 text-[12px] font-semibold text-text-dark-primary">{t("rawEvidence")}</h4><pre data-evidence-ledger className={CODE}>{JSON.stringify(context, null, 2)}</pre>
  </details>;
}

export function ContentBriefV2Results({ brief, locale, onConfirmed, onReturnToSettings }: {
  readonly brief: ContentBriefV2;
  readonly locale: string;
  readonly onConfirmed?: (confirmed: ConfirmedBriefV2 | null) => void;
  readonly onReturnToSettings?: () => void;
}) {
  const t = useTranslations("tools.contentBrief.v2");
  const limited = brief.run.reads.some((read) => read.status === "partial" || (read.status === "unavailable" && read.reason !== "not_requested"));
  const noOutline = brief.generated === null || brief.generated.research.outline.length === 0;
  const observations = buildBriefV2Observations(brief.context);
  return <div data-content-brief-v2-results role="region" aria-label={t("resultLabel", { keyword: brief.context.input.primary })} className={`${styles.results} mt-6 space-y-6`}>
    <header data-brief-header><div className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">{t("eyebrow")}</div><h3 className="mt-2 text-[26px] leading-[1.2] font-semibold tracking-[-0.03em] text-text-dark-primary">{brief.context.input.primary}</h3><div className="mt-2 flex flex-wrap gap-1.5">{[brief.context.input.market, brief.context.input.language, ...brief.context.input.supporting].map((value, index) => <span key={index} className={BADGE}>{value}</span>)}</div></header>
    <div data-run-header className={styles.runHeader}>
      <div className={styles.runTop}>
        <span data-generation-status className={`border px-2 py-1 font-mono text-[10.5px] ${chipTone(brief.generated === null ? "caution" : "positive")}`}>{brief.generated === null ? t("generationUnavailable") : t("ready")}</span>
        <span data-read-coverage-status className="font-mono text-[10.5px]">{limited ? t("limited") : t("readsComplete")}</span>
        <span data-run-collected>{t("collectedAt")} <time dateTime={brief.run.collected_at}>{collectedTime(brief.run.collected_at, locale)} UTC</time></span>
        <span data-run-timing>{t("duration")} · {seconds(brief.run.elapsed_ms)}s / {seconds(brief.run.budget_ms)}s</span>
      </div>
      <ReadStrip brief={brief} t={t} />
    </div>
    {brief.generated ? <PagePlan brief={brief} t={t} /> : <GenerationFailure brief={brief} t={t} onReturnToSettings={onReturnToSettings} />}
    <Fields brief={brief} observations={observations} locale={locale} t={t} />
    {brief.generated ? <Questions brief={brief} denominator={observations.question_coverage_denominator} t={t} /> : <RetainedEvidence brief={brief} t={t} />}
    {/* elapsed_ms is the sole field excluded from the causal fingerprint; a
        replacement receipt must not keep an export containing its old value. */}
    {noOutline ? brief.generated ? <><p data-no-outline className={BODY_TEXT}>{t("noQuestions")}</p><Recommendations brief={brief} t={t} /></> : null : <ContentBriefV2Editor key={`${brief.run.fingerprint}:${brief.run.elapsed_ms}`} brief={brief} locale={locale} onConfirmed={onConfirmed}><Recommendations brief={brief} t={t} /></ContentBriefV2Editor>}
    <TechnicalDetails brief={brief} locale={locale} t={t} />
    <details data-wont-say className="border-t border-brand-border-card pt-3"><summary className={SUMMARY}>{t("limitations")}</summary><p className={`mt-2 ${BODY_TEXT}`}>{t("limitationsBody")}</p></details>
  </div>;
}
