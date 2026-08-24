// @input  -- locale, GSC grant state, Daily Briefing API, and localized client messages
// @output -- connect/no-property states plus a reset-safe property and brand-confirmation form
// @pos    -- primary client state machine for /[locale]/tools/daily-search-briefing

"use client";

import { useState } from "react";
import { BellRing, CircleAlert, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DailyBriefingEnvelope } from "@sf/public-tools";
import type { GoogleConsentNotice } from "../../lib/tools/traffic-drop-session";
import { formatPropertyLabel } from "../../lib/tools/property-label";
import { trackMarketingEvent } from "../layout/google-analytics";
import {
  DailyBriefingResultPreview,
  DailyBriefingResults,
} from "./daily-briefing-results";
import {
  GscConnectPanel,
  gscAuthorizeHref,
} from "./gsc-connect-panel";
import { GscDisconnect } from "./gsc-disconnect";

const TOOL_PATH = "/tools/daily-search-briefing";
const NAMESPACE = "tools.dailyBriefing";
const PANEL =
  "scroll-mt-8 rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const FIELD_LABEL =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const FIELD_BASE =
  "mt-2 min-h-12 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-text-dark-primary outline-none transition-colors placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

type DailyBriefingResponse = {
  readonly data?: DailyBriefingEnvelope;
  readonly meta?: {
    readonly rateLimit?: {
      readonly remaining: number | null;
      readonly limit: number;
    };
  };
  readonly error?: { readonly code?: string };
};

type RateLimitFacts = {
  readonly remaining: number | null;
  readonly limit: number;
};

type KnownErrorCode =
  | "gsc_unavailable"
  | "scan_in_progress"
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "quota_unavailable"
  | "gsc_revoked"
  | "gsc_temporarily_unavailable"
  | "unknown";

interface DailyBriefingToolProps {
  readonly locale: string;
  readonly properties: readonly string[] | null;
  readonly propertyTotal: number;
  readonly connectEnabled: boolean;
  readonly consentNotice: GoogleConsentNotice;
  readonly brandCandidates?: Readonly<Record<string, readonly string[]>>;
}

function knownErrorCode(value: string | undefined): KnownErrorCode {
  switch (value) {
    case "gsc_unavailable":
    case "scan_in_progress":
    case "invalid_request":
    case "payload_too_large":
    case "unsupported_media_type":
    case "rate_limited":
    case "quota_unavailable":
    case "gsc_revoked":
    case "gsc_temporarily_unavailable":
      return value;
    default:
      return "unknown";
  }
}

function parseBrandTerms(input: string): readonly string[] {
  return input
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term !== "");
}

