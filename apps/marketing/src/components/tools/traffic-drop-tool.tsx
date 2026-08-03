// @input  -- locale, Search Console connection state, public /api/tools/traffic-drop response
// @output -- connect prompt, run state, and the rendered diagnosis
// @pos    -- primary client surface for /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
import { ArrowRight, LineChart, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type {
  ManualActionStatus,
  TrafficDailyPoint,
  TrafficDropResult,
} from "@sf/public-tools";
import type { GoogleConsentNotice } from "@/lib/tools/traffic-drop-session";
import { localePath } from "@/lib/locale-path";
import { formatPropertyLabel } from "@/lib/tools/property-label";
import { TrafficDropResults } from "./traffic-drop-results";

interface TrafficDropPayload {
  readonly result: TrafficDropResult;
  readonly series: readonly TrafficDailyPoint[];
}

interface TrafficDropToolProps {
  readonly locale: string;
  /**
   * Properties the signed-in user granted read access to.
   *
   * `null` means no Search Console grant is in place — either the visitor has
   * not connected, or the connect flow is not open yet. The component never
   * infers a connection from the absence of an error.
   */
  readonly properties: readonly string[] | null;
  /**
   * How many properties the grant covers, which is not always how many are
   * listed: a long list is trimmed to fit in one cookie. When it differs, the
   * page says so instead of presenting the short list as the whole grant.
   */
  readonly propertyTotal: number;
  /** False until the Google grant flow is live in this environment. */
  readonly connectEnabled: boolean;
  /** What Google will put in front of the visitor, if anything. */
  readonly consentNotice: GoogleConsentNotice;
}

export function TrafficDropTool({
  locale,
  properties,
  propertyTotal,
  connectEnabled,
  consentNotice,
}: TrafficDropToolProps) {
  const t = useTranslations("tools.trafficDrop");
  const [property, setProperty] = useState(properties?.[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [payload, setPayload] = useState<TrafficDropPayload | null>(null);
  /**
   * What the visitor told us about their Manual Actions page.
   *
   * Held here rather than in the results component so a re-run for any other
   * reason keeps the answer. It rides along with the request because the
   * engine owns which output path the answer selects; deriving that in the
   * browser would put the same rule in two places, and the browser's copy is
   * the one that would drift.
   */
  const [manualAction, setManualAction] =
    useState<ManualActionStatus>("not_checked");

  async function run(target: string, answer: ManualActionStatus) {
    setLoading(true);
    setErrorCode(null);
    setPayload(null);
    try {
      const response = await fetch("/api/tools/traffic-drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property: target, manualAction: answer }),
      });
      const body = (await response.json()) as {
        data?: TrafficDropPayload;
        error?: { code?: string };
      };
      if (!response.ok || !body.data) {
        setErrorCode(body.error?.code ?? "unknown");
        return;
      }
      setPayload(body.data);
    } catch {
      setErrorCode("unknown");
    } finally {
      setLoading(false);
    }
  }

  if (properties === null) {
    return (
      <section
        id="traffic-drop-tool"
        data-locale={locale}
        className="scroll-mt-8 rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-6 md:p-7"
      >
        <div className="flex size-11 items-center justify-center rounded-xl border border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text">
          <LineChart aria-hidden="true" className="size-5" />
        </div>
        <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-text-dark-primary">
          {t("connectTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-text-dark-secondary">
          {t("connectBody")}
        </p>

        {!connectEnabled ? (
          <p className="mt-5 rounded-xl border border-brand-border/60 bg-brand-bg/60 p-4 text-[13px] leading-relaxed text-text-dark-secondary">
            {t("connectPending")}
          </p>
        ) : consentNotice === "invite_only" ? (
          /*
           * The consent screen is in Testing: only accounts on its tester list
           * can authorize, everyone else is hard-blocked. The notice leads and
           * the authorize link stays secondary — an invited tester loses one
           * click, a stranger learns why instead of hitting a wall.
           */
          <div className="mt-5 rounded-xl border border-brand-warning/30 bg-[rgba(212,168,67,0.07)] p-4">
            <p className="text-[13px] font-semibold text-text-dark-primary">
              {t("inviteOnlyTitle")}
            </p>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
              {t("inviteOnlyBody")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href={`/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
                  localePath(locale, "/tools/traffic-drop-diagnosis"),
                )}`}
                className="inline-flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-brand-accent-text hover:underline"
              >
                {t("inviteOnlyCta")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <Link
                href={localePath(locale, "/contact")}
                className="text-[13px] text-text-dark-secondary hover:underline"
              >
                {t("inviteOnlyRequest")}
              </Link>
            </div>
          </div>
        ) : consentNotice === "unverified" ? (
          /*
           * Published, but Google has not finished verifying the sensitive
           * scope, so everyone passes an "app isn't verified" interstitial.
           * Anyone can get through, so the button stays primary — but the
           * screen they are about to meet is described first, including the
           * exact wording to look for. Being surprised by that page is what
           * loses people; being told about it beforehand mostly does not.
           */
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-brand-warning/30 bg-[rgba(212,168,67,0.07)] p-4">
              <p className="text-[13px] font-semibold text-text-dark-primary">
                {t("unverifiedTitle")}
              </p>
              <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
                {t("unverifiedBody")}
              </p>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
                {t("unverifiedScope")}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={`/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
                  localePath(locale, "/tools/traffic-drop-diagnosis"),
                )}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover"
              >
                {t("connectCta")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <p className="flex items-center gap-2 text-[12px] text-text-dark-secondary">
                <ShieldCheck aria-hidden="true" className="size-4" />
                {t("connectTrust")}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={`/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
                localePath(locale, "/tools/traffic-drop-diagnosis"),
              )}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover"
            >
              {t("connectCta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <p className="flex items-center gap-2 text-[12px] text-text-dark-secondary">
              <ShieldCheck aria-hidden="true" className="size-4" />
              {t("connectTrust")}
            </p>
          </div>
        )}
      </section>
    );
  }

  // Authorized, but the account owns no verified property. A real state, and
  // one the session layer already models — but the page used to render it as
  // an empty dropdown next to a greyed-out button and say nothing at all,
  // which reads as broken rather than as an answer.
  if (properties.length === 0) {
    return (
      <section
        id="traffic-drop-tool"
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
      id="traffic-drop-tool"
      data-locale={locale}
      className="scroll-mt-8 space-y-5"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="text-[13px] text-text-dark-secondary"
          htmlFor="traffic-drop-property"
        >
          {t("propertyLabel")}
        </label>
        <select
          id="traffic-drop-property"
          value={property}
          onChange={(event) => setProperty(event.target.value)}
          className="min-h-11 rounded-xl border border-brand-border bg-brand-bg-alt px-3 text-[13px] text-text-dark-primary"
        >
          {/* The value stays the property id; only the label is humanised. */}
          {properties.map((entry) => (
            <option key={entry} value={entry}>
              {formatPropertyLabel(entry)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void run(property, manualAction)}
          disabled={loading || property === ""}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover disabled:opacity-60"
        >
          {/* "Run again" before anything has run is an instruction to repeat
              something that never happened. */}
          {loading ? t("running") : payload ? t("rerun") : t("run")}
        </button>
      </div>

      {propertyTotal > properties.length ? (
        <p className="text-[12px] text-text-dark-secondary">
          {t("propertiesTruncated", {
            shown: properties.length,
            total: propertyTotal,
          })}
        </p>
      ) : null}

      {errorCode ? (
        <p
          role="status"
          className="rounded-xl border border-brand-error/40 bg-[rgba(217,87,87,0.08)] p-4 text-[13px] leading-relaxed text-text-dark-primary"
        >
          {t(`errors.${errorCode}`)}
        </p>
      ) : null}

      {payload ? (
        <>
          {/* Bounds are null when the property returned no rows; we say so
              rather than printing today's date as if it were data. */}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-dark-secondary">
            <span>
              {payload.result.dataEndDate
                ? t("dataThrough", { date: payload.result.dataEndDate })
                : t("notAvailable")}{" "}
              · {t("dataThroughNote")}
            </span>
            <span>
              {t("historyCovered", { days: payload.result.dayCount })}
              {payload.result.dataStartDate
                ? ` · ${t("historyFrom", { date: payload.result.dataStartDate })}`
                : ""}
            </span>
          </p>
          <TrafficDropResults
            result={payload.result}
            series={payload.series}
            locale={locale}
            busy={loading}
            onManualActionAnswer={(status) => {
              // Answering costs a second run. The alternative was recomputing
              // the affected output in the browser, which would put the rule
              // that decides what the report may say about penalties in two
              // places — and the browser's copy is the one that would drift.
              // The gate allows ten runs an hour; a visitor answers once.
              setManualAction(status);
              void run(property, status);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
