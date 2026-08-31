// @input  -- locale, granted GSC properties, the SERP market/language allow-lists, authenticated APIs
// @output -- the brief form (primary, supporting, market, language, profile, property), the
//            session-first run flow, and reopenable settings beside the frozen result
// @pos    -- primary client surface for the Marketing Content Brief Builder

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CONTENT_BRIEF_SCHEMA,
  type ContentBrief,
} from "@sf/public-tools/content-brief/contract";
import {
  RUN_BUDGET_MS,
  SERP_DEPTH,
  SUPPORTING_KEYWORDS_MAX,
  isWhitespaceTokenizedLanguage,
} from "@sf/public-tools/content-brief/constants";

import {
  DEFAULT_SERP_LANGUAGE,
  DEFAULT_SERP_MARKET,
  SERP_LANGUAGE_OPTIONS,
  SERP_MARKET_OPTIONS,
} from "../../lib/tools/serp-markets.ts";
import { SignInDialog } from "../auth/sign-in-dialog";
import { trackMarketingEvent } from "../layout/google-analytics";
import { isContentBriefErrorCode } from "./content-brief-codes";
import { ContentBriefResults } from "./content-brief-results";
import {
  countSupportingInput,
  parseSupportingInput,
} from "./content-brief-supporting-input";
import { useAccountWebsites } from "./content-brief-websites";

const PANEL =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const FIELD_LABEL =
  "block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const FIELD =
  "mt-2 h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-[13.5px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";
const TEXTAREA =
  "mt-2 min-h-24 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 py-3 text-[13.5px] leading-[1.5] text-text-dark-primary outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";
const HELP = "mt-2 text-[11.5px] leading-[1.5] text-text-dark-secondary";
const BUTTON =
  "inline-flex h-12.5 items-center justify-center rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";

type Phase = "idle" | "running" | "done";

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
 * The shape guard a 200 has to pass before it renders.
 *
 * Deliberately shallow: the draft-side `parse-brief` is the full zod parser,
 * and re-running it here would double the client bundle for a check the
 * server already made. What this catches is a body from a different route
 * or contract version, which is the one thing a cached or proxied response
 * can hand back with a 200.
 */
const BRIEF_FIELDS = [
  "keyword",
  "evidence",
  "verdict",
  "intent",
  "format",
  "length",
  "must_answer",
  "outline",
  "gap_angle",
  "internal_links",
  "do_not_cover",
  "draft_readiness",
  "budget",
] as const;

function responseBrief(body: unknown): ContentBrief | null {
  if (!isRecord(body) || body.schema !== CONTENT_BRIEF_SCHEMA) return null;
  if (!isRecord(body.run) || !isRecord(body.run.reads)) return null;
  if (typeof body.run.mode !== "string" || typeof body.run.fingerprint !== "string") {
    return null;
  }
  for (const field of BRIEF_FIELDS) {
    if (!isRecord(body[field])) return null;
  }
  return body as unknown as ContentBrief;
}

export interface ContentBriefToolProps {
  readonly locale: string;
  readonly properties: readonly string[] | null;
}

