// @input -- a parsed frozen Brief v2, locale and explicit confirmation callback
// @output -- keyword-first Artifact result with real source counts and editable confirmed outline
// @pos -- Marketing-local v2 presentation; never projects v2 into a fabricated legacy Brief
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { BriefV2Read, ConfirmedBriefV2, ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { BODY_TEXT, CARD, SECTION_TITLE, chipTone, collectedTime, number, safePageUrl, seconds } from "./content-brief-results-shared.ts";
import { SourceLayerBadge } from "./content-brief-source-chip.tsx";
import { ContentBriefV2Editor } from "./content-brief-v2-editor.tsx";
import styles from "./content-brief-presentation.module.css";

type Translate = ReturnType<typeof useTranslations<"tools.contentBrief.v2">>;
const SUMMARY = "cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const CODE = "max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[3px] bg-brand-panel-sunken p-3 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary";
const BADGE = "inline-flex rounded-[3px] border border-brand-border-strong px-1.5 py-0.5 font-mono text-[10px] text-text-dark-secondary";

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
        {read.status !== "unavailable" ? <span className="font-mono text-[14px] font-semibold text-text-dark-primary">{read.retained}/{read.attempted}</span> : null}
        <span data-read-status={read.reason === "not_requested" ? "not_used" : read.status} className={`text-[11px] ${read.reason === "not_requested" ? "text-text-dark-secondary" : read.status === "complete" ? "text-brand-success" : read.status === "partial" ? "text-brand-warning" : "text-brand-error"}`}>{label(read)}</span>
      </div>
      {read.status !== "unavailable" ? <div className="mt-1 text-[10px] leading-[1.4] text-text-dark-secondary">{t(`readUnits.${read.source}`)}</div> : null}
    </div>)}
  </div>;
}

function Fields({ brief, locale, t }: { readonly brief: ContentBriefV2; readonly locale: string; readonly t: Translate }) {
  const baseT = useTranslations("tools.contentBrief");
  const groups = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const page of brief.context.research.pages) {
    if (page.role !== "competitor" || !page.body_complete) continue;
    const identity = page.final_url.split("#")[0]!;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const measurement = page.research.length;
    groups.set(measurement.unit, [...(groups.get(measurement.unit) ?? []), measurement.value]);
  }
  return <div data-field-cards className="grid gap-3 md:grid-cols-3">
    {(["intent", "format"] as const).map((field) => {
      const value = brief.generated?.[field];
      return <section key={field} data-field-card={field} className={CARD}>
        <h3 className="text-[11px] font-semibold text-text-dark-secondary">{t(field)}</h3>
        <div className="mt-2 text-[18px] font-semibold text-text-dark-primary">{value ? t(`${field === "intent" ? "intents" : "formats"}.${value.value}`) : t("unknown")}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5"><SourceLayerBadge tone="model" t={baseT} /><span className="text-[10.5px] text-text-dark-secondary">{t("modelJudgment")}</span></div>
        {value ? <p className={`mt-2 ${BODY_TEXT}`}>{value.rationale}</p> : null}
      </section>;
    })}
    <section data-field-card="length" className={CARD}>
      <h3 className="text-[11px] font-semibold text-text-dark-secondary">{t("observedLength")}</h3>
      {groups.size === 0 ? <p className={`mt-2 ${BODY_TEXT}`}>{t("lengthUnavailable")}</p> : [...groups.entries()].map(([unit, values]) => {
        const ordered = values.toSorted((a, b) => a - b); const middle = Math.floor(ordered.length / 2);
        const median = ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
        return <div key={unit} className="mt-2"><div data-observed-length={unit} className="text-[16px] font-semibold text-text-dark-primary">{t("lengthValue", { value: number(median, locale, 1), unit: t(`lengthUnits.${unit}`) })}</div><p className={`mt-1 ${BODY_TEXT}`}>{t("lengthRange", { min: number(ordered[0]!, locale), max: number(ordered.at(-1)!, locale), count: values.length })}</p></div>;
      })}
      <div className="mt-2"><SourceLayerBadge tone="third" t={baseT} /></div>
      <p className={`mt-2 ${BODY_TEXT}`}>{t("lengthBoundary")}</p>
    </section>
  </div>;
}

