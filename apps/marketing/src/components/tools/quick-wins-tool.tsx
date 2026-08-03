// @input  -- locale, Search Console connection state, public /api/tools/quick-wins response
// @output -- connect prompt, run state, and the rendered evidence table
// @pos    -- primary client surface for /[locale]/tools/seo-quick-wins
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QuickWinsResult } from "@sf/public-tools";
import type { GoogleConsentNotice } from "@/lib/tools/traffic-drop-session";
import { formatPropertyLabel } from "@/lib/tools/property-label";
import { GscConnectPanel } from "./gsc-connect-panel";
import { QuickWinsResults } from "./quick-wins-results";

const TOOL_PATH = "/tools/seo-quick-wins";
const SECTION_ID = "quick-wins-tool";

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
        icon={<Search aria-hidden="true" className="size-5" />}
        connectEnabled={connectEnabled}
        consentNotice={consentNotice}
      />
    );
  }

  // Authorized, but the account owns no verified property. A real state that
  // reads as broken unless the page says which one it is.
  if (properties.length === 0) {
    return (
      <section
        id={SECTION_ID}
        data-locale={locale}
        className="scroll-mt-8 rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-6 md:p-7"
      >
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-text-dark-primary">
          {t("noPropertyTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-text-dark-secondary">
          {t("noPropertyBody")}
        </p>
      </section>
    );
  }

  return (
    <section
      id={SECTION_ID}
      data-locale={locale}
      className="scroll-mt-8 rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-6 md:p-7"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-medium text-text-dark-primary">
            {t("propertyLabel")}
          </span>
          <select
            value={property}
            onChange={(event) => setProperty(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-brand-border/70 bg-brand-bg px-3 py-2.5 text-[13px] text-text-dark-primary"
          >
            {properties.map((candidate) => (
              <option key={candidate} value={candidate}>
                {formatPropertyLabel(candidate)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[13px] font-medium text-text-dark-primary">
            {t("brandLabel")}
          </span>
          <input
            type="text"
            value={brandInput}
            onChange={(event) => setBrandInput(event.target.value)}
            placeholder={t("brandPlaceholder")}
            className="mt-1.5 w-full rounded-xl border border-brand-border/70 bg-brand-bg px-3 py-2.5 text-[13px] text-text-dark-primary"
          />
        </label>
      </div>

      <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary">
        {t("brandHint")}
      </p>

      {propertyTotal > properties.length ? (
        <p className="mt-3 text-[12px] text-text-dark-secondary">
          {t("propertiesTruncated", { total: propertyTotal })}
        </p>
      ) : null}

      <button
        type="button"
        disabled={loading || property === ""}
        aria-busy={loading}
        onClick={() => void run(property)}
        className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover disabled:opacity-60"
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
          className="mt-4 rounded-xl border border-brand-warning/40 bg-[rgba(212,168,67,0.07)] p-4 text-[13px] leading-relaxed text-text-dark-secondary"
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
