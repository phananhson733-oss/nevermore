// @input -- one strictly parsed Draft v2 and its exact frozen confirmed Brief
// @output -- leading coverage assessment, collapsible source-marked H2/H3 prose and exact exports
// @pos -- editorial v2 result; quality is separate from completion and publication remains explicit
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { DraftResultV2 } from "@sf/public-tools/content-brief/v2-draft-contract";
import { ACTION_BUTTON, BODY_TEXT, ID_CHIP, SECTION_TITLE, collectedTime, safePageUrl } from "./content-brief-results-shared";
import { ContentDraftV2OnPage } from "./content-draft-v2-onpage";
import { markdownNotes } from "./content-draft-handoff-bar";
import type { MarkdownNotes } from "./content-draft-markdown";
import styles from "./content-draft-v2-presentation.module.css";

const SUMMARY = "cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const CODE = "mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[4px] bg-brand-panel-sunken p-3 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary";
const RULE = "border-b border-brand-border-card pb-2";
type ExportState = "copied" | "downloaded" | "failed";
type ExportIdentity = { readonly result: DraftResultV2; readonly confirmed: ConfirmedBriefV2; readonly locale: string };
function sameExportIdentity(left: ExportIdentity, right: ExportIdentity): boolean {
  return left.result === right.result && left.confirmed === right.confirmed && left.locale === right.locale;
}

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
  readonly rerun: { readonly disabled: boolean; readonly runningSection: string | null; readonly running?: boolean; readonly onRerun: (id: string) => void };
}) {
  const t = useTranslations("tools.contentDraft.v2");
  const base = useTranslations("tools.contentDraft");
  const [showClaims, setShowClaims] = useState(true);
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>({});
  const sectionPrefix = useId();
  const [exportReceipt, setExportReceipt] = useState<{ readonly identity: ExportIdentity; readonly state: ExportState } | null>(null);
  const exportAttempt = useRef(0);
  const mounted = useRef(false);
  // Parsed inputs are immutable snapshots. Their causal hashes deliberately
  // omit elapsed time; locale also changes the exported Markdown absence notes.
  const exportIdentity = { result, confirmed, locale };
  const liveExportIdentity = useRef(exportIdentity);
  liveExportIdentity.current = exportIdentity;
  const exportStatus = exportReceipt !== null && sameExportIdentity(exportReceipt.identity, exportIdentity) ? exportReceipt.state : null;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; exportAttempt.current += 1; };
  }, []);
  const questions = confirmed.brief.generated?.research.questions ?? [];
  const coverage = result.coverage.status === "available" ? result.coverage : null;
  const coverageById = new Map(result.coverage.status === "available" ? result.coverage.items.map((item) => [item.question_id, item]) : []);
  const usedRefs = new Set(result.sections.flatMap((section) => section.status === "ok" ? section.body.paragraphs.flatMap((paragraph) => paragraph.sentences.flatMap((sentence) => sentence.evidence_refs)) : []));
  const research = confirmed.brief.context.research;
  const pages = new Map(research.pages.map((page) => [page.id, page]));
  const facts = new Map(confirmed.brief.context.facts.map((fact) => [fact.id, fact]));
  const units = new Map(research.units.map((unit) => [unit.id, unit]));
  const running = rerun.running === true || rerun.runningSection !== null;
  const quality = result.run.reads.sections.ok === 0 ? "noDraft" : result.coverage.status !== "available" ? "unknown"
    : result.coverage.partial > 0 || result.coverage.none > 0 ? "revision"
      : result.run.reads.sections.failed > 0 || result.run.reads.sections.skipped > 0 ? "incomplete" : "review";
  function sourceTier(refs: readonly string[], claim: string): "first" | "third" | "model" | "mixed" {
    if (claim !== "bound" || refs.length === 0) return "model";
    const tiers = new Set(refs.map((ref) => {
      const fact = facts.get(ref);
      if (fact) return fact.derivation === "inferred" ? "model" : "first";
      const unit = units.get(ref);
      if (unit?.kind !== "page") return "model";
      return pages.get(unit.page_ref)?.role === "owned" ? "first" : "third";
    }));
    return tiers.size > 1 ? "mixed" : tiers.values().next().value ?? "model";
  }
  const pageEvidence = research.units.flatMap((unit) => {
    if (!usedRefs.has(unit.id) || unit.kind !== "page") return [];
    const page = research.pages.find((item) => item.id === unit.page_ref);
    const excerpt = page?.research.segments[unit.segment_index];
    return page === undefined || excerpt === undefined ? [] : [{ ref: unit.id, page, excerpt }];
  });
  const profileEvidence = confirmed.brief.context.facts.filter((fact) => usedRefs.has(fact.id));
  const relatedLinks = confirmedRelatedLinks(confirmed);
  const notes = { ...markdownNotes(base), relatedLinks: t("relatedLinks") };

  function finishExport(state: ExportState, identity: ExportIdentity, attempt: number) {
    if (mounted.current && sameExportIdentity(liveExportIdentity.current, identity) && exportAttempt.current === attempt) setExportReceipt({ identity, state });
  }

  async function copy(kind: "markdown" | "json") {
    const identity = exportIdentity; const attempt = ++exportAttempt.current; setExportReceipt(null);
    try { await navigator.clipboard.writeText(kind === "json" ? JSON.stringify(result) : contentDraftV2Markdown(result, confirmed, notes)); finishExport("copied", identity, attempt); }
    catch { finishExport("failed", identity, attempt); }
  }
  function download(kind: "markdown" | "json") {
    const identity = exportIdentity; const attempt = ++exportAttempt.current; setExportReceipt(null);
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([kind === "json" ? JSON.stringify(result) : contentDraftV2Markdown(result, confirmed, notes)], { type: kind === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `content-draft-r${result.confirmed_ref.revision}-${result.run.fingerprint.slice(0, 12)}.${kind === "json" ? "json" : "md"}`; anchor.click(); finishExport("downloaded", identity, attempt);
    } catch { finishExport("failed", identity, attempt); }
    finally { if (url !== null) { const created = url; window.setTimeout(() => URL.revokeObjectURL(created), 0); } }
  }

  return <div data-draft-v2-result data-run-id={result.run.run_id} className={`${styles.results} mx-auto max-w-[880px] space-y-6 break-words`}>
    <header className="overflow-hidden rounded-[4px] border border-brand-border-card bg-brand-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-brand-border-card px-4 py-3 text-[11px] text-text-dark-secondary"><span data-processing-status className={ID_CHIP}>{t(running ? "processing.running" : `processing.${result.run.mode}`)}</span><span>{t("revision", { revision: result.confirmed_ref.revision })}</span><time dateTime={result.run.collected_at}>{collectedTime(result.run.collected_at, locale)}</time><span data-run-time className="font-mono">{t("runTime", { elapsed: (result.run.elapsed_ms / 1000).toFixed(1), budget: result.run.budget_ms / 1000 })}</span></div>
      <div className="grid grid-cols-2 md:grid-cols-4">{[
        [t("generatedSections"), `${result.run.reads.sections.ok}/${result.sections.length}`],
        [t("proseLength"), t(`length.${result.totals.unit}`, { count: result.totals.value })],
        [t("questionCoverage"), result.coverage.status === "available" ? `${result.coverage.covered}/${result.coverage.total}` : t("coverageUnavailable")],
        [base("verify.title"), String(result.verify_before_publish.length)],
      ].map(([label, value], index) => <div key={label} className="border-r border-brand-border-card px-4 py-3"><div className="text-[10px] text-text-dark-secondary">{label}</div><div data-draft-length={index === 1 ? "" : undefined} data-coverage-summary={index === 2 ? "" : undefined} className="mt-1 font-mono text-[15px] font-semibold text-text-dark-primary">{value}</div></div>)}</div>
      <p data-length-note className="border-t border-brand-border-card px-4 py-2 text-[11px] leading-[1.5] text-text-dark-secondary">{t("lengthNote")}</p>
    </header>

    <section data-draft-coverage aria-label={base("coverage.title")} className={styles.coverage}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className={SECTION_TITLE}>{base("coverage.title")}</h2><span data-quality-status className={ID_CHIP}>{t(`quality.${quality}`)}</span></div>
      {coverage !== null ? <div className={styles.coverageTotals}>{(["covered", "partial", "none"] as const).map((status) => <span key={status} data-coverage-total={status}>{t(`coverageTotals.${status}`, { count: coverage[status] })}</span>)}</div> : <p className={styles.coverageUnknown}>{t("coverageUnavailable")}</p>}
      {running ? <p data-previous-assessment>{t("previousAssessment")}</p> : null}
      <p data-coverage-method>{result.coverage.status !== "available" ? t("coverageUnavailableBody") : t(result.coverage.method === "empty_draft" ? "emptyDraft" : "coverageMethod")}</p>
      <p className="mt-2">{t("qualityBoundary")}</p>
      <div className="mt-4 divide-y divide-brand-border-card border-t border-brand-border-card">{questions.map((question) => { const item = coverageById.get(question.id); return <div key={question.id} data-coverage-question={question.id} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-3 md:grid-cols-[28px_minmax(0,1fr)_auto]"><span className={ID_CHIP}>{question.id}</span><span className="text-[13px] text-text-dark-primary">{question.q}{question.paa_refs.length > 0 ? <span className="ml-2 text-[10px] text-text-dark-secondary">PAA</span> : null}</span><span data-coverage-status={item?.status ?? "unavailable"} className="col-start-2 text-[11.5px] text-text-dark-secondary md:col-auto">{item === undefined ? t("coverageUnavailable") : base(`coverageStatus.${item.status}`)}{item?.covered_in ? ` · ${base("coverage.coveredIn", { id: item.covered_in })}` : ""}</span>{item?.gap ? <p className="col-start-2 text-brand-warning">{item.gap}</p> : null}</div>; })}</div>
    </section>

    <section data-draft-document aria-label={base("doc.title")}>
      <div className={styles.toolbar}><h2 className={SECTION_TITLE}>{base("doc.title")}</h2><button type="button" data-toggle-annotations aria-pressed={showClaims} className={styles.annotationToggle} onClick={() => setShowClaims((current) => !current)}><span aria-hidden="true" className={styles.switch} />{t("showAnnotations")}</button>
        {showClaims ? <div data-source-legend className={styles.legend}>{(["first", "third", "model"] as const).map((tier) => <span key={tier} data-tier={tier}><i aria-hidden="true" />{t(`sourceTier.${tier}`)}</span>)}</div> : null}
      </div>
      {showClaims ? <div className={styles.annotationNote}><p>{t("sourceLegend")}</p><p>{t("claimLegend")}</p></div> : null}
      <div className={styles.document}>{result.sections.map((section, index) => {
        const isOpen = expanded[section.id] ?? (index < 2 || section.status === "failed");
        const panelId = `${sectionPrefix}-${section.id}`;
        return <section key={section.id} data-draft-section={section.id} className={styles.chapter}>
          <div className={styles.chapterHeader}><span className="font-mono text-[10px] text-text-dark-secondary">H2 {String(index + 1).padStart(2, "0")}</span><h2 data-draft-h2 className={styles.chapterTitle}>{section.h2}</h2><span className="font-mono text-[10px] text-text-dark-secondary">{section.id} · {section.answers.join(", ")}</span><span data-section-status={section.id} data-status={section.status} className={styles.sectionStatus}>{section.status === "ok" ? t(`length.${section.body.length.unit}`, { count: section.body.length.value }) : base(section.status === "failed" ? "doc.failed" : "doc.skipped")}</span>
            <button type="button" data-toggle-section={section.id} aria-expanded={isOpen} aria-controls={panelId} aria-label={t(isOpen ? "collapseSection" : "expandSection", { section: section.h2 })} className={ACTION_BUTTON} onClick={() => setExpanded((current) => ({ ...current, [section.id]: !isOpen }))}>{t(isOpen ? "collapse" : "expand")}</button>
            <button type="button" data-rerun-section={section.id} disabled={rerun.disabled} className={ACTION_BUTTON} onClick={() => rerun.onRerun(section.id)}>{base(rerun.runningSection === section.id ? "actions.rerunning" : section.status === "skipped" ? "actions.generateSection" : "actions.rerun")}</button>
          </div>
          <div id={panelId} hidden={!isOpen} data-section-body={section.id}>
            {section.status === "ok" ? <div className={styles.prose}>{section.body.paragraphs.map((paragraph, pIndex) => <div key={pIndex}>{paragraph.heading !== null ? <h3 data-draft-h3>{paragraph.heading}</h3> : null}<p>{paragraph.sentences.map((sentence, sIndex) => {
              const tier = sourceTier(sentence.evidence_refs, sentence.claim);
              return <span key={sIndex} data-claim={sentence.claim} data-source-tier={tier} data-marked={showClaims ? "true" : "false"}>{sIndex > 0 ? " " : ""}<span data-sentence-text>{sentence.text}</span>{showClaims ? <span className={styles.claimAnnotation}>[{base(`claims.${sentence.claim}`)} · {t(`sourceTier.${tier}`)}{sentence.evidence_refs.length > 0 ? " · " : ""}{sentence.evidence_refs.map((ref, refIndex) => <span key={ref}>{refIndex > 0 ? ", " : ""}<a href={`#draft-v2-evidence-${ref}`}>{ref}</a></span>)}{sentence.claim === "bound" ? <span data-support-count> · {t("supportingPages", { count: sentence.support_count })}</span> : null}]</span> : null}</span>;
            })}</p></div>)}</div> : <div className={styles.failure}><strong>{base(section.status === "failed" ? "doc.failed" : "doc.skipped")}</strong><p>{section.status === "failed" ? base(`sectionFail.${section.fail_reason}`) : base("doc.skippedBody")}</p></div>}
          </div>
        </section>;
      })}</div>
    </section>

    {relatedLinks.length > 0 ? <section data-related-links><h2 className={`${SECTION_TITLE} ${RULE}`}>{t("relatedLinks")}</h2><ul className="mt-3 space-y-2">{relatedLinks.map((link) => <li key={link.pageRef}><a data-related-link href={link.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-brand-accent-text underline underline-offset-2">{link.anchor}</a></li>)}</ul></section> : null}

    <section><h2 className={`${SECTION_TITLE} ${RULE}`}>{base("verify.title")}</h2><p className={`mt-3 ${BODY_TEXT}`}>{t("verifyBoundary")}</p>{result.verify_before_publish.length === 0 ? <p className={`mt-2 ${BODY_TEXT}`}>{t(result.run.reads.sections.ok === 0 ? "noDraftToVerify" : "verifyEmpty")}</p> : <ul className="mt-3 space-y-3">{result.verify_before_publish.map((item, index) => <li key={index} className="border-l-2 border-brand-border-card pl-3"><div className="text-[11px] text-text-dark-secondary">{base(`verifyKind.${item.kind}`)} · {item.section_id}{item.kind === "single_source" ? ` · ${t("supportingPages", { count: item.support_count })}` : ""}</div><p className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-primary">{item.sentence}</p><div className="mt-1 flex gap-2 text-[11px] text-text-dark-secondary">{item.evidence_refs.length === 0 ? base("verify.noRefs") : item.evidence_refs.map((ref) => <a key={ref} href={`#draft-v2-evidence-${ref}`} className="underline">{ref}</a>)}</div></li>)}</ul>}</section>

    <section><h2 className={`${SECTION_TITLE} ${RULE}`}>{t("evidence")}</h2><p className={`mt-3 ${BODY_TEXT}`}>{t("evidenceBoundary")}</p><div className="mt-3 space-y-3">{pageEvidence.map(({ ref, page, excerpt }) => { const href = safePageUrl(page.final_url); return <details key={ref} id={`draft-v2-evidence-${ref}`} data-evidence-ref={ref} className="rounded-[4px] border border-brand-border-card p-3"><summary className={SUMMARY}>{ref} · {t(page.role === "owned" ? "ownedPage" : "observedPage")} · {page.final_url}</summary>{href !== null ? <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-[11px] text-brand-accent-text underline">{href}</a> : null}{excerpt.heading !== null ? <div className="mt-2 text-[12px] font-semibold text-text-dark-primary">{excerpt.heading.text}</div> : null}<blockquote className="mt-2 border-l-2 border-brand-border-card pl-3 text-[12px] leading-[1.6] text-text-dark-secondary">{excerpt.text}</blockquote><p className="mt-2 text-[10.5px] text-text-dark-secondary">{t("observedAt", { time: collectedTime(page.fetched_at, locale) })}</p></details>; })}{profileEvidence.map((fact) => <details key={fact.id} id={`draft-v2-evidence-${fact.id}`} data-evidence-ref={fact.id} className="rounded-[4px] border border-brand-border-card p-3"><summary className={SUMMARY}>{fact.id} · {t("profileFact")} · {t(`profileDerivation.${fact.derivation}`)}</summary><p className={`mt-2 ${BODY_TEXT}`}>{fact.text}</p></details>)}</div></section>

    <section className="border-t border-brand-border-card pt-4"><div className="flex flex-wrap gap-2"><button type="button" data-copy-markdown className={ACTION_BUTTON} onClick={() => void copy("markdown")}>{base("actions.copyMarkdown")}</button><button type="button" data-download-markdown className={ACTION_BUTTON} onClick={() => download("markdown")}>{t("downloadMarkdown")}</button><button type="button" data-copy-draft-json className={ACTION_BUTTON} onClick={() => void copy("json")}>{t("copyJson")}</button><button type="button" data-download-draft-json className={ACTION_BUTTON} onClick={() => download("json")}>{t("downloadJson")}</button></div><p className="mt-2 text-[11px] leading-[1.5] text-text-dark-secondary">{t("exportNote")}</p>{exportStatus !== null ? <p role="status" className={`mt-2 ${BODY_TEXT}`}>{t(`export.${exportStatus}`)}</p> : null}</section>
    <ContentDraftV2OnPage key={confirmed.fingerprint} confirmed={confirmed} locale={locale} />
    <details><summary className={SUMMARY}>{t("runReceipt")}</summary><p className={`mt-3 ${BODY_TEXT}`}>{t(result.run.rerun === null ? "initialUsage" : "rerunUsage")}</p><pre data-run-ledger className={CODE}>{JSON.stringify(result.run, null, 2)}</pre><details className="mt-3"><summary className={SUMMARY}>{t("fullJson")}</summary><pre data-draft-json className={CODE}>{JSON.stringify(result)}</pre></details></details>
  </div>;
}