function PagePlan({ brief, t }: { readonly brief: ContentBriefV2; readonly t: Translate }) {
  const plan = brief.generated!.page_plan;
  const target = brief.context.candidates.find((candidate) => candidate.id === plan.target_ref);
  const targetHref = safePageUrl(target?.url ?? null);
  return <section data-verdict-card className={`border ${chipTone(plan.action === "undecidable" ? "caution" : "positive")}`}>
    <div className="font-mono text-[10.5px] tracking-[0.1em] uppercase">{t("pageRecommendation")}</div>
    <h3 data-verdict-title className="mt-2 font-semibold tracking-[-0.03em]">{t(`actions.${plan.action}`)}</h3>
    <p className={`mt-3 ${BODY_TEXT}`}>{plan.rationale}</p>
    {target ? <div className="mt-3 space-y-1 text-[12px]"><div className="text-text-dark-secondary">{t("targetPage")} · {t(`readStates.${target.read}`)}</div>{targetHref ? <a data-target-page href={targetHref} target="_blank" rel="noopener noreferrer" className="break-all text-brand-accent-text underline underline-offset-2">{target.url}</a> : <span>{target.url}</span>}</div> : null}
    {plan.steps.length > 0 ? <ol className="mt-4 space-y-3 border-t border-brand-border-card pt-3">{plan.steps.map((step, index) => <li key={index} data-plan-step className="text-[12.5px] text-text-dark-primary"><div className="flex items-start gap-2"><span className={BADGE}>{t(`stepKinds.${step.kind}`)}</span><span>{step.instruction}</span></div><div className="mt-1 text-[10.5px] text-text-dark-secondary">{t("stepEvidence", { answers: step.answers.join(", ") || t("none"), sources: step.sources.join(", ") || t("none") })}</div></li>)}</ol> : null}
    <details data-page-evidence className="mt-3 border-t border-brand-border-card pt-3"><summary className={SUMMARY}>{t("pageEvidenceTitle")}</summary>
      {brief.context.gsc.matches.length > 0 ? <ul className="mt-3 space-y-3">{brief.context.gsc.matches.map((match) => <li key={match.id} data-gsc-match={match.id} className="text-[11.5px] text-text-dark-secondary"><div className="flex flex-wrap items-center gap-2"><span className={BADGE}>{match.id} · {t(`scopes.${match.scope}`)}</span><span>{match.query}</span></div><div className="mt-1"><PageLink url={match.page} /></div><div className="mt-1">{t("gscMetrics", { clicks: match.clicks, impressions: match.impressions, position: match.position ?? t("unknown") })}</div></li>)}</ul> : <p className={`mt-2 ${BODY_TEXT}`}>{brief.context.gsc.status === "unavailable" ? brief.context.gsc.reason === "not_requested" ? t("states.notUsed") : t("states.unavailable") : t("noMatchedQueries")}</p>}
      {brief.context.candidates.length > 0 ? <ul className="mt-3 space-y-2 border-t border-brand-border-card pt-3">{brief.context.candidates.map((candidate) => <li key={candidate.id} data-owned-candidate={candidate.id} className="text-[11.5px] text-text-dark-secondary"><span className="font-mono">{candidate.id} · {t(`readStates.${candidate.read}`)}</span><div><PageLink url={candidate.url} /></div></li>)}</ul> : null}
    </details>
    <p className={`mt-3 border-t border-brand-border-card pt-3 ${BODY_TEXT}`}>{t("sampleBoundary")}</p>
  </section>;
}