export function DailyBriefingTool({
  locale,
  properties,
  propertyTotal,
  connectEnabled,
  consentNotice,
  brandCandidates,
}: DailyBriefingToolProps) {
  const t = useTranslations("tools.dailyBriefing");
  const initialProperty = properties?.[0] ?? "";
  const [property, setProperty] = useState(initialProperty);
  const [brandInput, setBrandInput] = useState(
    (brandCandidates?.[initialProperty] ?? []).join(", "),
  );
  const [brandTermsConfirmed, setBrandTermsConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<KnownErrorCode | null>(null);
  const [payload, setPayload] = useState<{
    readonly envelope: DailyBriefingEnvelope;
    readonly rateLimit: RateLimitFacts | null;
  } | null>(null);
  const brandTerms = parseBrandTerms(brandInput);

  function clearRunState() {
    setPayload(null);
    setErrorCode(null);
  }

  async function run() {
    trackMarketingEvent("tool_start", { tool_name: "daily_search_briefing" });
    setLoading(true);
    clearRunState();

    try {
      const response = await fetch("/api/tools/daily-search-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property,
          brandTerms,
          brandTermsConfirmed,
        }),
      });
      const body = (await response.json()) as DailyBriefingResponse;
      if (!response.ok || body.data === undefined) {
        setErrorCode(knownErrorCode(body.error?.code));
        return;
      }
      setPayload({
        envelope: body.data,
        rateLimit: body.meta?.rateLimit
          ? {
              remaining: body.meta.rateLimit.remaining,
              limit: body.meta.rateLimit.limit,
            }
          : null,
      });
      trackMarketingEvent("tool_complete", {
        tool_name: "daily_search_briefing",
      });
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
        namespace={NAMESPACE}
        toolPath={TOOL_PATH}
        sectionId="daily-briefing-tool"
        icon={<BellRing aria-hidden="true" className="size-[18px]" />}
        connectEnabled={connectEnabled}
        consentNotice={consentNotice}
        inviteRequestLabel={t("inviteOnlyRequest")}
      />
    );
  }

  if (properties.length === 0) {
    return (
      <section id="daily-briefing-tool" data-locale={locale} className={PANEL}>
        <div className="flex size-11 items-center justify-center rounded-[10px] border border-brand-warning/30 bg-brand-warning/[0.08] text-brand-warning">
          <CircleAlert aria-hidden="true" className="size-[18px]" />
        </div>
        <h2 className="mt-4 text-[17px] font-semibold text-text-dark-primary">
          {t("noPropertyTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {t("noPropertyBody")}
        </p>
        <GscDisconnect namespace={NAMESPACE} />
      </section>
    );
  }

  return (
    <section
      id="daily-briefing-tool"
      data-locale={locale}
      aria-busy={loading}
      className={PANEL}
    >
      <div className="flex flex-col gap-3 border-b border-brand-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className={FIELD_LABEL}>{t("facts.timeBasis")}</p>
          <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary">
            {t("run")}
          </h2>
        </div>
        <p className="max-w-xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("facts.timeBasisBody")}
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label htmlFor="daily-briefing-property" className="block min-w-0">
          <span className={FIELD_LABEL}>{t("propertyLabel")}</span>
          <select
            id="daily-briefing-property"
            name="property"
            value={property}
            onChange={(event) => {
              const next = event.target.value;
              setProperty(next);
              setBrandInput((brandCandidates?.[next] ?? []).join(", "));
              setBrandTermsConfirmed(false);
              clearRunState();
            }}
            className={`${FIELD_BASE} font-mono text-[13px]`}
          >
            {properties.map((candidate) => (
              <option key={candidate} value={candidate}>
                {formatPropertyLabel(candidate)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="daily-briefing-brand-terms" className="block min-w-0">
          <span className={FIELD_LABEL}>{t("brand.label")}</span>
          <input
            id="daily-briefing-brand-terms"
            name="brandTerms"
            type="text"
            value={brandInput}
            onChange={(event) => {
              setBrandInput(event.target.value);
              setBrandTermsConfirmed(false);
              clearRunState();
            }}
            placeholder={t("brand.placeholder")}
            className={`${FIELD_BASE} text-[13.5px]`}
          />
        </label>
      </div>

      <p className="mt-3 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("brand.hint")}
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3.5">
        <input
          name="brandTermsConfirmed"
          type="checkbox"
          checked={brandTermsConfirmed}
          onChange={(event) => {
            setBrandTermsConfirmed(event.target.checked);
            clearRunState();
          }}
          className="mt-0.5 size-4 shrink-0 accent-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        />
        <span>
          <span className="block text-[13px] font-medium text-text-dark-primary">
            {t("brand.confirm")}
          </span>
          <span className="mt-1 block text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {brandTermsConfirmed
              ? t("brand.confirmed")
              : t("brand.unconfirmed")}
          </span>
        </span>
      </label>

      {propertyTotal > properties.length ? (
        <p className="mt-3 text-[12.5px] leading-[1.55] text-brand-warning">
          {t("propertiesTruncated", {
            shown: properties.length,
            total: propertyTotal,
          })}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={loading || property === ""}
          onClick={() => void run()}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60 disabled:shadow-none"
        >
          {loading ? t("running") : payload ? t("rerun") : t("run")}
          {loading ? (
            <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
          ) : null}
        </button>
        {loading ? (
          <p
            role="status"
            aria-live="polite"
            className="text-[12.5px] text-text-dark-secondary"
          >
            {t("running")}
          </p>
        ) : null}
      </div>

      {errorCode !== null ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-[10px] border border-brand-warning/30 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
        >
          <p>{t(`errors.${errorCode}`)}</p>
          {errorCode === "gsc_revoked" ? (
            <a
              href={gscAuthorizeHref(locale, TOOL_PATH)}
              className="mt-2 inline-flex min-h-9 items-center font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {t("reconnect")}
            </a>
          ) : null}
        </div>
      ) : null}

      {payload ? (
        <DailyBriefingResults
          locale={locale}
          property={property}
          envelope={payload.envelope}
          rateLimit={payload.rateLimit}
        />
      ) : (
        <DailyBriefingResultPreview />
      )}

      <GscDisconnect namespace={NAMESPACE} />
    </section>
  );
}
