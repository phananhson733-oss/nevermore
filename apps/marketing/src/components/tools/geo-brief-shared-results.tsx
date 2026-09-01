"use client";
// @input -- one immutable GEO Brief with display metadata from its exact frozen question
// @output -- readable evidence report and unchanged copy/download/Draft projections
// @pos -- presentation only; missing evidence never becomes replacement source data
import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { GeoContentBrief, GeoSource } from "@sf/public-tools/content-brief/geo-contract";
import { sharedGeoBriefFileName, sharedGeoBriefJson, sharedGeoBriefMarkdown } from "../../lib/geo-tools/brief-shared-export.ts";
import { geoBriefQuality, geoBriefQuestionSource } from "../../lib/geo-tools/brief-quality.ts";
import { writeContentBriefHandoff } from "../../lib/tools/content-brief-handoff.ts";
import { TOOL_HANDOFF_LINK_PROPS } from "../../lib/tools/tool-handoff.ts";
import { localePath } from "../../lib/locale-path.ts";
import { GeoKnowledgeRepairLink } from "./geo-knowledge-repair-link.tsx";
import styles from "./geo-brief-results.module.css";

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.fieldRow}><dt>{label}</dt><dd>{children}</dd></div>;
}

function download(brief: GeoContentBrief, extension: "md" | "json", questionNeedsRevision: boolean) {
  const url = URL.createObjectURL(new Blob([extension === "md" ? sharedGeoBriefMarkdown(brief, { questionNeedsRevision }) : sharedGeoBriefJson(brief)], { type: extension === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = sharedGeoBriefFileName(brief, extension); link.click(); URL.revokeObjectURL(url);
}

export function SharedGeoBriefResults({ brief, roleLabel, questionNeedsRevision = false }: { brief: GeoContentBrief; roleLabel?: string; questionNeedsRevision?: boolean }) {
  const t = useTranslations("tools.geoBrief"); const locale = useLocale(); const id = useId();
  const [copy, setCopy] = useState<{ fingerprint: string; ok: boolean } | null>(null);
  const [handoffFailure, setHandoffFailure] = useState<string | null>(null);
  const copySequence = useRef(0);
  const copyBrief = async () => {
    const attempt = ++copySequence.current; let ok = false;
    try { await navigator.clipboard.writeText(sharedGeoBriefMarkdown(brief, { questionNeedsRevision })); ok = true; } catch { /* Includes an unavailable Clipboard API. */ }
    if (attempt === copySequence.current) setCopy({ fingerprint: brief.run.fingerprint, ok });
  };
  const stage = (event: MouseEvent<HTMLAnchorElement>) => {
    let ok = false;
    try { ok = writeContentBriefHandoff(window.sessionStorage, Date.now(), brief).ok; } catch { /* Show storage failures before navigation. */ }
    setHandoffFailure(ok ? null : brief.run.fingerprint);
    if (!ok) event.preventDefault();
  };
  const quality = geoBriefQuality(brief, { questionNeedsRevision });
  const source = (value: GeoSource | "model") => <span className={styles.source} data-source={value} title={t(`sources.${value}`)}>{t(`sources.${value}`)}</span>;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
  const factLabel = (label: string) => /^(productName|oneLinePositioning|coreFeatures\[\d+\])$/.test(label) ? t(`quality.profileFields.${label.startsWith("coreFeatures[") ? "coreFeatures" : label}`) : label;
  const origin = brief.geo_origin;
  const failedSamples = brief.evidence.samples.filter(sample => sample.status === "failed").length;
  const repairSelection = { kbId: origin.kb_ref.kb_id, snapshotId: origin.kb_ref.snapshot_id, questionId: origin.question.id,
    manualQuestion: origin.question.id === null ? origin.question.text : null };
  const visibilityHref = localePath(locale, "/tools/ai-visibility-check");
  const needsKnowledge = quality.usableFacts === 0 || quality.missingFacts > 0 || questionNeedsRevision;
  const layer = origin.layer && ["problem", "discovery", "comparison", "evaluation"].includes(origin.layer) ? t(`quality.layers.${origin.layer}`) : null;
  const gap = origin.gap === "B" ? t("quality.gapB") : origin.gap === "A" || origin.gap === "D" ? t(`artifact.gap${origin.gap}`) : t("quality.noGap");
  return <section data-shared-geo-result className={styles.results}>
    <aside data-brief-quality={quality.status} className={styles.quality} aria-labelledby={`${id}-quality`}>
      <h2 id={`${id}-quality`} className={styles.heading}>{t(`quality.status.${quality.status}`)}</h2>
      <p>{t(`quality.description.${quality.status}`)}</p>
      <ul className={styles.metrics}>
        <li>{t("quality.outlineCount", { count: quality.outlineSections })}</li>
        <li>{t("quality.factCount", { count: quality.usableFacts })}</li>
        <li>{t("quality.observedCount", { questions: quality.observedQuestions, samples: quality.answeredSamples })}</li>
      </ul>
      <ul className={styles.limitations}>
        {quality.usableFacts === 0 ? <li>{t("quality.noFacts")}</li> : null}
        {quality.missingFacts > 0 ? <li>{t("quality.missingFacts", { count: quality.missingFacts })}</li> : null}
        {quality.answeredSamples === 0 ? <li>{t("quality.noSamples")} <a data-geo-run-visibility href={visibilityHref}>{t("quality.runVisibility")}</a></li> : null}
        {quality.answeredSamples > 0 && quality.observedQuestions === 0 ? <li>{t("quality.noObservedTopics")}</li> : null}
        {!quality.hasProfile ? <li>{t("quality.noProfile")} <GeoKnowledgeRepairLink selection={repairSelection} reason="profile">{t("quality.repairKnowledge")}</GeoKnowledgeRepairLink></li> : null}
      </ul>
      {needsKnowledge ? <GeoKnowledgeRepairLink selection={repairSelection} reason={questionNeedsRevision ? "question" : "facts"} className={styles.repairAction}>{t("quality.repairKnowledge")}</GeoKnowledgeRepairLink> : null}
    </aside>

    <section data-brief-section="geo_origin">
      <h2 className={styles.heading}>{t("shared.origin")}</h2>
      <dl className={styles.panel}>
        <FieldRow label={t("quality.question")}>
          <p className={styles.value}>{origin.question.text}</p>
          <p className={styles.note}>{roleLabel || t(origin.role === null ? "quality.generalRole" : "quality.unresolvedRole")}</p>
          <p data-geo-market-language className={styles.note}>{t("quality.marketLanguage", { market: brief.keyword.market, language: brief.keyword.language })}</p>
        </FieldRow>
        <FieldRow label={t("quality.layerGap")}><p>{[layer, gap].filter(Boolean).join(" · ")}</p></FieldRow>
        <FieldRow label={t("artifact.evidencePointer")}>
          <p>{t(`quality.origin.${quality.origin}`)}</p>
          {brief.evidence.samples.length ? <div className={styles.receipts}>{brief.evidence.samples.map(sample => <details key={sample.id} className={styles.receipt}>
            <summary>{sample.id} · {sample.engine} · {t(`quality.sampleStatus.${sample.status}`)}</summary>
            <p className={styles.note}><time dateTime={sample.collected_at}>{t("quality.sampleDate", { date: date(sample.collected_at) })}</time></p>
            {sample.excerpt ? <blockquote>{sample.excerpt}</blockquote> : null}
            <p className={styles.note}>{t("artifact.sampleTopics")}: {sample.topics.join(" · ") || t("artifact.noSamples")}</p>
          </details>)}</div> : null}
        </FieldRow>
        <FieldRow label={t("artifact.versionAnchor")}>
          <p>{t("quality.version", { revision: origin.kb_ref.revision })}</p>
          <p className={styles.note}>{t("quality.questionSetVersion", { version: origin.promptset_ref.registry_version })}</p>
          <details className={styles.exactReferences}><summary>{t("artifact.exactReferences")}</summary><pre>{JSON.stringify(origin, null, 2)}</pre></details>
        </FieldRow>
      </dl>
    </section>

    <section data-brief-section="lead_answer">
      <div className={styles.sectionHeading}><h2 className={styles.heading}>{t("leadAnswer.title")}</h2><p className={styles.note}>{t("quality.openingNote", { id: brief.lead_answer.question_id })}</p></div>
      <dl className={styles.panel}>
        <FieldRow label={t("quality.leadRequirement")}><p className={styles.value}>{brief.lead_answer.requirement}</p><p className={styles.note}>{t(`quality.${brief.geo_origin.question.id === null ? "openingManual" : "openingFrozen"}`)}</p></FieldRow>
        <FieldRow label={t("quality.entities")}>{brief.lead_answer.required_entities.length ? <ul className={styles.chips} aria-label={t("quality.entities")}>{brief.lead_answer.required_entities.map(entity => <li key={entity}>{entity}</li>)}</ul> : <p className={styles.note}>{t("quality.noEntities")}</p>}</FieldRow>
      </dl>
    </section>

    <section data-brief-section="must_answer">
      <div className={styles.sectionHeading}><h2 id={`${id}-questions`} className={styles.heading}>{t("quality.questionsTitle", { count: brief.must_answer.items.length })}</h2><p className={styles.note}>{t("quality.questionsNote")}</p></div>
      <div className={styles.tableScroll} role="region" aria-labelledby={`${id}-questions`} tabIndex={0}>
        <table className={`${styles.table} ${styles.questions}`} aria-labelledby={`${id}-questions`}>
          <thead><tr><th scope="col">{t("quality.idColumn")}</th><th scope="col">{t("artifact.questionColumn")}</th><th scope="col">{t("artifact.coverageColumn")}</th><th scope="col">{t("artifact.sourceColumn")}</th></tr></thead>
          <tbody>{brief.must_answer.items.map(item => <tr key={item.id} data-must-answer={item.id}>
            <th scope="row">{item.id}</th><td>{item.q}</td>
            <td>{item.source === "ai_sample" ? t("shared.coverage", { covered: item.covered_by, total: item.sample_total }) : t("quality.requiredItem")}</td>
            <td><span data-source={item.source} className={styles.source}>{t(`quality.${geoBriefQuestionSource(brief, item)}`)}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className={styles.footnote}>{t("shared.candidates", { candidates: brief.budget.must_answer_candidates, shown: brief.must_answer.items.length, hidden: brief.budget.must_answer_hidden })}{failedSamples ? ` · ${t("artifact.failedSamples", { count: failedSamples })}` : ""}</p>
    </section>

    <section data-brief-section="fact_table">
      <div className={styles.sectionHeading}><h2 id={`${id}-facts`} className={styles.heading}>{t("facts.title")}</h2><p className={styles.note}>{t("facts.note")}</p></div>
      {brief.fact_table.length ? <div className={styles.tableScroll} role="region" aria-labelledby={`${id}-facts`} tabIndex={0}>
        <table className={`${styles.table} ${styles.facts}`} aria-labelledby={`${id}-facts`}>
          <thead><tr><th scope="col">{t("artifact.dimensionColumn")}</th><th scope="col">{t("quality.factValue")}</th><th scope="col">{t("artifact.sourceColumn")}</th></tr></thead>
          <tbody>{brief.fact_table.map(fact => <tr key={fact.id}>
            <th scope="row">{factLabel(fact.label)}</th><td>{fact.value ?? t("quality.noValue")}</td>
            <td>{fact.value === null ? <p className={styles.nullFact}><span>{t(`quality.factReasons.${fact.reason ?? "missing"}`)}</span><span>{t("quality.factRestriction")}</span></p> : null}
              {fact.evidence_refs.map(ref => { const receipt = brief.evidence.facts.find(item => item.id === ref); return receipt ? <div key={ref} className={styles.factReceipt}>
                <p>{source(receipt.source)} · {ref} · <time dateTime={receipt.observed_at}>{date(receipt.observed_at)}</time></p>
                {receipt.url ? <a href={receipt.url} target="_blank" rel="noopener noreferrer">{receipt.url}</a> : null}
              </div> : null; })}
            </td>
          </tr>)}</tbody>
        </table>
      </div> : <p className={styles.empty}>{t("artifact.emptyFacts")} <GeoKnowledgeRepairLink selection={repairSelection} reason="facts">{t("quality.repairKnowledge")}</GeoKnowledgeRepairLink></p>}
    </section>

    <section data-brief-section="outline">
      <div className={styles.sectionHeading}><h2 className={styles.heading}>{t("quality.outlineTitle")}</h2><p className={styles.note}>{t("quality.outlineNote")}</p></div>
      {brief.outline.status === "available" ? <ol className={`${styles.panel} ${styles.outline}`}>{brief.outline.items.map(section => <li key={section.id}>
        <div className={styles.outlineRow}><p>H2 · {section.h2}</p><span>{t("artifact.answers", { ids: section.answers.join(" · ") || "—" })}</span></div>
        {section.h3.length ? <ul className={styles.subheadings}>{section.h3.map(heading => <li key={heading}>H3 · {heading}</li>)}</ul> : null}
      </li>)}</ol> : <p className={styles.empty}>{t("quality.noOutline")}</p>}
    </section>

    <section data-brief-section="fields">
      <h2 className={styles.heading}>{t("quality.boundaries")}</h2>
      <dl className={styles.panel}>
        <FieldRow label={t("shared.format")}><p>{brief.format.status === "available" ? t(`quality.formatValues.${brief.format.value}`) : t("quality.formatUnavailable")}</p>{brief.format.status === "available" ? <p className={styles.note}>{t("quality.formatNote")}</p> : null}</FieldRow>
        <FieldRow label={t("shared.verdict")}><p>{t("quality.pageBoundary")}</p></FieldRow>
        <FieldRow label={t("shared.length")}><p>{t("quality.lengthBoundary")}</p></FieldRow>
      </dl>
    </section>

    <section data-brief-section="internal_links">
      <h2 className={styles.heading}>{t("shared.internalLinks")}</h2>
      {brief.internal_links.status === "available" ? brief.internal_links.items.length ? <ul className={`${styles.panel} ${styles.links}`}>{brief.internal_links.items.map(link => { const page = brief.evidence.site_index.find(page => page.id === link.page_ref); return page ? <li key={page.id}>
        <a href={page.url} target="_blank" rel="noopener noreferrer">{page.title || page.url}</a>
        <p className={styles.note}>{source(link.source)} · <time dateTime={page.observed_at}>{date(page.observed_at)}</time> · {link.why}</p>
      </li> : null; })}</ul> : <p className={styles.empty}>{t("artifact.emptyLinks")}</p> : <p className={styles.empty}>{t("quality.noSiteIndex")} <a href={visibilityHref}>{t("quality.runVisibility")}</a></p>}
    </section>

    <div className={styles.delivery}>
      {quality.status === "structure_only" ? <p className={styles.note}>{t("quality.structureDraftNote")}</p> : null}
      <div className={styles.actions}>
        {needsKnowledge ? <GeoKnowledgeRepairLink selection={repairSelection} reason={questionNeedsRevision ? "question" : "facts"} className={styles.primaryAction}>{t("quality.repairKnowledge")}</GeoKnowledgeRepairLink> : null}
        {quality.canDraft ? <a data-geo-to-draft href={localePath(locale, "/tools/content-draft")} {...TOOL_HANDOFF_LINK_PROPS} onClick={stage} onContextMenu={stage} className={needsKnowledge ? undefined : styles.primaryAction}>{t(quality.status === "structure_only" ? "quality.structureDraft" : quality.status === "limited" ? "quality.limitedDraft" : "shared.generateDraft")}</a> : null}
        <button data-copy-geo-brief type="button" onClick={() => void copyBrief()}>{copy?.fingerprint === brief.run.fingerprint && copy.ok ? t("actions.copied") : t("actions.copy")}</button>
        <button type="button" onClick={() => download(brief, "md", questionNeedsRevision)}>{t("actions.downloadMarkdown")}</button><button type="button" onClick={() => download(brief, "json", questionNeedsRevision)}>{t("actions.downloadJson")}</button>
      </div>
      {handoffFailure === brief.run.fingerprint ? <p role="alert" className={styles.error}>{t("shared.handoffFailed")}</p> : null}
      {copy?.fingerprint === brief.run.fingerprint && !copy.ok ? <p role="alert" className={styles.error}>{t("actions.copyFailed")}</p> : null}
      <p className={styles.footnote}>{t("quality.delivered", { date: date(brief.run.collected_at) })}</p>
      <details data-geo-technical className={styles.exactReferences}><summary>{t("quality.technical")}</summary><p className={styles.note}>{t("artifact.handoffNote")}</p><pre>{JSON.stringify(brief, null, 2)}</pre></details>
    </div>
  </section>;
}