export function ContentBriefTool({ locale, properties }: ContentBriefToolProps) {
  const t = useTranslations("tools.contentBrief");
  const websites = useAccountWebsites();
  const [signInOpen, setSignInOpen] = useState(false);
  const [primary, setPrimary] = useState("");
  const [supportingInput, setSupportingInput] = useState("");
  const [market, setMarket] = useState(DEFAULT_SERP_MARKET);
  const [language, setLanguage] = useState(DEFAULT_SERP_LANGUAGE);
  const [websiteId, setWebsiteId] = useState("");
  const [property, setProperty] = useState("");
  const [validationKey, setValidationKey] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  // Native disclosure state can change before its queued toggle event fires.
  // Keep one source of truth and explicitly close/reopen only at run outcomes.
  const settingsRef = useRef<HTMLDetailsElement | null>(null);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const submissionLocked = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

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
    if (brief === null) return;
    resultsRef.current?.focus({ preventScroll: true });
    resultsRef.current?.scrollIntoView({ block: "start" });
  }, [brief]);

  const primaryInvalid = validationKey === "validation.primaryRequired";
  const supportingInvalid = validationKey === "validation.supportingLimit";
  const languageUnsupported = !isWhitespaceTokenizedLanguage(language);
  const hasProperties = properties !== null && properties.length > 0;
  const websiteSelectDisabled =
    phase === "running" || websites.phase !== "ready";

  function isCurrent(controller: AbortController): boolean {
    return (
      mounted.current &&
      activeRequest.current === controller &&
      !controller.signal.aborted
    );
  }

  async function run(): Promise<void> {
    if (submissionLocked.current) return;
    const primaryKeyword = primary.replace(/\s+/gu, " ").trim();
    if (primaryKeyword === "") {
      setValidationKey("validation.primaryRequired");
      return;
    }
    const parsed = parseSupportingInput(supportingInput);
    if (!parsed.ok) {
      setValidationKey(parsed.validationKey);
      return;
    }

    setValidationKey(null);
    setErrorCode(null);
    submissionLocked.current = true;
    setBrief(null);
    const controller = new AbortController();
    activeRequest.current = controller;
    setPhase("running");
    let stage: "auth" | "tool" = "auth";
    try {
      // Session first, always: a signed-out visitor gets the dialog and the
      // paid endpoint is never called (handoff §8 item 17).
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
        settingsRef.current?.setAttribute("open", "");
        setPhase("idle");
        return;
      }
      if (!sessionBody.signedIn) {
        settingsRef.current?.setAttribute("open", "");
        setSignInOpen(true);
        setPhase("idle");
        return;
      }

      stage = "tool";
      trackMarketingEvent("tool_start", { tool_name: "content_brief" });
      const requestBody = {
        primary: primaryKeyword,
        supporting: parsed.keywords,
        market,
        language,
        ...(websiteId === "" ? {} : { website_id: websiteId }),
        ...(property === "" ? {} : { gsc_property: property }),
      };
      const response = await fetch("/api/tools/content-brief/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });
      const body: unknown = await response.json();
      if (!isCurrent(controller)) return;
      const nextBrief = responseBrief(body);
      if (!response.ok || nextBrief === null) {
        const nextCode = responseErrorCode(body);
        setErrorCode(
          nextCode !== null && isContentBriefErrorCode(nextCode)
            ? nextCode
            : "unknown",
        );
        if (nextCode === "auth_required") setSignInOpen(true);
        settingsRef.current?.setAttribute("open", "");
        setPhase("idle");
        return;
      }
      setBrief(nextBrief);
      settingsRef.current?.removeAttribute("open");
      setPhase("done");
      trackMarketingEvent("tool_complete", { tool_name: "content_brief" });
    } catch {
      if (!isCurrent(controller)) return;
      setErrorCode(stage === "auth" ? "auth_unavailable" : "unknown");
      settingsRef.current?.setAttribute("open", "");
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
      id="content-brief-tool"
      data-locale={locale}
      aria-busy={phase === "running"}
      className="mx-auto min-w-0 max-w-[880px]"
    >
      <details
        data-brief-settings
        ref={settingsRef}
        open
        className="rounded-[6px] border border-brand-border-card bg-brand-panel"
      >
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
          {t("form.settings")}
          {brief !== null ? (
            <span className="ml-2 text-[11.5px] font-normal text-text-dark-secondary">
              {t("form.reopen")}
            </span>
          ) : null}
        </summary>
      <form
        data-content-brief-form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        className={PANEL}
      >
        <h2 className="text-[17px] font-semibold text-text-dark-primary">
          {t("form.title")}
        </h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("form.intro", { depth: SERP_DEPTH })}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label htmlFor="content-brief-primary" className="md:col-span-2">
            <span className={FIELD_LABEL}>{t("fields.primary.label")}</span>
            <input
              id="content-brief-primary"
              name="primary"
              type="text"
              autoComplete="off"
              value={primary}
              onChange={(event) => {
                setPrimary(event.target.value);
                setValidationKey(null);
              }}
              aria-describedby={primaryInvalid ? "content-brief-validation" : undefined}
              aria-invalid={primaryInvalid || undefined}
              placeholder={t("fields.primary.placeholder")}
              disabled={phase === "running"}
              className={FIELD}
            />
          </label>

          <div className="md:col-span-2">
            <label htmlFor="content-brief-supporting" className="block">
              <span className={FIELD_LABEL}>{t("fields.supporting.label")}</span>
              <textarea
                id="content-brief-supporting"
                name="supporting"
                autoComplete="off"
                value={supportingInput}
                onChange={(event) => {
                  setSupportingInput(event.target.value);
                  setValidationKey(null);
                }}
                aria-describedby={
                  supportingInvalid
                    ? "content-brief-validation"
                    : "content-brief-supporting-hint"
                }
                aria-invalid={supportingInvalid || undefined}
                placeholder={t("fields.supporting.placeholder")}
                disabled={phase === "running"}
                className={TEXTAREA}
              />
            </label>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <p
                id="content-brief-supporting-hint"
                data-supporting-hint
                className="text-[11.5px] leading-[1.5] text-text-dark-secondary"
              >
                {t("fields.supporting.hint", { max: SUPPORTING_KEYWORDS_MAX })}
              </p>
              <p
                data-supporting-count
                className="font-mono text-[11px] text-text-dark-secondary"
              >
                {t("fields.supporting.count", {
                  count: countSupportingInput(supportingInput),
                  max: SUPPORTING_KEYWORDS_MAX,
                })}
              </p>
            </div>
          </div>

          <label htmlFor="content-brief-market">
            <span className={FIELD_LABEL}>{t("fields.market.label")}</span>
            <select
              id="content-brief-market"
              name="market"
              value={market}
              onChange={(event) => setMarket(event.target.value)}
              disabled={phase === "running"}
              className={FIELD}
            >
              {SERP_MARKET_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <label htmlFor="content-brief-language" className="block">
              <span className={FIELD_LABEL}>{t("fields.language.label")}</span>
              <select
                id="content-brief-language"
                name="language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                disabled={phase === "running"}
                aria-describedby={
                  languageUnsupported ? "content-brief-language-hint" : undefined
                }
                className={FIELD}
              >
                {SERP_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.code} · {option.label}
                  </option>
                ))}
              </select>
            </label>
            {languageUnsupported ? (
              <p
                id="content-brief-language-hint"
                data-language-unsupported
                className="mt-2 text-[11.5px] leading-[1.5] text-brand-warning"
              >
                {t("fields.language.unsupported")}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="content-brief-website" className="block">
              <span className={FIELD_LABEL}>{t("fields.website.label")}</span>
              <select
                id="content-brief-website"
                name="websiteId"
                value={websiteId}
                onChange={(event) => setWebsiteId(event.target.value)}
                disabled={websiteSelectDisabled}
                aria-describedby="content-brief-website-help"
                data-websites-phase={websites.phase}
                className={FIELD}
              >
                <option value="">{t("fields.website.none")}</option>
                {websites.phase === "ready"
                  ? websites.websites.map((website) => (
                      <option key={website.websiteId} value={website.websiteId}>
                        {(website.displayName ?? website.host) +
                          (website.isPrimary
                            ? ` · ${t("fields.website.primary")}`
                            : "")}
                      </option>
                    ))
                  : null}
              </select>
            </label>
            <p id="content-brief-website-help" className={HELP}>
              {t("fields.website.help")}
            </p>
            {websites.phase === "loading" ? (
              <p aria-live="polite" className={HELP}>{t("fields.website.loading")}</p>
            ) : websites.phase === "signed_out" ? (
              <p data-website-signed-out className={HELP}>{t("fields.website.signedOut")}</p>
            ) : websites.phase === "unavailable" ? (
              <p data-website-unavailable className={HELP}>{t("fields.website.unavailable")}</p>
            ) : websites.websites.length === 0 ? (
              <p data-website-empty className={HELP}>{t("fields.website.empty")}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="content-brief-property" className="block">
              <span className={FIELD_LABEL}>{t("fields.property.label")}</span>
              <select
                id="content-brief-property"
                name="gscProperty"
                value={property}
                onChange={(event) => setProperty(event.target.value)}
                disabled={phase === "running" || !hasProperties}
                aria-describedby="content-brief-property-help"
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
            <p id="content-brief-property-help" className={HELP}>
              {t("fields.property.help")}
            </p>
            {hasProperties ? null : (
              <p data-property-not-connected className={HELP}>
                {t("fields.property.notConnected")}
              </p>
            )}
          </div>
        </div>

        {validationKey !== null ? (
          <p
            id="content-brief-validation"
            role="alert"
            className="mt-4 text-[12.5px] text-brand-error"
          >
            {t(validationKey as Parameters<typeof t>[0], {
              max: SUPPORTING_KEYWORDS_MAX,
            })}
          </p>
        ) : null}

        {errorCode !== null ? (
          <div
            role="alert"
            data-error-code={errorCode}
            className="mt-4 rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[12.5px] text-brand-error"
          >
            {t(
              `errors.${isContentBriefErrorCode(errorCode) ? errorCode : "unknown"}` as Parameters<
                typeof t
              >[0],
              { max: SUPPORTING_KEYWORDS_MAX },
            )}
          </div>
        ) : null}

        {phase === "running" ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-4 text-[12.5px] text-text-dark-secondary"
          >
            {t("running.elapsed", {
              seconds: elapsedSeconds,
              budget: Math.round(RUN_BUDGET_MS / 1000),
            })}
          </p>
        ) : phase === "done" ? (
          <p role="status" aria-live="polite" className="sr-only">
            {t("running.complete")}
          </p>
        ) : null}

        <button
          type="submit"
          data-run-brief
          disabled={phase === "running"}
          className={`${BUTTON} mt-6`}
        >
          {phase === "running" ? t("actions.running") : t("actions.run")}
        </button>
      </form>
      </details>

      {brief !== null ? (
        <div
          ref={resultsRef}
          data-content-brief-result
          role="region"
          aria-label={t("run.resultLabel", { keyword: brief.keyword.primary })}
          tabIndex={-1}
          className="min-w-0 scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          <ContentBriefResults brief={brief} locale={locale} />
        </div>
      ) : null}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </section>
  );
}
