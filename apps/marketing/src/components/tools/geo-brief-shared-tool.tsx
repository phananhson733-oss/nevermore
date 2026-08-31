"use client";
// @input -- exact frozen selectors or a single-use owned-gap handoff
// @output -- the Artifact-order shared GEO brief and its same-object exports/Draft handoff
// @pos -- current /tools/geo-brief surface; legacy v1 UI remains separately exported
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GEO_CONTENT_BRIEF_SCHEMA, type GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { consumeGeoGapHandoff, type GeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";
import { sharedGeoBriefFileName, sharedGeoBriefJson, sharedGeoBriefMarkdown } from "../../lib/geo-tools/brief-shared-export.ts";
import { writeContentBriefHandoff } from "../../lib/tools/content-brief-handoff.ts";
import { TOOL_HANDOFF_LINK_PROPS } from "../../lib/tools/tool-handoff.ts";
import { localePath } from "../../lib/locale-path.ts";

interface Choice { kbId: string; snapshotId: string; revision: number; host: string; frozenAt: string; questions: { id: string; text: string; layer: string; roleId: string | null }[] }
interface Loaded { choices: Choice[]; runsPerDay: number; providerConfigured: boolean }
const PANEL = "rounded-xl border border-brand-border-card bg-brand-panel p-5";
const FIELD = "rounded-xl border border-brand-border-card bg-transparent px-3 py-2 text-[14px] text-text-dark-primary";
const BUTTON = "rounded-full bg-brand-accent px-5 py-2.5 text-[14px] text-brand-accent-contrast disabled:opacity-50";
const ERRORS = new Set(["auth_required", "auth_unavailable", "invalid_request", "not_found", "daily_limit", "provider_unconfigured", "unsupported_language", "store_unavailable", "brief_unavailable", "internal_error", "network", "gap_not_eligible", "run_evidence_unavailable", "handoff_invalid"]);
function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function failure(payload: unknown): string { const code = record(record(payload)?.error)?.code; return typeof code === "string" && ERRORS.has(code) ? code : "unknown"; }
function loaded(value: unknown): Loaded | null {
  const row = record(value); if (!row || !Array.isArray(row.choices) || typeof row.runsPerDay !== "number" || typeof row.providerConfigured !== "boolean") return null;
  const choices: Choice[] = [];
  for (const value of row.choices) {
    const choice = record(value); if (!choice || typeof choice.kbId !== "string" || typeof choice.snapshotId !== "string" || typeof choice.revision !== "number" || typeof choice.host !== "string" || typeof choice.frozenAt !== "string" || !Array.isArray(choice.questions)) return null;
    const questions: Choice["questions"] = [];
    for (const value of choice.questions) { const q = record(value); if (!q || typeof q.id !== "string" || typeof q.text !== "string" || typeof q.layer !== "string" || (q.roleId !== null && typeof q.roleId !== "string")) return null; questions.push({ id: q.id, text: q.text, layer: q.layer, roleId: q.roleId }); }
    choices.push({ kbId: choice.kbId, snapshotId: choice.snapshotId, revision: choice.revision, host: choice.host, frozenAt: choice.frozenAt, questions });
  }
  return { choices, runsPerDay: row.runsPerDay, providerConfigured: row.providerConfigured };
}
function download(brief: GeoContentBrief, extension: "md" | "json") {
  const url = URL.createObjectURL(new Blob([extension === "md" ? sharedGeoBriefMarkdown(brief) : sharedGeoBriefJson(brief)], { type: extension === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = sharedGeoBriefFileName(brief, extension); link.click(); URL.revokeObjectURL(url);
}

export function SharedGeoBriefResults({ brief }: { brief: GeoContentBrief }) {
  const t = useTranslations("tools.geoBrief"); const locale = useLocale();
  const [copy, setCopy] = useState<{ fingerprint: string; ok: boolean } | null>(null); const [handoffError, setHandoffError] = useState(false);
  const copySequence = useRef(0);
  const copyBrief = async () => { const attempt = ++copySequence.current; let ok = false; try { await navigator.clipboard.writeText(sharedGeoBriefMarkdown(brief)); ok = true; } catch { /* includes unavailable Clipboard API */ } if (attempt === copySequence.current) setCopy({ fingerprint: brief.run.fingerprint, ok }); };
  const stage = (event: React.MouseEvent<HTMLAnchorElement>) => { let ok = false; try { ok = writeContentBriefHandoff(window.sessionStorage, Date.now(), brief).ok; } catch { /* explicit visible failure */ } setHandoffError(!ok); if (!ok) event.preventDefault(); };
  const origin = brief.geo_origin;
  return <section data-shared-geo-result className="grid gap-5">
    <section data-brief-section="geo_origin" className={PANEL}>
      <h2 className="text-lg text-text-dark-primary">geo_origin · {t("shared.origin")}</h2>
      <p>{origin.question.text}</p><p className="text-sm text-text-dark-secondary">{origin.layer ?? "—"} · {origin.role ?? "—"} · {origin.gap ?? "—"}</p>
      <p data-geo-market-language className="text-sm">market: {brief.keyword.market} · language: {brief.keyword.language}</p>
      {origin.run_ref === null ? <p>{t("shared.noEvidence")}</p> : <p className="break-all font-mono text-xs">run: {origin.run_ref.id} · {origin.run_ref.fingerprint}</p>}
      <details className="mt-3"><summary>{t("shared.evidence")}</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(origin, null, 2)}</pre>
        {brief.evidence.samples.map(sample => <article key={sample.id} className="mt-3 border-t border-brand-border-card pt-2"><p className="font-mono text-xs">{sample.id} · {sample.engine} · {sample.status} · {sample.collected_at}</p><blockquote className="text-sm">{sample.excerpt}</blockquote></article>)}
      </details>
    </section>
    <section data-brief-section="lead_answer" className={PANEL}><h2 className="text-lg">lead_answer · {t("leadAnswer.title")}</h2><p className="mt-2">{brief.lead_answer.requirement}</p><p className="mt-2 text-xs">source: {t(`sources.${brief.lead_answer.source}`)}</p><p className="mt-2 text-sm">{t("leadAnswer.entities")}: {brief.lead_answer.required_entities.join(" · ") || "—"}</p></section>
    <section data-brief-section="must_answer" className={PANEL}><h2 className="text-lg">must_answer · {t("mustAnswer.title")}</h2><ul className="mt-3 grid gap-3">{brief.must_answer.items.map(item => <li key={item.id} data-must-answer={item.id}><p><span className="font-mono text-xs">{item.id}</span> · {item.q}</p><p className="text-xs text-text-dark-secondary">{t(`sources.${item.source}`)} · {item.source === "ai_sample" ? t("shared.coverage", { covered: item.covered_by, total: item.sample_total }) : item.source === "user_input" ? t("shared.manualNote") : t("shared.requirement")}</p></li>)}</ul><p className="mt-3 text-xs">{t("shared.candidates", { candidates: brief.budget.must_answer_candidates, shown: brief.budget.must_answer_shown, hidden: brief.budget.must_answer_hidden })}</p></section>
    <section data-brief-section="fact_table" className={PANEL}><h2 className="text-lg">fact_table · {t("facts.title")}</h2><p className="text-sm text-text-dark-secondary">{t("facts.note")}</p><ul className="mt-3">{brief.fact_table.map(fact => <li className="border-t border-brand-border-card py-3" key={fact.id}><p>{fact.label}: {fact.value ?? `null · ${fact.reason}`}</p>{fact.evidence_refs.map(id => { const receipt = brief.evidence.facts.find(item => item.id === id); return receipt ? <p className="mt-1 text-xs text-text-dark-secondary" key={id}>{id} · {t(`sources.${receipt.source}`)} · <time dateTime={receipt.observed_at}>{receipt.observed_at}</time> {receipt.url ? <a className="underline" href={receipt.url} target="_blank" rel="noopener noreferrer">{receipt.url}</a> : null}</p> : null; })}</li>)}</ul></section>
    <section data-brief-section="outline" className={PANEL}><h2 className="text-lg">outline · {t("outline.title")}</h2>{brief.outline.status === "available" ? <ol className="mt-3 grid gap-3">{brief.outline.items.map(section => <li key={section.id}><p>{section.h2}</p><p className="text-xs">source: {t("sources.model")} · {section.answers.join(" · ") || "—"}</p>{section.h3.map(heading => <p key={heading} className="ml-3 text-sm">{heading}</p>)}</li>)}</ol> : <p>{t("shared.unavailable", { reason: brief.outline.reason })}</p>}</section>
    <section data-brief-section="fields" className={PANEL}><dl className="grid gap-2 text-sm"><div><dt>{t("shared.format")}</dt><dd>{brief.format.status === "available" ? `${brief.format.value} · ${brief.format.reason} · ${brief.format.provenance.origin}` : t("shared.unavailable", { reason: brief.format.reason })}</dd></div><div><dt>{t("shared.verdict")}</dt><dd>{brief.verdict.action} · {brief.verdict.reason}</dd></div><div><dt>{t("shared.length")}</dt><dd>{t("shared.unavailable", { reason: brief.length.reason })}</dd></div></dl></section>
    <section data-brief-section="internal_links" className={PANEL}><h2 className="text-lg">{t("shared.internalLinks")}</h2>{brief.internal_links.status === "available" ? <ul>{brief.internal_links.items.map(link => { const page = brief.evidence.site_index.find(page => page.id === link.page_ref); return page ? <li key={page.id}><a href={page.url} target="_blank" rel="noopener noreferrer" className="underline">{page.title || page.url}</a><p className="text-xs">site_index · {page.observed_at}</p></li> : null; })}</ul> : <p>{t("shared.unavailable", { reason: brief.internal_links.reason })}</p>}</section>
    <p className="text-sm">{t("shared.readiness", { count: brief.draft_readiness.writable.length })}</p>
    <div className="flex flex-wrap gap-3">
      {brief.draft_readiness.writable.length ? <a data-geo-to-draft href={localePath(locale, "/tools/content-draft")} {...TOOL_HANDOFF_LINK_PROPS} onClick={stage} onContextMenu={stage} className={BUTTON}>{t("shared.generateDraft")}</a> : null}
      <button data-copy-geo-brief type="button" onClick={() => void copyBrief()}>{copy?.fingerprint === brief.run.fingerprint && copy.ok ? t("actions.copied") : t("actions.copy")}</button>
      <button type="button" onClick={() => download(brief, "md")}>{t("actions.downloadMarkdown")}</button><button type="button" onClick={() => download(brief, "json")}>{t("actions.downloadJson")}</button>
    </div>
    {handoffError ? <p role="alert">{t("shared.handoffFailed")}</p> : null}{copy?.fingerprint === brief.run.fingerprint && !copy.ok ? <p role="alert">{t("actions.copyFailed")}</p> : null}
    <p className="break-all font-mono text-xs">{brief.schema} · {brief.run.collected_at} · {brief.run.fingerprint}</p>
  </section>;
}

export function GeoBriefSharedTool() {
  const t = useTranslations("tools.geoBrief");
  const [choices, setChoices] = useState<Loaded | null>(null); const [snapshotId, setSnapshotId] = useState(""); const [questionId, setQuestionId] = useState<string | null>(null); const [manual, setManual] = useState("");
  const [handoff, setHandoff] = useState<GeoGapHandoff | null>(null); const [brief, setBrief] = useState<GeoContentBrief | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const started = useRef(false);
  const choice = useMemo(() => choices?.choices.find(item => item.snapshotId === snapshotId) ?? null, [choices, snapshotId]);
  const loadChoices = useCallback(async (pointer: GeoGapHandoff | null = null) => {
    setBusy(true); setError(null); setBrief(null);
    try { const response = await fetch("/api/tools/geo-brief/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pointer === null ? {} : { schema: GEO_CONTENT_BRIEF_SCHEMA, kbId: pointer.kbId, snapshotId: pointer.snapshotId }) }); const payload: unknown = await response.json(); const data = response.ok ? loaded(record(payload)?.data) : null;
      if (data === null) { setError(failure(payload)); return; }
      const first = pointer === null ? data.choices[0] : data.choices.find(item => item.kbId === pointer.kbId && item.snapshotId === pointer.snapshotId);
      if (pointer && (!first || !first.questions.some(question => question.id === pointer.questionId))) { setError("handoff_invalid"); return; }
      setChoices(data); setSnapshotId(first?.snapshotId ?? ""); setQuestionId(pointer?.questionId ?? first?.questions[0]?.id ?? null); setHandoff(pointer);
    } catch { setError("network"); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (started.current) return; started.current = true; try { const pointer = consumeGeoGapHandoff(window.sessionStorage); if (pointer) void loadChoices(pointer); } catch { /* manual entrance remains usable */ } }, [loadChoices]);
  const run = async () => {
    if (!choice || (questionId === null && !manual.trim())) return;
    setBusy(true); setError(null); setBrief(null);
    try { const response = await fetch("/api/tools/geo-brief/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schema: GEO_CONTENT_BRIEF_SCHEMA, kbId: choice.kbId, snapshotId: choice.snapshotId, questionId, manualQuestion: questionId === null ? manual.trim() : null, runId: handoff?.runId ?? null, gapId: handoff?.gapId ?? null }) }); const payload: unknown = await response.json();
      if (!response.ok) { setError(failure(payload)); return; } const parsed = await parseGeoContentBrief(record(record(payload)?.data)?.brief); if (!parsed.ok) { setError("brief_unavailable"); return; } setBrief(parsed.value);
    } catch { setError("network"); } finally { setBusy(false); }
  };
  return <div className="mt-8 grid gap-6" aria-busy={busy}>
    {!choices ? <button type="button" data-load-geo-brief disabled={busy} onClick={() => void loadChoices()} className={BUTTON}>{t(busy ? "form.loading" : "form.load")}</button> : null}
    {choices?.choices.length === 0 ? <p>{t("form.noFrozen")}</p> : null}
    {choice ? <section className={`${PANEL} grid gap-4`}><label className="grid gap-2">{t("form.version")}<select disabled={busy} className={FIELD} value={snapshotId} onChange={event => { const next = choices?.choices.find(item => item.snapshotId === event.target.value); setSnapshotId(event.target.value); setQuestionId(next?.questions[0]?.id ?? null); setHandoff(null); setBrief(null); }}>{choices?.choices.map(item => <option key={item.snapshotId} value={item.snapshotId}>{item.host} · v{item.revision}</option>)}</select></label>
      <label className="grid gap-2">{t("form.question")}<select disabled={busy} className={FIELD} value={questionId ?? ""} onChange={event => { setQuestionId(event.target.value || null); setHandoff(null); setBrief(null); }}>{choice.questions.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}<option value="">{t("form.typeYourOwn")}</option></select></label>
      {questionId === null ? <label className="grid gap-2">{t("form.typedQuestion")}<textarea disabled={busy} className={FIELD} maxLength={300} value={manual} onChange={event => { setManual(event.target.value); setBrief(null); }} /><span className="text-xs">{t("shared.manualNote")}</span></label> : <p className="text-sm">{t("shared.role")}: {choice.questions.find(item => item.id === questionId)?.roleId ?? "—"}</p>}
      <p className="text-xs">{handoff ? `run: ${handoff.runId}` : t("shared.noEvidence")}</p><p className="text-xs">{t("shared.estimate")}</p>
      <button data-run-geo-brief type="button" className={BUTTON} disabled={busy || !choices?.providerConfigured || (questionId === null && !manual.trim())} onClick={() => void run()}>{t(busy ? "form.submitting" : "form.submit")}</button>{!choices?.providerConfigured ? <p>{t("errors.provider_unconfigured")}</p> : null}
    </section> : null}
    {error ? <p role="alert" className="text-brand-error">{t(`errors.${error}`, { limit: choices?.runsPerDay ?? 20 })}</p> : null}
    {brief ? <SharedGeoBriefResults brief={brief} /> : null}
  </div>;
}
