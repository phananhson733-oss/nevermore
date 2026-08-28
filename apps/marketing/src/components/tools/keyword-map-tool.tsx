// @input  -- locale, the visitor's Search Console grant, and the market allow-list
// @output -- connect / read / confirm / durable tracking / refresh recovery / result states
// @pos    -- primary client surface for /[locale]/tools/low-competition-keywords
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useEffect, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  KeywordOpportunityErrorCode,
  KeywordOpportunityContextSelection,
  KeywordOpportunityProposition,
  KeywordOpportunityResult,
} from "@sf/public-tools/keyword-opportunity/types";
import { KEYWORD_OPPORTUNITY_ERROR_CODES } from "@sf/public-tools/keyword-opportunity/types";
import type { GoogleConsentNotice } from "../../lib/tools/traffic-drop-session";
import { formatPropertyLabel } from "../../lib/tools/property-label";
import { trackMarketingEvent } from "../layout/google-analytics";
import { GscConnectPanel, gscAuthorizeHref } from "./gsc-connect-panel";
import { GscDisconnect } from "./gsc-disconnect";
import { keywordMapSiteUrl } from "./keyword-map-property";
import { KeywordMapResults } from "./keyword-map-results";
import {
  clearKeywordWorkflowPointer,
  KEYWORD_WORKFLOW_API_VERSION,
  keywordWorkflowPointerForContext,
  keywordWorkflowPollDelayMs,
  normalizeKeywordWorkflowStartResponse,
  normalizeKeywordWorkflowStatusResponse,
  readKeywordWorkflowPointer,
  writeKeywordWorkflowPointer,
  type KeywordWorkflowContextState,
  type KeywordWorkflowPointerV1,
} from "../../lib/tools/keyword-workflow-client.ts";

const TOOL_PATH = "/tools/low-competition-keywords";
const SECTION_ID = "keyword-map-tool";

/** Shared surfaces, so this tool and its siblings read as one console. */
const PANEL =
  "scroll-mt-8 rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const FIELD_LABEL =
  "block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const FIELD_BASE =
  "mt-2 h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-text-dark-primary transition-colors outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const SELECT_FIELD = `${FIELD_BASE} font-mono text-[13px]`;
const TEXT_FIELD = `${FIELD_BASE} text-[13.5px]`;
const BUTTON =
  "inline-flex h-12.5 items-center justify-center rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60 disabled:shadow-none";
const SECONDARY_BUTTON =
  "inline-flex h-12.5 items-center justify-center rounded-[10px] border border-brand-border-strong px-6 text-[14px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";

/** Seeds the visitor may add, matching what the API accepts. */
const MAX_SEEDS = 10;
const MAX_SEED_LENGTH = 80;

/**
 * Languages offered, and the market each one defaults from.
 *
 * Short on purpose: every entry is a language the crawl, the prompts and the
 * provider have all actually been run against. Offering a longer list would
 * spend a paid call to discover the pair is unsupported.
 */
const LANGUAGES = ["en", "de", "fr", "nl", "sv"] as const;
const MARKET_LANGUAGE: Readonly<Record<string, string>> = {
  US: "en",
  GB: "en",
  CA: "en",
  AU: "en",
  DE: "de",
  FR: "fr",
  NL: "nl",
  SE: "sv",
};
const CONTEXT_STOP_REASONS = new Set([
  "max_urls",
  "max_requests",
  "max_wall_clock",
  "max_total_bytes",
  "aborted",
]);

/** A clock that cannot run backwards when the device's wall clock is adjusted. */
function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

type Phase = "idle" | "reading" | "confirm" | "tracking" | "done";
type ContextState = KeywordWorkflowContextState;

interface KeywordMapToolProps {
  readonly locale: string;
  /** `null` means no grant. The component never infers one from a silent error. */
  readonly properties: readonly string[] | null;
  readonly propertyTotal: number;
  readonly connectEnabled: boolean;
  readonly consentNotice: GoogleConsentNotice;
  /**
   * Market codes the API accepts, passed down rather than duplicated.
   *
   * The allow-list lives with the provider adapter because an unmapped code is
   * a paid round trip to learn the visitor typed something wrong. A second
   * copy here is a second thing to forget to update.
   */
  readonly markets: readonly string[];
}

