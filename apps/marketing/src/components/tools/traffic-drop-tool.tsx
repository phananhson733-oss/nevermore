// @input  -- locale, GSC state, one scope-aware Daily Briefing handoff, diagnosis API
// @output -- property-owned prefill, connect/run/diagnosis states, analytics
// @pos    -- primary client surface for /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, LineChart, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { TrafficDailyPoint, TrafficDropResult } from "@sf/public-tools";
import type { GoogleConsentNotice } from "@/lib/tools/traffic-drop-session";
import { localePath } from "../../lib/locale-path";
import { formatPropertyLabel } from "../../lib/tools/property-label";
import { consumeToolHandoff } from "../../lib/tools/tool-handoff";
import { trackMarketingEvent } from "../layout/google-analytics";
import { gscAuthorizeHref } from "./gsc-connect-panel";
import { GscDisconnect } from "./gsc-disconnect";
import { TrafficDropResults } from "./traffic-drop-results";
import {
  answersFor,
  emptyDraft,
  TrafficDropSelfCheckGate,
  type SelfCheckDraft,
} from "./traffic-drop-self-check-gate";

const TOOL_PATH = "/tools/traffic-drop-diagnosis";

/**
 * Every code this surface has copy for.
 *
 * Listed rather than derived: the handler's codes come from the shared error
 * envelope and from the admission gate, and next-intl throws on a key it does
 * not have — so an unlisted code would replace the report with a crash.
 */
const TRAFFIC_DROP_ERROR_CODES: readonly string[] = [
  "no_gsc_data",
  "gsc_unavailable",
  "gsc_revoked",
  "gsc_temporarily_unavailable",
  "scan_in_progress",
  "rate_limited",
  "quota_unavailable",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "unknown",
];

/** Shared surfaces, so the connect state and the report read as one console. */
const PANEL =
  "scroll-mt-8 rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const PRIMARY_CTA =
  "inline-flex h-12.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const FIELD_LABEL =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";

interface TrafficDropPayload {
  readonly result: TrafficDropResult;
  readonly series: readonly TrafficDailyPoint[];
  /**
   * The property this report is about.
   *
   * Carried on the payload rather than read from the selector, because the
   * selector moves and the report does not. Switching sites after a run used
   * to leave the dropdown saying B while the chart, the numbers and the
   * recorded self-check answers below were all still A's, with nothing naming
   * A anywhere on the page.
   */
  readonly property: string;
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
  /**
   * Mechanical brand-term guesses per property, for the visitor to correct.
   *
   * Derived on the server because the module that builds them lives in a
   * package that reaches `node:net`. They are a form's starting value and
   * nothing else: the split refuses to run until the visitor has confirmed
   * the list, because a domain-derived guess is wrong in both directions —
   * too narrow to match how people type the brand, and too wide the moment it
   * is shortened to a word that is also a topic.
   */
  readonly brandCandidates?: Readonly<Record<string, readonly string[]>>;
}

