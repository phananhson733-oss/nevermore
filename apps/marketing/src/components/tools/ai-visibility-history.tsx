"use client";
// @input -- owner-scoped archived runs and an optional ?run= identifier
// @output -- durable report reopening with an explicit missing-evidence path
// @pos -- history is read-only and never calls the billable run endpoint
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { parseVisibilityHistoryList, parseVisibilityHistoryRead, type VisibilityHistoryList, type VisibilityHistoryRead } from "../../lib/geo-tools/visibility-history-contract.ts";

const ROOT = "/api/tools/ai-visibility-check/history";
export function visibilityRunAddress(runId: string | null): void {
  const url = new URL(window.location.href);
  if (runId === null) url.searchParams.delete("run"); else url.searchParams.set("run", runId);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
export function useVisibilityHistory(enabled: boolean) {
  const [list, setList] = useState<VisibilityHistoryList | null>(null);
  const [selected, setSelected] = useState<VisibilityHistoryRead | null>(null);
  const [error, setError] = useState(false);
  const [listError, setListError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestId = useRef(0);
  const restored = useRef(false);
  const refresh = useCallback(async () => {
    setListError(false);
    try {
      const response = await fetch(ROOT, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("history_unavailable");
      const body: unknown = await response.json();
      const parsed = parseVisibilityHistoryList((body as { data?: unknown }).data);
      if (parsed === null) throw new Error("invalid_history");
      setList(parsed);
    } catch { setListError(true); }
  }, []);
  const open = useCallback(async (runId: string) => {
    const id = ++requestId.current;
    setLoading(true); setError(false); setSelected(null); setSelectedId(runId);
    visibilityRunAddress(runId);
    try {
      const response = await fetch(`${ROOT}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
      if (!response.ok) throw new Error("history_unavailable");
      const body: unknown = await response.json();
      const value = parseVisibilityHistoryRead((body as { data?: unknown }).data);
      if (value === null || (value.evidenceAvailability === "recorded" ? value.report.manifest.runId : value.summary.runId) !== runId) throw new Error("invalid_history");
      if (id === requestId.current) setSelected(value);
    } catch { if (id === requestId.current) setError(true); }
    finally { if (id === requestId.current) setLoading(false); }
  }, []);
  const clear = useCallback(() => {
    requestId.current += 1; setSelected(null); setSelectedId(null); setError(false); setLoading(false); visibilityRunAddress(null);
  }, []);
  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    void refresh();
    const id = new URL(window.location.href).searchParams.get("run");
    if (id !== null) void open(id);
  }, [enabled, open, refresh]);
  useEffect(() => {
    if (!enabled) return;
    const navigate = () => {
      const id = new URL(window.location.href).searchParams.get("run");
      if (id === null) clear(); else void open(id);
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, [clear, enabled, open]);
  useEffect(() => () => { requestId.current += 1; }, []);
  return { list, selected, selectedId, error, listError, loading, refresh, open, clear };
}

export function AiVisibilityHistory({ history, locale, disabled }: { readonly history: ReturnType<typeof useVisibilityHistory>; readonly locale: string; readonly disabled: boolean }) {
  const t = useTranslations("tools.aiVisibility");
  return <section data-testid="visibility-history" className="rounded-xl border border-brand-border-card bg-brand-panel p-5 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-text-dark-primary">{t("history.title")}</h2><button type="button" className="text-sm text-brand-accent-text underline underline-offset-4 disabled:opacity-50" onClick={() => { void history.refresh(); }}>{t("history.refresh")}</button></div>
    <p className="mt-2 text-xs leading-relaxed text-text-dark-secondary">{t("history.scope")}</p>
    {history.listError ? <p role="alert" className="mt-3 text-sm text-brand-error">{t("history.listError")}</p> : history.list === null ? <p className="mt-3 text-sm text-text-dark-secondary">{t("loading")}</p> : history.list.runs.length === 0 ? <p className="mt-3 text-sm text-text-dark-secondary">{t("history.empty")}</p> : <ul className="mt-4 divide-y divide-brand-border-card">
      {history.list.runs.map(run => <li key={run.runId} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0"><p className="break-words text-sm font-medium text-text-dark-primary">{run.host ?? t("history.historicalSite")} <span className="font-mono text-xs text-text-dark-secondary">· kb@v{run.snapshotRevision}</span></p><p className="mt-1 text-xs text-text-dark-secondary">{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(run.finishedAt))} · {run.engines.map(engine => engine === "chatgpt" ? "ChatGPT" : "Perplexity").join(" + ")} · {t(`results.status.${run.status}`)} · {t(run.evidenceAvailability === "summary_only" ? "history.summaryOnly" : "history.recorded")}</p></div>
        <button type="button" data-run-id={run.runId} disabled={disabled || history.loading} onClick={() => { void history.open(run.runId); }} className="rounded-lg border border-brand-border-card px-3 py-2 text-sm text-text-dark-primary disabled:opacity-50">{t("history.open")}</button>
      </li>)}
    </ul>}
    {history.list?.hasMore && <p className="mt-3 text-xs text-text-dark-secondary">{t("history.more")}</p>}
  </section>;
}
