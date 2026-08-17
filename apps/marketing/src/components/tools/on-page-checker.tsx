"use client";

// @input  -- one page URL, up to five target queries, a market, a language, a page role
// @output -- keyword coverage for that page, its fixes, and a local list of recent checks
// @pos    -- the page-scoped entry into the same bounded crawl the SEO Agent runs
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";

import {
  appendOnPageHistory,
  clearOnPageStorage,
  newOnPageHistoryId,
  readOnPageDraft,
  readOnPageHistory,
  storeOnPageDraft,
  type OnPageCheckerPageType,
  type OnPageHistoryEntry,
} from "../../lib/on-page-checker/storage";
import { buildCopyReport } from "../../lib/on-page-checker/copy-report";
import { storePageFocusedAgentIntent } from "../agents/agent-intent";
import { localePath } from "../../lib/locale-path";

const MAX_QUERIES = 5;
const MAX_QUERY_CHARS = 80;

const PAGE_ROLES: readonly OnPageCheckerPageType[] = [
  "homepage",
  "product",
  "tool",
  "guide",
];

/** Codes this surface has its own wording for; anything else reads as generic. */
const KNOWN_ERROR_CODES = new Set([
  "auth_required",
  "invalid_url",
  "invalid_request",
  "scan_in_progress",
  "target_busy",
  "rate_limited",
  "scan_timeout",
  "scan_failed",
  "robots_disallowed",
  "robots_unreachable",
]);

interface AuditResponse {
  readonly data?: {
    readonly run?: {
      readonly source?: {
        readonly cache?: { readonly status?: unknown };
      };
    };
    readonly result?: {
      readonly targetUrl?: unknown;
      readonly scannedAt?: unknown;
      readonly targetInspected?: unknown;
      readonly inspectedTargetUrl?: unknown;
      readonly coverage?: Readonly<Record<string, unknown>>;
      readonly targetPageExtract?: unknown;
      readonly keywordEvidence?: KeywordEvidence;
    };
  };
  readonly error?: { readonly code?: unknown };
}

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as AuditResponse).error?.code;
  return typeof code === "string" ? code : null;
}

function integerAt(
  source: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number {
  const value = source?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return "";
  }
}

/** Retry-After only when it is a plain integer count of seconds we can show. */
function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const seconds = Number(raw.trim());
  if (!Number.isSafeInteger(seconds)) return null;
  return Math.min(Math.max(seconds, 1), 3_600);
}

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly startedAt: number }
  | {
      readonly kind: "done";
      readonly evidence: KeywordEvidence;
      readonly targetUrl: string;
      readonly scannedAt: string;
      readonly cacheStatus: "hit" | "miss" | "unknown";
    }
  | {
      readonly kind: "failed";
      readonly code: string;
      readonly retryAfter: number | null;
    };

