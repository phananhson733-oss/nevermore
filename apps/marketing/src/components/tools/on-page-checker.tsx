"use client";

// @input  -- page/query fields, optional private query/page handoff, market and role
// @output -- handoff prefill, focused safe redirect recovery, page evidence, local history
// @pos    -- the page-scoped entry into the same bounded crawl the SEO Agent runs
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools/seo-audit/types";
import {
  buildOnPageScore,
  type OnPageScore,
} from "../../lib/on-page-checker/scoring.ts";
import {
  MAX_QUERIES,
  MAX_QUERY_CHARS,
  parseTargetQueries,
} from "../../lib/on-page-checker/parse-queries.ts";
import {
  DEFAULT_SERP_LANGUAGE,
  DEFAULT_SERP_MARKET,
  SERP_LANGUAGE_OPTIONS,
  SERP_MARKET_OPTIONS,
} from "../../lib/tools/serp-markets.ts";
import {
  coverageAvailabilityOf,
  countAt,
  errorCodeOf,
  formatCollectedAt,
  hostOf,
  monotonicNow,
  redirectTargetOf,
  retryAfterSeconds,
  type AuditResponse,
} from "../../lib/on-page-checker/response-reading.ts";
import { OnPageHistoryPanel } from "./on-page-history-panel.tsx";
import { OnPageReportSections } from "./on-page-report-sections.tsx";
import { OnPageKeywordEvidence } from "./on-page-keyword-evidence.tsx";
import {
  isSerpLandscape,
  type SerpLandscape,
} from "../../lib/agents/audit-contract.ts";

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
import { checkLabelKey } from "../../lib/on-page-checker/check-types.ts";
import { pageVitals } from "../../lib/on-page-checker/vitals.ts";
import { consumeToolHandoff } from "../../lib/tools/tool-handoff";
import {
  clearPendingAgentIntent,
  readPendingAgentIntent,
  storePageFocusedAgentIntent,
} from "../agents/agent-intent";
import { localePath } from "../../lib/locale-path";

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
  "target_redirected",
  "unknown",
]);

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly startedAt: number }
  | {
      readonly kind: "done";
      /**
       * Null for a URL-only run.
       *
       * The API omits the region entirely when no query was submitted, which is
       * a different fact from a region that came back unavailable — one is a
       * question nobody asked, the other one we could not answer.
       */
      readonly evidence: KeywordEvidence | null;
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
      /** Page one for the primary query, or null when it was not looked up. */
      readonly landscape: SerpLandscape | null;
    }
  | {
      readonly kind: "failed";
      readonly code: string;
      readonly retryAfter: number | null;
      readonly redirectTarget: string | null;
    };