function isKnownErrorCode(code: string): code is KeywordOpportunityErrorCode {
  return (KEYWORD_OPPORTUNITY_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * The server's own cooldown, or 0 when it sent none.
 *
 * Clamped: `Retry-After` arrives from a response and a bad or hostile value
 * must not park the button for a week. An hour covers the widest window any
 * gate actually uses.
 */
function retryAfterSecondsFrom(response: Response): number {
  const header = response.headers.get("Retry-After");
  if (header === null) return 0;
  const seconds = Number.parseInt(header, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, 3600);
}

function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function KeywordMapTool({
  locale,
  properties,
  propertyTotal,
  connectEnabled,
  consentNotice,
  markets,
}: KeywordMapToolProps) {
  const t = useTranslations("tools.keywordMap");
  const firstProperty = properties?.[0] ?? "";
  const [property, setProperty] = useState(firstProperty);
  const [siteUrl, setSiteUrl] = useState(
    keywordMapSiteUrl(firstProperty) ?? "",
  );
  const [marketCode, setMarketCode] = useState(markets[0] ?? "US");
  const [languageCode, setLanguageCode] = useState(
    MARKET_LANGUAGE[markets[0] ?? "US"] ?? "en",
  );
  const [seedInput, setSeedInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [context, setContext] = useState<ContextState | null>(null);
  const [result, setResult] = useState<KeywordOpportunityResult | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [trackingRestored, setTrackingRestored] = useState(false);
  const startedAt = useRef<number | null>(null);
  const workflowPointer = useRef<KeywordWorkflowPointerV1 | null>(null);
  const workflowAbort = useRef<AbortController | null>(null);
  const restoredOnce = useRef(false);

  const busy = phase === "reading" || phase === "tracking";

  /**
   * Count the server's own `Retry-After` down to zero.
   *
   * The gates have sent the header on every refusal since they shipped; the
   * client read only the JSON body, so a rate-limited visitor got a generic
   * error, a still-enabled button, and no reason not to click again — which
   * spends another admission attempt and resets nothing.
   */
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setTimeout(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldownSeconds]);

  /**
   * An honest elapsed counter, and deliberately not a progress bar.
   *
   * Neither request reports progress, so any denominator would be invented.
   * What the visitor needs during a two-minute wait is evidence that it is
   * still going and a truthful expectation of how long — both of which a
   * running clock next to a measured typical duration gives them.
   */
  useEffect(() => {
    if (!busy) {
      startedAt.current = null;
      return;
    }
    startedAt.current = monotonicNow();
    setElapsedMs(0);
    const ticker = setInterval(() => {
      const start = startedAt.current;
      if (start !== null) setElapsedMs(monotonicNow() - start);
    }, 1000);
    return () => {
      clearInterval(ticker);
    };
  }, [busy]);

  useEffect(
    () => () => {
      workflowAbort.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (restoredOnce.current || properties === null || properties.length === 0) {
      return;
    }
    restoredOnce.current = true;
    const pointer = readKeywordWorkflowPointer(sessionStorage, {
      properties,
      markets,
    });
    if (pointer === null) return;

    workflowPointer.current = pointer;
    setProperty(pointer.property);
    setSiteUrl(pointer.siteUrl);
    setMarketCode(pointer.marketCode);
    setLanguageCode(pointer.languageCode);
    setSeedInput(pointer.seedInput);
    setContext(pointer.context);
    setTrackingRestored(true);
    void resumeKeywordWorkflow(pointer);
    // Recovery is deliberately one-shot for this mounted tab. A state update
    // must not submit or poll the same run a second time.
  }, [markets, properties]);

  function rememberWorkflow(pointer: KeywordWorkflowPointerV1): void {
    workflowPointer.current = pointer;
    writeKeywordWorkflowPointer(sessionStorage, pointer);
  }

  function forgetWorkflow(): void {
    workflowPointer.current = null;
    clearKeywordWorkflowPointer(sessionStorage);
  }

  function finishWorkflow(nextResult: KeywordOpportunityResult): void {
    forgetWorkflow();
    setResult(nextResult);
    setErrorCode(null);
    setTrackingRestored(false);
    setPhase("done");
    trackMarketingEvent("tool_complete", {
      tool_name: "keyword_opportunity_map",
    });
  }

  async function pollKeywordWorkflow(
    initial: KeywordWorkflowPointerV1,
  ): Promise<void> {
    workflowAbort.current?.abort();
    const controller = new AbortController();
    workflowAbort.current = controller;
    let pointer = initial;
    setPhase("tracking");
    setErrorCode(null);

    while (!controller.signal.aborted) {
      try {
        const response = await fetch(
          "/api/tools/hidden-keywords/opportunities/status",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runToken: pointer.runToken }),
            signal: controller.signal,
          },
        );
        const body: unknown = await response.json();
        const outcome = normalizeKeywordWorkflowStatusResponse(
          response.status,
          body,
        );
        if (outcome.kind === "completed") {
          finishWorkflow(outcome.result);
          return;
        }
        if (outcome.kind === "redirect") {
          pointer = { ...pointer, runToken: outcome.runToken };
          rememberWorkflow(pointer);
          continue;
        }
        if (outcome.kind === "tracking") {
          if (outcome.runToken !== pointer.runToken) {
            pointer = { ...pointer, runToken: outcome.runToken };
            rememberWorkflow(pointer);
          }
          await waitForPoll(
            keywordWorkflowPollDelayMs(response.headers.get("Retry-After")),
            controller.signal,
          );
          continue;
        }
        if (outcome.kind === "error") {
          if (
            outcome.code === "keyword_run_unavailable" &&
            response.status === 503
          ) {
            await waitForPoll(
              keywordWorkflowPollDelayMs(
                response.headers.get("Retry-After"),
              ),
              controller.signal,
            );
            continue;
          }
          forgetWorkflow();
          setErrorCode(outcome.code);
          setCooldownSeconds(retryAfterSecondsFrom(response));
          setTrackingRestored(false);
          setPhase("confirm");
          return;
        }

        // Keep the request id but drop the unreadable pointer. A manual retry
        // then reaches the active-hook dedupe path instead of buying a new run.
        pointer = { ...pointer, runToken: null };
        rememberWorkflow(pointer);
        setErrorCode("unknown");
        setTrackingRestored(false);
        setPhase("confirm");
        return;
      } catch {
        if (controller.signal.aborted) return;
        // A polling transport error says nothing about the run. Keep the
        // pointer and retry sequentially; never start a second paid request.
        await waitForPoll(2_000, controller.signal);
      }
    }
  }

  async function startKeywordWorkflow(
    pointer: KeywordWorkflowPointerV1,
  ): Promise<void> {
    workflowAbort.current?.abort();
    const controller = new AbortController();
    workflowAbort.current = controller;
    rememberWorkflow(pointer);
    setPhase("tracking");
    setErrorCode(null);
    try {
      const response = await fetch("/api/tools/hidden-keywords/opportunities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Keyword-Workflow-Version": KEYWORD_WORKFLOW_API_VERSION,
        },
        body: JSON.stringify({
          contextToken: pointer.context.token,
          requestId: pointer.requestId,
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      const outcome = normalizeKeywordWorkflowStartResponse(
        response.status,
        body,
      );
      if (outcome.kind === "completed") {
        finishWorkflow(outcome.result);
        return;
      }
      if (outcome.kind === "accepted") {
        const trackingPointer = { ...pointer, runToken: outcome.runToken };
        rememberWorkflow(trackingPointer);
        await pollKeywordWorkflow(trackingPointer);
        return;
      }
      if (outcome.kind === "error") {
        if (outcome.code !== "keyword_run_unavailable") {
          forgetWorkflow();
        }
        setErrorCode(outcome.code);
        setCooldownSeconds(retryAfterSecondsFrom(response));
        setTrackingRestored(false);
        setPhase("confirm");
        return;
      }
      setErrorCode("unknown");
      setTrackingRestored(false);
      setPhase("confirm");
    } catch {
      if (controller.signal.aborted) return;
      // The request may have reached the server. Retain the request id with no
      // run token so retry/reload asks the deterministic hook for its owner.
      setErrorCode("unknown");
      setTrackingRestored(false);
      setPhase("confirm");
    }
  }

  async function resumeKeywordWorkflow(
    pointer: KeywordWorkflowPointerV1,
  ): Promise<void> {
    if (pointer.runToken === null) {
      await startKeywordWorkflow(pointer);
      return;
    }
    await pollKeywordWorkflow(pointer);
  }

  function invalidateConfirmedContext(): void {
    workflowAbort.current?.abort();
    forgetWorkflow();
    setTrackingRestored(false);
    setContext(null);
    setResult(null);
    setErrorCode(null);
    setPhase("idle");
  }

  function selectProperty(next: string) {
    invalidateConfirmedContext();
    setProperty(next);
    // The URL follows the property, because the pairing is the point: the
    // coverage read uses the property and the crawl uses the URL, and a
    // visitor who edits one without the other gets a run whose headline stage
    // silently does not apply to the site they asked about.
    setSiteUrl(keywordMapSiteUrl(next) ?? "");
  }

  function selectMarket(next: string) {
    setMarketCode(next);
    const paired = MARKET_LANGUAGE[next];
    if (paired !== undefined) setLanguageCode(paired);
    invalidateConfirmedContext();
  }

  function seeds(): string[] {
    return seedInput
      .split(",")
      .map((seed) => seed.trim())
      .filter((seed) => seed !== "")
      .slice(0, MAX_SEEDS);
  }

  /**
   * Carry withheld terms back into the seed field for a narrower re-run.
   *
   * Seeds travel inside the sealed context token, so the path back through
   * stage one is not ceremony — it is the only way the generator ever sees
   * them. Seeds steer the next run's candidate generation; they do not skip
   * it, so the copy anywhere near this must promise a narrower re-run, never
   * that these exact terms will be judged.
   */
  function retryWithSeeds(keywords: readonly string[]) {
    // Two filters, both about the round trip surviving: the API refuses any
    // seed over its length cap with a 400 for the whole request, and the
    // seed field is comma-separated, so a term carrying a comma would arrive
    // as two fragments of itself.
    const usable = keywords.filter(
      (keyword) => keyword.length <= MAX_SEED_LENGTH && !keyword.includes(","),
    );
    workflowAbort.current?.abort();
    forgetWorkflow();
    setTrackingRestored(false);
    setSeedInput(usable.slice(0, MAX_SEEDS).join(", "));
    setContext(null);
    setResult(null);
    setErrorCode(null);
    setPhase("idle");
    document.getElementById(SECTION_ID)?.scrollIntoView({ block: "start" });
  }

  async function readSite() {
    workflowAbort.current?.abort();
    forgetWorkflow();
    setTrackingRestored(false);
    trackMarketingEvent("tool_start", { tool_name: "keyword_opportunity_map" });
    setPhase("reading");
    setErrorCode(null);
    setContext(null);
    setResult(null);
    try {
      const response = await fetch("/api/tools/hidden-keywords/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteUrl,
          marketCode,
          languageCode,
          seeds: seeds(),
        }),
      });
      const body = (await response.json()) as {
        data?: {
          contextToken?: string;
          propositions?: readonly KeywordOpportunityProposition[];
          pagesFetched?: number;
          productPagesFetched?: number;
          selection?: KeywordOpportunityContextSelection;
          contextSufficient?: boolean;
          stopReason?: string;
        };
        error?: { code?: string };
      };
      if (!response.ok || !body.data?.contextToken) {
        setErrorCode(body.error?.code ?? "unknown");
        setCooldownSeconds(retryAfterSecondsFrom(response));
        setPhase("idle");
        return;
      }
      setContext({
        token: body.data.contextToken,
        propositions: body.data.propositions ?? [],
        pagesFetched: body.data.pagesFetched ?? 0,
        productPagesFetched: body.data.productPagesFetched ?? 0,
        ...(body.data.selection === undefined
          ? {}
          : { selection: body.data.selection }),
        contextSufficient: body.data.contextSufficient ?? false,
        stopReason: body.data.stopReason ?? null,
      });
      setPhase("confirm");
    } catch {
      setErrorCode("unknown");
      setPhase("idle");
    }
  }

  async function runMap(token: string) {
    if (context === null || context.token !== token) return;
    try {
      const pointer = keywordWorkflowPointerForContext(
        workflowPointer.current,
        {
          property,
          siteUrl,
          marketCode,
          languageCode,
          seedInput,
          context,
        },
      );
      setTrackingRestored(false);
      await startKeywordWorkflow(pointer);
    } catch {
      setErrorCode("unknown");
      setPhase("confirm");
    }
  }

  if (properties === null) {
    return (
      <GscConnectPanel
        locale={locale}
        namespace="tools.keywordMap"
        toolPath={TOOL_PATH}
        sectionId={SECTION_ID}
        icon={<Compass aria-hidden="true" className="size-[18px]" />}
        connectEnabled={connectEnabled}
        consentNotice={consentNotice}
      />
    );
  }

  if (properties.length === 0) {
    return (
      <section id={SECTION_ID} data-locale={locale} className={PANEL}>
        <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
          {t("noPropertyTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("noPropertyBody")}
        </p>
        <GscDisconnect namespace="tools.keywordMap" />
      </section>
    );
  }

  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <section id={SECTION_ID} data-locale={locale} className={PANEL}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block">
          <span className={FIELD_LABEL}>{t("propertyLabel")}</span>
          <select
            value={property}
            onChange={(event) => {
              selectProperty(event.target.value);
            }}
            disabled={busy}
            className={SELECT_FIELD}
          >
            {properties.map((candidate) => (
              <option key={candidate} value={candidate}>
                {formatPropertyLabel(candidate)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={FIELD_LABEL}>{t("siteUrlLabel")}</span>
          <input
            type="url"
            value={siteUrl}
            onChange={(event) => {
              setSiteUrl(event.target.value);
              invalidateConfirmedContext();
            }}
            disabled={busy}
            className={TEXT_FIELD}
          />
        </label>

        <label className="block">
          <span className={FIELD_LABEL}>{t("marketLabel")}</span>
          <select
            value={marketCode}
            onChange={(event) => {
              selectMarket(event.target.value);
            }}
            disabled={busy}
            className={SELECT_FIELD}
          >
            {markets.map((code) => (
              <option key={code} value={code}>
                {t(`markets.${code}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={FIELD_LABEL}>{t("languageLabel")}</span>
          <select
            value={languageCode}
            onChange={(event) => {
              setLanguageCode(event.target.value);
              invalidateConfirmedContext();
            }}
            disabled={busy}
            className={SELECT_FIELD}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {t(`languages.${code}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3.5 block">
        <span className={FIELD_LABEL}>{t("seedsLabel")}</span>
        <input
          type="text"
          value={seedInput}
          onChange={(event) => {
            setSeedInput(event.target.value);
            invalidateConfirmedContext();
          }}
          placeholder={t("seedsPlaceholder")}
          disabled={busy}
          className={TEXT_FIELD}
        />
      </label>
      <p className="mt-2 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("seedsHint")}
      </p>

      {propertyTotal > properties.length ? (
        <p className="mt-3 text-[12.5px] text-text-dark-secondary">
          {t("propertiesTruncated", { total: propertyTotal })}
        </p>
      ) : null}

      {/* Step one is free and fast; the money is spent by the button after it. */}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || cooldownSeconds > 0 || siteUrl.trim() === ""}
          aria-busy={phase === "reading"}
          onClick={() => void readSite()}
          className={BUTTON}
        >
          {phase === "reading"
            ? t("reading")
            : context !== null
              ? t("rereadSite")
              : t("readSite")}
        </button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {phase === "reading"
          ? t("reading")
          : phase === "tracking"
            ? trackingRestored
              ? t("restoredStatus", { seconds })
              : t("runningStatus", { seconds })
            : phase === "done" && result !== null
              ? t("statusDone", { count: result.rows.length })
              : ""}
      </p>

      {busy ? (
        <div className="mt-4 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 py-3.5">
          <p className="text-[13px] text-text-dark-primary">
            {phase === "reading" ? t("readingTitle") : t("runningTitle")}
          </p>
          <p className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {/*
             * A measured expectation, not a bar. Neither endpoint reports
             * progress, so a denominator would be invented — and the visitor's
             * real question during two minutes of nothing is whether to keep
             * waiting.
             */}
            {phase === "reading" ? t("readingBody") : t("runningBody")}
          </p>
          <p className="mt-2 font-mono text-[12px] text-text-dark-secondary tabular-nums">
            {t("elapsed", { seconds })}
          </p>
        </div>
      ) : null}

      {errorCode !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-[10px] border border-brand-warning/25 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
        >
          {/*
           * Unknown codes fall back to a generic line rather than rendering the
           * raw string: a visitor cannot act on something we did not plan for,
           * and a bare code reads as a crash.
           */}
          {t(`errors.${isKnownErrorCode(errorCode) ? errorCode : "unknown"}`)}
          {cooldownSeconds > 0 ? (
            <span className="mt-1.5 block font-mono text-[12px] tabular-nums">
              {t("cooldown", { seconds: cooldownSeconds })}
            </span>
          ) : null}
          {/*
           * `gsc_revoked` gets the same way back as `authentication_required`:
           * both mean the browser holds no usable grant and the only fix is
           * the consent screen. Before this, a revoked visitor saw a generic
           * error with no exit — the reconnect link rendered for the other
           * code only.
           */}
          {errorCode === "authentication_required" ||
          errorCode === "gsc_revoked" ? (
            <a
              href={gscAuthorizeHref(locale, TOOL_PATH)}
              className="mt-2 block font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
            >
              {t("reconnect")}
            </a>
          ) : null}
        </p>
      ) : null}

      {context !== null && phase !== "reading" ? (
        <div className="mt-5 rounded-[10px] border border-brand-border-strong bg-brand-bg p-[18px]">
          <h3 className="text-[14.5px] font-semibold text-text-dark-primary">
            {t("confirmTitle")}
          </h3>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("confirmBody", {
              pages: context.pagesFetched,
              productPages: context.productPagesFetched,
            })}
          </p>
          {context.selection === undefined ? null : (
            <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
              {t("contextSelection", {
                eligible: context.selection.eligibleCandidates,
                excluded: context.selection.excludedCandidates,
                attempted: context.selection.attemptedCandidates,
                truncated: context.selection.truncatedCandidates,
              })}
            </p>
          )}

          {context.stopReason === null ||
          context.stopReason === "completed" ? null : (
            <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
              {t("contextStopped", {
                reason: CONTEXT_STOP_REASONS.has(context.stopReason)
                  ? t(
                      `contextStops.${context.stopReason}` as Parameters<
                        typeof t
                      >[0],
                    )
                  : context.stopReason,
              })}
            </p>
          )}

          {!context.contextSufficient ? (
            <p className="mt-3 text-[12.5px] leading-[1.6] text-brand-warning">
              {t("thinContext")}
            </p>
          ) : null}

          <ul className="mt-3 space-y-2">
            {context.propositions.map((proposition) => (
              <li
                key={proposition.statement}
                className="text-[13px] leading-[1.6] text-text-dark-primary"
              >
                {proposition.statement}
                <span className="mt-0.5 block font-mono text-[11px] break-all text-text-dark-secondary">
                  {proposition.sourceUrl}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("confirmHint")}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || cooldownSeconds > 0}
              aria-busy={phase === "tracking"}
              onClick={() => void runMap(context.token)}
              className={BUTTON}
            >
              {phase === "tracking"
                ? t("running")
                : result !== null
                  ? t("rerunMap")
                  : t("runMap")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                workflowAbort.current?.abort();
                forgetWorkflow();
                setTrackingRestored(false);
                setContext(null);
                setResult(null);
                setPhase("idle");
              }}
              className={SECONDARY_BUTTON}
            >
              {t("startOver")}
            </button>
          </div>
        </div>
      ) : null}

      {result !== null ? (
        <KeywordMapResults
          result={result}
          locale={locale}
          onRetryWithSeeds={retryWithSeeds}
        />
      ) : null}

      <p className="mt-5 max-w-2xl text-[12px] leading-[1.6] text-text-dark-secondary">
        {t("persistenceBoundary")}
      </p>

      <GscDisconnect namespace="tools.keywordMap" />
    </section>
  );
}
