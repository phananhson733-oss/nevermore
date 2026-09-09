// @input -- one strictly parsed Draft v2 and its exact frozen confirmed Brief
// @output -- leading coverage assessment, collapsible source-marked H2/H3 prose and exact exports
// @pos -- editorial v2 result; quality is separate from completion and publication remains explicit
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { DraftResultV2 } from "@sf/public-tools/content-brief/v2-draft-contract";
import type { DraftV2Sentence } from "@sf/public-tools/content-brief/v2-draft-section";
import { ACTION_BUTTON, BODY_TEXT, ID_CHIP, SECTION_TITLE, collectedTime, safePageUrl } from "./content-brief-results-shared";
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

/**
 * Every page an accepted section actually cited, in the order it was first used.
 *
 * Derived from the sentences, not from the research bundle: a page the brief
 * collected and the draft never cited is not a source of this article, and
 * listing it would be the article claiming to rest on reading it did not do.
 * Both the rendered article and the export read this one function, so the
 * published list and the exported list cannot drift apart.
 *
 * Identity is the final URL, not the page id. Two ids can be two observations
 * of one page -- a Search Console candidate that also ranks in the SERP, for
 * instance -- and printing that page twice would tell the reader the article
 * rests on two sources when it rests on one. A page whose final URL will not
 * parse as an ordinary http(s) address is left out rather than named from a
 * string nobody can resolve; that is a crawler the brief should not have
 * produced, and the excerpt is still in the evidence section either way.
 */
export function draftV2CitedPages(result: DraftResultV2, confirmed: ConfirmedBriefV2) {
  const research = confirmed.brief.context.research;
  const units = new Map(research.units.map((unit) => [unit.id, unit]));
  const pages = new Map(research.pages.map((page) => [page.id, page]));
  const seen = new Set<string>();
  const cited: { readonly id: string; readonly domain: string; readonly url: string; readonly fetched_at: string }[] = [];
  for (const section of result.sections) {
    if (section.status !== "ok") continue;
    for (const paragraph of section.body.paragraphs) for (const sentence of paragraph.sentences) for (const ref of sentence.evidence_refs) {
      const unit = units.get(ref);
      if (unit?.kind !== "page") continue;
      const page = pages.get(unit.page_ref);
      const url = page === undefined ? null : safePageUrl(page.final_url);
      if (page === undefined || url === null || seen.has(url)) continue;
      seen.add(url);
      cited.push({ id: page.id, domain: new URL(url).hostname, url, fetched_at: page.fetched_at });
    }
  }
  return cited;
}

/** Consecutive bulleted sentences are one list; everything else stays running prose. */
export function draftV2Runs(sentences: readonly DraftV2Sentence[]) {
  const runs: { readonly bullet: boolean; readonly items: { readonly sentence: DraftV2Sentence; readonly index: number }[] }[] = [];
  for (const [index, sentence] of sentences.entries()) {
    const bullet = sentence.bullet === true;
    const open = runs.at(-1);
    if (open !== undefined && open.bullet === bullet) open.items.push({ sentence, index });
    else runs.push({ bullet, items: [{ sentence, index }] });
  }
  return runs;
}

