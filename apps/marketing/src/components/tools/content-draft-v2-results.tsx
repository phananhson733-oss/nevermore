// @input -- one strictly parsed Draft v2 and its exact frozen confirmed Brief
// @output -- real H2/H3 prose, honest evidence, exact exports and an explicit published-URL handoff
// @pos -- editorial v2 result; no publishing or implicit tool navigation
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { DraftResultV2 } from "@sf/public-tools/content-brief/v2-draft-contract";
import { ACTION_BUTTON, BODY_TEXT, ID_CHIP, SECTION_TITLE, collectedTime, safePageUrl } from "./content-brief-results-shared";
import { ContentDraftV2OnPage } from "./content-draft-v2-onpage";
import { markdownNotes } from "./content-draft-handoff-bar";
import type { MarkdownNotes } from "./content-draft-markdown";

const SUMMARY = "cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const CODE = "mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[4px] bg-brand-panel-sunken p-3 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary";
const RULE = "border-b border-brand-border-card pb-2";
type ExportState = "copied" | "downloaded" | "failed";

/** URLs come only from observed candidates in the exact confirmed Brief, never generated prose. */
function confirmedRelatedLinks(confirmed: ConfirmedBriefV2) {
  return (confirmed.brief.generated?.internal_links ?? []).flatMap((link) => {
    const candidate = confirmed.brief.context.candidates.find((item) => item.id === link.page_ref);
    const url = candidate?.read === "observed" ? safePageUrl(candidate.url) : null;
    return url === null ? [] : [{ pageRef: link.page_ref, anchor: link.anchor, url }];
  });
}