export function OnPageChecker({ locale }: { readonly locale: string }) {
  const t = useTranslations("tools.onPageChecker");
  const [url, setUrl] = useState("");
  const [queries, setQueries] = useState<readonly string[]>([]);
  const [queryDraft, setQueryDraft] = useState("");
  const [country, setCountry] = useState("US");
  const [language, setLanguage] = useState(locale === "zh" ? "zh" : "en");
  const [pageRole, setPageRole] = useState<OnPageCheckerPageType>("homepage");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [queryNotice, setQueryNotice] = useState<string | null>(null);
  const [urlNotice, setUrlNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly OnPageHistoryEntry[]>([]);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [elapsed, setElapsed] = useState(0);
  const mounted = useRef(true);

  // Web Storage can throw on access alone, and the prefix walk needs `key`
  // and `length`, which the narrower intent storage interface does not carry.
  const webStore = useCallback((kind: "local" | "session"): Storage | null => {
    try {
      return kind === "local" ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Restore whatever sign-in interrupted, then forget it: a draft that outlives
  // its use is a stale URL waiting to be submitted by the next person here.
  useEffect(() => {
    const session = webStore("session");
    if (session) {
      const draft = readOnPageDraft(session);
      if (draft) {
        setUrl(draft.url);
        setQueries(draft.targetQueries);
        setCountry(draft.country);
        setLanguage(draft.locale);
        setPageRole(draft.pageType);
      }
    }
    const store = webStore("local");
    if (store) setHistory(readOnPageHistory(store));
  }, [webStore]);

  useEffect(() => {
    if (run.kind !== "running") return;
    const timer = setInterval(() => {
      if (mounted.current) setElapsed(Math.round((Date.now() - run.startedAt) / 1000));
    }, 1_000);
    return () => clearInterval(timer);
  }, [run]);

  const addQuery = useCallback(() => {
    const value = queryDraft.trim();
    if (value === "") {
      setQueryNotice(t("errors.queryEmpty"));
      return;
    }
    if (value.length > MAX_QUERY_CHARS) {
      setQueryNotice(t("errors.queryTooLong", { max: MAX_QUERY_CHARS }));
      return;
    }
    if (queries.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      setQueryNotice(t("errors.queryDuplicate"));
      return;
    }
    if (queries.length >= MAX_QUERIES) {
      setQueryNotice(t("errors.queryLimit", { max: MAX_QUERIES }));
      return;
    }
    setQueries([...queries, value]);
    setQueryDraft("");
    setQueryNotice(null);
  }, [queries, queryDraft, t]);

  const removeQuery = useCallback(
    (index: number) => {
      setQueries(queries.filter((_entry, at) => at !== index));
      setQueryNotice(null);
    },
    [queries],
  );

  const submit = useCallback(async () => {
    if (url.trim() === "") {
      setUrlNotice(t("errors.urlRequired"));
      return;
    }
    if (queries.length === 0) {
      setQueryNotice(t("errors.queryRequired"));
      return;
    }
    setUrlNotice(null);
    setQueryNotice(null);
    setCopied("idle");
    setElapsed(0);
    setRun({ kind: "running", startedAt: Date.now() });

    let response: Response;
    try {
      response = await fetch("/api/agents/seo/audit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          url: url.trim(),
          targetQueries: queries,
          pageRole,
        }),
      });
    } catch {
      if (mounted.current) {
        setRun({ kind: "failed", code: "scan_failed", retryAfter: null });
      }
      return;
    }

    const body = (await response.json().catch(() => null)) as unknown;
    if (!mounted.current) return;

    if (!response.ok) {
      const code = errorCodeOf(body) ?? "unknown";
      if (code === "auth_required") {
        // Keep the form, not the run: coming back signed in restores what was
        // typed and waits to be told to go.
        const session = webStore("session");
        if (session) {
          storeOnPageDraft(session, {
            url: url.trim(),
            targetQueries: queries,
            country,
            locale: language,
            pageType: pageRole,
          });
          storePageFocusedAgentIntent(session, url.trim());
        }
      }
      setRun({
        kind: "failed",
        code,
        retryAfter: retryAfterSeconds(response.headers),
      });
      return;
    }

    const result = (body as AuditResponse).data?.result;
    const evidence = result?.keywordEvidence;
    if (!evidence) {
      setRun({ kind: "failed", code: "scan_failed", retryAfter: null });
      return;
    }

    const cacheStatus = (body as AuditResponse).data?.run?.source?.cache?.status;
    const cache =
      cacheStatus === "hit" || cacheStatus === "miss" ? cacheStatus : "unknown";
    const targetUrl =
      typeof result?.targetUrl === "string" ? result.targetUrl : url.trim();
    const scannedAt =
      typeof result?.scannedAt === "string" ? result.scannedAt : "";

    setRun({ kind: "done", evidence, targetUrl, scannedAt, cacheStatus: cache });

    // Only a whole success is remembered, so the list never suggests a run
    // produced something it did not.
    if (evidence.availability === "available") {
      const store = webStore("local");
      if (store) {
        setHistory(
          appendOnPageHistory(store, {
            id: newOnPageHistoryId(),
            createdAt: Date.now(),
            url: targetUrl,
            host: hostOf(targetUrl),
            targetQueries: queries,
            country,
            locale: language,
            pageType: pageRole,
            focus: evidence.focus,
            coverage: {
              pagesInspected: integerAt(result?.coverage, "pagesInspected"),
              urlsSkipped: integerAt(result?.coverage, "urlsSkipped"),
              urlsBlocked: integerAt(result?.coverage, "urlsBlocked"),
              urlsErrored: integerAt(result?.coverage, "urlsErrored"),
            },
            cacheStatus: cache,
          }),
        );
      }
    }
  }, [country, language, pageRole, queries, t, url, webStore]);

  const copyReport = useCallback(async () => {
    if (run.kind !== "done") return;
    const text = buildCopyReport({
      targetUrl: run.targetUrl,
      scannedAt: run.scannedAt,
      cacheStatus: run.cacheStatus,
      evidence: run.evidence,
      limitationText: Object.fromEntries(
        (run.evidence.availability === "available"
          ? run.evidence.limitations
          : []
        ).map((code) => [code, t(`limitations.${code}`)]),
      ),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }, [run, t]);

  const clearHistory = useCallback(() => {
    clearOnPageStorage(webStore("local"), webStore("session"));
    setHistory([]);
  }, [webStore]);

  const evidence = run.kind === "done" ? run.evidence : null;
  const available =
    evidence !== null && evidence.availability === "available" ? evidence : null;

  return (
    <div className="mt-10 grid gap-10">
      <section
        aria-labelledby="onpage-stage-target"
        className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7"
      >
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {t("stages.target.eyebrow")}
        </p>
        <h2
          id="onpage-stage-target"
          className="mt-2 text-[19px] text-text-dark-primary"
        >
          {t("stages.target.title")}
        </h2>

        <div className="mt-5 grid gap-4">
          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="onpage-url"
            >
              {t("fields.url")}
            </label>
            <input
              className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
              id="onpage-url"
              inputMode="url"
              maxLength={2_048}
              onChange={(event) => {
                setUrl(event.target.value);
                setUrlNotice(null);
              }}
              placeholder="example.com/pricing"
              value={url}
            />
            <p aria-live="polite" className="mt-1.5 text-[12.5px] text-brand-error" role="alert">
              {urlNotice ?? ""}
            </p>
          </div>

          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="onpage-query"
            >
              {t("fields.queries", { max: MAX_QUERIES })}
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                className="w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                id="onpage-query"
                maxLength={MAX_QUERY_CHARS}
                onChange={(event) => {
                  setQueryDraft(event.target.value);
                  setQueryNotice(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addQuery();
                  }
                }}
                value={queryDraft}
              />
              <button
                className="shrink-0 rounded-lg border border-brand-border-card px-3 text-[13.5px] text-text-dark-secondary hover:border-brand-accent/40 hover:text-text-dark-primary"
                onClick={addQuery}
                type="button"
              >
                {t("actions.addQuery")}
              </button>
            </div>
            <p aria-live="polite" className="mt-1.5 text-[12.5px] text-brand-error" role="alert">
              {queryNotice ?? ""}
            </p>
            {queries.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {queries.map((query, index) => (
                  <li key={query}>
                    <button
                      className="rounded-full border border-brand-border-card px-3 py-1 font-mono text-[12px] text-text-dark-secondary hover:border-brand-accent/40"
                      onClick={() => removeQuery(index)}
                      type="button"
                    >
                      {query}
                      <span aria-hidden="true"> ×</span>
                      <span className="sr-only">{t("actions.removeQuery")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label
                className="block text-[13px] text-text-dark-secondary"
                htmlFor="onpage-country"
              >
                {t("fields.market")}
              </label>
              <input
                className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 font-mono text-[14px] text-text-dark-primary uppercase"
                id="onpage-country"
                maxLength={2}
                onChange={(event) => setCountry(event.target.value.toUpperCase())}
                value={country}
              />
            </div>
            <div>
              <label
                className="block text-[13px] text-text-dark-secondary"
                htmlFor="onpage-language"
              >
                {t("fields.language")}
              </label>
              <input
                className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 font-mono text-[14px] text-text-dark-primary"
                id="onpage-language"
                maxLength={16}
                onChange={(event) => setLanguage(event.target.value)}
                value={language}
              />
            </div>
            <div>
              <label
                className="block text-[13px] text-text-dark-secondary"
                htmlFor="onpage-role"
              >
                {t("fields.pageRole")}
              </label>
              <select
                className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                id="onpage-role"
                onChange={(event) =>
                  setPageRole(event.target.value as OnPageCheckerPageType)
                }
                value={pageRole}
              >
                {PAGE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`pageRoles.${role}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-lg bg-brand-accent px-4 py-2 text-[14px] font-medium text-brand-on-accent disabled:opacity-60"
              disabled={run.kind === "running"}
              onClick={() => void submit()}
              type="button"
            >
              {run.kind === "running" ? t("actions.running") : t("actions.run")}
            </button>
            <p className="text-[12.5px] text-text-dark-secondary">
              {t("boundaries.accountFree")}
            </p>
          </div>
          <p className="text-[12.5px] leading-[1.6] text-text-dark-faint">
            {t("boundaries.projection")}
          </p>
        </div>
      </section>

      <section
        aria-labelledby="onpage-stage-evidence"
        aria-live="polite"
        className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7"
      >
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {t("stages.evidence.eyebrow")}
        </p>
        <h2
          id="onpage-stage-evidence"
          className="mt-2 text-[19px] text-text-dark-primary"
        >
          {t("stages.evidence.title")}
        </h2>

        {run.kind === "idle" && (
          <p className="mt-4 text-[14px] text-text-dark-secondary">
            {t("stages.evidence.empty")}
          </p>
        )}

        {run.kind === "running" && (
          <div className="mt-4 grid gap-2">
            <p className="text-[14px] text-text-dark-primary">
              {t("waiting.headline")}
            </p>
            <p className="font-mono text-[13px] text-text-dark-secondary">
              {t("waiting.elapsed", { seconds: elapsed })}
            </p>
            <p className="text-[12.5px] leading-[1.6] text-text-dark-faint">
              {t("waiting.body")}
            </p>
            <p className="text-[12.5px] text-text-dark-faint">
              {t("waiting.noEstimate")}
            </p>
          </div>
        )}

        {run.kind === "failed" && (
          <div className="mt-4 grid gap-2" role="status">
            <p className="text-[14px] text-brand-error">
              {KNOWN_ERROR_CODES.has(run.code)
                ? t(`errors.${run.code}`)
                : t("errors.unknown")}
            </p>
            {run.retryAfter !== null && (
              <p className="text-[13px] text-text-dark-secondary">
                {t("errors.retryAfter", { seconds: run.retryAfter })}
              </p>
            )}
          </div>
        )}

        {evidence !== null && evidence.availability === "unavailable" && (
          <div className="mt-4 grid gap-2">
            <p className="text-[14px] text-text-dark-primary">
              {t(`unavailable.${evidence.reason}`)}
            </p>
            <p className="text-[12.5px] text-text-dark-faint">
              {t("unavailable.notZero")}
            </p>
          </div>
        )}

        {available !== null && (
          <div className="mt-5 grid gap-4">
            <p className="text-[14px] text-text-dark-primary">
              {t("focus.summary", {
                covered: available.focus.covered,
                applicable: available.focus.applicable,
              })}
            </p>
            <p className="text-[12.5px] text-text-dark-faint">
              {t("focus.notAScore")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="text-text-dark-faint">
                    <th className="py-2 pr-3 font-normal">{t("table.query")}</th>
                    <th className="py-2 pr-3 font-normal">{t("table.title")}</th>
                    <th className="py-2 pr-3 font-normal">
                      {t("table.description")}
                    </th>
                    <th className="py-2 pr-3 font-normal">{t("table.h1")}</th>
                    <th className="py-2 pr-3 font-normal">
                      {t("table.subHeadings")}
                    </th>
                    <th className="py-2 pr-3 font-normal">
                      {t("table.openingText")}
                    </th>
                    <th className="py-2 pr-3 font-normal">{t("table.url")}</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {available.queries.map((query) => (
                    <tr
                      className="border-t border-brand-border-card"
                      key={query.displayQuery}
                    >
                      <td className="py-2 pr-3 font-sans text-text-dark-primary">
                        {query.displayQuery}
                        {query.isPrimary && (
                          <span className="ml-2 rounded-full bg-brand-accent/10 px-2 py-0.5 font-mono text-[10.5px] text-brand-accent-text">
                            {t("table.primary")}
                          </span>
                        )}
                        {query.brandCandidate === "matched" && (
                          <span className="ml-2 rounded-full border border-brand-border-card px-2 py-0.5 font-mono text-[10.5px] text-text-dark-faint">
                            {t("table.brand")}
                          </span>
                        )}
                      </td>
                      {(
                        [
                          query.slots.title,
                          query.slots.description,
                          query.slots.h1,
                          query.slots.subHeadings,
                          query.slots.openingText,
                        ] as const
                      ).map((slot, index) => (
                        <td className="py-2 pr-3" key={index}>
                          <SlotCell
                            label={t(`slotStates.${slot.state}`)}
                            occurrences={slot.occurrences}
                            state={slot.state}
                          />
                        </td>
                      ))}
                      <td className="py-2 pr-3">
                        <SlotCell
                          label={t(`slotStates.${query.slots.url.state}`)}
                          occurrences={null}
                          state={query.slots.url.state}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="grid gap-1.5">
              {available.queries.map((query) => (
                <li
                  className="text-[13px] text-text-dark-secondary"
                  key={`density-${query.displayQuery}`}
                >
                  {query.density === null
                    ? t("density.unavailable", { query: query.displayQuery })
                    : t("density.value", {
                        query: query.displayQuery,
                        percent: (query.density.value * 100).toFixed(2),
                        units: query.density.denominatorUnits,
                        occurrences: query.capturedOccurrences,
                      })}
                </li>
              ))}
            </ul>

            <ul className="grid gap-1.5 border-t border-brand-border-card pt-4">
              {available.limitations.map((code) => (
                <li
                  className="text-[12.5px] leading-[1.6] text-text-dark-faint"
                  key={code}
                >
                  {t(`limitations.${code}`)}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-3 border-t border-brand-border-card pt-4">
              <button
                className="rounded-lg border border-brand-border-card px-3 py-2 text-[13.5px] text-text-dark-secondary hover:border-brand-accent/40 hover:text-text-dark-primary"
                onClick={() => void copyReport()}
                type="button"
              >
                {t("actions.copyReport")}
              </button>
              <p aria-live="polite" className="text-[12.5px] text-text-dark-faint" role="status">
                {copied === "done"
                  ? t("actions.copyDone")
                  : copied === "failed"
                    ? t("actions.copyFailed")
                    : ""}
              </p>
              <a
                className="ml-auto text-[13.5px] text-brand-accent-text underline underline-offset-4"
                href={localePath(locale, "/agents/seo")}
              >
                {t("actions.openAgent")}
              </a>
            </div>
          </div>
        )}
      </section>

      <section
        aria-labelledby="onpage-history"
        className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7"
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <h2
            className="text-[19px] text-text-dark-primary"
            id="onpage-history"
          >
            {t("history.title")}
          </h2>
          {history.length > 0 && (
            <button
              className="ml-auto text-[13px] text-text-dark-secondary underline underline-offset-4 hover:text-text-dark-primary"
              onClick={clearHistory}
              type="button"
            >
              {t("history.clear")}
            </button>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-faint">
          {t("history.localOnly")}
        </p>
        {history.length === 0 ? (
          <p className="mt-4 text-[14px] text-text-dark-secondary">
            {t("history.empty")}
          </p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {[...history].reverse().map((entry) => (
              <li
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-brand-border-card pt-2 text-[13px]"
                key={entry.id}
              >
                <span className="font-mono text-text-dark-primary">
                  {entry.url}
                </span>
                <span className="text-text-dark-faint">
                  {entry.targetQueries.join(", ")}
                </span>
                <span className="ml-auto font-mono tabular-nums text-text-dark-secondary">
                  {t("focus.short", {
                    covered: entry.focus.covered,
                    applicable: entry.focus.applicable,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SlotCell({
  label,
  occurrences,
  state,
}: {
  readonly label: string;
  readonly occurrences: number | null;
  readonly state: "covered" | "not_covered" | "not_applicable";
}) {
  const tone =
    state === "covered"
      ? "text-brand-success"
      : state === "not_covered"
        ? "text-brand-warning"
        : "text-text-dark-faint";
  return (
    <span className={tone}>
      {label}
      {occurrences !== null && occurrences > 0 && (
        <span className="text-text-dark-faint"> ({occurrences})</span>
      )}
    </span>
  );
}
