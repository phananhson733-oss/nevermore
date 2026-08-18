"use client";

// @input  -- one page URL, up to five target queries, a market, a language, a page role
// @output -- keyword coverage for that page, its fixes, and a local list of recent checks
// @pos    -- the page-scoped entry into the same bounded crawl the SEO Agent runs
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type {
  SeoAuditRecord,
  SeoAuditSiteResources,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools/seo-audit/types";
import {
  buildOnPageScore,
  type OnPageScore,
} from "../../lib/on-page-checker/scoring.ts";
import { OnPageScoreCard } from "./on-page-score-card.tsx";
import { OnPageCheckList } from "./on-page-check-list.tsx";
import { OnPageSerpPreview } from "./on-page-serp-preview.tsx";
import { OnPageTermTables } from "./on-page-term-tables.tsx";

import {
  appendOnPageHistory,
  clearOnPageDraft,
  clearOnPageHistory,
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

/**
 * The checker's own boundary over the SEO Agent's audit handler.
 *
 * It runs the identical engine, gate and cache as `/api/agents/seo/audit`; the
 * separate path exists so a run started here is recorded in the credit ledger as
 * this tool rather than as an Agent audit.
 */
const ON_PAGE_CHECK_ENDPOINT = "/api/tools/on-page-seo-check";

/**
 * The only code this surface words for itself.
 *
 * Everything else the crawl and its gate can return is explained by the shared
 * `tools.seoAudit.errors` catalogue, and deliberately not re-explained here.
 * Writing a second sentence for the same 409 produced two contradictory
 * accounts of it — this page told the visitor a same-site scan was already
 * running, when the limit is per network address and not per site, and the
 * shared message (which an existing honesty test pins) already said so.
 *
 * `auth_required` stays local because the checker's answer is different: what
 * was typed is kept and nothing runs until the visitor says so.
 */
const LOCAL_ERROR_CODES = new Set(["auth_required"]);

/** Every code the shared catalogue words, so an unknown one still reads sanely. */
const CRAWL_ERROR_CODES = new Set([
  "invalid_url",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "scan_in_progress",
  "target_busy",
  "rate_limited",
  "quota_unavailable",
  "scan_timeout",
  "scan_failed",
  "robots_disallowed",
  "robots_unreachable",
  "unknown",
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
      readonly targetPageExtract?: SeoAuditTargetPageExtract | null;
      readonly siteResources?: SeoAuditSiteResources;
      readonly records?: readonly SeoAuditRecord[];
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

/**
 * A count the response actually carried, or `null`.
 *
 * Never 0 for a missing number: this value is stored and read back later, and a
 * zero there says "we looked and there were none" about something we were never
 * told. The house rule is that unavailable is not zero, and a crawl that
 * reported nothing about skipped URLs is unavailable, not clean.
 */
function countAt(
  source: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function coverageAvailabilityOf(
  source: Readonly<Record<string, unknown>> | undefined,
): "available" | "partial" | "unavailable" {
  const value = source?.["availability"];
  return value === "available" || value === "partial" ? value : "unavailable";
}

/**
 * Elapsed time comes off a clock that cannot go backwards.
 *
 * `Date.now()` moves when the system clock is corrected or the machine wakes
 * from sleep, and this counter runs for up to four minutes beside a claim about
 * how long the visitor has waited.
 */
function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * The collection time, in the reader's own locale.
 *
 * Rendered only after a client-side run, so there is no server pass to disagree
 * with. An unparsable timestamp reads as the raw value rather than as a date we
 * made up.
 */
function formatCollectedAt(scannedAt: string, locale: string): string {
  const parsed = new Date(scannedAt);
  if (Number.isNaN(parsed.getTime())) return scannedAt;
  try {
    return parsed.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return parsed.toISOString();
  }
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
      /** The page's own extract, or null when the run could not read it. */
      readonly extract: SeoAuditTargetPageExtract | null;
      /**
       * Scored in the browser from the same response the tables are drawn from.
       *
       * The audit stays a neutral ledger, so the number cannot arrive from the
       * API; deriving it here keeps the score and the evidence on screen from
       * ever disagreeing about the same run.
       */
      readonly score: OnPageScore | null;
    }
  | {
      readonly kind: "failed";
      readonly code: string;
      readonly retryAfter: number | null;
    };

export function OnPageChecker({ locale }: { readonly locale: string }) {
  const t = useTranslations("tools.onPageChecker");
  const tTerms = useTranslations("tools.onPageChecker.terms");
  /** One account of the crawl gate, shared with the tool that owns it. */
  const tCrawl = useTranslations("tools.seoAudit.errors");
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
  /**
   * The report text, kept only when the clipboard refused it.
   *
   * The failure copy tells the visitor to select the report and copy it, which
   * needs a report on the page to select.
   */
  const [fallbackReport, setFallbackReport] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const mounted = useRef(true);
  const inFlight = useRef<AbortController | null>(null);

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
      // A crawl can run for four minutes. Leaving on client navigation without
      // aborting abandons it and keeps its crawl-gate slot held until the
      // server finishes something nobody is waiting for.
      inFlight.current?.abort();
      inFlight.current = null;
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
        // Consumed, not just read. It exists to survive one sign-in round trip;
        // leaving it behind means every visit inside the TTL refills the form
        // with someone's earlier URL, on a shared machine included.
        clearOnPageDraft(session);
      }
    }
    const store = webStore("local");
    if (store) setHistory(readOnPageHistory(store));
  }, [webStore]);

  useEffect(() => {
    if (run.kind !== "running") return;
    const timer = setInterval(() => {
      if (mounted.current)
        setElapsed(Math.round((monotonicNow() - run.startedAt) / 1000));
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
    // One run at a time: a second click would start a second crawl and leave
    // whichever answer arrived last on screen.
    if (inFlight.current !== null) return;
    setUrlNotice(null);
    setQueryNotice(null);
    setCopied("idle");
    setFallbackReport(null);
    setElapsed(0);
    setRun({ kind: "running", startedAt: monotonicNow() });

    const controller = new AbortController();
    inFlight.current = controller;
    let response: Response;
    try {
      response = await fetch(ON_PAGE_CHECK_ENDPOINT, {
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
        signal: controller.signal,
      });
    } catch {
      inFlight.current = null;
      if (mounted.current && !controller.signal.aborted) {
        setRun({ kind: "failed", code: "scan_failed", retryAfter: null });
      }
      return;
    }
    inFlight.current = null;

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

    const cacheStatus = (body as AuditResponse).data?.run?.source?.cache
      ?.status;
    const cache =
      cacheStatus === "hit" || cacheStatus === "miss" ? cacheStatus : "unknown";
    const targetUrl =
      typeof result?.targetUrl === "string" ? result.targetUrl : url.trim();
    const scannedAt =
      typeof result?.scannedAt === "string" ? result.scannedAt : "";

    const extract = result?.targetPageExtract ?? null;
    const siteResources = result?.siteResources ?? null;
    // Scored only when the page was actually read. A run that could not reach
    // the page has nothing to score, and a zero would read as a verdict.
    const score =
      extract === null || siteResources === null
        ? null
        : buildOnPageScore({
            extract,
            evidence,
            siteResources,
            siteRecords: result?.records ?? [],
          });

    setRun({
      kind: "done",
      evidence,
      targetUrl,
      scannedAt,
      cacheStatus: cache,
      extract,
      score,
    });

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
            // Null when the run could not be scored, so the trend column reads
            // "—" rather than implying this page came back a zero.
            score:
              score === null
                ? null
                : { value: score.score, grade: score.grade },
            coverage: {
              availability: coverageAvailabilityOf(result?.coverage),
              pagesInspected: countAt(result?.coverage, "pagesInspected"),
              urlsSkipped: countAt(result?.coverage, "urlsSkipped"),
              urlsBlocked: countAt(result?.coverage, "urlsBlocked"),
              urlsErrored: countAt(result?.coverage, "urlsErrored"),
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
      setFallbackReport(null);
    } catch {
      // Browsers deny the clipboard in plenty of ordinary situations. The report
      // goes on the page instead, so the instruction to select it is true.
      setCopied("failed");
      setFallbackReport(text);
    }
  }, [run, t]);

  /**
   * Hand this page and its queries to the Agent.
   *
   * A plain link would drop everything the visitor just framed and open an empty
   * site-wide form, which is the same loss the sign-in path was fixed for. The
   * draft carries the queries, market, language and role; the intent carries the
   * page and its scope, because that is what the Agent's own resume reads.
   */
  const openAgent = useCallback(() => {
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
    window.location.assign(localePath(locale, "/agents/seo"));
  }, [country, language, locale, pageRole, queries, url, webStore]);

  const clearHistory = useCallback(() => {
    clearOnPageHistory(webStore("local"), webStore("session"));
    setHistory([]);
  }, [webStore]);

  const evidence = run.kind === "done" ? run.evidence : null;
  const available =
    evidence !== null && evidence.availability === "available"
      ? evidence
      : null;

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
              aria-describedby="onpage-url-notice"
              aria-invalid={urlNotice !== null}
              onChange={(event) => {
                setUrl(event.target.value);
                setUrlNotice(null);
              }}
              placeholder="example.com/pricing"
              value={url}
            />
            {/* `role="alert"` is already an assertive live region; declaring a
                polite one beside it asks for two different behaviours. */}
            <p
              className="mt-1.5 text-[12.5px] text-brand-error"
              id="onpage-url-notice"
              role="alert"
            >
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
                aria-describedby="onpage-query-notice"
                aria-invalid={queryNotice !== null}
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
            <p
              className="mt-1.5 text-[12.5px] text-brand-error"
              id="onpage-query-notice"
              role="alert"
            >
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
                      <span className="sr-only">
                        {t("actions.removeQuery")}
                      </span>
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
                aria-describedby="onpage-market-scope"
                id="onpage-country"
                maxLength={2}
                onChange={(event) =>
                  setCountry(event.target.value.toUpperCase())
                }
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
                aria-describedby="onpage-market-scope"
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

          {/*
            Market and language do not reach the check.

            The request carries the URL, the queries and the page role, and
            nothing else — so these two are carried into the SEO Agent when the
            visitor opens it, and change nothing about the numbers below. Asking
            for them without saying so reads as "checked for that market".
          */}
          <p
            className="text-[12.5px] leading-[1.6] text-text-dark-faint"
            id="onpage-market-scope"
          >
            {t("fields.marketScope")}
          </p>

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

      {/*
        No live region on the section itself.

        The elapsed counter below ticks every second inside it, so a page-level
        polite region announced the whole panel about 240 times over one crawl.
        The announcements belong on the state blocks, which change once each.
      */}
      <section
        aria-labelledby="onpage-stage-evidence"
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
          <div className="mt-4 grid gap-2" role="status">
            <p className="text-[14px] text-text-dark-primary">
              {t("waiting.headline")}
            </p>
            {/*
              The one thing on screen that moves. A minute of silence under a
              headline that says no estimate will be given reads as a hung
              request, so the count is given the weight of a running clock
              rather than a footnote. Deliberately not announced once a second.
            */}
            <p
              aria-hidden="true"
              className="font-mono text-[15px] text-brand-accent-text"
            >
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
              {LOCAL_ERROR_CODES.has(run.code)
                ? t(`errors.${run.code}`)
                : CRAWL_ERROR_CODES.has(run.code)
                  ? tCrawl(run.code)
                  : tCrawl("unknown")}
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

        {available !== null && run.kind === "done" && (
          <div className="mt-5 grid gap-4">
            {/*
              What was read, and when.

              Without this a cache hit up to an hour old is indistinguishable
              from a crawl that just finished, and a normalized target URL is
              indistinguishable from the one that was typed.
            */}
            <div className="grid gap-1">
              <p className="font-mono text-[12.5px] break-all text-text-dark-secondary">
                {t("provenance.page", { url: run.targetUrl })}
              </p>
              <p className="text-[12.5px] text-text-dark-faint">
                {t(`provenance.${run.cacheStatus}`, {
                  time: formatCollectedAt(run.scannedAt, locale),
                })}
              </p>
            </div>
            {/*
              The score first, then what it is made of. A visitor who wants one
              number gets it without scrolling; a visitor who wants to check it
              has every check that produced it on the same screen.
            */}
            {run.score !== null && run.extract !== null && (
              <div className="grid gap-5">
                <OnPageScoreCard extract={run.extract} score={run.score} />
              </div>
            )}

            {run.extract !== null && (
              <section className="grid gap-3">
                <h3 className="text-[15px] text-text-dark-primary">
                  {t("sections.previewHeading")}
                </h3>
                <OnPageSerpPreview extract={run.extract} />
              </section>
            )}

            {run.score !== null && (
              <section className="grid gap-3">
                <h3 className="text-[15px] text-text-dark-primary">
                  {t("sections.checksHeading")}
                </h3>
                <OnPageCheckList categories={run.score.categories} />
              </section>
            )}

            {/*
              What the page is about, before what it was asked about. The
              keyword table below answers "is my word here"; this one answers
              "what is here", which is the question a page that ranks for the
              wrong thing needs asked.
            */}
            {run.extract !== null && (
              <section className="grid gap-3">
                <h3 className="text-[15px] text-text-dark-primary">
                  {tTerms("heading")}
                </h3>
                <OnPageTermTables extract={run.extract} evidence={available} />
              </section>
            )}

            <h3 className="text-[15px] text-text-dark-primary">
              {t("sections.keywordHeading")}
            </h3>
            <p className="text-[14px] text-text-dark-primary">
              {t("focus.summary", {
                covered: available.focus.covered,
                applicable: available.focus.applicable,
              })}
            </p>
            <p className="text-[12.5px] text-text-dark-faint">
              {t("focus.notAScore")}
            </p>
            {/*
              A query the visitor typed can be absent from the table: the wire
              normalizes and de-duplicates, so two spellings of one query arrive
              as one. Saying so is cheaper than letting them hunt for it.
            */}
            {available.queries.length < queries.length && (
              <p className="text-[12.5px] text-brand-warning">
                {t("provenance.queriesMerged", {
                  submitted: queries.length,
                  measured: available.queries.length,
                })}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="text-text-dark-faint">
                    <th className="py-2 pr-3 font-normal">
                      {t("table.query")}
                    </th>
                    <th className="py-2 pr-3 font-normal">
                      {t("table.title")}
                    </th>
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
                        // Words and CJK characters are both "units" and are not
                        // the same thing; a reader comparing two pages has to
                        // be able to see which was counted.
                        unitsBasis: t(
                          `density.units.${query.density.unitsBasis}`,
                        ),
                        occurrences: query.capturedOccurrences,
                      })}
                </li>
              ))}
            </ul>

            {/*
              The declared page role's one consumer. Without it the selector was
              an input that changed nothing, which is the mirror image of a
              required field that changes nothing.
            */}
            <div className="border-t border-brand-border-card pt-4">
              <h3 className="text-[15px] text-text-dark-primary">
                {t("fixes.title")}
              </h3>
              <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
                {t(`fixes.${available.pageRole ?? "homepage"}`)}
              </p>
              <p className="mt-2 text-[12.5px] text-text-dark-faint">
                {t("fixes.basis")}
              </p>
            </div>

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
              <p
                aria-live="polite"
                className="text-[12.5px] text-text-dark-faint"
                role="status"
              >
                {copied === "done"
                  ? t("actions.copyDone")
                  : copied === "failed"
                    ? t("actions.copyFailed")
                    : ""}
              </p>
              <button
                className="ml-auto text-[13.5px] text-brand-accent-text underline underline-offset-4 hover:text-brand-accent-hover"
                onClick={openAgent}
                type="button"
              >
                {t("actions.openAgent")}
              </button>
            </div>
            {fallbackReport !== null && (
              <label className="grid gap-2">
                <span className="text-[12.5px] text-text-dark-secondary">
                  {t("actions.copyFallbackLabel")}
                </span>
                <textarea
                  className="h-40 w-full rounded-lg border border-brand-border-card bg-brand-bg p-3 font-mono text-[12px] text-text-dark-primary"
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  value={fallbackReport}
                />
              </label>
            )}
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
                {/*
                  The trend, and the arithmetic that makes it one. `previous` is
                  the same URL's last check before this one, so re-checking a
                  different page never reads as an improvement on this one.
                */}
                <ScoreTrend
                  score={entry.score ?? null}
                  previous={previousScoreFor(history, entry)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The last score this same URL scored before the given check.
 *
 * Same URL, because a list mixing pages would otherwise report the difference
 * between two unrelated pages as a change in one of them.
 */
function previousScoreFor(
  history: readonly OnPageHistoryEntry[],
  entry: OnPageHistoryEntry,
): number | null {
  const earlier = history
    .filter(
      (candidate) =>
        candidate.url === entry.url && candidate.createdAt < entry.createdAt,
    )
    .sort((left, right) => left.createdAt - right.createdAt)
    .at(-1);
  return earlier?.score?.value ?? null;
}

function ScoreTrend({
  score,
  previous,
}: {
  readonly score: { readonly value: number; readonly grade: string } | null;
  readonly previous: number | null;
}) {
  if (score === null) {
    return <span className="font-mono text-text-dark-faint">—</span>;
  }
  const delta = previous === null ? null : score.value - previous;
  return (
    <span className="font-mono tabular-nums text-text-dark-primary">
      {score.value}
      <span className="text-text-dark-faint"> {score.grade}</span>
      {delta !== null && delta !== 0 && (
        <span
          className={
            delta > 0 ? "text-brand-success" : "text-brand-warning"
          }
        >
          {` ${delta > 0 ? "+" : ""}${delta}`}
        </span>
      )}
    </span>
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
