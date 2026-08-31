"use client";
// @input -- one parsed, immutable GEO ContentBrief and an optional frozen role display label
// @output -- Artifact-order evidence panels and unchanged copy/download/Draft projections
// @pos -- GEO Brief result presentation only; no generation or contract mutation
import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { GeoContentBrief, GeoSource } from "@sf/public-tools/content-brief/geo-contract";
import { sharedGeoBriefFileName, sharedGeoBriefJson, sharedGeoBriefMarkdown } from "../../lib/geo-tools/brief-shared-export.ts";
import { writeContentBriefHandoff } from "../../lib/tools/content-brief-handoff.ts";
import { TOOL_HANDOFF_LINK_PROPS } from "../../lib/tools/tool-handoff.ts";
import { localePath } from "../../lib/locale-path.ts";
import styles from "./geo-brief-results.module.css";

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.fieldRow}><dt>{label}</dt><dd>{children}</dd></div>;
}

function download(brief: GeoContentBrief, extension: "md" | "json") {
  const url = URL.createObjectURL(new Blob([extension === "md" ? sharedGeoBriefMarkdown(brief) : sharedGeoBriefJson(brief)], { type: extension === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = sharedGeoBriefFileName(brief, extension); link.click(); URL.revokeObjectURL(url);
}

export function SharedGeoBriefResults({ brief, roleLabel }: { brief: GeoContentBrief; roleLabel?: string }) {
  const t = useTranslations("tools.geoBrief"); const locale = useLocale(); const id = useId();
  const [copy, setCopy] = useState<{ fingerprint: string; ok: boolean } | null>(null);
  const [handoffFailure, setHandoffFailure] = useState<string | null>(null);
  const copySequence = useRef(0);
  const copyBrief = async () => {
    const attempt = ++copySequence.current; let ok = false;
    try { await navigator.clipboard.writeText(sharedGeoBriefMarkdown(brief)); ok = true; } catch { /* Includes an unavailable Clipboard API. */ }
    if (attempt === copySequence.current) setCopy({ fingerprint: brief.run.fingerprint, ok });
  };
  const stage = (event: MouseEvent<HTMLAnchorElement>) => {
    let ok = false;
    try { ok = writeContentBriefHandoff(window.sessionStorage, Date.now(), brief).ok; } catch { /* Show storage failures before navigation. */ }
    setHandoffFailure(ok ? null : brief.run.fingerprint);
    if (!ok) event.preventDefault();
  };
  const source = (value: GeoSource | "model") => <span className={styles.source} data-source={value} title={t(`sources.${value}`)}>{value}</span>;
  const origin = brief.geo_origin;
  const failedSamples = brief.evidence.samples.filter(sample => sample.status === "failed").length;
  return <section data-shared-geo-result className={styles.results}>
    <section data-brief-section="geo_origin">
      <h2 className={styles.heading}>geo_origin · {t("shared.origin")}</h2>
      <dl className={styles.panel}>
        <FieldRow label={t("artifact.questionLayerGap")}>
          <p className={styles.value}>{origin.question.text} · {origin.layer ?? "—"} · gap {origin.gap ?? "—"}</p>
          <p className={styles.note}>{t("shared.role")}: {roleLabel || origin.role || "—"}</p>
          <p data-geo-market-language className={styles.note}>market: {brief.keyword.market} · language: {brief.keyword.language}</p>
        </FieldRow>
        <FieldRow label={t("artifact.evidencePointer")}>
          {origin.run_ref === null ? <p className={styles.note}>{t("shared.noEvidence")}</p> : <p className={styles.value}>run: {origin.run_ref.id}</p>}
          {brief.evidence.samples.length ? <div className={styles.receipts}>{brief.evidence.samples.map(sample => <details key={sample.id} className={styles.receipt}>
            <summary>{sample.id} · {sample.engine} · {sample.status}</summary>
            <p className={styles.note}><time dateTime={sample.collected_at}>{sample.collected_at}</time> · search_enabled: {String(sample.search_enabled)}</p>
            {sample.excerpt ? <blockquote>{sample.excerpt}</blockquote> : null}
            <p className={styles.note}>{t("artifact.sampleTopics")}: {sample.topics.join(" · ") || "—"}</p>
          </details>)}</div> : <p className={styles.note}>{t("artifact.noSamples")}</p>}
        </FieldRow>
        <FieldRow label={t("artifact.versionAnchor")}>
          <p className={styles.value}>kb@v{origin.kb_ref.revision} · {origin.promptset_ref.schema} · {origin.promptset_ref.registry_version}</p>
          <p className={styles.note}>{t("artifact.versionAnchorNote")}</p>
          <details className={styles.exactReferences}><summary>{t("artifact.exactReferences")}</summary><pre>{JSON.stringify(origin, null, 2)}</pre></details>
        </FieldRow>
      </dl>
    </section>

    <section data-brief-section="lead_answer">
      <div className={styles.sectionHeading}><h2 className={styles.heading}>lead_answer · {t("leadAnswer.title")}</h2><p className={styles.note}>source: {source(brief.lead_answer.source)} · {t("artifact.leadAnswerNote", { id: brief.lead_answer.question_id })}</p></div>
      <dl className={styles.panel}>
        <FieldRow label="requirement"><p className={styles.value}>{brief.lead_answer.requirement}</p>{brief.lead_answer.source === "user_input" ? <p className={styles.note}>{t("shared.manualNote")}</p> : null}</FieldRow>
        <FieldRow label="required_entities"><ul className={styles.chips} aria-label={t("leadAnswer.entities")}>{brief.lead_answer.required_entities.length ? brief.lead_answer.required_entities.map(entity => <li key={entity}>{entity}</li>) : <li>—</li>}</ul></FieldRow>
      </dl>
    </section>

    <section data-brief-section="must_answer">
      <div className={styles.sectionHeading}><h2 id={`${id}-questions`} className={styles.heading}>must_answer · {t("artifact.mustAnswerCount", { count: brief.must_answer.items.length })}</h2><p className={styles.note}>{t("artifact.mustAnswerNote")}</p></div>
      <div className={styles.tableScroll} role="region" aria-labelledby={`${id}-questions`} tabIndex={0}>
        <table className={`${styles.table} ${styles.questions}`} aria-labelledby={`${id}-questions`}>
          <thead><tr><th scope="col">id</th><th scope="col">{t("artifact.questionColumn")}</th><th scope="col">{t("artifact.coverageColumn")}</th><th scope="col">{t("artifact.sourceColumn")}</th></tr></thead>
          <tbody>{brief.must_answer.items.map(item => <tr key={item.id} data-must-answer={item.id}>
            <th scope="row">{item.id}</th><td>{item.q}</td>
            <td>{item.source === "ai_sample" ? t("shared.coverage", { covered: item.covered_by, total: item.sample_total }) : item.source === "user_input" ? t("sources.user_input") : t("shared.requirement")}</td>
            <td>{source(item.source)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className={styles.footnote}>{t("shared.candidates", { candidates: brief.budget.must_answer_candidates, shown: brief.must_answer.items.length, hidden: brief.budget.must_answer_hidden })}{failedSamples ? ` · ${t("artifact.failedSamples", { count: failedSamples })}` : ""}</p>
    </section>

    <section data-brief-section="fact_table">
      <div className={styles.sectionHeading}><h2 id={`${id}-facts`} className={styles.heading}>fact_table · {t("facts.title")}</h2><p className={styles.note}>{t("facts.note")}</p></div>
      <div className={styles.tableScroll} role="region" aria-labelledby={`${id}-facts`} tabIndex={0}>
        <table className={`${styles.table} ${styles.facts}`} aria-labelledby={`${id}-facts`}>
          <thead><tr><th scope="col">{t("artifact.dimensionColumn")}</th><th scope="col">own</th><th scope="col">{t("artifact.sourceColumn")}</th></tr></thead>
          <tbody>{brief.fact_table.length ? brief.fact_table.map(fact => <tr key={fact.id}>
            <th scope="row">{fact.label}</th><td>{fact.value ?? "—"}</td>
            <td>{fact.value === null ? <p className={styles.nullFact}><span>null · {fact.reason}</span><span>{t("facts.notVerified", { reason: fact.reason ?? "—" })}</span></p> : null}
              {fact.evidence_refs.map(ref => { const receipt = brief.evidence.facts.find(item => item.id === ref); return receipt ? <div key={ref} className={styles.factReceipt}>
                <p>{source(receipt.source)} · {ref} · <time dateTime={receipt.observed_at}>{receipt.observed_at}</time></p>
                {receipt.url ? <a href={receipt.url} target="_blank" rel="noopener noreferrer">{receipt.url}</a> : null}
              </div> : null; })}
              {fact.value !== null && fact.evidence_refs.length === 0 ? "—" : null}
            </td>
          </tr>) : <tr><td colSpan={3}>{t("artifact.emptyFacts")}</td></tr>}</tbody>
        </table>
      </div>
    </section>

    <section data-brief-section="outline">
      <div className={styles.sectionHeading}><h2 className={styles.heading}>outline</h2><p className={styles.note}>{t("artifact.outlineNote")}</p></div>
      {brief.outline.status === "available" ? <ol className={`${styles.panel} ${styles.outline}`}>{brief.outline.items.map(section => <li key={section.id}>
        <div className={styles.outlineRow}><p>H2 · {section.h2}</p><span>{t("artifact.answers", { ids: section.answers.join(" · ") || "—" })}</span></div>
        {section.h3.length ? <ul className={styles.subheadings}>{section.h3.map(heading => <li key={heading}>H3 · {heading}</li>)}</ul> : null}
      </li>)}</ol> : <p className={styles.empty}>{t("shared.unavailable", { reason: brief.outline.reason })}</p>}
    </section>

    <section data-brief-section="fields">
      <h2 className={styles.heading}>{t("artifact.fieldsTitle")}</h2>
      <dl className={styles.panel}>
        <FieldRow label={t("shared.format")}><p>{brief.format.status === "available" ? <>{brief.format.value} · {brief.format.reason} · {source(brief.format.provenance.origin)}</> : t("shared.unavailable", { reason: brief.format.reason })}</p></FieldRow>
        <FieldRow label={t("shared.verdict")}><p>{brief.verdict.action} · {brief.verdict.reason}</p></FieldRow>
        <FieldRow label={t("shared.length")}><p>{t("shared.unavailable", { reason: brief.length.reason })}</p></FieldRow>
      </dl>
    </section>

    <section data-brief-section="internal_links">
      <h2 className={styles.heading}>internal_links · {t("shared.internalLinks")}</h2>
      {brief.internal_links.status === "available" ? brief.internal_links.items.length ? <ul className={`${styles.panel} ${styles.links}`}>{brief.internal_links.items.map(link => { const page = brief.evidence.site_index.find(page => page.id === link.page_ref); return page ? <li key={page.id}>
        <a href={page.url} target="_blank" rel="noopener noreferrer">{page.title || page.url}</a>
        <p className={styles.note}>{source(link.source)} · <time dateTime={page.observed_at}>{page.observed_at}</time> · {link.why}</p>
      </li> : null; })}</ul> : <p className={styles.empty}>{t("artifact.emptyLinks")}</p> : <p className={styles.empty}>{t("shared.unavailable", { reason: brief.internal_links.reason })}</p>}
    </section>

    <div className={styles.delivery}>
      <p className={styles.note}>{t("shared.readiness", { count: brief.draft_readiness.writable.length })}</p>
      <div className={styles.actions}>
        {brief.draft_readiness.writable.length ? <a data-geo-to-draft href={localePath(locale, "/tools/content-draft")} {...TOOL_HANDOFF_LINK_PROPS} onClick={stage} onContextMenu={stage} className={styles.primaryAction}>{t("shared.generateDraft")}</a> : null}
        <button data-copy-geo-brief type="button" onClick={() => void copyBrief()}>{copy?.fingerprint === brief.run.fingerprint && copy.ok ? t("actions.copied") : t("actions.copy")}</button>
        <button type="button" onClick={() => download(brief, "md")}>{t("actions.downloadMarkdown")}</button><button type="button" onClick={() => download(brief, "json")}>{t("actions.downloadJson")}</button>
      </div>
      {handoffFailure === brief.run.fingerprint ? <p role="alert" className={styles.error}>{t("shared.handoffFailed")}</p> : null}
      {copy?.fingerprint === brief.run.fingerprint && !copy.ok ? <p role="alert" className={styles.error}>{t("actions.copyFailed")}</p> : null}
      <p className={styles.footnote}>{t("artifact.handoffNote")}</p>
      <p className={styles.fingerprint}>{brief.schema} · {brief.run.collected_at} · {brief.run.fingerprint}</p>
    </div>
  </section>;
}
