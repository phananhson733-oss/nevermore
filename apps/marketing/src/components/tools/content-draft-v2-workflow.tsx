// @input -- one exact confirmed Brief v2 revision and the parent's explicit sign-in handoff callback
// @output -- received-brief summary, explicit generation choices and result-focused bounded reruns
// @pos -- independent v2 workflow; never converts a confirmed envelope into a legacy Brief
"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { DRAFT_V2_REQUEST_MAX_BYTES, DRAFT_V2_SECTION_REQUEST_MAX_BYTES, type DraftResultV2, type DraftV2Settings } from "@sf/public-tools/content-brief/v2-draft-contract";
import { parseDraftResultV2 } from "@sf/public-tools/content-brief/v2-draft";
import { DRAFT_TOTAL_BUDGET_MS, SECTION_ENDPOINT_BUDGET_MS, SECTION_RERUN_SOFT_MAX } from "@sf/public-tools/content-brief/constants";
import { SignInDialog } from "../auth/sign-in-dialog";
import { PERSONS, PRODUCT_MENTIONS, TONES, isContentDraftErrorCode } from "./content-draft-codes";
import { ACTION_BUTTON, PRIMARY_ACTION_BUTTON, BODY_TEXT, ID_CHIP, safePageUrl } from "./content-brief-results-shared";
import { ContentDraftV2Results } from "./content-draft-v2-results";
import styles from "./content-draft-v2-presentation.module.css";

const DEFAULT_SETTINGS: DraftV2Settings = { tone: "explanatory", person: "second", product_mention: "gap_only" };
const PANEL = "rounded-[4px] border border-brand-border-card bg-brand-panel p-4 md:p-5";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.08em] text-text-dark-secondary";
const FIELD = "mt-2 h-11 w-full rounded-[4px] border border-brand-border-strong bg-brand-bg px-3 text-[13px] text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";
type ErrorState = { readonly code: string; readonly retry: number | null; readonly kb: number };
function sameSettings(a: DraftV2Settings, b: DraftV2Settings) { return a.tone === b.tone && a.person === b.person && a.product_mention === b.product_mention; }
function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const error = body.error;
  if (typeof error === "string") return error;
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

