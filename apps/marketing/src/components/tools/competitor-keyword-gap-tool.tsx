// @input  -- locale, granted GSC properties, supported markets, authenticated APIs
// @output -- a bounded 1-5 competitor form, a v3 envelope guard, and honest run states
// @pos    -- primary client surface for the Marketing competitor keyword gap tool

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  COMPETITOR_KEYWORD_GAP_ERROR_CODES,
  COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS,
  COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS,
  COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BASES,
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
  COMPETITOR_KEYWORD_GAP_TOOL,
  normalizeCompetitorKeywordGapDomain,
  type CompetitorKeywordGapEnvelope,
  type CompetitorKeywordGapErrorCode,
} from "@sf/public-tools/competitor-keyword-gap";
import { SignInDialog } from "../auth/sign-in-dialog";
import { trackMarketingEvent } from "../layout/google-analytics";
import { keywordMapSiteUrl } from "./keyword-map-property";
import { CompetitorKeywordGapResults } from "./competitor-keyword-gap-results";

const PANEL =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const FIELD_LABEL =
  "block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const FIELD =
  "mt-2 h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-[13.5px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";
const BUTTON =
  "inline-flex h-12.5 items-center justify-center rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";
const SECONDARY_BUTTON =
  "inline-flex h-12.5 items-center justify-center rounded-[10px] border border-brand-border-strong px-5 text-[13px] font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";

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

type Phase = "idle" | "running" | "done";

/**
 * The refusals raised by the Search Console preflight, every one of which the
 * visitor can get past immediately by dropping the optional overlay. Listed
 * explicitly rather than by prefix: `rate_limited`, `quota_unavailable` and
 * `scan_in_progress` do not carry one, and a prefix test would also swallow
 * any future GSC code whose remedy is different.
 */
const GSC_PREFLIGHT_ERROR_CODES: readonly CompetitorKeywordGapErrorCode[] = [
  "gsc_property_not_granted",
  "gsc_property_site_mismatch",
  "gsc_revoked",
  "gsc_temporarily_unavailable",
  "rate_limited",
  "quota_unavailable",
  "scan_in_progress",
];

function isGscPreflightCode(code: string): boolean {
  return (GSC_PREFLIGHT_ERROR_CODES as readonly string[]).includes(code);
}

function isKnownErrorCode(code: string): code is CompetitorKeywordGapErrorCode {
  return (COMPETITOR_KEYWORD_GAP_ERROR_CODES as readonly string[]).includes(
    code,
  );
}

function responseErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const error = (body as { readonly error?: unknown }).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Belt and braces behind the request-side acceptSchemaVersion declaration: a
 * 200 that failed the envelope guard because it names a DIFFERENT contract
 * version than this bundle (a cached response, or a server that predates the
 * request-side check). Read defensively -- only a non-empty schemaVersion
 * string that differs from this build's constant counts.
 */
function hasMismatchedRunSchemaVersion(body: unknown): boolean {
  if (!isRecord(body) || !isRecord(body.data)) return false;
  const run = body.data.run;
  if (!isRecord(run)) return false;
  const schemaVersion = run.schemaVersion;
  return (
    typeof schemaVersion === "string" &&
    schemaVersion !== "" &&
    schemaVersion !== COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION
  );
}

function isFiniteNumberOrNull(value: unknown): boolean {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function isMetric(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.availability === "available" ||
      value.availability === "explicit_zero" ||
      value.availability === "provider_no_data") &&
    isFiniteNumberOrNull(value.value)
  );
}

function isGscEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    [
      "observed_strong",
      "observed_weak",
      "not_observed_in_gsc_query_sample",
      "gsc_query_sample_not_read",
    ].includes(String(value.queryStatus)) &&
    (value.evidenceBasis === "query" ||
      value.evidenceBasis === "query_page" ||
      value.evidenceBasis === null) &&
    isFiniteNumberOrNull(value.queryImpressions) &&
    isFiniteNumberOrNull(value.queryPosition) &&
    [
      "observed_sufficient",
      "observed_partial",
      "not_observed_in_gsc_query_page_sample",
      "gsc_query_page_sample_not_read",
    ].includes(String(value.pageStatus)) &&
    (value.pageUrl === null || typeof value.pageUrl === "string") &&
    isFiniteNumberOrNull(value.pageImpressions) &&
    isFiniteNumberOrNull(value.pagePosition) &&
    isFiniteNumberOrNull(value.queryPageCoverage) &&
    [
      "optimize_existing",
      "review_existing_query",
      "review_content_gap",
      "verify_own_coverage",
    ].includes(String(value.nextStep))
  );
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isCompetitorPage(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringOrNull(value.url) &&
    isStringOrNull(value.title) &&
    isFiniteNumberOrNull(value.etv)
  );
}

