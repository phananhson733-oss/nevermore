"use client";
// @input -- owned website/frozen contexts, run choices and recorded history
// @output -- explicit frozen-input selection, an honest running state and artifact-aligned report
// @pos -- visibility workbench; never writes Profile or silently updates frozen inputs
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { VISIBILITY_RUNS_PER_DAY, VISIBILITY_SAMPLES_DEFAULT, VISIBILITY_SAMPLES_OPTIONS, visibilityCallCount, visibilityCostEstimateUsd, visibilityMinutesEstimate, type VisibilityComparison } from "../../lib/geo-tools/visibility-contract.ts";
import { VISIBILITY_ENGINES, isVisibilityReportV2, type AnyVisibilityReport as VisibilityReport, type VisibilityEngine } from "../../lib/geo-tools/visibility-v2-contract.ts";
import { parseVisibilityContext, type VisibilityContext, type VisibilityWebsiteContext } from "../../lib/geo-tools/visibility-context.ts";
import { localePath } from "../../lib/locale-path.ts";
import { VisibilityPortableRuns } from "./ai-visibility-check-v2.tsx";
import { AiVisibilityReport, AiVisibilityComparison, AiVisibilityLegacySummary } from "./ai-visibility-report/index.tsx";
import { AiVisibilitySource } from "./ai-visibility-source.tsx";
import { useExactVisibilitySource } from "./ai-visibility-context.ts";
import { decodeVisibilityWire } from "../../lib/geo-tools/visibility-wire.ts";
import { AiVisibilityHistory, useVisibilityHistory, visibilityRunAddress } from "./ai-visibility-history.tsx";
import { clearVisibilityRunPointer, readVisibilityRunPointer, writeVisibilityRunPointer } from "./ai-visibility-run-pointer.ts";
import { asRecord, errorCodeOf, asLoadedChoices, readStatus, retryAfterSecondsFrom, pollDelayMs, waitFor, monotonicNow, POLL_DEFAULT_MS, type LoadedChoices, type FrozenVersion } from "./ai-visibility-client.ts";

const ENDPOINTS = { load: "/api/tools/ai-visibility-check/load", run: "/api/tools/ai-visibility-check/run", status: "/api/tools/ai-visibility-check/run/status", context: "/api/tools/ai-visibility-check/context" } as const;
const MAX_POLL_WALL_CLOCK_MS = 30 * 60 * 1_000;
const MAX_STATUS_FAILURES = 5;
const STALE_POINTER_CODES = new Set(["not_found", "run_unavailable", "invalid_request"]);
const PANEL = "rounded-xl border border-brand-border-card bg-brand-panel p-5 md:p-6";
const HEADING = "text-lg font-semibold text-text-dark-primary";
const BODY = "text-sm leading-relaxed text-text-dark-secondary";
const NOTE = "text-xs leading-relaxed text-text-dark-secondary";
const FIELD = "mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-sm text-text-dark-primary";
const PRIMARY_BUTTON = "rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-brand-on-accent disabled:opacity-60";
const SECONDARY_BUTTON = "rounded-lg border border-brand-border-card px-3 py-1.5 text-sm text-text-dark-primary disabled:opacity-60";
type RunState = { readonly kind: "idle" | "starting" | "running" } | { readonly kind: "done"; readonly report: VisibilityReport } | { readonly kind: "error"; readonly code: string };
function formatMoment(iso: string, locale: string): string { const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date); }