export function ContentDraftV2Workflow({ confirmed, source, locale, authenticated, onReplace, onKeepForSignIn }: {
  readonly confirmed: ConfirmedBriefV2;
  readonly source: "handoff" | "paste" | "upload";
  readonly locale: string;
  readonly authenticated: boolean;
  readonly onReplace: () => void;
  readonly onKeepForSignIn: () => boolean;
}) {
  const t = useTranslations("tools.contentDraft.v2");
  const base = useTranslations("tools.contentDraft");
  const [settings, setSettings] = useState<DraftV2Settings>(DEFAULT_SETTINGS);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const settingsId = useId();
  const [selected, setSelected] = useState(() => new Set(confirmed.outline.map((section) => section.id)));
  const [result, setResult] = useState<DraftResultV2 | null>(null);
  const [busy, setBusy] = useState(false);
  const [runningSection, setRunningSection] = useState<string | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [selectionError, setSelectionError] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [keepFailed, setKeepFailed] = useState(false);
  const [rerunsUsed, setRerunsUsed] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const rerunsSpent = useRef(0);
  const resultRegion = useRef<HTMLDivElement | null>(null);

  // The intake owner keys this component by confirmed fingerprint. A revision
  // change or unmount invalidates both HTTP work and asynchronous hash checks.
  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    return () => { mounted.current = false; generation.current += 1; active.current?.abort(); active.current = null; };
  }, [confirmed.fingerprint]);

  const onSignedIn = useCallback((): boolean | void => {
    if (!mounted.current) return;
    try { const kept = onKeepForSignIn(); if (!kept) { setKeepFailed(true); setSettingsExpanded(true); } return kept; }
    catch { setKeepFailed(true); setSettingsExpanded(true); return false; }
  }, [onKeepForSignIn]);

  const visibleResult = result?.confirmed_ref.fingerprint === confirmed.fingerprint ? result : null;
  useEffect(() => { if (visibleResult !== null) resultRegion.current?.focus(); }, [visibleResult]);
  const settingsChanged = visibleResult !== null && !sameSettings(settings, visibleResult.settings);
  const plan = confirmed.brief.generated?.page_plan;
  const action = confirmed.resolution === "create_despite_uncertainty" ? "create" : plan?.action;
  const target = confirmed.brief.context.research.pages.find((page) => page.id === plan?.target_ref);
  const targetUrl = target === undefined ? null : safePageUrl(target.final_url);
  const gapId = confirmed.brief.generated?.gap_angle == null ? null : confirmed.brief.generated.research.outline.at(-1)?.id;

  async function generate(sectionId?: string) {
    if (!mounted.current || active.current !== null) return;
    const previous = sectionId === undefined ? null : visibleResult;
    if (sectionId !== undefined && (previous === null || settingsChanged || rerunsSpent.current >= SECTION_RERUN_SOFT_MAX || !previous.sections.some((section) => section.id === sectionId))) return;
    const sectionIds = confirmed.outline.filter((section) => selected.has(section.id)).map((section) => section.id);
    if (sectionId === undefined && sectionIds.length === 0) { setSelectionError(true); setSettingsExpanded(true); return; }
    const controller = new AbortController(); const gen = generation.current;
    active.current = controller; setBusy(true); setRunningSection(sectionId ?? null); setError(null); setSelectionError(false);
    const current = () => mounted.current && generation.current === gen && active.current === controller;
    const usable = () => current() && !controller.signal.aborted;
    const budget = sectionId === undefined ? DRAFT_TOTAL_BUDGET_MS : SECTION_ENDPOINT_BUDGET_MS;
    const limit = sectionId === undefined ? DRAFT_V2_REQUEST_MAX_BYTES : DRAFT_V2_SECTION_REQUEST_MAX_BYTES;
    const fail = (code: string, retry: number | null = null) => { setError({ code, retry, kb: Math.round(limit / 1024) }); setSettingsExpanded(true); };
    const timer = window.setTimeout(() => { if (current()) { controller.abort(); fail("timeout"); setBusy(false); setRunningSection(null); active.current = null; } }, budget + 10_000);
    try {
      let session: Response; let sessionBody: unknown;
      try { session = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal }); sessionBody = await session.json(); }
      catch { if (usable()) fail("auth_unavailable"); return; }
      if (!usable()) return;
      if (!session.ok || typeof sessionBody !== "object" || sessionBody === null || !("signedIn" in sessionBody) || typeof sessionBody.signedIn !== "boolean") { fail("auth_unavailable"); return; }
      if (!sessionBody.signedIn) { setSignInOpen(true); return; }
      const body = JSON.stringify(previous === null ? { brief: confirmed, settings, section_ids: sectionIds } : { brief: confirmed, section_id: sectionId, previous });
      if (new TextEncoder().encode(body).length > limit) { fail("payload_too_large"); return; }
      if (previous !== null) { rerunsSpent.current += 1; setRerunsUsed(rerunsSpent.current); }
      const response = await fetch(previous === null ? "/api/tools/content-draft/run" : "/api/tools/content-draft/section", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
      const payload: unknown = await response.json();
      if (!usable()) return;
      if (!response.ok) {
        const code = errorCode(payload); const rawRetry = response.headers.get("Retry-After"); const retry = rawRetry === null ? NaN : Number(rawRetry);
        fail(code !== null && isContentDraftErrorCode(code) ? code : "unknown", Number.isSafeInteger(retry) && retry > 0 ? retry : null);
        if (code === "auth_required") setSignInOpen(true);
        return;
      }
      const parsed = await parseDraftResultV2(payload, confirmed, previous ?? undefined);
      if (!usable()) return;
      if (!parsed.ok) { fail("invalid_result"); return; }
      const next = parsed.value;
      const matchingRun = previous !== null ? next.run.rerun?.section_id === sectionId : next.run.rerun === null && sameSettings(next.settings, settings) && next.sections.every((section) => selected.has(section.id) === (section.status !== "skipped"));
      if (!matchingRun) { fail("invalid_result"); return; }
      setResult(next);
      setSettingsExpanded(next.run.reads.sections.ok === 0);
      if (previous === null) { rerunsSpent.current = 0; setRerunsUsed(0); }
    } catch { if (usable()) fail("unknown"); }
    finally { window.clearTimeout(timer); if (current()) { active.current = null; setBusy(false); setRunningSection(null); } }
  }

  function errorText(value: ErrorState) {
    if (value.code === "invalid_result" || value.code === "timeout" || value.code === "brief_schema_mismatch" || value.code === "brief_reference_invalid" || value.code === "brief_fingerprint_mismatch") return t(`errors.${value.code}`);
    if (value.retry !== null && (value.code === "rate_limited" || value.code === "run_in_progress")) return base(`errorsWithRetry.${value.code}`, { seconds: value.retry });
    return base(`errors.${isContentDraftErrorCode(value.code) ? value.code : "unknown"}`, { kb: value.kb });
  }

  return <div id="content-draft-tool" data-draft-v2-workflow data-locale={locale} aria-busy={busy} className={`${styles.workflow} mx-auto max-w-[880px] space-y-6 break-words`}>
    <section className={`${PANEL} ${styles.received}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className={LABEL}>{t("confirmed")}</div><h2 className="mt-2 text-[22px] font-semibold tracking-tight text-text-dark-primary">{confirmed.brief.context.input.primary}</h2><p data-confirmed-revision className={`mt-2 ${BODY_TEXT}`}>{t("revision", { revision: confirmed.revision })} · {t(`source.${source}`)} · {confirmed.brief.context.input.language}</p></div>
        <button type="button" data-replace-brief className={ACTION_BUTTON} disabled={busy} onClick={() => { if (active.current === null) onReplace(); }}>{base("intake.replace")}</button>
      </div>
      <dl className={styles.receivedGrid}>
        <div><dt>{t("received.action")}</dt><dd data-page-action>{t(action === "update" ? "update" : "create")}</dd></div>
        <div><dt>{t("received.questions")}</dt><dd data-received-question-count>{confirmed.brief.generated?.research.questions.length ?? 0}</dd></div>
        <div><dt>{t("received.outline")}</dt><dd data-received-outline-count>{confirmed.outline.length}</dd></div>
        <div><dt>{t("received.language")}</dt><dd>{confirmed.brief.context.input.market} · {confirmed.brief.context.input.language}</dd></div>
      </dl>
      {confirmed.resolution === "create_despite_uncertainty" ? <p className={`mt-1 ${BODY_TEXT}`}>{t("explicitCreate")}</p> : null}
      {targetUrl !== null ? <a data-target-page href={targetUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-[12px] text-brand-accent-text underline">{targetUrl}</a> : null}
      {action === "update" && plan !== undefined ? <ol data-rewrite-plan className="mt-3 space-y-2 text-[12px] text-text-dark-secondary">{plan.steps.map((step, index) => <li key={index}><span className={ID_CHIP}>{t(`steps.${step.kind}`)}</span> {step.instruction}</li>)}</ol> : null}
      <details className="mt-4"><summary className="cursor-pointer text-[11px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">{t("viewFullBrief")}</summary><p className="mt-2 break-all font-mono text-[10px] text-text-dark-secondary">{t("confirmedReceipt")} · {confirmed.fingerprint}</p><pre data-confirmed-brief-json className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[4px] bg-brand-panel-sunken p-3 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary">{JSON.stringify(confirmed)}</pre></details>
    </section>

    <section className={PANEL} aria-busy={busy}>
      <h2><button type="button" data-toggle-settings aria-expanded={settingsExpanded} aria-controls={settingsId} disabled={busy} onClick={() => setSettingsExpanded((expanded) => !expanded)} className="flex w-full items-center justify-between gap-3 text-left text-[15px] font-semibold text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60">{t("runSettings")}<span aria-hidden="true">{settingsExpanded ? "−" : "+"}</span></button></h2>
      <div id={settingsId} data-draft-settings-panel hidden={!settingsExpanded}>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {([{ field: "tone", label: "tone", values: TONES }, { field: "person", label: "person", values: PERSONS }] as const).map(({ field, label, values }) => <label key={field} className="block"><span className={LABEL}>{base(`settings.${label}.label`)}</span><select data-setting={field} value={settings[field]} disabled={busy} className={FIELD} onChange={(event) => { if (active.current === null) setSettings({ ...settings, [field]: event.target.value }); }}>{values.map((value) => <option key={value} value={value}>{base(`settings.${label}.${value}` as Parameters<typeof base>[0])}</option>)}</select></label>)}
      </div>
      <fieldset className="mt-5" disabled={busy}><legend className={LABEL}>{base("settings.productMention.label")}</legend><div className={styles.mentionChoices}>{PRODUCT_MENTIONS.map((value) => <label key={value} className={styles.mentionChoice}><input type="radio" name="product_mention" value={value} checked={settings.product_mention === value} onChange={() => { if (active.current === null) setSettings((current) => ({ ...current, product_mention: value })); }} /><span><strong>{base(`settings.productMention.${value}`)}</strong><small>{t(`mentionNotes.${value}`)}</small></span></label>)}</div></fieldset>
      <p className={`mt-3 ${BODY_TEXT}`}>{gapId ? base("settings.productMention.help", { section: gapId }) : base("settings.productMention.helpNoGap")}</p>
      {settings.product_mention === "throughout" ? <p className="mt-1 text-[11.5px] text-brand-warning">{base("settings.productMention.helpThroughout")}</p> : null}
      <fieldset className="mt-4" disabled={busy}><legend className={LABEL}>{base("settings.sections.label")}</legend><p className={`mt-2 ${BODY_TEXT}`}>{t("sectionsHelp")}</p><div className="mt-3 space-y-2">{confirmed.outline.map((section) => <label key={section.id} className="flex items-start gap-3 rounded-[4px] border border-brand-border-card px-3 py-2.5"><input data-section-checkbox={section.id} type="checkbox" checked={selected.has(section.id)} disabled={busy} className="mt-1 accent-brand-accent" onChange={(event) => { if (active.current !== null) return; const checked = event.target.checked; setSelected((current) => { const next = new Set(current); if (checked) next.add(section.id); else next.delete(section.id); return next; }); setSelectionError(false); }} /><span className="min-w-0"><span className="text-[13px] font-semibold text-text-dark-primary">{section.id} · {section.h2}</span><span className="mt-1 block text-[11px] text-text-dark-secondary">{base("settings.sections.answers", { ids: section.answers.join(", ") })}{section.id === gapId ? ` · ${base("settings.sections.gapAngleHere")}` : ""}</span></span></label>)}</div></fieldset>
      {settingsChanged ? <p data-settings-changed className="mt-3 text-[12px] text-brand-warning">{t("settingsChanged")}</p> : null}
      {selectionError ? <p role="alert" className="mt-3 text-[12px] text-brand-error">{base("validation.sectionsRequired")}</p> : null}
      {error !== null ? <p role="alert" data-error-code={error.code} className="mt-3 text-[12px] text-brand-error">{errorText(error)}</p> : null}
      {keepFailed ? <p data-keep-failed role="status" className={`mt-3 ${BODY_TEXT}`}>{base("intake.handoffKeepFailed")}</p> : null}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-brand-border-card pt-4"><button type="button" data-generate-draft disabled={busy} className={PRIMARY_ACTION_BUTTON} onClick={() => void generate()}>{base(busy ? "actions.running" : "actions.run")}</button><span className="text-[11.5px] text-text-dark-secondary">{authenticated ? t("runNote") : t("signInNote")}</span></div>
      {busy ? <p role="status" className={`mt-3 ${BODY_TEXT}`}>{t(runningSection === null ? "generating" : "rerunning", { section: runningSection ?? "", budget: Math.round((runningSection === null ? DRAFT_TOTAL_BUDGET_MS : SECTION_ENDPOINT_BUDGET_MS) / 1000) })}</p> : null}
      </div>
    </section>
    {visibleResult !== null ? <div ref={resultRegion} data-draft-result-region role="region" aria-label={t("resultRegion")} tabIndex={-1} className="min-w-0 space-y-3 scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"><p className="text-[11.5px] text-text-dark-secondary">{base("doc.rerunsUsed", { used: rerunsUsed, max: SECTION_RERUN_SOFT_MAX })}</p><ContentDraftV2Results confirmed={confirmed} result={visibleResult} locale={locale} rerun={{ disabled: busy || settingsChanged || rerunsUsed >= SECTION_RERUN_SOFT_MAX, running: busy, runningSection, onRerun: (id) => void generate(id) }} /></div> : null}
    <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} onSignedIn={onSignedIn} />
  </div>;
}