function isSearchVolumeTrend(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isFiniteNumberOrNull(value.monthly) &&
      isFiniteNumberOrNull(value.quarterly) &&
      isFiniteNumberOrNull(value.yearly))
  );
}

function isSerpSnapshot(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      Array.isArray(value.itemTypes) &&
      value.itemTypes.every((item) => typeof item === "string") &&
      isStringOrNull(value.updatedAt))
  );
}

function isPreScreen(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.band === "string" &&
    (COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS as readonly string[]).includes(
      value.band,
    ) &&
    typeof value.basis === "string" &&
    (COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BASES as readonly string[]).includes(
      value.basis,
    ) &&
    typeof value.reason === "string"
  );
}

function isV3Row(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.keyword === "string" &&
    isRecord(value.competitorRanks) &&
    Object.values(value.competitorRanks).every(
      (rank) => typeof rank === "number" && Number.isFinite(rank),
    ) &&
    isRecord(value.competitorPages) &&
    Object.values(value.competitorPages).every(isCompetitorPage) &&
    typeof value.competitorCount === "number" &&
    Number.isFinite(value.competitorCount) &&
    typeof value.bestCompetitorRank === "number" &&
    Number.isFinite(value.bestCompetitorRank) &&
    value.ownState === "not_observed_in_provider_rankings" &&
    isMetric(value.searchVolume) &&
    isMetric(value.cpc) &&
    isMetric(value.keywordDifficulty) &&
    isStringOrNull(value.providerIntent) &&
    isStringOrNull(value.coreKeyword) &&
    isSearchVolumeTrend(value.searchVolumeTrend) &&
    isSerpSnapshot(value.serpSnapshot) &&
    isPreScreen(value.preScreen) &&
    isGscEvidence(value.gsc)
  );
}

function isSampleRule(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.maxCompetitorRank === "number" &&
    Number.isFinite(value.maxCompetitorRank) &&
    typeof value.perCompetitorLimit === "number" &&
    Number.isFinite(value.perCompetitorLimit) &&
    typeof value.serpSnapshotRequested === "boolean"
  );
}

function isCompetitorCoverage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.domain === "string" &&
    (value.status === "complete" || value.status === "unavailable") &&
    typeof value.returnedRows === "number" &&
    Number.isFinite(value.returnedRows) &&
    isFiniteNumberOrNull(value.totalCount) &&
    typeof value.truncated === "boolean" &&
    (value.failureCode === null ||
      value.failureCode === "keyword_source_unavailable")
  );
}

function responseEnvelope(body: unknown): CompetitorKeywordGapEnvelope | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const { data } = body;
  if (!isRecord(data.run) || !isRecord(data.result)) return null;
  const { run, result } = data;
  if (
    run.tool !== COMPETITOR_KEYWORD_GAP_TOOL ||
    run.schemaVersion !== COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION ||
    run.mode !== "public_preview" ||
    run.scope !== "site" ||
    run.persistence !== "none" ||
    typeof run.completedAt !== "string" ||
    !["complete", "partial", "unavailable"].includes(String(run.status)) ||
    typeof result.capturedAt !== "string" ||
    typeof result.siteDomain !== "string" ||
    !Array.isArray(result.competitorDomains) ||
    !result.competitorDomains.every((domain) => typeof domain === "string") ||
    typeof result.marketCode !== "string" ||
    typeof result.languageCode !== "string" ||
    !isSampleRule(result.sampleRule) ||
    typeof result.requestedCompetitors !== "number" ||
    !Number.isFinite(result.requestedCompetitors) ||
    typeof result.completedCompetitors !== "number" ||
    !Number.isFinite(result.completedCompetitors) ||
    typeof result.unavailableCompetitors !== "number" ||
    !Number.isFinite(result.unavailableCompetitors) ||
    !Array.isArray(result.competitors) ||
    !result.competitors.every(isCompetitorCoverage) ||
    !Array.isArray(result.rows) ||
    !result.rows.every(isV3Row) ||
    typeof result.resultTruncated !== "boolean" ||
    !["not_requested", "available", "partial", "unavailable"].includes(
      String(result.overlayStatus),
    ) ||
    typeof result.gscQueryTruncated !== "boolean" ||
    typeof result.gscQueryPageTruncated !== "boolean" ||
    !isFiniteNumberOrNull(result.gscQueryRowCount) ||
    !isFiniteNumberOrNull(result.gscQueryPageRowCount)
  ) {
    return null;
  }
  return data as unknown as CompetitorKeywordGapEnvelope;
}

