// @input  -- locale, GSC state, quick-wins API, consent-gated event tracker
// @output -- connect/run/evidence states plus tool_start/tool_complete analytics
// @pos    -- primary client surface for /[locale]/tools/seo-quick-wins
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QuickWinsResult } from "@sf/public-tools";
import type { GoogleConsentNotice } from "@/lib/tools/traffic-drop-session";
import { formatPropertyLabel } from "@/lib/tools/property-label";
import { trackMarketingEvent } from "@/components/layout/google-analytics";
import { GscConnectPanel } from "./gsc-connect-panel";
import { QuickWinsResults } from "./quick-wins-results";

const TOOL_PATH = "/tools/seo-quick-wins";
const SECTION_ID = "quick-wins-tool";

/** Shared surfaces, so this tool and the traffic-drop tool read as one console. */
const PANEL =
  "scroll-mt-8 rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const FIELD_LABEL =
  "block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const FIELD_BASE =
  "mt-2 h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-text-dark-primary transition-colors outline-none placeholder:text-text-dark-faint focus:border-brand-accent/70";
/** The property is an identifier, so it reads in mono; the brand list is prose. */
const SELECT_FIELD = `${FIELD_BASE} font-mono text-[13px]`;
const TEXT_FIELD = `${FIELD_BASE} text-[13.5px]`;

interface QuickWinsToolProps {
  readonly locale: string;
  /**
   * Properties the visitor granted read access to.
   *
   * `null` means no grant is in place. The component never infers a connection
   * from the absence of an error.
   */
  readonly properties: readonly string[] | null;
  /** How many the grant covers, which is not always how many are listed. */
  readonly propertyTotal: number;
  readonly connectEnabled: boolean;
  readonly consentNotice: GoogleConsentNotice;
}

/** Split on commas so a visitor can paste "acme, acme corp" as they think of it. */
function parseBrandTerms(raw: string): string[] {
  return raw
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term !== "");
}

export function QuickWinsTool({
  locale,
  properties,
  propertyTotal,
  connectEnabled,
  consentNotice,
}: QuickWinsToolProps) {
  const t = useTranslations("tools.quickWins");
  const [property, setProperty] = useState(properties?.[0] ?? "");
  const [brandInput, setBrandInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<QuickWinsResult | null>(null);

  async function run(target: string) {
    trackMarketingEvent("tool_start", { tool_name: "seo_quick_wins" });
    setLoading(true);
    setErrorCode(null);
    setResult(null);
    try {
      const response = await fetch("/api/tools/quick-wins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property: target,
          brandTerms: parseBrandTerms(brandInput),
        }),
      });
      const body = (await response.json()) as {
        data?: { result?: QuickWinsResult };
        error?: { code?: string };
      };
      if (!response.ok || !body.data?.result) {
        setErrorCode(body.error?.code ?? "unknown");
        return;
      }
      setResult(body.data.result);
      trackMarketingEvent("tool_complete", { tool_name: "seo_quick_wins" });
    } catch {
      setErrorCode("unknown");
    } finally {
      setLoading(false);
    }
  }

  if (properties === null) {
    return (
      <GscConnectPanel
        locale={locale}
        namespace="tools.quickWins"
        toolPath={TOOL_PATH}
        sectionId={SECTION_ID}
        icon={<Search aria-hidden="true" className="size-[18px]" />}
        connectEnabled={connectEnabled}
        consentNotice={consentNotice}
      />
    );
  }

  // Authorized, but the account owns no verified property. A real state that
  // reads as broken unless the page says which one it is.
  if (properties.length === 0) {
    return (
      <section id={SECTION_ID} data-locale={locale} className={PANEL}>
        <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
          {t("noPropertyTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("noPropertyBody")}
        </p>
      </section>
    );
  }

  return (
    <section id={SECTION_ID} data-locale={locale} className={PANEL}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block">
          <span className={FIELD_LABEL}>{t("propertyLabel")}</span>
          <select
            value={property}
            onChange={(event) => setProperty(event.target.value)}
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
          <span className={FIELD_LABEL}>{t("brandLabel")}</span>
          <input
            type="text"
            value={brandInput}
            onChange={(event) => setBrandInput(event.target.value)}
            placeholder={t("brandPlaceholder")}
            className={TEXT_FIELD}
          />
        </label>
      </div>

      <p className="mt-3 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("brandHint")}
      </p>

      {propertyTotal > properties.length ? (
        <p className="mt-3 text-[12.5px] text-text-dark-secondary">
          {t("propertiesTruncated", { total: propertyTotal })}
        </p>
      ) : null}

      <button
        type="button"
        disabled={loading || property === ""}
        aria-busy={loading}
        onClick={() => void run(property)}
        className="mt-5 inline-flex h-12.5 items-center justify-center rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60 disabled:shadow-none"
      >
        {loading ? t("running") : result ? t("rerun") : t("run")}
      </button>

      {/*
        The run takes tens of seconds and replaces the page below it. Someone
        not watching the button — a screen reader user, or anyone who tabbed
        away — otherwise gets no signal that it started or that it finished.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {loading
          ? t("running")
          : result
            ? t("statusDone", { count: result.rows.length })
            : ""}
      </p>

      {errorCode !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-[10px] border border-brand-warning/25 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
        >
          {/*
           * Unknown codes fall back to the generic unavailable message rather
           * than rendering the raw code: a visitor cannot act on a string we
           * did not plan for, and showing it reads as a crash.
           */}
          {t(
            `errors.${
              [
                "gsc_unavailable",
                "scan_in_progress",
                "rate_limited",
                "quota_unavailable",
                "invalid_request",
                "payload_too_large",
                "unsupported_media_type",
              ].includes(errorCode)
                ? errorCode
                : "gsc_unavailable"
            }`,
          )}
        </p>
      ) : null}

      {result !== null ? (
        <QuickWinsResults result={result} locale={locale} />
      ) : null}
    </section>
  );
}