export function AiVisibilityCheck({
  locale,
  authentication,
}: {
  readonly locale: string;
  readonly authentication: "authenticated" | "unauthenticated" | "unavailable";
}) {
  const t = useTranslations("tools.aiVisibility");
  const [view, setView] = useState<"input" | "result">("input");
  const [choices, setChoices] = useState<LoadedChoices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [websiteId, setWebsiteId] = useState("");
  const [context, setContext] = useState<VisibilityContext | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [samples, setSamples] = useState<number>(VISIBILITY_SAMPLES_DEFAULT);
  const [engines, setEngines] = useState<readonly VisibilityEngine[]>(["chatgpt"]);
  const [fileComparison, setFileComparison] = useState<VisibilityComparison | null>(null);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [runningInput, setRunningInput] = useState<{ version: FrozenVersion; site: VisibilityWebsiteContext } | null>(null);
  const loadEpoch = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const startedAt = useRef<number | null>(null);
  /** How far into a restored run this page arrived, so the clock does not lie. */
  const resumeOffsetMs = useRef(0);
  const restoredOnce = useRef(false);

  const busy = run.kind === "starting" || run.kind === "running";
  const signedIn = authentication === "authenticated";
  const history = useVisibilityHistory(signedIn);
  const selectedSite = busy && runningInput !== null ? runningInput.site : context?.websites.find(site => site.website.websiteId === websiteId) ?? context?.websites[0] ?? null;
  const versions = useMemo(() => busy && runningInput !== null ? [runningInput.version] : choices?.versions.filter(version => version.kbId === selectedSite?.knowledgeBase?.kbId) ?? [], [busy, choices, runningInput, selectedSite]);
  const selectedSnapshot = versions.some(version => version.snapshotId === selected) ? selected : (versions[0]?.snapshotId ?? "");
  const savedReport = useMemo(() => history.selected?.evidenceAvailability === "recorded" ? decodeVisibilityWire(history.selected.report) : null, [history.selected]);
  const savedSummary = history.selected?.evidenceAvailability === "summary_only" ? history.selected.summary : null;
  const displayedReport = history.selectedId !== null ? savedReport : run.kind === "done" ? run.report : null;
  const resultManifest = displayedReport?.manifest ?? savedSummary?.manifest ?? null;
  const resultSource = useExactVisibilitySource(context, resultManifest?.kbId ?? null, resultManifest?.snapshotId ?? null, resultManifest?.questionSetHash ?? null);
  const inputSource = useExactVisibilitySource(context, selectedSite?.knowledgeBase?.kbId ?? null, selectedSnapshot || null);
  const sourceForInput = busy && runningInput !== null ? runningInput.site : inputSource.site;
  const hasResult = displayedReport !== null || savedSummary !== null;
  const resultRef = useRef<HTMLDivElement | null>(null);
  const focusedReport = useRef<string | null>(null);
  useEffect(() => { if (history.selected !== null) setView("result"); else if (history.selectedId === null && run.kind !== "done") setView("input"); }, [history.selected, history.selectedId, run.kind]);
  useEffect(() => {
    const key = resultManifest === null ? null : `${resultManifest.snapshotId}:${resultManifest.finishedAt}`;
    if (view === "result" && key !== null && focusedReport.current !== key) { resultRef.current?.focus({ preventScroll: true }); focusedReport.current = key; }
  }, [view, resultManifest]);
  useEffect(
    () => () => {
      abort.current?.abort();
      loadAbort.current?.abort();
      loadEpoch.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldown]);

  /**
   * A clock, deliberately not a progress bar.
   *
   * The run reports how many calls finished only when it has that number to
   * report; a bar drawn without one would be a denominator this page invented.
   * What a fifteen-minute wait needs is evidence it is still going, next to the
   * duration the estimate promised.
   */
  useEffect(() => {
    if (!busy) {
      startedAt.current = null;
      return;
    }
    if (startedAt.current === null) {
      startedAt.current = monotonicNow() - resumeOffsetMs.current;
    }
    const ticker = setInterval(() => {
      const start = startedAt.current;
      if (start !== null) setElapsedMs(monotonicNow() - start);
    }, 1_000);
    return () => {
      clearInterval(ticker);
    };
  }, [busy]);

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    const current = () => epoch === loadEpoch.current && !controller.signal.aborted;
    setLoadError(null); setRefreshing(true);
    try {
      const [response, contextResponse] = await Promise.all([
        fetch(ENDPOINTS.load, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal }),
        fetch(ENDPOINTS.context, { signal: controller.signal }),
      ]);
      const [body, contextBody]: [unknown, unknown] = await Promise.all([response.json(), contextResponse.json()]);
      if (!current()) return;
      if (!response.ok || !contextResponse.ok) { setLoadError(errorCodeOf(!response.ok ? body : contextBody) ?? "unknown"); return; }
      const loaded = asLoadedChoices(body);
      if (loaded === null) { setLoadError("schema_mismatch"); return; }
      let nextContext: VisibilityContext;
      try { nextContext = parseVisibilityContext(contextBody); } catch { setLoadError("schema_mismatch"); return; }
      setChoices(loaded); setContext(nextContext);
    } catch { if (current()) setLoadError("network"); }
    finally { if (current()) setRefreshing(false); }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void load();
  }, [load, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, signedIn]);
  const version = useMemo(() => versions.find(entry => entry.snapshotId === selectedSnapshot) ?? null, [selectedSnapshot, versions]);
  const sourceMismatch = inputSource.site !== null && (inputSource.site.frozen?.questionCount !== version?.questionCount || inputSource.site.frozen?.retrievalCount !== version?.retrievalCount);
  const sourceBlocked = refreshing || loadError !== null || inputSource.loading || inputSource.error || sourceMismatch || inputSource.site === null || inputSource.site.preparation.languageWarnings.length > 0;


  const estimate = useMemo(() => {
    const calls = visibilityCallCount(version?.questionCount ?? 0, samples) * engines.length;
    return {
      calls,
      cost: visibilityCostEstimateUsd(calls),
      minutes: visibilityMinutesEstimate(calls),
    };
  }, [engines, samples, version]);

  const poll = useCallback(
    async (
      token: string,
      controller: AbortController,
      firstDelayMs: number,
      restored: boolean,
    ): Promise<void> => {
      let delay = firstDelayMs;
      let failures = 0;
      const deadline = monotonicNow() + MAX_POLL_WALL_CLOCK_MS;
      // Awaiting each response before scheduling the next is what keeps a
      // single request in flight; a timer that fires on its own schedule would
      // stack requests on a slow run.
      while (!controller.signal.aborted) {
        await waitFor(delay, controller.signal);
        if (controller.signal.aborted) return;
        if (monotonicNow() > deadline) {
          // The pointer stays in storage: the run may still be finishing, and
          // reloading is how the visitor gets another look at it.
          setRun({ kind: "error", code: "polling_stopped" });
          return;
        }
        try {
          const response = await fetch(ENDPOINTS.status, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runToken: token }),
            signal: controller.signal,
          });
          const body: unknown = await response.json();
          delay = pollDelayMs(body);
          const outcome = readStatus(response.status, body);
          if (outcome.kind === "completed") {
            history.clear();
            clearVisibilityRunPointer(sessionStorage);
            setRun({ kind: "done", report: outcome.report });
            setView("result");
            if (isVisibilityReportV2(outcome.report)) visibilityRunAddress(outcome.report.manifest.runId);
            void history.refresh();
            return;
          }
          if (outcome.kind === "running") {
            failures = 0;
            setRun({ kind: "running" });
            continue;
          }
          if (outcome.kind === "error") {
            clearVisibilityRunPointer(sessionStorage);
            // A restored pointer the server will not answer for is a stale
            // pointer, not a failed run. Reporting it as an error would put a
            // run the visitor never started on the screen; the form is the
            // honest place to land.
            if (restored && STALE_POINTER_CODES.has(outcome.code)) {
              setRun({ kind: "idle" });
              return;
            }
            setRun({ kind: "error", code: outcome.code });
            setCooldown(retryAfterSecondsFrom(body));
            return;
          }
          failures += 1;
          if (failures >= MAX_STATUS_FAILURES) {
            clearVisibilityRunPointer(sessionStorage);
            setRun(
              restored
                ? { kind: "idle" }
                : { kind: "error", code: "run_unavailable" },
            );
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
          // A transport error says nothing about the run itself, so it is worth
          // a bounded number of retries before the page gives the wait back.
          // The pointer is kept for the same reason: the run is still running.
          failures += 1;
          if (failures >= MAX_STATUS_FAILURES) {
            setRun({ kind: "error", code: "network" });
            return;
          }
          delay = Math.max(delay, POLL_DEFAULT_MS);
        }
      }
    },
    [history.clear, history.refresh],
  );

  const start = useCallback(async () => {
    if (version === null || engines.length === 0 || sourceBlocked || inputSource.site === null) return;
    setRunningInput({ version, site: inputSource.site });
    setSelected(version.snapshotId); setWebsiteId(inputSource.site.website.websiteId);
    history.clear();
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    resumeOffsetMs.current = 0;
    startedAt.current = monotonicNow();
    setElapsedMs(0);
    setRun({ kind: "starting" });
    setView("input");
    try {
      const response = await fetch(ENDPOINTS.run, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kbId: version.kbId,
          snapshotId: version.snapshotId,
          samplesPerQuestion: samples,
          engines,
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setRun({ kind: "error", code: errorCodeOf(body) ?? "unknown" });
        setCooldown(retryAfterSecondsFrom(body));
        return;
      }
      const token = asRecord(asRecord(body)?.["data"])?.["runToken"];
      if (typeof token !== "string" || token.length === 0) {
        setRun({ kind: "error", code: "run_unavailable" });
        return;
      }
      // Written before the first poll, not after it: the calls are already
      // being made, so the window in which a reload loses the run has to be
      // as close to zero as the code can make it.
      writeVisibilityRunPointer(sessionStorage, {
        runToken: token,
        startedAt: Date.now(),
      });
      setRun({ kind: "running" });
      await poll(token, controller, pollDelayMs(body), false);
    } catch {
      if (controller.signal.aborted) return;
      setRun({ kind: "error", code: "network" });
    }
  }, [engines, history.clear, inputSource.site, poll, samples, sourceBlocked, version]);

  /**
   * Pick a paid run back up after a reload.
   *
   * The server seals the pointer for a day and the page tells the visitor they
   * may leave; both were false while the token lived only in a closure. One
   * shot per mount, so no state update re-enters a poll already in flight.
   */
  useEffect(() => {
    if (!signedIn || restoredOnce.current) return;
    restoredOnce.current = true;
    if (new URL(window.location.href).searchParams.has("run")) return;
    const pointer = readVisibilityRunPointer(sessionStorage);
    if (pointer === null) return;
    resumeOffsetMs.current = Math.max(0, Date.now() - pointer.startedAt);
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setElapsedMs(resumeOffsetMs.current);
    setRun({ kind: "running" });
    void poll(pointer.runToken, controller, POLL_DEFAULT_MS, true);
  }, [poll, signedIn]);

  if (!signedIn) {
    return (
      <section className={`mt-10 ${PANEL}`}>
        <h2 className={HEADING}>{t("signIn.title")}</h2>
        <p className={`mt-3 max-w-[640px] ${BODY}`}>
          {authentication === "unavailable"
            ? t("signIn.unavailable")
            : t("signIn.body")}
        </p>
      </section>
    );
  }

  const recovering = busy && runningInput === null;
  const inputReady = choices !== null && context !== null;
  const elapsedSeconds = Math.floor(elapsedMs / 1_000);
  const providerConfigured = choices?.providerConfigured !== false;

  return (
    <div className="mt-8 grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-brand-border pb-4">
        <p className="font-mono text-sm text-text-dark-secondary">{recovering && view === "input" ? t("running.recoveredTitle") : <>{view === "result" ? (displayedReport !== null && isVisibilityReportV2(displayedReport) ? displayedReport.context.targetHost : resultSource.site?.website.host ?? t("history.historicalSite")) : selectedSite?.website.host ?? ""} <span className="text-brand-accent-text">· kb@v{view === "result" ? resultManifest?.snapshotRevision ?? "—" : version?.revision ?? "—"}</span></>}</p>
        <div role="tablist" aria-label={t("workbench.views")} className="flex rounded-lg border border-brand-border-card p-1">
          {(["input", "result"] as const).map((item) => <button key={item} type="button" id={`visibility-${item}-tab`} role="tab" data-view={item} aria-selected={view === item} aria-controls={`visibility-${item}-panel`} tabIndex={view === item ? 0 : -1} disabled={item === "result" && !hasResult} onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "input" : event.key === "End" ? "result" : item === "input" ? "result" : "input"; if (next !== "result" || hasResult) { setView(next); document.getElementById(`visibility-${next}-tab`)?.focus(); } }
          }} onClick={() => setView(item)} className={`rounded-md px-5 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${view === item ? "bg-brand-accent text-brand-on-accent" : "text-text-dark-secondary hover:text-text-dark-primary"}`}>{t(`workbench.${item}`)}</button>)}
        </div>
      </div>
      {view === "input" && !recovering && !inputReady && <section className={PANEL}>
        <p className={BODY} role={loadError === null ? "status" : "alert"}>{loadError === null ? t("loading") : t(`errors.${loadError}`)}</p>
        {loadError !== null && <button className={`mt-4 ${SECONDARY_BUTTON}`} onClick={() => { void load(); }} type="button">{t("retryLoad")}</button>}
      </section>}
      {view === "input" && !recovering && inputReady && <section id="visibility-input-panel" data-testid="visibility-input-panel" role="tabpanel" aria-labelledby="visibility-input-tab" className={PANEL}>
        <h2 className={HEADING}>{t("form.title")}</h2>
        <p className={`mt-2 max-w-[640px] ${BODY}`}>{t("form.intro")}</p>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1"><label className="block text-sm text-text-dark-secondary" htmlFor="visibility-website">{t("workbench.website")}</label>
            <select id="visibility-website" className={FIELD} value={selectedSite?.website.websiteId ?? ""} disabled={busy || (context?.websites.length ?? 0) === 0} onChange={event => { setWebsiteId(event.target.value); setSelected(""); }}>
              {(context?.websites.length ?? 0) === 0 && <option value="">{t("workbench.noWebsites")}</option>}
              {context?.websites.map(site => <option key={site.website.websiteId} value={site.website.websiteId}>{site.website.host} · {t(`workbench.readiness.${site.preparation.status}`)}</option>)}
            </select>
          </div>
          <button className={SECONDARY_BUTTON} type="button" disabled={refreshing} onClick={() => { void load(); }}>{t("workbench.refresh")}</button>
        </div>
        {loadError !== null && <p role="alert" className="mt-3 text-sm text-brand-error">{t(`errors.${loadError}`)}</p>}
        {selectedSite !== null && version === null && <div className="mt-4 rounded-lg border border-brand-border-card p-4"><p className={BODY}>{t("noFrozen.body")}</p><a className="mt-2 inline-block text-sm text-brand-accent-text underline" href={localePath(locale, `/account/websites/${selectedSite.website.websiteId}/geo`)}>{t("workbench.prepare")}</a></div>}
        {selectedSite === null && <a className="mt-3 inline-block text-sm text-brand-accent-text underline" href={localePath(locale, "/account/websites")}>{t("workbench.addWebsite")}</a>}
        {sourceForInput !== null ? <AiVisibilitySource site={sourceForInput} locale={locale} /> : selectedSite?.frozen === null ? <AiVisibilitySource site={selectedSite} locale={locale} /> : null}
        {!busy && inputSource.loading && <p className={`mt-3 ${NOTE}`}>{t("workbench.sourceLoading")}</p>}
        {!busy && (inputSource.error || sourceMismatch) && <p className="mt-3 text-sm text-brand-error" role="alert">{t("workbench.sourceUnavailable")}</p>}
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="visibility-version"
            >
              {t("form.versionLabel")}
            </label>
            <select
              className={FIELD}
              disabled={busy || versions.length === 0}
              id="visibility-version"
              onChange={(event) => setSelected(event.target.value)}
              value={selectedSnapshot}
            >
              {versions.length === 0 && <option value="">{t("workbench.noFrozen")}</option>}
              {versions.map((entry) => (
                <option key={entry.snapshotId} value={entry.snapshotId}>
                  {t("form.versionOption", {
                    host: entry.host,
                    revision: entry.revision,
                    time: formatMoment(entry.frozenAt, locale),
                  })}
                </option>
              ))}
            </select>
            {version === null ? null : (
              <p className={`mt-1.5 ${NOTE}`}>
                {t("form.versionQuestions", {
                  count: version.questionCount,
                  retrieval: version.retrievalCount,
                })}
              </p>
            )}
            {version?.language != null && version.marketCode !== null && <p className={`mt-1.5 ${NOTE}`}>{t("form.context", { market: version.marketCode, language: version.language })}</p>}
          </div>

          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="visibility-samples"
            >
              {t("form.samplesLabel")}
            </label>
            <select
              className={FIELD}
              disabled={busy}
              id="visibility-samples"
              onChange={(event) =>
                setSamples(Number.parseInt(event.target.value, 10))
              }
              value={String(samples)}
            >
              {VISIBILITY_SAMPLES_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {t("form.samplesOption", { count: option })}
                </option>
              ))}
            </select>
            <p className={`mt-1.5 ${NOTE}`}>{t("form.samplesHelp")}</p>
          </div>
        </div>

        <fieldset className="mt-5" disabled={busy}>
          <legend className="text-sm text-text-dark-primary">{t("form.enginesLabel")}</legend>
          <div className="mt-2 flex flex-wrap gap-5">{VISIBILITY_ENGINES.map((engine) => <label className="flex items-center gap-2 text-sm text-text-dark-primary" key={engine}>
            <input type="checkbox" value={engine} checked={engines.includes(engine)} onChange={(event) => setEngines(VISIBILITY_ENGINES.filter((item) => item === engine ? event.target.checked : engines.includes(item)))} />{engine === "chatgpt" ? "ChatGPT" : "Perplexity"}
          </label>)}</div>
          <p className={`mt-2 ${NOTE}`}>{t("form.enginesHelp")}</p>
        </fieldset>

        <p className="mt-5 text-[14.5px] text-text-dark-primary">
          {t("form.estimate", {
            calls: estimate.calls,
            cost: estimate.cost,
            minutes: estimate.minutes,
          })}
        </p>
        <p className={`mt-1.5 ${NOTE}`}>{t(engines.includes("perplexity") ? "form.multiEngineEstimateNote" : "form.estimateNote")}</p>
        {/* The server's own number, not this bundle's: a tab open across a
            limit change would otherwise print the figure it was built with. */}
        <p className={`mt-1.5 ${NOTE}`}>
          {t("form.dailyLimit", { runs: choices?.runsPerDay ?? VISIBILITY_RUNS_PER_DAY })}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className={PRIMARY_BUTTON}
            disabled={
              busy || version === null || sourceBlocked || engines.length === 0 || cooldown > 0 || !providerConfigured
            }
            onClick={() => {
              void start();
            }}
            type="button"
          >
            {run.kind === "starting" ? t("form.starting") : busy ? t("running.title") : t("form.start")}
          </button>
          {cooldown > 0 ? (
            <span className={NOTE}>
              {t("form.cooldown", { seconds: cooldown })}
            </span>
          ) : null}
        </div>

        {/* The load endpoint reports this so a visitor does not spend a click
            to learn the credentials are missing. Saying it here is what makes
            that reporting worth anything. */}
        {providerConfigured ? null : (
          <p className={`mt-4 text-[13.5px] text-brand-error`} role="alert">
            {t("errors.provider_unconfigured")}
          </p>
        )}

        {run.kind === "error" ? (
          <p className="mt-4 text-[13.5px] text-brand-error" role="alert">
            {t(`errors.${run.code}`)}
          </p>
        ) : null}
      </section>}

      {busy ? (
        <section className={PANEL} aria-live="polite" data-testid={recovering ? "visibility-recovered-running" : undefined}>
          <h2 className={HEADING}>{t("running.title")}</h2>
          <p className={`mt-2 max-w-[640px] ${BODY}`}>
            {recovering ? t("running.recoveredBody") : t("running.body", { minutes: estimate.minutes })}
          </p>
          <p className={`mt-3 ${BODY}`}>
            {t("running.elapsed", {
              minutes: Math.floor(elapsedSeconds / 60),
              seconds: elapsedSeconds % 60,
            })}
          </p>
          {/* The run reports nothing per call, so the page says so rather
              than inventing a denominator to draw a bar with. */}
          <p className={`mt-2 ${BODY}`}>{t("running.noCount")}</p>
          <p className={`mt-3 ${NOTE}`}>{t("running.tabNote")}</p>
        </section>
      ) : null}

      {history.loading && <p role="status" className={BODY}>{t("history.loading")}</p>}
      {history.error && <p data-testid="visibility-history-error" role="alert" className="text-sm text-brand-error">{t("history.readError")}</p>}
      {hasResult && view === "result" && <div id="visibility-result-panel" role="tabpanel" aria-labelledby="visibility-result-tab" tabIndex={-1} ref={resultRef} className="grid gap-6 outline-none">
        {displayedReport !== null && <AiVisibilityReport locale={locale} report={displayedReport} />}
        {savedSummary !== null && <AiVisibilityLegacySummary locale={locale} summary={savedSummary} />}
        {resultSource.site !== null && <AiVisibilitySource site={resultSource.site} locale={locale} historical />}
        {resultSource.loading && <p className={NOTE}>{t("workbench.sourceLoading")}</p>}
        {(resultSource.error || (context === null && loadError !== null)) && <p role="status" className={NOTE}>{t("workbench.historicalSourceUnavailable")}</p>}
      </div>}
      <AiVisibilityHistory history={history} locale={locale} disabled={busy} />
      <VisibilityPortableRuns onComparison={setFileComparison} />
      {fileComparison !== null && <AiVisibilityComparison comparison={fileComparison} locale={locale} />}
    </div>
  );
}
