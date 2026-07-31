// @input  -- locale, Search Console connection state, public /api/tools/traffic-drop response
// @output -- connect prompt, run state, and the rendered diagnosis
// @pos    -- primary client surface for /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
import { ArrowRight, LineChart, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { TrafficDailyPoint, TrafficDropResult } from "@sf/public-tools";
import { localePath } from "@/lib/locale-path";
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
  /** False until the Google grant flow is live in this environment. */
  readonly connectEnabled: boolean;
  /** True while Google's consent screen still limits authorization to testers. */
  readonly inviteOnly: boolean;
}

export function TrafficDropTool({
  locale,
  properties,
  connectEnabled,
  inviteOnly,
}: TrafficDropToolProps) {
  const t = useTranslations("tools.trafficDrop");
  const [property, setProperty] = useState(properties?.[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [payload, setPayload] = useState<TrafficDropPayload | null>(null);

  async function run(target: string) {
    setLoading(true);
    setErrorCode(null);
    setPayload(null);
    try {
      const response = await fetch("/api/tools/traffic-drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property: target }),
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
        ) : inviteOnly ? (
          /*
           * Google's consent screen is still in Testing, so only accounts on
           * its tester list can authorize. The notice comes first and the
           * authorize link stays secondary: an invited tester gets through in
           * one extra click, while everyone else is told why before Google
           * stops them — which is the difference between a limitation and a
           * broken button.
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
          {properties.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void run(property)}
          disabled={loading || property === ""}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover disabled:opacity-60"
        >
          {loading ? t("running") : t("rerun")}
        </button>
      </div>

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
          />
        </>
      ) : null}
    </section>
  );
}