export function TrafficDropTool({
  locale,
  properties,
  propertyTotal,
  connectEnabled,
  consentNotice,
  brandCandidates,
}: TrafficDropToolProps) {
  const t = useTranslations("tools.trafficDrop");
  const [property, setProperty] = useState(properties?.[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [payload, setPayload] = useState<TrafficDropPayload | null>(null);
  /**
   * What the visitor found on the two Search Console pages we cannot read.
   *
   * Collected BEFORE the run, and the run is blocked until both are in. The
   * answers ride along with the request because the engine owns which output
   * path they select; deriving that in the browser would put the same rule in
   * two places, and the browser's copy is the one that would drift.
   */
  const [selfChecks, setSelfChecks] = useState<SelfCheckDraft>(() =>
    emptyDraft(properties?.[0] ?? ""),
  );
  /**
   * Set when an input changes after a report was rendered.
   *
   * The report stays on screen — it is still a true report of the answers it
   * was built from, and blanking it would throw away work the visitor paid a
   * Search Console call for. But it is no longer a report of what the form now
   * says, and saying nothing about that is how a stale verdict gets read as a
   * current one.
   */
  const [stale, setStale] = useState(false);
  /**
   * The brand list, as text the visitor can edit.
   *
   * Seeded from the server's candidates for the selected property, and sent
   * only when `brandConfirmed` is set. Without that flag the engine reports
   * `brand_terms_not_confirmed` and withholds the split — which is the whole
   * point: nothing here is evidence until a person has looked at it.
   */
  const [brandInput, setBrandInput] = useState(
    (brandCandidates?.[properties?.[0] ?? ""] ?? []).join(", "),
  );
  const [brandConfirmed, setBrandConfirmed] = useState(false);
  const [handoffImported, setHandoffImported] = useState(false);

  const brandTerms = brandInput
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term !== "");

  /** Any change to what the next run would send invalidates the rendered one. */
  function invalidate() {
    setStale(true);
  }

  const selectProperty = useCallback((next: string) => {
    setProperty(next);
    setStale(true);
    // Answers are assertions about ONE site's Search Console pages. Carrying
    // them across would let a visitor who cleared site A get an all-clear for
    // site B without ever opening B's pages — the same reasoning as the brand
    // list below, with more at stake.
    setSelfChecks(emptyDraft(next));
    // A brand list belongs to one site. Carrying the previous property's terms
    // across would quietly classify the new site's queries by someone else's
    // brand, so the confirmation resets with them.
    setBrandInput((brandCandidates?.[next] ?? []).join(", "));
    setBrandConfirmed(false);
  }, [brandCandidates]);

  useEffect(() => {
    try {
      const handoff = consumeToolHandoff(
        window.sessionStorage,
        Date.now(),
        "traffic-drop-diagnosis",
      );
      if (handoff === null || !properties?.includes(handoff.property)) return;
      // All three legal scopes select only a granted property here; none
      // starts the diagnosis or carries old answers across sites. A page-scope
      // handoff's page is deliberately dropped: this tool diagnoses a property
      // and has no page input to put it in.
      selectProperty(handoff.property);
      setHandoffImported(true);
    } catch {
      // Storage access itself can be unavailable. The diagnosis form remains
      // usable; only the optional local preselection is skipped.
    }
  }, [properties, selectProperty]);

  async function run() {
    // Narrowed rather than asserted: the button is disabled without both
    // answers, but a disabled button is a UI convention, not an invariant.
    // `answersFor` also refuses answers given for a different property, so the
    // guard and the payload cannot disagree about which site was inspected.
    const answers = answersFor(selfChecks, property);
    if (answers === null) return;
    setHandoffImported(false);
    trackMarketingEvent("tool_start", { tool_name: "traffic_drop_diagnosis" });

    setLoading(true);
    setErrorCode(null);
    setPayload(null);
    setStale(false);
    try {
      const response = await fetch("/api/tools/traffic-drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property,
          selfChecks: { property, ...answers },
          brandTerms,
          brandTermsConfirmed: brandConfirmed,
        }),
      });
      const body = (await response.json()) as {
        data?: TrafficDropPayload;
        error?: { code?: string };
      };
      if (!response.ok || !body.data) {
        setErrorCode(body.error?.code ?? "unknown");
        return;
      }
      setPayload({ ...body.data, property });
      trackMarketingEvent("tool_complete", {
        tool_name: "traffic_drop_diagnosis",
      });
    } catch {
      setErrorCode("unknown");
    } finally {
      setLoading(false);
    }
  }

  if (properties === null) {
    return (
      <section id="traffic-drop-tool" data-locale={locale} className={PANEL}>
        <div className="flex size-11 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
          <LineChart aria-hidden="true" className="size-[18px]" />
        </div>
        <h2 className="mt-4 text-[16.5px] font-semibold text-text-dark-primary">
          {t("connectTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("connectBody")}
        </p>

        {!connectEnabled ? (
          <p className="mt-5 rounded-[10px] border border-brand-border bg-brand-panel-sunken p-4 text-[13px] leading-[1.6] text-text-dark-secondary">
            {t("connectPending")}
          </p>
        ) : consentNotice === "invite_only" ? (
          /*
           * The consent screen is in Testing: only accounts on its tester list
           * can authorize, everyone else is hard-blocked. The notice leads and
           * the authorize link stays secondary — an invited tester loses one
           * click, a stranger learns why instead of hitting a wall.
           */
          <div className="mt-5 rounded-[10px] border border-brand-warning/30 bg-brand-warning/[0.08] p-4">
            <p className="text-[13px] font-semibold text-text-dark-primary">
              {t("inviteOnlyTitle")}
            </p>
            <p className="mt-1.5 max-w-xl text-[13px] leading-[1.6] text-text-dark-secondary">
              {t("inviteOnlyBody")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href={gscAuthorizeHref(locale, TOOL_PATH)}
                className="inline-flex min-h-9 items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
              >
                {t("inviteOnlyCta")}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </a>
              <Link
                href={localePath(locale, "/contact")}
                className="text-[12.5px] text-text-dark-secondary transition-colors hover:text-text-dark-primary"
              >
                {t("inviteOnlyRequest")}
              </Link>
            </div>
          </div>
        ) : (
          /*
           * Nothing unusual on the way through, so nothing is prepended to the
           * button. A warning block here used to describe Google's "app isn't
           * verified" interstitial; that screen only appears for unapproved
           * sensitive scopes, which this flow does not request.
           */
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={gscAuthorizeHref(locale, TOOL_PATH)}
              className={PRIMARY_CTA}
            >
              {t("connectCta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <p className="flex items-center gap-2 text-[12.5px] text-text-dark-secondary">
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
      <section id="traffic-drop-tool" data-locale={locale} className={PANEL}>
        <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
          {t("noPropertyTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("noPropertyBody")}
        </p>
        {/* Connected, just with nothing to run against — and a visitor who
            authorized the wrong account needs the way out most here. */}
        <GscDisconnect namespace="tools.trafficDrop" />
      </section>
    );
  }

  return (
    <section
      id="traffic-drop-tool"
      data-locale={locale}
      className="scroll-mt-8 space-y-4"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className={FIELD_LABEL} htmlFor="traffic-drop-property">
          {t("propertyLabel")}
        </label>
        <select
          id="traffic-drop-property"
          value={property}
          onChange={(event) => {
            selectProperty(event.target.value);
            setHandoffImported(false);
          }}
          className="h-12.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-3.5 font-mono text-[13px] text-text-dark-primary transition-colors outline-none focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {/* The value stays the property id; only the label is humanised. */}
          {properties.map((entry) => (
            <option key={entry} value={entry}>
              {formatPropertyLabel(entry)}
            </option>
          ))}
        </select>
      </div>

      {handoffImported ? (
        <p
          role="status"
          className="rounded-[10px] border border-brand-accent/25 bg-brand-accent/[0.08] px-4 py-3 text-[12.5px] leading-[1.6] text-text-dark-secondary"
        >
          {t("handoffNotice")}
        </p>
      ) : null}

      {/*
       * The gate. Both answers are required before anything runs: they decide
       * what the report is allowed to say, and a report built without them has
       * to hedge every sentence — which is the version the visitor reads first
       * and remembers.
       */}
      <TrafficDropSelfCheckGate
        value={selfChecks}
        disabled={loading}
        onChange={(next) => {
          setSelfChecks(next);
          invalidate();
          setHandoffImported(false);
        }}
      />

      {/*
       * The brand list. Optional — leaving it alone costs one observation and
       * nothing else, and the report says which one and why. It is here rather
       * than inside the results because confirming it after a run would mean
       * paying for a second run to use it.
       */}
      <div className="rounded-card border border-brand-border-card bg-brand-panel p-[22px]">
        <label className={FIELD_LABEL} htmlFor="traffic-drop-brand-terms">
          {t("brandTerms.label")}
        </label>
        <p className="mt-2 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("brandTerms.help")}
        </p>
        <input
          id="traffic-drop-brand-terms"
          type="text"
          value={brandInput}
          onChange={(event) => {
            setBrandInput(event.target.value);
            // Editing invalidates the confirmation. Otherwise a visitor ticks
            // the box, then changes the terms, and the run uses a list nobody
            // approved.
            setBrandConfirmed(false);
            invalidate();
            setHandoffImported(false);
          }}
          placeholder={t("brandTerms.placeholder")}
          className="mt-3 h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-[13.5px] text-text-dark-primary transition-colors outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        />
        <label className="mt-3 flex items-start gap-2.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          <input
            type="checkbox"
            checked={brandConfirmed}
            disabled={brandTerms.length === 0}
            onChange={(event) => {
              setBrandConfirmed(event.target.checked);
              invalidate();
              setHandoffImported(false);
            }}
            className="mt-0.5 size-4 shrink-0 accent-brand-accent"
          />
          <span>{t("brandTerms.confirm")}</span>
        </label>
      </div>

      {/*
       * The run control, below everything it depends on. It used to sit beside
       * the property dropdown, above the gate — a greyed-out primary button
       * with the thing that unblocks it further down the page and no text
       * connecting the two, which reads as broken rather than as a next step.
       */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={
            loading ||
            property === "" ||
            answersFor(selfChecks, property) === null
          }
          className={`${PRIMARY_CTA} disabled:opacity-60 disabled:shadow-none`}
        >
          {/* "Run again" before anything has run is an instruction to repeat
              something that never happened. */}
          {loading ? t("running") : payload ? t("rerun") : t("run")}
        </button>
        {answersFor(selfChecks, property) === null && !loading ? (
          <p className="text-[12.5px] text-text-dark-secondary">
            {t("runBlockedBySelfChecks")}
          </p>
        ) : null}
      </div>

      {propertyTotal > properties.length ? (
        <p className="text-[12.5px] text-text-dark-secondary">
          {t("propertiesTruncated", {
            shown: properties.length,
            total: propertyTotal,
          })}
        </p>
      ) : null}

      {errorCode ? (
        <p
          role="status"
          className="rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-error"
        >
          {/*
           * Unknown codes fall back to the generic message rather than being
           * looked up: next-intl throws on a missing key, so a code nobody
           * planned for would replace the report with a crash.
           */}
          {t(
            `errors.${TRAFFIC_DROP_ERROR_CODES.includes(errorCode) ? errorCode : "unknown"}`,
          )}
          {/*
           * A revoked grant is the one error a visitor can fix on the spot,
           * and the only route back is the consent screen.
           */}
          {errorCode === "gsc_revoked" ? (
            <a
              href={gscAuthorizeHref(locale, TOOL_PATH)}
              className="mt-2 block font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
            >
              {t("reconnect")}
            </a>
          ) : null}
        </p>
      ) : null}

      {payload && payload.property !== property ? (
        <p
          role="status"
          className="rounded-[10px] border border-brand-warning/25 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
        >
          {t("reportIsForOtherProperty", {
            reported: formatPropertyLabel(payload.property),
            selected: formatPropertyLabel(property),
          })}
        </p>
      ) : payload && stale ? (
        <p
          role="status"
          className="rounded-[10px] border border-brand-warning/25 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
        >
          {t("staleAnswers")}
        </p>
      ) : null}

      {payload ? (
        <>
          {/* Bounds are null when the property returned no rows; we say so
              rather than printing today's date as if it were data. */}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-text-dark-secondary">
            <span className="font-mono text-[11px] tracking-[0.04em] text-text-dark-primary">
              {formatPropertyLabel(payload.property)}
            </span>
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
            property={payload.property}
          />
        </>
      ) : null}

      <GscDisconnect namespace="tools.trafficDrop" />
    </section>
  );
}