function Questions({ brief, t }: { readonly brief: ContentBriefV2; readonly t: Translate }) {
  const questions = brief.generated!.research.questions;
  const research = brief.context.research;
  return <section data-must-answer>
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-brand-border-card pb-2"><h3 className={SECTION_TITLE}>{t("questions")}</h3><span className="text-[11px] text-text-dark-secondary">{t("questionCount", { count: questions.length })}</span></div>
    {questions.length > 0 ? <div className="mt-3 overflow-hidden rounded-[4px] border border-brand-border-card bg-brand-panel"><table aria-label={t("questions")} className="w-full table-fixed text-left"><thead className="sr-only"><tr><th>ID</th><th>{t("questionColumn")}</th><th>{t("coverageColumn")}</th></tr></thead><colgroup><col className="w-11" /><col /><col className="w-20" /></colgroup><tbody>
      {questions.map((question) => <tr key={question.id} data-question-row={question.id} className="border-b border-brand-border-card align-top last:border-0">
        <th scope="row" className="px-2 py-3 font-mono text-[10.5px] font-medium text-text-dark-secondary">{question.id}</th>
        <td className="min-w-0 px-2 py-3"><div data-must-answer-q className="text-[13px] leading-[1.45] text-text-dark-primary">{question.q}</div><div className="mt-1.5 flex flex-wrap gap-1">{question.paa_refs.length > 0 ? <span className={BADGE}>PAA · {question.paa_refs.join(", ")}</span> : null}{question.source_refs.some((id) => research.units.find((unit) => unit.id === id)?.kind === "page") ? <span className={BADGE}>{t("pageEvidence")}</span> : null}</div>
          <details className="mt-2"><summary className={SUMMARY}>{t("questionEvidence", { id: question.id })}</summary><ul className="mt-2 space-y-3">{question.source_refs.map((id) => {
            const unit = research.units.find((item) => item.id === id);
            if (unit?.kind === "paa") { const item = research.paa.find((paa) => paa.id === unit.paa_ref); return <li key={id} className="text-[11.5px] text-text-dark-secondary"><span className="font-mono">{id} · PAA · {unit.paa_ref}</span><div>{item?.question}</div></li>; }
            if (unit?.kind !== "page") return null;
            const page = research.pages.find((item) => item.id === unit.page_ref); const segment = page?.research.segments[unit.segment_index];
            return <li key={id} className="text-[11.5px] text-text-dark-secondary"><div className="font-mono">{id} · {unit.page_ref} · {t(`sources.${page?.role === "owned" ? "owned_pages" : "competitors"}`)}</div>{page ? <PageLink url={page.final_url} /> : null}{segment?.heading ? <div className="mt-1 font-medium">{segment.heading.level.toUpperCase()} · {segment.heading.text}</div> : null}<blockquote className="mt-1 border-l-2 border-brand-border-strong pl-2">{segment?.text}</blockquote></li>;
          })}</ul></details>
        </td>
        <td data-covered-by aria-label={t("coverageColumn")} className="px-2 py-3 text-right font-mono text-[11px] text-text-dark-secondary">{t("coveredPages", { count: question.covered_by })}</td>
      </tr>)}
    </tbody></table></div> : null}
    <p data-paa-boundary className={`mt-3 ${BODY_TEXT}`}>{t("paaBoundary")}</p>
    <p className="mt-2 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary">{t("researchBudget", { retained: research.budget.page_units_retained, available: research.budget.page_units_available, omitted: research.budget.page_units_omitted, paaRetained: research.budget.paa_retained, paaAvailable: research.budget.paa_available, paaDuplicates: research.budget.paa_duplicates, paaOmitted: research.budget.paa_omitted })}</p>
  </section>;
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
      <div><dt>{t("gscWindow")}</dt><dd data-gsc-window>{context.gsc.property ?? t("states.notUsed")}{context.gsc.window ? ` · ${context.gsc.window.start} – ${context.gsc.window.end} (${context.gsc.window.lookback_days})` : ""}</dd></div>
      <div className="sm:col-span-2"><dt>{t("profileSnapshot")}</dt><dd className="break-all">{context.profile_snapshot ? `${context.profile_snapshot.website_id} · ${context.profile_snapshot.revision} · ${context.profile_snapshot.hash}` : t("states.notUsed")}</dd></div>
      <div className="sm:col-span-2"><dt>{t("fingerprint")}</dt><dd data-run-fingerprint className="break-all font-mono">{run.fingerprint}</dd><dd className="mt-1">{t("fingerprintBoundary")}</dd></div>
    </dl>
    <h4 className="mt-4 mb-2 text-[12px] font-semibold text-text-dark-primary">{t("sourceDetails")}</h4><ul className="space-y-2 text-[11.5px] text-text-dark-secondary">{run.reads.map((read) => <li key={read.source}>{t(`sources.${read.source}`)} · {read.reason === "not_requested" ? t("states.notUsed") : t(`states.${read.status}`)} · {read.reason ?? `${read.retained}/${read.attempted}`}</li>)}</ul>
    <h4 className="mt-4 mb-2 text-[12px] font-semibold text-text-dark-primary">{t("rawRun")}</h4><pre data-run-ledger className={CODE}>{JSON.stringify(run, null, 2)}</pre>
    <h4 className="mt-4 mb-2 text-[12px] font-semibold text-text-dark-primary">{t("rawEvidence")}</h4><pre data-evidence-ledger className={CODE}>{JSON.stringify(context, null, 2)}</pre>
  </details>;
}