function propertySiteDomain(property: string): string | null {
  const siteUrl = keywordMapSiteUrl(property);
  if (siteUrl === null) return null;
  try {
    return normalizeCompetitorKeywordGapDomain(new URL(siteUrl).hostname);
  } catch {
    return null;
  }
}

export interface CompetitorKeywordGapToolProps {
  readonly locale: string;
  readonly properties: readonly string[] | null;
  readonly markets: readonly string[];
}

export function CompetitorKeywordGapTool({
  locale,
  properties,
  markets,
}: CompetitorKeywordGapToolProps) {
  const t = useTranslations("tools.competitorKeywordGap");
  const firstMarket = markets[0] ?? "US";
  const [signInOpen, setSignInOpen] = useState(false);
  const [siteDomain, setSiteDomain] = useState("");
  const [property, setProperty] = useState("");
  const [marketCode, setMarketCode] = useState(firstMarket);
  const [languageCode, setLanguageCode] = useState(
    MARKET_LANGUAGE[firstMarket] ?? "en",
  );
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitorDomains, setCompetitorDomains] = useState<readonly string[]>(
    [],
  );
  const [validationKey, setValidationKey] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [envelope, setEnvelope] = useState<CompetitorKeywordGapEnvelope | null>(
    null,
  );
  const [resultProperty, setResultProperty] = useState("");
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const submissionLocked = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const propertyRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      activeRequest.current = null;
      submissionLocked.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    startedAt.current = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (envelope === null) return;
    resultsRef.current?.scrollIntoView({ block: "start" });
  }, [envelope]);

  const siteInputInvalid = validationKey === "validation.siteInvalid";
  const competitorInputInvalid =
    validationKey === "validation.competitorsRequired" ||
    validationKey === "validation.competitorInvalid" ||
    validationKey === "validation.competitorSelf" ||
    validationKey === "validation.competitorDuplicate" ||
    validationKey === "validation.competitorLimit";

  function addCompetitor(): void {
    setValidationKey(null);
    const normalized = normalizeCompetitorKeywordGapDomain(competitorInput);
    if (normalized === null) {
      setValidationKey("validation.competitorInvalid");
      return;
    }
    const normalizedSite = normalizeCompetitorKeywordGapDomain(siteDomain);
    if (normalizedSite !== null && normalized === normalizedSite) {
      setValidationKey("validation.competitorSelf");
      return;
    }
    if (competitorDomains.includes(normalized)) {
      setValidationKey("validation.competitorDuplicate");
      return;
    }
    if (competitorDomains.length >= COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS) {
      setValidationKey("validation.competitorLimit");
      return;
    }
    setCompetitorDomains([...competitorDomains, normalized]);
    setCompetitorInput("");
  }

  function removeCompetitor(domain: string): void {
    setCompetitorDomains(
      competitorDomains.filter((candidate) => candidate !== domain),
    );
    setValidationKey(null);
  }

  function selectMarket(next: string): void {
    setMarketCode(next);
    setLanguageCode(MARKET_LANGUAGE[next] ?? "en");
  }

  function selectProperty(next: string): void {
    setProperty(next);
    if (next === "") return;
    const derivedDomain = propertySiteDomain(next);
    if (derivedDomain !== null) {
      setSiteDomain(derivedDomain);
      setValidationKey(null);
    }
  }

  function isCurrent(controller: AbortController): boolean {
    return (
      mounted.current &&
      activeRequest.current === controller &&
      !controller.signal.aborted
    );
  }

  /**
   * `overrideProperty` exists for the "run without the GSC layer" recovery:
   * the state setter has not committed by the time this runs, so the caller
   * passes the value it just chose rather than letting the closure read the
   * previous frame.
   */
  async function run(overrideProperty?: string): Promise<void> {
    if (submissionLocked.current) return;
    const normalizedSite = normalizeCompetitorKeywordGapDomain(siteDomain);
    if (normalizedSite === null) {
      setValidationKey("validation.siteInvalid");
      return;
    }
    if (competitorDomains.length === 0) {
      setValidationKey("validation.competitorsRequired");
      return;
    }
    if (competitorDomains.includes(normalizedSite)) {
      setValidationKey("validation.competitorSelf");
      return;
    }

    setValidationKey(null);
    setErrorCode(null);
    submissionLocked.current = true;
    setEnvelope(null);
    setResultProperty("");
    const requestedProperty = overrideProperty ?? property;
    const controller = new AbortController();
    activeRequest.current = controller;
    setPhase("running");
    let stage: "auth" | "tool" = "auth";
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        signal: controller.signal,
      });
      const sessionBody = (await sessionResponse.json()) as {
        readonly signedIn?: unknown;
      };
      if (!isCurrent(controller)) return;
      if (!sessionResponse.ok || typeof sessionBody.signedIn !== "boolean") {
        setErrorCode("auth_unavailable");
        setPhase("idle");
        return;
      }
      if (!sessionBody.signedIn) {
        setSignInOpen(true);
        setPhase("idle");
        return;
      }

      stage = "tool";
      trackMarketingEvent("tool_start", {
        tool_name: "competitor_keyword_gap",
      });
      const requestBody = {
        ...(requestedProperty === "" ? {} : { property: requestedProperty }),
        siteDomain: normalizedSite,
        competitorDomains,
        marketCode,
        languageCode,
        // The contract version this bundle was built against; the server
        // refuses a mismatch before spending anything on the run.
        acceptSchemaVersion: COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
      };
      const response = await fetch("/api/tools/competitor-keyword-gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });
      const body: unknown = await response.json();
      if (!isCurrent(controller)) return;
      const nextEnvelope = responseEnvelope(body);
      if (!response.ok || nextEnvelope === null) {
        const nextCode = responseErrorCode(body);
        setErrorCode(
          nextCode !== null && isKnownErrorCode(nextCode)
            ? nextCode
            : nextEnvelope === null && hasMismatchedRunSchemaVersion(body)
              ? "client_out_of_date"
              : "unknown",
        );
        if (nextCode === "auth_required") setSignInOpen(true);
        setPhase("idle");
        return;
      }
      setResultProperty(requestedProperty);
      setEnvelope(nextEnvelope);
      setPhase("done");
      trackMarketingEvent("tool_complete", {
        tool_name: "competitor_keyword_gap",
      });
    } catch {
      if (!isCurrent(controller)) return;
      setErrorCode(stage === "auth" ? "auth_unavailable" : "unknown");
      setPhase("idle");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        submissionLocked.current = false;
      }
    }
  }

  return (
    <section
      id="competitor-keyword-gap-tool"
      data-locale={locale}
      aria-busy={phase === "running"}
      className="min-w-0"
    >
      <div data-competitor-gap-form className={PANEL}>
        <h2 className="text-[17px] font-semibold text-text-dark-primary">
          {t("form.title")}
        </h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("form.intro")}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label htmlFor="competitor-gap-site-domain">
            <span className={FIELD_LABEL}>{t("fields.siteDomain.label")}</span>
            <input
              id="competitor-gap-site-domain"
              name="siteDomain"
              type="text"
              autoComplete="off"
              value={siteDomain}
              onChange={(event) => {
                setSiteDomain(event.target.value);
                setValidationKey(null);
              }}
              aria-describedby={
                siteInputInvalid ? "competitor-gap-validation" : undefined
              }
              aria-invalid={siteInputInvalid || undefined}
              placeholder={t("fields.siteDomain.placeholder")}
              disabled={phase === "running"}
              className={FIELD}
            />
          </label>

          <label htmlFor="competitor-gap-property">
            <span className={FIELD_LABEL}>{t("fields.property.label")}</span>
            <select
              id="competitor-gap-property"
              name="property"
              ref={propertyRef}
              value={property}
              onChange={(event) => selectProperty(event.target.value)}
              disabled={phase === "running"}
              className={FIELD}
            >
              <option value="">{t("fields.property.none")}</option>
              {(properties ?? []).map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="competitor-gap-market">
            <span className={FIELD_LABEL}>{t("fields.market.label")}</span>
            <select
              id="competitor-gap-market"
              name="marketCode"
              value={marketCode}
              onChange={(event) => selectMarket(event.target.value)}
              disabled={phase === "running"}
              className={FIELD}
            >
              {(markets.length === 0 ? [firstMarket] : markets).map(
                (market) => (
                  <option key={market} value={market}>
                    {market}
                  </option>
                ),
              )}
            </select>
          </label>

          <label htmlFor="competitor-gap-language">
            <span className={FIELD_LABEL}>{t("fields.language.label")}</span>
            <select
              id="competitor-gap-language"
              name="languageCode"
              value={languageCode}
              onChange={(event) => setLanguageCode(event.target.value)}
              disabled={phase === "running"}
              className={FIELD}
            >
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5">
          <div className="flex items-end justify-between gap-4">
            <label
              htmlFor="competitor-gap-competitor"
              className="min-w-0 flex-1"
            >
              <span className={FIELD_LABEL}>{t("competitors.label")}</span>
              <input
                id="competitor-gap-competitor"
                name="competitorDomain"
                type="text"
                autoComplete="off"
                value={competitorInput}
                onChange={(event) => {
                  setCompetitorInput(event.target.value);
                  setValidationKey(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addCompetitor();
                }}
                placeholder={t("competitors.placeholder")}
                aria-describedby={
                  competitorInputInvalid
                    ? "competitor-gap-validation"
                    : undefined
                }
                aria-invalid={competitorInputInvalid || undefined}
                disabled={phase === "running"}
                className={FIELD}
              />
            </label>
            <button
              type="button"
              onClick={addCompetitor}
              disabled={phase === "running"}
              className={SECONDARY_BUTTON}
            >
              {t("competitors.add")}
            </button>
          </div>
          <p className="mt-2 text-right font-mono text-[11px] text-text-dark-secondary">
            {t("competitors.count", { count: competitorDomains.length })}
          </p>
          {competitorDomains.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {competitorDomains.map((domain) => (
                <li
                  key={domain}
                  data-competitor-chip
                  className="inline-flex items-center gap-2 rounded-full border border-brand-border-strong bg-brand-panel-sunken px-3 py-1.5 font-mono text-[11px] text-text-dark-primary"
                >
                  <span>{domain}</span>
                  <button
                    type="button"
                    data-remove-competitor={domain}
                    onClick={() => removeCompetitor(domain)}
                    disabled={phase === "running"}
                    aria-label={t("competitors.remove", { domain })}
                    className="rounded-full px-1 text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-brand-accent"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {validationKey !== null ? (
          <p
            id="competitor-gap-validation"
            role="alert"
            className="mt-4 text-[12.5px] text-brand-error"
          >
            {t(validationKey as Parameters<typeof t>[0])}
          </p>
        ) : null}

        {errorCode !== null ? (
          <div
            role="alert"
            className="mt-4 rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[12.5px] text-brand-error"
          >
            {t(
              `errors.${isKnownErrorCode(errorCode) ? errorCode : "unknown"}` as Parameters<
                typeof t
              >[0],
            )}
            {isGscPreflightCode(errorCode) && property !== "" ? (
              <button
                type="button"
                data-run-without-gsc
                disabled={phase === "running"}
                onClick={() => {
                  setProperty("");
                  void run("");
                }}
                className="mt-3 flex items-center rounded-[10px] border border-brand-error/40 px-3 py-2 text-[12px] font-medium text-brand-error transition hover:border-brand-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-error disabled:opacity-60"
              >
                {t("actions.runWithoutGsc")}
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === "running" ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-4 text-[12.5px] text-text-dark-secondary"
          >
            {t("running.elapsed", { seconds: elapsedSeconds })}
          </p>
        ) : phase === "done" ? (
          <p role="status" aria-live="polite" className="sr-only">
            {t("running.complete")}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void run()}
          disabled={phase === "running"}
          className={`${BUTTON} mt-6`}
        >
          {phase === "running" ? t("actions.running") : t("actions.run")}
        </button>
      </div>

      {envelope !== null ? (
        <div
          ref={resultsRef}
          data-competitor-gap-results
          className="min-w-0 scroll-mt-24"
        >
          <CompetitorKeywordGapResults
            envelope={envelope}
            locale={locale}
            selectedProperty={resultProperty}
            onFocusProperty={() => propertyRef.current?.focus()}
          />
        </div>
      ) : null}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </section>
  );
}
