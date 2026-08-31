// @input -- an immutable parsed Brief v2 and a parent confirmation callback
// @output -- editable heading/order draft and an exact explicitly confirmed revision
// @pos -- browser-local confirmation/export and explicit one-time Draft handoff; no provider calls
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { confirmBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { isBoundedModelText } from "@sf/public-tools/content-brief/text";
import type { ResearchOutlineItem } from "@sf/public-tools/content-brief/v2-contract";
import type { ConfirmedBriefV2, ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { ACTION_BUTTON, BODY_TEXT, PRIMARY_ACTION_BUTTON, SECTION_TITLE } from "./content-brief-results-shared.ts";
import { localePath } from "../../lib/locale-path.ts";
import { clearMatchingContentBriefHandoff } from "../../lib/tools/content-brief-handoff.ts";
import { writeConfirmedBriefHandoff } from "../../lib/tools/content-brief-v2-handoff.ts";
import { TOOL_HANDOFF_LINK_PROPS } from "../../lib/tools/tool-handoff.ts";

const INPUT = "w-full min-w-0 rounded-[3px] border border-brand-border-strong bg-brand-panel-sunken px-3 py-2 text-[13px] leading-[1.5] text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const DISABLED = "disabled:cursor-not-allowed disabled:opacity-45";
type OutlineDraft = Omit<ResearchOutlineItem, "h3"> & { readonly h3Text: string };
const draftOf = (outline: readonly ResearchOutlineItem[]): OutlineDraft[] => outline.map(({ h3, ...section }) => ({ ...section, h3Text: h3.join("\n") }));
const plainHeading = (text: string) => text.trim().replace(/\s+/gu, " ");
const effectiveOutline = (draft: readonly OutlineDraft[]): ResearchOutlineItem[] => draft.map(({ h3Text, ...section }) => ({ ...section, h2: plainHeading(section.h2), h3: h3Text.split(/\r?\n/u).map(plainHeading).filter(Boolean) }));

function downloadJson(value: ConfirmedBriefV2): void {
  const blob = new Blob([JSON.stringify(value)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `content-brief-confirmed-r${value.revision}-${value.fingerprint.slice(0, 12)}.json`;
  try { document.body.append(anchor); anchor.click(); } finally {
    anchor.remove();
    // Let the browser consume the click before releasing the local object URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function ContentBriefV2Editor({ brief, locale, onConfirmed, children }: {
  readonly brief: ContentBriefV2;
  readonly locale: string;
  readonly onConfirmed?: ((confirmed: ConfirmedBriefV2 | null) => void) | undefined;
  readonly children?: ReactNode;
}) {
  const t = useTranslations("tools.contentBrief.v2");
  const base = brief.generated!.research.outline;
  const [draft, setDraft] = useState(() => draftOf(base));
  const [resolved, setResolved] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedBriefV2 | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [handoffFailure, setHandoffFailure] = useState(false);
  const confirmedRef = useRef<ConfirmedBriefV2 | null>(null);
  const stagedRaw = useRef<string | null>(null);
  const lifecycle = useRef({ mounted: false, generation: 0, inFlight: false, revision: 0 });
  const callback = useRef(onConfirmed);
  useEffect(() => { callback.current = onConfirmed; }, [onConfirmed]);
  useEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    callback.current?.(null);
    return () => { state.mounted = false; state.generation += 1; state.inFlight = false; confirmedRef.current = null; clearStaged(); callback.current?.(null); };
  }, []);

  const outline = effectiveOutline(draft);
  const invalid = outline.some((section) => !isBoundedModelText(section.h2, 160) || section.h3.length > 3 || section.h3.some((text) => !isBoundedModelText(text, 160)));
  const needsDecision = brief.generated!.page_plan.action === "undecidable";

  function clearStaged() {
    const raw = stagedRaw.current;
    stagedRaw.current = null;
    if (raw === null) return;
    try { clearMatchingContentBriefHandoff(window.sessionStorage, raw); } catch { /* Storage may be disabled. */ }
  }
  function stageHandoff(): boolean {
    const value = confirmedRef.current;
    if (value === null || !lifecycle.current.mounted) return false;
    try {
      const written = writeConfirmedBriefHandoff(window.sessionStorage, Date.now(), value, { preserve: stagedRaw.current });
      if (written.ok) { stagedRaw.current = written.raw; setHandoffFailure(false); return true; }
    } catch { /* A storage getter can fail before the writer runs. */ }
    setHandoffFailure(true);
    return false;
  }
  function invalidate() {
    confirmedRef.current = null;
    clearStaged();
    lifecycle.current.generation += 1;
    lifecycle.current.inFlight = false;
    setPending(false); setConfirmed(null); setError(null); setExportStatus(null); setCopying(false); setHandoffFailure(false);
    callback.current?.(null);
  }
  function edit(id: string, field: "h2" | "h3Text", text: string) {
    invalidate();
    setDraft((current) => current.map((section) => section.id === id ? { ...section, [field]: text } : section));
  }
  function move(id: string, direction: -1 | 1) {
    invalidate();
    setDraft((current) => {
      const index = current.findIndex((section) => section.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[next]] = [reordered[next]!, reordered[index]!];
      return reordered;
    });
  }
  async function confirm() {
    const state = lifecycle.current;
    if (state.inFlight || confirmed !== null || invalid || (needsDecision && !resolved)) return;
    const generation = ++state.generation;
    state.inFlight = true; setPending(true); setError(null);
    const current = () => state.mounted && state.generation === generation;
    try {
      const result = await confirmBriefV2(brief, { outline, revision: state.revision + 1, confirmed_at: new Date().toISOString(), resolution: needsDecision ? "create_despite_uncertainty" : "accept_recommendation" });
      if (!current()) return;
      if (!result.ok) { setError(t("confirmationFailed")); return; }
      state.revision = result.value.revision;
      confirmedRef.current = result.value;
      setDraft(draftOf(result.value.outline)); setConfirmed(result.value);
      callback.current?.(result.value);
    } catch { if (current()) setError(t("confirmationFailed")); }
    finally { if (current()) { state.inFlight = false; setPending(false); } }
  }
  async function copy() {
    if (confirmed === null || copying) return;
    const generation = lifecycle.current.generation;
    setCopying(true); setExportStatus(null);
    try {
      await navigator.clipboard.writeText(JSON.stringify(confirmed));
      if (lifecycle.current.mounted && lifecycle.current.generation === generation) setExportStatus(t("copied"));
    } catch { if (lifecycle.current.mounted && lifecycle.current.generation === generation) setExportStatus(t("copyFailed")); }
    finally { if (lifecycle.current.mounted && lifecycle.current.generation === generation) setCopying(false); }
  }

  return <>
    <section data-outline aria-label={t("outline")}>
      <h3 className={SECTION_TITLE}>{t("outline")}</h3>
      <p className={`mt-2 ${BODY_TEXT}`}>{t("outlineHelp")}</p>
      <div className="mt-4 space-y-4 border-l-2 border-brand-border-strong pl-4">
        {draft.map((section, index) => {
          const original = base.find((item) => item.id === section.id)!;
          const edited = section.h2 !== original.h2 || section.h3Text !== original.h3.join("\n") || base[index]?.id !== section.id;
          return <div key={section.id} data-outline-section={section.id} className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10.5px] text-text-dark-secondary">{section.id} · {edited ? t("edited") : t("generated")}</span>
              <div className="flex gap-1">
                <button type="button" data-move-up={section.id} aria-label={t("moveUp", { id: section.id })} disabled={index === 0} onClick={() => move(section.id, -1)} className={`${ACTION_BUTTON} ${DISABLED}`}>↑</button>
                <button type="button" data-move-down={section.id} aria-label={t("moveDown", { id: section.id })} disabled={index === draft.length - 1} onClick={() => move(section.id, 1)} className={`${ACTION_BUTTON} ${DISABLED}`}>↓</button>
              </div>
            </div>
            <label className="block"><span className="sr-only">{t("h2Label", { id: section.id })}</span><input data-outline-h2={section.id} value={section.h2} onChange={(event) => edit(section.id, "h2", event.target.value)} className={INPUT} /></label>
            <details data-h3-editor={section.id}><summary className="cursor-pointer text-[11.5px] leading-[1.5] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-brand-accent">H3 · {section.h3Text.split(/\r?\n/u).filter(Boolean).join(" · ") || t("h3Empty")}</summary><label className="mt-2 block text-[11px] text-text-dark-secondary">{t("h3Label", { id: section.id })}<textarea data-outline-h3={section.id} value={section.h3Text} onChange={(event) => edit(section.id, "h3Text", event.target.value)} rows={Math.max(1, Math.min(3, section.h3Text.split("\n").length))} className={`mt-1 resize-y ${INPUT}`} /></label><div className="mt-1 text-[10.5px] text-text-dark-secondary">{t("h3Help")}</div></details>
            <div data-outline-answers className="font-mono text-[10.5px] text-text-dark-secondary">{t("answers", { ids: section.answers.join(", ") })}</div>
          </div>;
        })}
      </div>
      {invalid ? <p role="alert" className="mt-3 text-[12px] text-brand-error">{t("invalidHeadings")}</p> : null}
    </section>
    {children}
    <section data-confirmation-bar className="rounded-[4px] border border-brand-border-strong bg-brand-panel-raised p-4">
      <h3 className={SECTION_TITLE}>{t("confirmTitle")}</h3>
      <p className={`mt-2 ${BODY_TEXT}`}>{t("confirmHelp")}</p>
      {needsDecision ? <div className="mt-3 rounded-[3px] border border-brand-warning/40 p-3"><label className="flex items-start gap-2 text-[12.5px] text-text-dark-primary"><input type="checkbox" data-resolve-create checked={resolved} onChange={(event) => { invalidate(); setResolved(event.target.checked); }} className="mt-1 shrink-0 accent-brand-accent" /><span>{t("resolveCreate")}</span></label><p className={`mt-2 ${BODY_TEXT}`}>{t("resolveHelp")}</p></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" data-confirm-brief disabled={pending || confirmed !== null || invalid || (needsDecision && !resolved)} aria-busy={pending} onClick={() => void confirm()} className={`${PRIMARY_ACTION_BUTTON} ${DISABLED}`}>{pending ? t("confirming") : confirmed ? t("confirmed") : t("confirm")}</button>
        <button type="button" data-copy-confirmed-json disabled={confirmed === null || copying} onClick={() => void copy()} className={`${ACTION_BUTTON} ${DISABLED}`}>{copying ? t("copying") : t("copyJson")}</button>
        <button type="button" data-download-confirmed-json disabled={confirmed === null} onClick={() => { if (confirmed !== null) { try { downloadJson(confirmed); setExportStatus(null); } catch { setExportStatus(t("downloadFailed")); } } }} className={`${ACTION_BUTTON} ${DISABLED}`}>{t("downloadJson")}</button>
      </div>
      {confirmed !== null ? <div className="mt-3"><a
        data-generate-draft href={localePath(locale, "/tools/content-draft")} {...TOOL_HANDOFF_LINK_PROPS}
        onMouseDown={(event) => { if ((event.button === 0 || event.button === 1) && !stageHandoff()) event.preventDefault(); }}
        onContextMenu={(event) => { if (!stageHandoff()) event.preventDefault(); }}
        onAuxClick={(event) => { if (event.button === 1 && !stageHandoff()) event.preventDefault(); }}
        onClick={(event) => { if (!stageHandoff()) event.preventDefault(); }}
        className={PRIMARY_ACTION_BUTTON}
      >{t("generateDraft")}</a></div> : null}
      {handoffFailure ? <p data-draft-handoff-error role="alert" className="mt-3 text-[12px] text-brand-error">{t("handoffFailed")}</p> : null}
      {error ? <p role="alert" className="mt-3 text-[12px] text-brand-error">{error}</p> : null}
      <div role="status" aria-live="polite" className="mt-3 text-[12px] text-text-dark-secondary">{exportStatus}</div>
      {confirmed ? <div data-confirmed-summary className="mt-3 border-t border-brand-border-card pt-3">
        <p className="text-[13px] font-semibold text-text-dark-primary">{t("confirmedRevision", { revision: confirmed.revision, count: confirmed.outline.length })}</p>
        <p className={`mt-1 ${BODY_TEXT}`}>{confirmed.resolution === "create_despite_uncertainty" ? t("yourDecision") : t("confirmedAction", { action: t(`actions.${confirmed.brief.generated!.page_plan.action}`) })}</p>
        <details className="mt-2"><summary className="cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-brand-accent">{t("confirmedDetails")}</summary><code data-confirmed-fingerprint className="mt-2 block break-all text-[10.5px]">{confirmed.fingerprint}</code><pre data-confirmed-json className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-[3px] bg-brand-panel-sunken p-3 text-[10.5px]">{JSON.stringify(confirmed, null, 2)}</pre></details>
      </div> : null}
      <p className={`mt-3 ${BODY_TEXT}`}>{t("exportHelp")}</p>
    </section>
  </>;
}