export function ContentBriefV2Results({ brief, locale, onConfirmed }: {
  readonly brief: ContentBriefV2;
  readonly locale: string;
  readonly onConfirmed?: (confirmed: ConfirmedBriefV2 | null) => void;
}) {
  const t = useTranslations("tools.contentBrief.v2");
  const limited = brief.run.reads.some((read) => read.status === "partial" || (read.status === "unavailable" && read.reason !== "not_requested"));
  const noOutline = brief.generated === null || brief.generated.research.outline.length === 0;
  return <div data-content-brief-v2-results role="region" aria-label={t("resultLabel", { keyword: brief.context.input.primary })} className={`${styles.results} mt-6 space-y-6`}>
    <header data-brief-header><div className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">{t("eyebrow")}</div><h3 className="mt-2 text-[26px] leading-[1.2] font-semibold tracking-[-0.03em] text-text-dark-primary">{brief.context.input.primary}</h3><div className="mt-2 flex flex-wrap gap-1.5">{[brief.context.input.market, brief.context.input.language, ...brief.context.input.supporting].map((value, index) => <span key={index} className={BADGE}>{value}</span>)}<span className={`rounded-[3px] border px-2 py-0.5 text-[10.5px] ${chipTone(brief.generated === null || limited ? "caution" : "positive")}`}>{brief.generated === null ? t("generationUnavailable") : limited ? t("limited") : t("ready")}</span></div></header>
    <ReadStrip brief={brief} t={t} />
    {brief.generated ? <><PagePlan brief={brief} t={t} /><Fields brief={brief} locale={locale} t={t} /><Questions brief={brief} t={t} /></> : null}
    {/* elapsed_ms is the sole field excluded from the causal fingerprint; a
        replacement receipt must not keep an export containing its old value. */}
    {noOutline ? <><p data-no-outline className={BODY_TEXT}>{brief.generated === null ? t("noGeneration") : t("noQuestions")}</p>{brief.generated ? <Recommendations brief={brief} t={t} /> : null}</> : <ContentBriefV2Editor key={`${brief.run.fingerprint}:${brief.run.elapsed_ms}`} brief={brief} onConfirmed={onConfirmed}><Recommendations brief={brief} t={t} /></ContentBriefV2Editor>}
    <TechnicalDetails brief={brief} locale={locale} t={t} />
    <details data-wont-say className="border-t border-brand-border-card pt-3"><summary className={SUMMARY}>{t("limitations")}</summary><p className={`mt-2 ${BODY_TEXT}`}>{t("limitationsBody")}</p></details>
  </div>;
}