export function OnPageChecker({ locale }: { readonly locale: string }) {
  const t = useTranslations("tools.onPageChecker");
  /** One account of the crawl gate, shared with the tool that owns it. */
  const tCrawl = useTranslations("tools.seoAudit.errors");
  /** Resolved where the wording lives, so the paste reads what the screen reads. */
  const tCheck = useTranslations("tools.onPageChecker.checks");
  const tCategory = useTranslations("tools.onPageChecker.scoreCategories");
  const [url, setUrl] = useState("");
  /**
   * The typed line is the source of truth; the list is read out of it.
   *
   * Holding both a list and a draft meant the visitor could type a keyword,
   * not press the button beside it, and have the run go without the word
   * still sitting in the field.
   */
  const [queryText, setQueryText] = useState("");
  const [country, setCountry] = useState(DEFAULT_SERP_MARKET);
  const [language, setLanguage] = useState(DEFAULT_SERP_LANGUAGE);
  const [pageRole, setPageRole] = useState<OnPageCheckerPageType>("homepage");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [queryNotice, setQueryNotice] = useState<string | null>(null);
  const [urlNotice, setUrlNotice] = useState<string | null>(null);
  const [handoffImported, setHandoffImported] = useState(false);
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
  const urlInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const inFlight = useRef<AbortController | null>(null);

  /**
   * Everything the field departed from what was typed, counted.
   *
   * A field that silently drops the sixth keyword answers about five words when
   * six were asked about, and nothing on screen accounts for the difference.
   */
  const parsed = useMemo(() => parseTargetQueries(queryText), [queryText]);
  const queries = parsed.queries;

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
      const handoff = consumeToolHandoff(
        session,
        Date.now(),
        "on-page-seo-check",
      );
      // A page-scope handoff carries no query, so the query field is left
      // for the visitor rather than filled with an invented one.
      //
      // Chained against the branches below on purpose. While this was its own
      // `if`, a page-scope handoff set the URL and then fell into the draft
      // branch of the next statement, which overwrote it with a stale draft's
      // URL and query while the banner still said the page had been imported —
      // the visitor was shown a different page than the one they clicked.
      if (handoff?.scope === "page") {
        setUrl(handoff.page);
        setHandoffImported(true);
        // The handoff is the newer explicit intent, so the draft it replaces
        // must not survive to be resurrected on the next visit.
        const pendingIntent = readPendingAgentIntent(session, "seo");
        if (pendingIntent?.purpose === "page_focused_launch") {
          clearPendingAgentIntent(session, "seo");
        }
        clearOnPageDraft(session);
      } else if (handoff?.scope === "query_page") {
        setUrl(handoff.page);
        setQueryText(handoff.query);
        if (handoff.source === "competitor-keyword-gap") {
          setCountry(
            SERP_MARKET_OPTIONS.some(
              (option) => option.code === handoff.marketCode,
            )
              ? handoff.marketCode
              : DEFAULT_SERP_MARKET,
          );
          setLanguage(
            SERP_LANGUAGE_OPTIONS.some(
              (option) => option.code === handoff.languageCode,
            )
              ? handoff.languageCode
              : DEFAULT_SERP_LANGUAGE,
          );
        }
        setHandoffImported(true);
        // The handoff is the newer explicit intent. The checker draft and its
        // page-focused Agent intent are one handoff, so replace the pair rather
        // than leaving the Agent half able to resurrect the older URL.
        const pendingIntent = readPendingAgentIntent(session, "seo");
        if (pendingIntent?.purpose === "page_focused_launch") {
          clearPendingAgentIntent(session, "seo");
        }
        clearOnPageDraft(session);
      } else {
        const draft = readOnPageDraft(session);
        if (draft) {
          setUrl(draft.url);
          setQueryText(draft.targetQueries.join(", "));
          // A draft outlives the list it was written against. Restoring a code
          // this build no longer offers would leave the selector showing its
          // first option while the state held something else, and the run would
          // go to a market the visitor never saw named.
          setCountry(
            SERP_MARKET_OPTIONS.some(
              (option) => option.code === draft.country,
            )
              ? draft.country
              : DEFAULT_SERP_MARKET,
          );
          setLanguage(
            SERP_LANGUAGE_OPTIONS.some(
              (option) => option.code === draft.locale,
            )
              ? draft.locale
              : DEFAULT_SERP_LANGUAGE,
          );
          setPageRole(draft.pageType);
          // Consumed, not just read. It exists to survive one sign-in round trip;
          // leaving it behind means every visit inside the TTL refills the form
          // with someone's earlier URL, on a shared machine included.
          clearOnPageDraft(session);
        }
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

  const submit = useCallback(async () => {
    if (url.trim() === "") {
      setUrlNotice(t("errors.urlRequired"));
      return;
    }
    // One run at a time: a second click would start a second crawl and leave
    // whichever answer arrived last on screen.
    if (inFlight.current !== null) return;
    setHandoffImported(false);
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
          // Omitted rather than sent empty: the request normaliser rejects an
          // empty list outright, and this is the shape that means "no query",
          // which the API answers by leaving the keyword region out.
          ...(queries.length === 0 ? {} : { targetQueries: queries }),
          pageRole,
          // These two used to stop at the form. They reach the results-page
          // lookup now, and nothing else: the crawl ignores both.
          market: country,
          language,
        }),
        signal: controller.signal,
      });
    } catch {
      inFlight.current = null;
      if (mounted.current && !controller.signal.aborted) {
        setRun({
          kind: "failed",
          code: "scan_failed",
          retryAfter: null,
          redirectTarget: null,
        });
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
        redirectTarget:
          code === "target_redirected"
            ? redirectTargetOf(response.headers, url.trim())
            : null,
      });
      return;
    }

    const result = (body as AuditResponse).data?.result;
    const evidence = result?.keywordEvidence ?? null;
    // Absent because nothing was asked is the URL-only run working. Absent
    // after a query was submitted is the API contradicting itself, and that is
    // still a failure.
    if (evidence === null && queries.length > 0) {
      setRun({
        kind: "failed",
        code: "scan_failed",
        retryAfter: null,
        redirectTarget: null,
      });
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
      // Validated, not cast. The checker reads this response with a TypeScript
      // interface, which is erased at runtime — so the guard written for this
      // shape was never reached on the one route that produces it, and a
      // malformed landscape would have crashed the report on `rows.map`.
      landscape: isSerpLandscape(result?.serpLandscape)
        ? result.serpLandscape
        : null,
    });

    // A whole success is remembered, so the list never suggests a run produced
    // something it did not — but recorded whenever the run finished, not only
    // when it produced coverage.
    // The list is what the visitor checked; a URL-only run that never appeared
    // in it left somebody able to check five pages and see an empty history.
    if (evidence === null || evidence.availability === "available") {
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
            focus: evidence === null ? null : evidence.focus,
            // Null when the run could not be scored, so the trend column reads
            // "—" rather than implying this page came back a zero.
            score:
              score === null || score.score === null || score.grade === null
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
    /*
      The whole report, not just the keyword region.

      This paste exists to be handed to an assistant that will be asked to
      implement the fixes, and for a long time it carried the coverage table and
      nothing else — no score, no caps, and none of the forty per-check findings
      that actually say what to change. It read like a report and was missing
      the part worth acting on.
    */
    const score = run.score;
    const text = buildCopyReport({
      targetUrl: run.targetUrl,
      scannedAt: run.scannedAt,
      cacheStatus: run.cacheStatus,
      evidence: run.evidence,
      limitationText: Object.fromEntries(
        (run.evidence !== null && run.evidence.availability === "available"
          ? run.evidence.limitations
          : []
        ).map((code) => [code, t(`limitations.${code}`)]),
      ),
      result:
        score === null
          ? null
          : {
              score: score.score,
              grade: score.grade === null ? null : t(`grades.${score.grade}`),
              // Said in words, because the receiver is an assistant that would
              // otherwise compare an absent number with a scored page's.
              ...(score.score === null
                ? { scoreUnavailable: t("score.unscoredReport") }
                : {}),
              counts: {
                pass: score.counts.pass,
                warn: score.counts.warn,
                fail: score.counts.fail,
              },
              topicFocus: score.topicFocus,
              categories: score.categories.map((category) => ({
                label: tCategory(category.category),
                earned: category.score,
                available: category.max,
              })),
              caps: score.caps.map((cap) =>
                t(`score.caps.${cap.reason}`, { ceiling: cap.ceiling }),
              ),
              checks: score.checks.map((entry) => ({
                id: entry.id,
                state: entry.state,
                score: entry.score,
                max: entry.max,
                label: tCheck(checkLabelKey(entry)),
                detail: tCheck(entry.detail.key, entry.detail.values),
                categoryLabel: tCategory(entry.category),
              })),
            },
      vitals:
        run.extract === null
          ? []
          : pageVitals(run.extract).map((vital) => ({
              label: t(`vitals.${vital.labelKey}`),
              value: vital.value,
            })),
      fixes:
        run.evidence !== null && run.evidence.availability === "available"
          ? t(`fixes.${run.evidence.pageRole ?? "homepage"}`)
          : null,
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
  }, [run, t, tCategory, tCheck]);

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

  /*
    Beside the score, not past the whole report.

    It sat at the very bottom, which is a long way from the number that makes
    someone want to hand this to an assistant in the first place.
  */
  const scoredHere =
    run.kind === "done" && run.score !== null && run.extract !== null;
  const copyControl = (
    <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );

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

        {handoffImported ? (
          <p
            role="status"
            className="mt-4 rounded-lg border border-brand-accent/25 bg-brand-accent/[0.08] px-4 py-3 text-[12.5px] leading-[1.6] text-text-dark-secondary"
          >
            {t("handoffNotice")}
          </p>
        ) : null}

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
                setHandoffImported(false);
              }}
              placeholder="example.com/pricing"
              ref={urlInput}
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
              {t("fields.queriesOptional", { max: MAX_QUERIES })}
            </label>
            {/*
              Said before the field, not after a rejected submit.
              
              The keyword category is the only one that reads this box. Leaving
              it empty runs everything else and publishes no overall score,
              which is a choice worth making deliberately rather than a rule to
              discover by pressing the button.
            */}
            <p className="mt-1 text-[12px] leading-[1.55] text-text-dark-faint">
              {t("fields.queriesOptionalHint")}
            </p>
            {/*
              One field, no button beside it.

              The pair used to be a draft box and an "add" button, which meant a
              keyword could be typed, sit there unadded, and be missing from the
              run the visitor then started — the field looked filled and was
              not. The typed line is the list now, so what is on screen is what
              gets submitted.
            */}
            <input
              className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
              id="onpage-query"
              aria-describedby="onpage-query-notice onpage-query-parsed"
              aria-invalid={queryNotice !== null}
              onChange={(event) => {
                setQueryText(event.target.value);
                setQueryNotice(null);
                setHandoffImported(false);
              }}
              placeholder={t("fields.queriesPlaceholder")}
              value={queryText}
            />
            <p
              className="mt-1.5 text-[12.5px] text-brand-error"
              id="onpage-query-notice"
              role="alert"
            >
              {queryNotice ?? ""}
            </p>
            {/*
              What the separator did, said out loud.

              A comma-separated field is a parser the visitor cannot see running,
              and the failure it produces is silent: `占星，星盘` submitted whole
              comes back absent from a page that covers both words. Printing the
              parsed list turns that into something readable before the run.
            */}
            {queries.length > 0 && (
              <ul
                className="mt-2 flex flex-wrap gap-2"
                id="onpage-query-parsed"
              >
                {queries.map((query) => (
                  <li
                    className="rounded-full border border-brand-border-card px-3 py-1 font-mono text-[12px] text-text-dark-secondary"
                    key={query}
                  >
                    {query}
                  </li>
                ))}
              </ul>
            )}
            {(parsed.overflow > 0 ||
              parsed.duplicates > 0 ||
              parsed.tooLong.length > 0) && (
              <ul className="mt-2 grid gap-1">
                {parsed.overflow > 0 && (
                  <li className="text-[12.5px] text-brand-warning">
                    {t("errors.queryLimit", {
                      max: MAX_QUERIES,
                      dropped: parsed.overflow,
                    })}
                  </li>
                )}
                {parsed.tooLong.length > 0 && (
                  <li className="text-[12.5px] text-brand-warning">
                    {t("errors.queryTooLong", {
                      max: MAX_QUERY_CHARS,
                      dropped: parsed.tooLong.length,
                    })}
                  </li>
                )}
                {parsed.duplicates > 0 && (
                  <li className="text-[12.5px] text-text-dark-faint">
                    {t("errors.queryDuplicate", { folded: parsed.duplicates })}
                  </li>
                )}
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
              {/*
                A list, not a free-text box.

                The lookup is a paid call whose provider rejects an unknown
                market only after it has been billed, so the two-letter box let
                a typo buy an error. Every option here is a code the lookup
                already maps, and the list is derived from that map rather than
                kept beside it.
              */}
              <select
                className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                aria-describedby="onpage-market-scope"
                id="onpage-country"
                onChange={(event) => {
                  setCountry(event.target.value);
                  setHandoffImported(false);
                }}
                value={country}
              >
                {SERP_MARKET_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label} ({option.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-[13px] text-text-dark-secondary"
                htmlFor="onpage-language"
              >
                {t("fields.language")}
              </label>
              <select
                className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                aria-describedby="onpage-market-scope"
                id="onpage-language"
                onChange={(event) => {
                  setLanguage(event.target.value);
                  setHandoffImported(false);
                }}
                value={language}
              >
                {SERP_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label} ({option.code})
                  </option>
                ))}
              </select>
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
                onChange={(event) => {
                  setPageRole(event.target.value as OnPageCheckerPageType);
                  setHandoffImported(false);
                }}
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
            Market and language reach exactly one thing: the results-page
            lookup. The crawl and every check built on it are the same in every
            market, and saying so is cheaper than letting a visitor read the
            whole report as "checked for that market".
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
            {run.redirectTarget !== null && (
              <div className="grid gap-2">
                <p className="text-[13px] text-text-dark-secondary">
                  {t("redirect.destination")}:{" "}
                  <a
                    className="break-all text-brand-accent-text underline underline-offset-2"
                    href={run.redirectTarget}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {run.redirectTarget}
                  </a>
                </p>
                <div>
                  <button
                    className="rounded-lg border border-brand-border-card px-3 py-2 text-[13px] font-medium text-text-dark-primary"
                    onClick={() => {
                      const target = run.redirectTarget;
                      if (target === null) return;
                      setUrl(target);
                      setUrlNotice(null);
                      setHandoffImported(false);
                      setRun({ kind: "idle" });
                      urlInput.current?.focus();
                    }}
                    type="button"
                  >
                    {t("actions.useDestinationUrl")}
                  </button>
                </div>
              </div>
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

        {/* Gated on the run, not on the keyword region.
            
            While this required `available`, a run that named no query — or one
            whose keyword region came back unavailable — rendered an empty
            stage 02: the score, the vitals, the forty checks and the term
            tables were all computed and none of them reached the screen. */}
        {run.kind === "done" && (
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
            <OnPageReportSections
            scoreAction={scoredHere ? copyControl : undefined}
              extract={run.extract}
              score={run.score}
              landscape={run.landscape}
              evidence={available}
            />

            {available !== null && (
              <OnPageKeywordEvidence
                available={available}
                submittedQueries={queries.length}
              />
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-brand-border-card pt-4">
              {/*
                Only when the score card is not there to hold it. A run that
                could not be scored still produced a report worth handing on,
                and hosting the control solely beside the score made it vanish
                on exactly those runs.
              */}
              {!scoredHere && copyControl}
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

      <OnPageHistoryPanel history={history} onClear={clearHistory} />
    </div>
  );
}
