// @input  -- locale, the visitor's Search Console grant, and the market allow-list
// @output -- connect / read-site / confirm / run / result states for the keyword map
// @pos    -- primary client surface for /[locale]/tools/hidden-keywords
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useEffect, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  KeywordOpportunityErrorCode,
  KeywordOpportunityProposition,
  KeywordOpportunityResult,
} from "@sf/public-tools/keyword-opportunity/types";
import { KEYWORD_OPPORTUNITY_ERROR_CODES } from "@sf/public-tools/keyword-opportunity/types";
import type { GoogleConsentNotice } from "@/lib/tools/traffic-drop-session";
import { formatPropertyLabel } from "@/lib/tools/property-label";
import { trackMarketingEvent } from "@/components/layout/google-analytics";
import { GscConnectPanel, gscAuthorizeHref } from "./gsc-connect-panel";
import { GscDisconnect } from "./gsc-disconnect";
import { keywordMapSiteUrl } from "./keyword-map-property";
import { KeywordMapResults } from "./keyword-map-results";

const TOOL_PATH = "/tools/hidden-keywords";
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

/** A clock that cannot run backwards when the device's wall clock is adjusted. */
function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

type Phase = "idle" | "reading" | "confirm" | "running" | "done";

interface ContextState {
  readonly token: string;
  readonly propositions: readonly KeywordOpportunityProposition[];
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  readonly contextSufficient: boolean;
}

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
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number | null>(null);

  const busy = phase === "reading" || phase === "running";

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

  function selectProperty(next: string) {
    setProperty(next);
    // The URL follows the property, because the pairing is the point: the
    // coverage read uses the property and the crawl uses the URL, and a
    // visitor who edits one without the other gets a run whose headline stage
    // silently does not apply to the site they asked about.
    setSiteUrl(keywordMapSiteUrl(next) ?? "");
    setContext(null);
    setResult(null);
    setErrorCode(null);
    setPhase("idle");
  }

  function selectMarket(next: string) {
    setMarketCode(next);
    const paired = MARKET_LANGUAGE[next];
    if (paired !== undefined) setLanguageCode(paired);
  }

  function seeds(): string[] {
    return seedInput
      .split(",")
      .map((seed) => seed.trim())
      .filter((seed) => seed !== "")
      .slice(0, MAX_SEEDS);
  }

  async function readSite() {
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
          contextSufficient?: boolean;
        };
        error?: { code?: string };
      };
      if (!response.ok || !body.data?.contextToken) {
        setErrorCode(body.error?.code ?? "unknown");
        setPhase("idle");
        return;
      }
      setContext({
        token: body.data.contextToken,
        propositions: body.data.propositions ?? [],
        pagesFetched: body.data.pagesFetched ?? 0,
        productPagesFetched: body.data.productPagesFetched ?? 0,
        contextSufficient: body.data.contextSufficient ?? false,
      });
      setPhase("confirm");
    } catch {
      setErrorCode("unknown");
      setPhase("idle");
    }
  }

  async function runMap(token: string) {
    setPhase("running");
    setErrorCode(null);
    try {
      const response = await fetch(
        "/api/tools/hidden-keywords/opportunities",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contextToken: token }),
        },
      );
      const body = (await response.json()) as {
        data?: { result?: KeywordOpportunityResult };
        error?: { code?: string };
      };
      if (!response.ok || !body.data?.result) {
        setErrorCode(body.error?.code ?? "unknown");
        // Back to the confirmation step, not to the start: the sealed context
        // is still valid for ten minutes, and making the visitor re-crawl
        // their own site to retry a provider hiccup wastes a minute of theirs.
        setPhase("confirm");
        return;
      }
      setResult(body.data.result);
      setPhase("done");
      trackMarketingEvent("tool_complete", {
        tool_name: "keyword_opportunity_map",
      });
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
          disabled={busy || siteUrl.trim() === ""}
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
          : phase === "running"
            ? t("runningStatus", { seconds })
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
          {errorCode === "authentication_required" ? (
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
              disabled={busy}
              aria-busy={phase === "running"}
              onClick={() => void runMap(context.token)}
              className={BUTTON}
            >
              {phase === "running"
                ? t("running")
                : result !== null
                  ? t("rerunMap")
                  : t("runMap")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
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

      {result !== null ? <KeywordMapResults result={result} /> : null}

      <GscDisconnect namespace="tools.keywordMap" />
    </section>
  );
}