function markdownLinkLabel(text: string) { return text.replace(/&/gu, "&amp;").replace(/[\\`*_{}[\]()<>!#|]/gu, "\\$&"); }
/**
 * A heading renders its own text and nothing else.
 *
 * Headings are the one place the export interpolates model and operator text
 * into Markdown syntax. "Reading [Delayed Reports](https://example.com)" is a
 * legal title -- no number, no unsupplied acronym, nothing the generation
 * checks refuse -- and pasted into a CMS it becomes a heading that links
 * somewhere nobody chose. Backslash-escaping the inline constructs keeps the
 * exported heading the string that was confirmed. The visible text is
 * unchanged: a CommonMark reader prints the character, not the backslash.
 *
 * Parentheses are deliberately left alone. Escaping the bracket already breaks
 * the link, and escaping the paren that follows a bare URL only lands a visible
 * backslash inside the autolink GFM makes of it. A bare URL that links to
 * itself hides nothing; a label pointing somewhere else is the whole risk.
 */
function markdownHeading(text: string) { return text.replace(/[\\`*_[\]<>#|~]/gu, "\\$&"); }
function markdownLinkUrl(url: string) { return url.replace(/[()[\]<>\\]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`).replace(/&/gu, "&amp;"); }

/** Full outline and real prose, with local absence notes and one confirmed related-links block. */
export interface ImagePromptNotes {
  readonly imagePrompts: string; readonly imagePromptsNote: string; readonly imageHero: string; readonly imagePrompt: string; readonly imageAlt: string;
}
export interface SourceListNotes {
  readonly sources: string;
  readonly observedAt: (time: string) => string;
}
export function contentDraftV2Markdown(result: DraftResultV2, confirmed: ConfirmedBriefV2, notes: MarkdownNotes & { readonly relatedLinks: string } & ImagePromptNotes & SourceListNotes): string {
  // The one H1, and only when the confirmation recorded one. An export that
  // invented a heading from the keyword would be putting a promise on the page
  // that nobody chose and nothing checked.
  const sections = confirmed.title === undefined ? [] : [`# ${markdownHeading(confirmed.title)}`];
  sections.push(...result.sections.map((section) => {
    if (section.status === "failed") return `## ${markdownHeading(section.h2)}\n\n> ${notes.failed(section.fail_reason)}`;
    if (section.status === "skipped") return `## ${markdownHeading(section.h2)}\n\n> ${notes.skipped}`;
    return [`## ${markdownHeading(section.h2)}`, ...section.body.paragraphs.flatMap((paragraph) => [
      ...(paragraph.heading === null ? [] : [`### ${markdownHeading(paragraph.heading)}`]),
      ...draftV2Runs(paragraph.sentences).map((run) => run.bullet
        ? run.items.map(({ sentence }) => `- ${sentence.text}`).join("\n")
        : run.items.map(({ sentence }) => sentence.text).join(" ")),
    ])].join("\n\n");
  }));
  const cited = draftV2CitedPages(result, confirmed);
  // The URL is a link with its own text escaped, exactly as the related-links
  // block does it: a final URL is a crawled string, and one carrying image or
  // link syntax would otherwise put an attacker's destination inside the
  // article's own source list.
  if (cited.length > 0) sections.push(`## ${markdownHeading(notes.sources)}\n\n${cited.map((page) =>
    `- ${markdownLinkLabel(page.domain)} — [${markdownLinkLabel(page.url)}](${markdownLinkUrl(page.url)}) (${notes.observedAt(page.fetched_at.slice(0, 10))})`).join("\n")}`);
  const links = confirmedRelatedLinks(confirmed);
  if (links.length > 0) sections.push(`## ${notes.relatedLinks}\n\n${links.map((link) => `- [${markdownLinkLabel(link.anchor)}](${markdownLinkUrl(link.url)})`).join("\n")}`);
  const plan = result.image_prompts;
  if (plan?.status === "available") {
    const card = (heading: string, image: { readonly prompt: string; readonly alt: string }) =>
      `### ${heading}\n\n${notes.imagePrompt}: ${image.prompt}\n\n${notes.imageAlt}: ${image.alt}`;
    const titled = new Map(result.sections.map((section) => [section.id, section.h2]));
    sections.push([
      `## ${notes.imagePrompts}`, notes.imagePromptsNote, card(notes.imageHero, plan.hero),
      ...plan.sections.map((image) => card(`${image.section_id} · ${titled.get(image.section_id) ?? image.section_id}`, image)),
    ].join("\n\n"));
  }
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
  // Off by default: every paragraph prints its sources beneath it, so the
  // per-sentence chips are a second copy of the same fact and turn the article
  // into a ledger. The toggle keeps them one click away for anyone verifying.
  const [showClaims, setShowClaims] = useState(false);
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
  /** Distinct sources behind one paragraph, in first-use order; profile facts collapse into one entry. */
  function paragraphSources(sentences: readonly { readonly evidence_refs: readonly string[] }[]) {
    const seen = new Set<string>();
    const entries: { readonly ref: string; readonly label: string }[] = [];
    for (const sentence of sentences) for (const ref of sentence.evidence_refs) {
      const fact = facts.get(ref);
      if (fact !== undefined) {
        if (seen.has("profile")) continue;
        seen.add("profile");
        entries.push({ ref, label: t("profileFact") });
        continue;
      }
      const unit = units.get(ref);
      const page = unit?.kind === "page" ? pages.get(unit.page_ref) : undefined;
      if (page === undefined) continue;
      let host: string;
      try { host = new URL(page.final_url).hostname; } catch { continue; }
      if (seen.has(host)) continue;
      seen.add(host);
      entries.push({ ref, label: host });
    }
    return entries;
  }
  const relatedLinks = confirmedRelatedLinks(confirmed);
  const cited = draftV2CitedPages(result, confirmed);
  const notes = {
    ...markdownNotes(base), relatedLinks: t("relatedLinks"),
    sources: t("sources"), observedAt: (time: string) => t("observedAt", { time }),
    imagePrompts: t("images.markdownHeading"), imagePromptsNote: t("images.markdownNote"), imageHero: t("images.hero"), imagePrompt: t("images.prompt"), imageAlt: t("images.alt"),
  };
  // Per-card copy receipt; a new result is a new set of cards, so it resets with it.
  const [copiedImage, setCopiedImage] = useState<string | null>(null);
  useEffect(() => { setCopiedImage(null); }, [result]);
  async function copyImagePrompt(id: string, prompt: string) {
    setCopiedImage(null);
    try { await navigator.clipboard.writeText(prompt); if (mounted.current) setCopiedImage(id); }
    catch { if (mounted.current) setCopiedImage(`failed:${id}`); }
  }
  const imagePlan = result.image_prompts;
  const sectionTitle = new Map(result.sections.map((section) => [section.id, section.h2]));
  function imageCard(id: string, label: string, image: { readonly prompt: string; readonly alt: string }) {
    return <li key={id} data-image-prompt={id} className={styles.imageCard}>
      <div className={styles.imageCardHeader}><span className={ID_CHIP}>{label}</span>
        <button type="button" data-copy-image-prompt={id} className={ACTION_BUTTON} onClick={() => void copyImagePrompt(id, image.prompt)}>{t(copiedImage === id ? "images.copied" : "images.copy")}</button></div>
      <div className={styles.imageField}><span>{t("images.prompt")}</span><p data-image-prompt-text lang="en">{image.prompt}</p></div>
      <div className={styles.imageField}><span>{t("images.alt")}</span><p data-image-alt-text>{image.alt}</p></div>
      {copiedImage === `failed:${id}` ? <p role="alert" className={`mt-2 ${BODY_TEXT} text-brand-error`}>{t("images.copyFailed")}</p> : null}
    </li>;
  }

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
      {confirmed.title === undefined ? null : <h1 data-draft-title className={styles.articleTitle}>{confirmed.title}</h1>}
      <div className={styles.document}>{result.sections.map((section, index) => {
        const isOpen = expanded[section.id] ?? (index < 2 || section.status === "failed");
        const panelId = `${sectionPrefix}-${section.id}`;
        return <section key={section.id} data-draft-section={section.id} className={styles.chapter}>
          <div className={styles.chapterHeader}><span className="font-mono text-[10px] text-text-dark-secondary">H2 {String(index + 1).padStart(2, "0")}</span><h2 data-draft-h2 className={styles.chapterTitle}>{section.h2}</h2><span className="font-mono text-[10px] text-text-dark-secondary">{section.id} · {section.answers.join(", ")}</span><span data-section-status={section.id} data-status={section.status} className={styles.sectionStatus}>{section.status === "ok" ? t(`length.${section.body.length.unit}`, { count: section.body.length.value }) : base(section.status === "failed" ? "doc.failed" : "doc.skipped")}</span>
            <button type="button" data-toggle-section={section.id} aria-expanded={isOpen} aria-controls={panelId} aria-label={t(isOpen ? "collapseSection" : "expandSection", { section: section.h2 })} className={ACTION_BUTTON} onClick={() => setExpanded((current) => ({ ...current, [section.id]: !isOpen }))}>{t(isOpen ? "collapse" : "expand")}</button>
            <button type="button" data-rerun-section={section.id} disabled={rerun.disabled} className={ACTION_BUTTON} onClick={() => rerun.onRerun(section.id)}>{base(rerun.runningSection === section.id ? "actions.rerunning" : section.status === "skipped" ? "actions.generateSection" : "actions.rerun")}</button>
          </div>
          <div id={panelId} hidden={!isOpen} data-section-body={section.id}>
            {section.status === "ok" ? <div className={styles.prose}>{section.body.paragraphs.map((paragraph, pIndex) => <div key={pIndex}>{paragraph.heading !== null ? <h3 data-draft-h3>{paragraph.heading}</h3> : null}{draftV2Runs(paragraph.sentences).map((run, rIndex) => {
              const nodes = run.items.map(({ sentence, index }, position) => {
                const tier = sourceTier(sentence.evidence_refs, sentence.claim);
                return <span key={index} data-claim={sentence.claim} data-source-tier={tier} data-marked={showClaims ? "true" : "false"}>{!run.bullet && position > 0 ? " " : ""}<span data-sentence-text>{sentence.text}</span>{showClaims ? <span className={styles.claimAnnotation}>[{base(`claims.${sentence.claim}`)} · {t(`sourceTier.${tier}`)}{sentence.evidence_refs.length > 0 ? " · " : ""}{sentence.evidence_refs.map((ref, refIndex) => <span key={ref}>{refIndex > 0 ? ", " : ""}<a href={`#draft-v2-evidence-${ref}`}>{ref}</a></span>)}{sentence.claim === "bound" ? <span data-support-count> · {t("supportingPages", { count: sentence.support_count })}</span> : null}]</span> : null}</span>;
              });
              return run.bullet
                ? <ul key={rIndex} data-draft-list>{nodes.map((sentenceNode, position) => <li key={run.items[position]!.index}>{sentenceNode}</li>)}</ul>
                : <p key={rIndex}>{nodes}</p>;
            })}{(() => { const sources = paragraphSources(paragraph.sentences); return sources.length === 0 ? null : <p data-paragraph-sources className={styles.paragraphSources}>{t("paragraphSources")}{sources.map((source, index) => <span key={source.ref}>{index > 0 ? "\u3001" : " "}<a href={`#draft-v2-evidence-${source.ref}`}>{source.label}</a></span>)}</p>; })()}</div>)}</div> : <div className={styles.failure}><strong>{base(section.status === "failed" ? "doc.failed" : "doc.skipped")}</strong><p>{section.status === "failed" ? base(`sectionFail.${section.fail_reason}`) : base("doc.skippedBody")}</p></div>}
          </div>
        </section>;
      })}</div>
    </section>

    {imagePlan === undefined ? null : <section data-image-prompts data-status={imagePlan.status} aria-label={t("images.title")}>
      <h2 className={`${SECTION_TITLE} ${RULE}`}>{t("images.title")}</h2>
      <p className={`mt-3 ${BODY_TEXT}`}>{t("images.boundary")}</p>
      {imagePlan.status === "available"
        ? <ul className={styles.imageCards}>{[
          imageCard("hero", t("images.hero"), imagePlan.hero),
          ...imagePlan.sections.map((image) => imageCard(image.section_id, t("images.section", { id: image.section_id, title: sectionTitle.get(image.section_id) ?? image.section_id }), image)),
        ]}</ul>
        : <p data-image-prompts-unavailable className={`mt-3 ${BODY_TEXT}`}>{t("images.unavailable", { reason: t(`images.reason.${imagePlan.reason}`) })}</p>}
    </section>}

    {cited.length > 0 ? <section data-draft-sources><h2 className={`${SECTION_TITLE} ${RULE}`}>{t("sources")}</h2><p className={`mt-3 ${BODY_TEXT}`}>{t("sourcesBoundary")}</p><ul className="mt-3 space-y-2">{cited.map((page) => <li key={page.id} data-source-page={page.id} className="text-[12.5px] leading-[1.6] text-text-dark-primary"><span className="font-semibold">{page.domain}</span> · <a href={page.url} target="_blank" rel="noopener noreferrer" className="break-all text-brand-accent-text underline underline-offset-2">{page.url}</a> <span className="text-text-dark-secondary">· {t("observedAt", { time: collectedTime(page.fetched_at, locale) })}</span></li>)}</ul></section> : null}
    {relatedLinks.length > 0 ? <section data-related-links><h2 className={`${SECTION_TITLE} ${RULE}`}>{t("relatedLinks")}</h2><ul className="mt-3 space-y-2">{relatedLinks.map((link) => <li key={link.pageRef}><a data-related-link href={link.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-brand-accent-text underline underline-offset-2">{link.anchor}</a></li>)}</ul></section> : null}

    <section><h2 className={`${SECTION_TITLE} ${RULE}`}>{base("verify.title")}</h2><p className={`mt-3 ${BODY_TEXT}`}>{t("verifyBoundary")}</p>{result.verify_before_publish.length === 0 ? <p className={`mt-2 ${BODY_TEXT}`}>{t(result.run.reads.sections.ok === 0 ? "noDraftToVerify" : "verifyEmpty")}</p> : <ul className="mt-3 space-y-3">{result.verify_before_publish.map((item, index) => <li key={index} className="border-l-2 border-brand-border-card pl-3"><div className="text-[11px] text-text-dark-secondary">{base(`verifyKind.${item.kind}`)} · {item.section_id}{item.kind === "single_source" ? ` · ${t("supportingPages", { count: item.support_count })}` : ""}</div><p className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-primary">{item.sentence}</p><div className="mt-1 flex gap-2 text-[11px] text-text-dark-secondary">{item.evidence_refs.length === 0 ? base("verify.noRefs") : item.evidence_refs.map((ref) => <a key={ref} href={`#draft-v2-evidence-${ref}`} className="underline">{ref}</a>)}</div></li>)}</ul>}</section>

    <section><h2 className={`${SECTION_TITLE} ${RULE}`}>{t("evidence")}</h2><p className={`mt-3 ${BODY_TEXT}`}>{t("evidenceBoundary")}</p><div className="mt-3 space-y-3">{pageEvidence.map(({ ref, page, excerpt }) => { const href = safePageUrl(page.final_url); return <details key={ref} id={`draft-v2-evidence-${ref}`} data-evidence-ref={ref} className="rounded-[4px] border border-brand-border-card p-3"><summary className={SUMMARY}>{ref} · {t(page.role === "owned" ? "ownedPage" : "observedPage")} · {page.final_url}</summary>{href !== null ? <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-[11px] text-brand-accent-text underline">{href}</a> : null}{excerpt.heading !== null ? <div className="mt-2 text-[12px] font-semibold text-text-dark-primary">{excerpt.heading.text}</div> : null}<blockquote className="mt-2 border-l-2 border-brand-border-card pl-3 text-[12px] leading-[1.6] text-text-dark-secondary">{excerpt.text}</blockquote><p className="mt-2 text-[10.5px] text-text-dark-secondary">{t("observedAt", { time: collectedTime(page.fetched_at, locale) })}</p></details>; })}{profileEvidence.map((fact) => <details key={fact.id} id={`draft-v2-evidence-${fact.id}`} data-evidence-ref={fact.id} className="rounded-[4px] border border-brand-border-card p-3"><summary className={SUMMARY}>{fact.id} · {t("profileFact")} · {t(`profileDerivation.${fact.derivation}`)}</summary><p className={`mt-2 ${BODY_TEXT}`}>{fact.text}</p></details>)}</div></section>

    <section className="border-t border-brand-border-card pt-4"><div className="flex flex-wrap gap-2"><button type="button" data-copy-markdown className={ACTION_BUTTON} onClick={() => void copy("markdown")}>{base("actions.copyMarkdown")}</button><button type="button" data-download-markdown className={ACTION_BUTTON} onClick={() => download("markdown")}>{t("downloadMarkdown")}</button><button type="button" data-copy-draft-json className={ACTION_BUTTON} onClick={() => void copy("json")}>{t("copyJson")}</button><button type="button" data-download-draft-json className={ACTION_BUTTON} onClick={() => download("json")}>{t("downloadJson")}</button></div><p className="mt-2 text-[11px] leading-[1.5] text-text-dark-secondary">{t("exportNote")}</p>{exportStatus !== null ? <p role="status" className={`mt-2 ${BODY_TEXT}`}>{t(`export.${exportStatus}`)}</p> : null}</section>
    <details><summary className={SUMMARY}>{t("runReceipt")}</summary><p className={`mt-3 ${BODY_TEXT}`}>{t(result.run.rerun === null ? "initialUsage" : "rerunUsage")}</p><pre data-run-ledger className={CODE}>{JSON.stringify(result.run, null, 2)}</pre><details className="mt-3"><summary className={SUMMARY}>{t("fullJson")}</summary><pre data-draft-json className={CODE}>{JSON.stringify(result)}</pre></details></details>
  </div>;
}