function markdownLinkLabel(text: string) { return text.replace(/&/gu, "&amp;").replace(/[\\`*_{}[\]()<>!#|]/gu, "\\$&"); }
function markdownLinkUrl(url: string) { return url.replace(/[()[\]<>\\]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`).replace(/&/gu, "&amp;"); }

/** Full outline and real prose, with local absence notes and one confirmed related-links block. */
export function contentDraftV2Markdown(result: DraftResultV2, confirmed: ConfirmedBriefV2, notes: MarkdownNotes & { readonly relatedLinks: string }): string {
  const sections = result.sections.map((section) => {
    if (section.status === "failed") return `## ${section.h2}\n\n> ${notes.failed(section.fail_reason)}`;
    if (section.status === "skipped") return `## ${section.h2}\n\n> ${notes.skipped}`;
    return [`## ${section.h2}`, ...section.body.paragraphs.flatMap((paragraph) => [
      ...(paragraph.heading === null ? [] : [`### ${paragraph.heading}`]),
      paragraph.sentences.map((sentence) => sentence.text).join(" "),
    ])].join("\n\n");
  });
  const links = confirmedRelatedLinks(confirmed);
  if (links.length > 0) sections.push(`## ${notes.relatedLinks}\n\n${links.map((link) => `- [${markdownLinkLabel(link.anchor)}](${markdownLinkUrl(link.url)})`).join("\n")}`);
  return sections.join("\n\n");
}

export function ContentDraftV2Results({ confirmed, result, locale, rerun }: {
  readonly confirmed: ConfirmedBriefV2;
  readonly result: DraftResultV2;
  readonly locale: string;
  readonly rerun: { readonly disabled: boolean; readonly runningSection: string | null; readonly onRerun: (id: string) => void };
}) {
  const t = useTranslations("tools.contentDraft.v2");
  const base = useTranslations("tools.contentDraft");
  const [showClaims, setShowClaims] = useState(true);
  const [exportReceipt, setExportReceipt] = useState<{ readonly fingerprint: string; readonly state: ExportState } | null>(null);
  const exportAttempt = useRef(0);
  const mounted = useRef(false);
  const liveFingerprint = useRef(result.run.fingerprint);
  liveFingerprint.current = result.run.fingerprint;
  const exportStatus = exportReceipt?.fingerprint === result.run.fingerprint ? exportReceipt.state : null;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; exportAttempt.current += 1; };
  }, []);
  const questions = confirmed.brief.generated?.research.questions ?? [];
  const coverageById = new Map(result.coverage.status === "available" ? result.coverage.items.map((item) => [item.question_id, item]) : []);
  const usedRefs = new Set(result.sections.flatMap((section) => section.status === "ok" ? section.body.paragraphs.flatMap((paragraph) => paragraph.sentences.flatMap((sentence) => sentence.evidence_refs)) : []));
  const research = confirmed.brief.context.research;
  const pageEvidence = research.units.flatMap((unit) => {
    if (!usedRefs.has(unit.id) || unit.kind !== "page") return [];
    const page = research.pages.find((item) => item.id === unit.page_ref);
    const excerpt = page?.research.segments[unit.segment_index];
    return page === undefined || excerpt === undefined ? [] : [{ ref: unit.id, page, excerpt }];
  });
  const profileEvidence = confirmed.brief.context.facts.filter((fact) => usedRefs.has(fact.id));
  const relatedLinks = confirmedRelatedLinks(confirmed);
  const notes = { ...markdownNotes(base), relatedLinks: t("relatedLinks") };

  function finishExport(state: ExportState, fingerprint: string, attempt: number) {
    if (mounted.current && liveFingerprint.current === fingerprint && exportAttempt.current === attempt) setExportReceipt({ fingerprint, state });
  }

  async function copy(kind: "markdown" | "json") {
    const fingerprint = result.run.fingerprint; const attempt = ++exportAttempt.current; setExportReceipt(null);
    try { await navigator.clipboard.writeText(kind === "json" ? JSON.stringify(result) : contentDraftV2Markdown(result, confirmed, notes)); finishExport("copied", fingerprint, attempt); }
    catch { finishExport("failed", fingerprint, attempt); }
  }
  function download(kind: "markdown" | "json") {
    const fingerprint = result.run.fingerprint; const attempt = ++exportAttempt.current; setExportReceipt(null);
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([kind === "json" ? JSON.stringify(result) : contentDraftV2Markdown(result, confirmed, notes)], { type: kind === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `content-draft-r${result.confirmed_ref.revision}-${result.run.fingerprint.slice(0, 12)}.${kind === "json" ? "json" : "md"}`; anchor.click(); finishExport("downloaded", fingerprint, attempt);
    } catch { finishExport("failed", fingerprint, attempt); }
    finally { if (url !== null) { const created = url; window.setTimeout(() => URL.revokeObjectURL(created), 0); } }
  }

  return <div data-draft-v2-result data-run-id={result.run.run_id} className="mx-auto max-w-[880px] space-y-6 break-words">
    <header className="overflow-hidden rounded-[4px] border border-brand-border-card bg-brand-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-brand-border-card px-4 py-3 text-[11px] text-text-dark-secondary"><span className={ID_CHIP}>{base(`modes.${result.run.mode}`)}</span><span>{t("revision", { revision: result.confirmed_ref.revision })}</span><time dateTime={result.run.collected_at}>{collectedTime(result.run.collected_at, locale)}</time></div>
      <div className="grid grid-cols-2 md:grid-cols-4">{[
        [t("generatedSections"), `${result.run.reads.sections.ok}/${result.sections.length}`],
        [t("proseLength"), t(`length.${result.totals.unit}`, { count: result.totals.value })],
        [t("questionCoverage"), result.coverage.status === "available" ? `${result.coverage.covered}/${result.coverage.total}` : t("coverageUnavailable")],
        [base("verify.title"), String(result.verify_before_publish.length)],
      ].map(([label, value], index) => <div key={label} className="border-r border-brand-border-card px-4 py-3"><div className="text-[10px] text-text-dark-secondary">{label}</div><div data-draft-length={index === 1 ? "" : undefined} data-coverage-summary={index === 2 ? "" : undefined} className="mt-1 font-mono text-[15px] font-semibold text-text-dark-primary">{value}</div></div>)}</div>
      <p data-length-note className="border-t border-brand-border-card px-4 py-2 text-[11px] leading-[1.5] text-text-dark-secondary">{t("lengthNote")}</p>
    </header>

    <section aria-label={base("doc.title")}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${RULE}`}><h2 className={SECTION_TITLE}>{base("doc.title")}</h2><label className="flex items-center gap-2 text-[11.5px] text-text-dark-secondary"><input type="checkbox" checked={showClaims} onChange={(event) => setShowClaims(event.target.checked)} className="accent-brand-accent" />{base("toolbar.showClaims")}</label></div>
      {showClaims ? <p className="mt-3 text-[11px] leading-[1.5] text-text-dark-secondary">{t("claimLegend")}</p> : null}
      <div className="mt-4 space-y-7">{result.sections.map((section) => <section key={section.id} data-draft-section={section.id} className="border-l-2 border-brand-border-card pl-4 md:pl-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="font-mono text-[10px] text-text-dark-secondary">{section.id} · {base("doc.answers", { ids: section.answers.join(", ") })}</span><h2 data-draft-h2 className="mt-1 text-[20px] font-semibold leading-[1.25] tracking-tight text-text-dark-primary">{section.h2}</h2></div><button type="button" data-rerun-section={section.id} disabled={rerun.disabled} className={ACTION_BUTTON} onClick={() => rerun.onRerun(section.id)}>{base(rerun.runningSection === section.id ? "actions.rerunning" : section.status === "skipped" ? "actions.generateSection" : "actions.rerun")}</button></div>
        {section.status === "ok" ? <><div className="mt-3 text-[10.5px] text-text-dark-secondary">{t(`length.${section.body.length.unit}`, { count: section.body.length.value })}</div>{section.body.paragraphs.map((paragraph, pIndex) => <div key={pIndex} className="mt-4">{paragraph.heading !== null ? <h3 data-draft-h3 className="mb-2 text-[15px] font-semibold text-text-dark-primary">{paragraph.heading}</h3> : null}<p className="text-[14px] leading-[1.85] text-text-dark-primary">{paragraph.sentences.map((sentence, sIndex) => <span key={sIndex} data-claim={sentence.claim}>{sIndex > 0 ? " " : ""}<span className={showClaims && sentence.claim !== "no_claim" ? sentence.claim === "gap" ? "decoration-brand-warning decoration-dashed underline underline-offset-4" : "decoration-brand-border-strong underline underline-offset-4" : undefined}>{sentence.text}</span>{showClaims ? <span className="ml-1 inline text-[10px] leading-normal text-text-dark-secondary">[{base(`claims.${sentence.claim}`)}{sentence.evidence_refs.length > 0 ? " · " : ""}{sentence.evidence_refs.map((ref, index) => <span key={ref}>{index > 0 ? ", " : ""}<a href={`#draft-v2-evidence-${ref}`} className="underline underline-offset-2">{ref}</a></span>)}{sentence.claim === "bound" ? <span data-support-count> · {t("supportingPages", { count: sentence.support_count })}</span> : null}]</span> : null}</span>)}</p></div>)}</> : <div className="mt-3 rounded-[4px] border border-brand-border-card bg-brand-panel-sunken p-3"><div className="text-[12px] font-semibold text-text-dark-primary">{base(section.status === "failed" ? "doc.failed" : "doc.skipped")}</div><p className={`mt-1 ${BODY_TEXT}`}>{section.status === "failed" ? base(`sectionFail.${section.fail_reason}`) : base("doc.skippedBody")}</p></div>}
      </section>)}</div>
    </section>

    {relatedLinks.length > 0 ? <section data-related-links><h2 className={`${SECTION_TITLE} ${RULE}`}>{t("relatedLinks")}</h2><ul className="mt-3 space-y-2">{relatedLinks.map((link) => <li key={link.pageRef}><a data-related-link href={link.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-brand-accent-text underline underline-offset-2">{link.anchor}</a></li>)}</ul></section> : null}

    <section><h2 className={`${SECTION_TITLE} ${RULE}`}>{base("coverage.title")}</h2><p data-coverage-method className="mt-3 text-[11.5px] leading-[1.5] text-text-dark-secondary">{result.coverage.status !== "available" ? t("coverageUnavailableBody") : t(result.coverage.method === "empty_draft" ? "emptyDraft" : "coverageMethod")}</p><div className="mt-3 divide-y divide-brand-border-card rounded-[4px] border border-brand-border-card">{questions.map((question) => { const item = coverageById.get(question.id); return <div key={question.id} data-coverage-question={question.id} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-3 py-3 md:grid-cols-[28px_minmax(0,1fr)_auto]"><span className={ID_CHIP}>{question.id}</span><span className="text-[13px] text-text-dark-primary">{question.q}{question.paa_refs.length > 0 ? <span className="ml-2 text-[10px] text-text-dark-secondary">PAA</span> : null}</span><span data-coverage-status={item?.status ?? "unavailable"} className="col-start-2 text-[11.5px] text-text-dark-secondary md:col-auto">{item === undefined ? t("coverageUnavailable") : base(`coverageStatus.${item.status}`)}{item?.covered_in ? ` · ${base("coverage.coveredIn", { id: item.covered_in })}` : ""}</span>{item?.gap ? <p className="col-start-2 text-[11.5px] text-brand-warning">{item.gap}</p> : null}</div>; })}</div></section>

    <section><h2 className={`${SECTION_TITLE} ${RULE}`}>{base("verify.title")}</h2><p className={`mt-3 ${BODY_TEXT}`}>{t("verifyBoundary")}</p>{result.verify_before_publish.length === 0 ? <p className={`mt-2 ${BODY_TEXT}`}>{t(result.run.reads.sections.ok === 0 ? "noDraftToVerify" : "verifyEmpty")}</p> : <ul className="mt-3 space-y-3">{result.verify_before_publish.map((item, index) => <li key={index} className="border-l-2 border-brand-border-card pl-3"><div className="text-[11px] text-text-dark-secondary">{base(`verifyKind.${item.kind}`)} · {item.section_id}{item.kind === "single_source" ? ` · ${t("supportingPages", { count: item.support_count })}` : ""}</div><p className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-primary">{item.sentence}</p><div className="mt-1 flex gap-2 text-[11px] text-text-dark-secondary">{item.evidence_refs.length === 0 ? base("verify.noRefs") : item.evidence_refs.map((ref) => <a key={ref} href={`#draft-v2-evidence-${ref}`} className="underline">{ref}</a>)}</div></li>)}</ul>}</section>

    <section><h2 className={`${SECTION_TITLE} ${RULE}`}>{t("evidence")}</h2><p className={`mt-3 ${BODY_TEXT}`}>{t("evidenceBoundary")}</p><div className="mt-3 space-y-3">{pageEvidence.map(({ ref, page, excerpt }) => { const href = safePageUrl(page.final_url); return <details key={ref} id={`draft-v2-evidence-${ref}`} data-evidence-ref={ref} className="rounded-[4px] border border-brand-border-card p-3"><summary className={SUMMARY}>{ref} · {t(page.role === "owned" ? "ownedPage" : "observedPage")} · {page.final_url}</summary>{href !== null ? <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-[11px] text-brand-accent-text underline">{href}</a> : null}{excerpt.heading !== null ? <div className="mt-2 text-[12px] font-semibold text-text-dark-primary">{excerpt.heading.text}</div> : null}<blockquote className="mt-2 border-l-2 border-brand-border-card pl-3 text-[12px] leading-[1.6] text-text-dark-secondary">{excerpt.text}</blockquote><p className="mt-2 text-[10.5px] text-text-dark-secondary">{t("observedAt", { time: collectedTime(page.fetched_at, locale) })}</p></details>; })}{profileEvidence.map((fact) => <details key={fact.id} id={`draft-v2-evidence-${fact.id}`} data-evidence-ref={fact.id} className="rounded-[4px] border border-brand-border-card p-3"><summary className={SUMMARY}>{fact.id} · {t("profileFact")} · {t(fact.derivation === "inferred" ? "inferred" : "declared")}</summary><p className={`mt-2 ${BODY_TEXT}`}>{fact.text}</p></details>)}</div></section>

    <section className="border-t border-brand-border-card pt-4"><div className="flex flex-wrap gap-2"><button type="button" data-copy-markdown className={ACTION_BUTTON} onClick={() => void copy("markdown")}>{base("actions.copyMarkdown")}</button><button type="button" data-download-markdown className={ACTION_BUTTON} onClick={() => download("markdown")}>{t("downloadMarkdown")}</button><button type="button" data-copy-draft-json className={ACTION_BUTTON} onClick={() => void copy("json")}>{t("copyJson")}</button><button type="button" data-download-draft-json className={ACTION_BUTTON} onClick={() => download("json")}>{t("downloadJson")}</button></div><p className="mt-2 text-[11px] leading-[1.5] text-text-dark-secondary">{t("exportNote")}</p>{exportStatus !== null ? <p role="status" className={`mt-2 ${BODY_TEXT}`}>{t(`export.${exportStatus}`)}</p> : null}</section>
    <ContentDraftV2OnPage key={confirmed.fingerprint} confirmed={confirmed} locale={locale} />
    <details><summary className={SUMMARY}>{t("runReceipt")}</summary><p className={`mt-3 ${BODY_TEXT}`}>{t(result.run.rerun === null ? "initialUsage" : "rerunUsage")}</p><pre data-run-ledger className={CODE}>{JSON.stringify(result.run, null, 2)}</pre><details className="mt-3"><summary className={SUMMARY}>{t("fullJson")}</summary><pre data-draft-json className={CODE}>{JSON.stringify(result)}</pre></details></details>
  </div>;
}
