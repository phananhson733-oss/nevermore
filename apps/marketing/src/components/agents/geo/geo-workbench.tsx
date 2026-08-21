// @input  -- visitor context, the session probe, and the GEO run API
// @output -- a confirm-first workbench that spends nothing until every fact is confirmed
// @pos    -- primary client workbench for the independent /agents/geo route

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Radar } from "lucide-react";

import { SignInDialog } from "../../auth/sign-in-dialog";
import {
  buildGeoContextSourceSummary,
  confirmGeoContext,
  proposeGeoAliasCandidates,
  type GeoAliasCandidateV1,
  type GeoContextSnapshotV1,
} from "../../../lib/agents/geo-context";
import {
  buildGeoCoreQuerySet,
  confirmGeoQuerySet,
  editGeoQueryText,
} from "../../../lib/agents/geo-questions";
import {
  geoPlannedCallCount,
  type GeoQuerySetV1,
} from "../../../lib/agents/geo-query-contract";
import {
  AGENT_GEO_REPORT_SCHEMA_VERSION,
  isGeoReportSuccessEnvelope,
  type GeoReportDataV3,
} from "../../../lib/agents/geo-report-contract";
import {
  clearGeoReportSession,
  geoSessionStorage,
  restoreGeoReportSession,
  saveGeoReportSession,
} from "../../../lib/agents/geo-session-state";
import { GeoQueryReview, GeoRunPlan } from "./geo-query-review";
import { GeoReportView } from "./geo-report-view";

type Stage = "context" | "review" | "queries" | "running" | "report";
type SessionStatus = "signed_in" | "signed_out" | "unavailable";

async function getSessionStatus(signal?: AbortSignal): Promise<SessionStatus> {
  const response = await fetch("/api/auth/session", {
    signal,
    cache: "no-store",
  });
  if (!response.ok) return "unavailable";
  const body = (await response.json()) as { readonly signedIn?: unknown };
  if (body.signedIn === true) return "signed_in";
  if (body.signedIn === false) return "signed_out";
  return "unavailable";
}

function splitList(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 6);
}

/**
 * The markets the confirm step offers.
 *
 * A list rather than a free-text field, and with no preselected value. The
 * calibration ran with US settings, so any other country is honestly labelled
 * uncalibrated further down — but a missing market stops the run rather than
 * quietly becoming US, and "EU" and "UK" are not on the list because neither is
 * a country code the provider accepts.
 */
const MARKETS = [
  "US",
  "GB",
  "CA",
  "AU",
  "IE",
  "NZ",
  "DE",
  "FR",
  "NL",
  "ES",
  "IT",
  "SE",
  "DK",
  "NO",
  "FI",
  "PL",
  "PT",
  "BR",
  "MX",
  "JP",
  "KR",
  "SG",
  "IN",
  "ZA",
] as const;

const FIELD_CLASS =
  "h-11 w-full rounded-[10px] border border-brand-border-strong bg-brand-panel-sunken px-3 text-[13.5px] text-text-dark-primary placeholder:text-text-dark-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const LABEL_CLASS = "block text-[12px] font-medium text-text-dark-primary";
const HINT_CLASS = "mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary";
const PRIMARY_BUTTON_CLASS =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-accent/50 bg-brand-panel px-5 text-[13.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const GHOST_BUTTON_CLASS =
  "inline-flex h-11 items-center justify-center rounded-[10px] border border-brand-border-strong bg-transparent px-4 text-[13px] text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const CHECKBOX_CLASS =
  "size-4 shrink-0 accent-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

export function GeoWorkbench({ locale }: { readonly locale: string }) {
  const t = useTranslations("agents.geo");
  const [stage, setStage] = useState<Stage>("context");

  const [url, setUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [buyer, setBuyer] = useState("");
  const [jtbd, setJtbd] = useState("");
  const [rivals, setRivals] = useState("");
  const [marketCode, setMarketCode] = useState("");

  const [aliases, setAliases] = useState<readonly GeoAliasCandidateV1[]>([]);
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  const [context, setContext] = useState<GeoContextSnapshotV1 | null>(null);
  const [querySet, setQuerySet] = useState<GeoQuerySetV1 | null>(null);
  const [report, setReport] = useState<GeoReportDataV3 | null>(null);

  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [rejections, setRejections] = useState<readonly string[]>([]);
  const [signInOpen, setSignInOpen] = useState(false);

  // Concurrency control lives in refs so a second submit cannot start a second
  // paid run, and so an unmounted component never writes state.
  const mounted = useRef(true);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  /**
   * The current query set, readable from a callback that was created earlier.
   *
   * A `useCallback` closes over the state of the render that created it, so an
   * edit handler reading `querySet` directly would keep re-deriving from the
   * first set the visitor ever saw. The ref is the fix, and it is the same one
   * a sibling Agent workbench needed for the same reason.
   */
  const querySetRef = useRef<GeoQuerySetV1 | null>(null);
  /**
   * The confirmed context, readable from the same callbacks, for the same
   * reason. An edit re-derives the brand stance from the names in this
   * snapshot, and reading the state directly would derive every edit against
   * the context of the first render — which is `null`.
   */
  const contextRef = useRef<GeoContextSnapshotV1 | null>(null);
  /**
   * The banner that says why a run stopped.
   *
   * It renders at the top of the workbench while the button that starts a run
   * sits at the bottom of a long question list, and a failure also sends the
   * visitor back to that list. Without moving to it, a refused run looks exactly
   * like a button that did nothing — which is how a real visitor read a run that
   * had already been billed for eighteen provider calls.
   */
  const alertRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (errorCode === null && rejections.length === 0) return;
    const node = alertRef.current;
    if (node === null) return;
    node.scrollIntoView?.({ block: "center", behavior: "auto" });
    // Focus follows the scroll so keyboard and screen-reader users land on the
    // reason too, rather than on whatever the previous stage left focused.
    node.focus();
  }, [errorCode, rejections]);

  useEffect(() => {
    querySetRef.current = querySet;
  }, [querySet]);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  /**
   * Put a finished report back after a same-tab navigation.
   *
   * The language switcher calls `router.push`, which remounts this route and
   * loses every piece of component state — including a report that cost
   * eighteen provider calls. Without this, switching to English after a run
   * dropped the visitor back on an empty form with no way to reach what they
   * had just paid for, and the obvious next move is to run it again.
   *
   * Restoration is a read. It issues no request, reserves no budget and calls
   * no provider; a stored payload that fails any part of the guard is deleted
   * instead of rendered.
   */
  useEffect(() => {
    const restored = restoreGeoReportSession(geoSessionStorage(), new Date());
    if (restored === null) return;
    setContext(restored.context);
    contextRef.current = restored.context;
    setQuerySet(restored.querySet);
    querySetRef.current = restored.querySet;
    setReport(restored.report);
    setStage("report");

    // The form fields too, not only the confirmed snapshot. Restoring the
    // report alone left "Back" pointing at a review step built from empty
    // inputs: a category confirmation checkbox with no category, no alias to
    // tick, and a Confirm button that could never enable — a dead end reachable
    // in two clicks from a working report. Found by cross-model review,
    // 2026-08-19.
    const snapshot = restored.context;
    setUrl(snapshot.targetUrl);
    setProductName(snapshot.productName);
    setCategory(snapshot.category);
    setBuyer(snapshot.buyer);
    setJtbd(snapshot.jtbd);
    setRivals(snapshot.directCompetitors.join(", "));
    setMarketCode(snapshot.marketCode);
    // Every alias in a confirmed snapshot is one the visitor ticked; the
    // snapshot cannot hold an unconfirmed one.
    setAliases(
      snapshot.brandAliases.map((alias) => ({ ...alias, confirmed: true })),
    );
    setCategoryConfirmed(true);
  }, []);

  const errorMessage = useCallback(
    (code: string | null): string | null => {
      if (code === null) return null;
      const known = [
        "auth_required",
        "auth_unavailable",
        "invalid_request",
        "geo_client_outdated",
        "geo_context_invalid",
        "geo_query_set_invalid",
        "geo_query_set_unconfirmed",
        "geo_query_set_mismatch",
        "geo_brand_stance_mismatch",
        "geo_prompt_too_long",
        "geo_plan_size_mismatch",
        "geo_budget_exhausted",
        "geo_budget_unavailable",
        "geo_time_budget_exhausted",
        "geo_provider_unavailable",
        "geo_report_invalid",
      ];
      return t(`errors.${known.includes(code) ? code : "unknown"}`);
    },
    [t],
  );

  /**
   * Move to the confirm step, proposing aliases without confirming any.
   *
   * The proposal is regenerated from the current URL and product name every
   * time, and every candidate arrives unticked. A derived alias that inherited
   * a previous confirmation would be a fact the visitor never agreed to.
   */
  const handleProposeContext = useCallback(() => {
    setErrorCode(null);
    setRejections([]);
    setAliases(proposeGeoAliasCandidates(url.trim(), productName.trim()));
    setCategoryConfirmed(false);
    setStage("review");
  }, [productName, url]);

  const handleToggleAlias = useCallback((alias: string) => {
    setAliases((current) =>
      current.map((candidate) =>
        candidate.alias === alias
          ? { ...candidate, confirmed: !candidate.confirmed }
          : candidate,
      ),
    );
  }, []);

  const handleConfirmContext = useCallback(async () => {
    setErrorCode(null);
    setRejections([]);
    const competitors = splitList(rivals);
    const confirmed = await confirmGeoContext(
      {
        targetUrl: url.trim(),
        productName: productName.trim(),
        brandAliases: aliases,
        category: category.trim(),
        categoryConfirmed,
        buyer: buyer.trim(),
        user: "",
        jtbd: jtbd.trim(),
        useCases: [],
        outcomes: [],
        barriers: [],
        directCompetitors: competitors,
        indirectAlternatives: [],
        marketCode,
        targetQueryLanguage: "en",
        sourceProfileVersion: "geo-context.local.v1",
        sourceSummary: buildGeoContextSourceSummary({
          hasCompetitors: competitors.length > 0,
          hasJtbd: jtbd.trim().length > 0,
          aliasSources: aliases
            .filter((candidate) => candidate.confirmed)
            .map((candidate) => candidate.source),
        }),
      },
      () => new Date(),
    );
    if (!mounted.current) return;
    if (!confirmed.ok) {
      setRejections(confirmed.rejections);
      return;
    }

    const built = await buildGeoCoreQuerySet(
      confirmed.snapshot,
      () => new Date(),
    );
    if (!mounted.current) return;
    if (!built.ok) {
      setRejections(built.rejections.map((entry) => entry.code));
      return;
    }
    setContext(confirmed.snapshot);
    contextRef.current = confirmed.snapshot;
    setQuerySet(built.querySet);
    setStage("queries");
  }, [
    aliases,
    buyer,
    category,
    categoryConfirmed,
    jtbd,
    marketCode,
    productName,
    rivals,
    url,
  ]);

  /**
   * Apply an edit, which changes the query set's identity.
   *
   * Editing is expected — it is what the confirm step is for — and it has
   * consequences the contract makes visible: a new content fingerprint, a
   * cleared confirmation, and a retrieval probe demoted out of measured status
   * because its citation counts only meant something for the exact string
   * somebody paid to measure.
   */
  const handleQueryEdit = useCallback((queryId: string, text: string) => {
    const current = querySetRef.current;
    const snapshot = contextRef.current;
    if (current === null || snapshot === null) return;

    // Shown immediately so typing does not lag behind the caret; the awaited
    // result replaces it with the properly re-fingerprinted, demoted set.
    const optimistic: GeoQuerySetV1 = {
      ...current,
      queries: current.queries.map((query) =>
        query.queryId === queryId ? { ...query, text } : query,
      ),
    };
    querySetRef.current = optimistic;
    setQuerySet(optimistic);

    void editGeoQueryText(current, queryId, text, snapshot).then((result) => {
      if (!mounted.current) return;
      // A slower keystroke's result must not overwrite a faster one. The
      // fingerprint is async, so results can land out of order.
      const latest = querySetRef.current;
      const stillCurrent = latest?.queries.some(
        (query) => query.queryId === queryId && query.text === text,
      );
      if (stillCurrent !== true) return;
      if (!result.ok) {
        /*
         * A refused edit puts the last accepted set back.
         *
         * The optimistic set carries the new text under the old fingerprint,
         * sample plan and mode. Leaving it there after a refusal — emptying the
         * field, or pasting something too long to pay for — left the plan panel
         * counting three samples for a question with no text, and the run
         * button offering to buy them. The server refuses such a set before
         * billing, so no money was ever at stake; the count on screen was
         * simply not the count that would run.
         */
        querySetRef.current = current;
        setQuerySet(current);
        return;
      }
      querySetRef.current = result.querySet;
      setQuerySet(result.querySet);
    });
  }, []);

  const handleRun = useCallback(async () => {
    if (busy.current || context === null || querySet === null) return;
    busy.current = true;
    setErrorCode(null);

    try {
      // Checked before the request so a signed-out visitor sees the dialog
      // instead of a 401, and so no paid call is ever attempted for them.
      const session = await getSessionStatus();
      if (session !== "signed_in") {
        if (!mounted.current) return;
        setErrorCode(session === "unavailable" ? "auth_unavailable" : null);
        if (session === "signed_out") setSignInOpen(true);
        return;
      }

      const confirmedSet = await confirmGeoQuerySet(querySet, () => new Date());
      if (!mounted.current) return;
      setQuerySet(confirmedSet);
      setStage("running");

      const controller = new AbortController();
      abort.current = controller;
      const response = await fetch("/api/agents/geo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          // Declares which contract this bundle can read. A tab left open
          // across a deploy still runs the previous guard, and the server
          // refuses the run on this field alone rather than after billing
          // eighteen provider calls for a report this client would discard.
          schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
          context,
          querySet: confirmedSet,
        }),
      });

      const envelope: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;

      if (!response.ok) {
        const code =
          typeof envelope === "object" &&
          envelope !== null &&
          "error" in envelope &&
          typeof (envelope as { error?: { code?: unknown } }).error?.code ===
            "string"
            ? (envelope as { error: { code: string } }).error.code
            : "unknown";
        setErrorCode(code);
        setStage("queries");
        return;
      }

      // Validated with the same guard the server used. A payload that fails
      // here is a contract break, not a report, and is never rendered.
      if (!isGeoReportSuccessEnvelope(envelope)) {
        setErrorCode("geo_report_invalid");
        setStage("queries");
        return;
      }

      // Stored before it is rendered, so a language switch a second later still
      // finds it. Only what the report itself contains: no auth state, no
      // credentials, no account identity, and nothing that outlives the tab.
      saveGeoReportSession(
        geoSessionStorage(),
        { context, querySet: confirmedSet, report: envelope.data },
        new Date(),
      );
      setReport(envelope.data);
      setStage("report");
    } catch {
      if (!mounted.current) return;
      setErrorCode("unknown");
      setStage("queries");
    } finally {
      busy.current = false;
      abort.current = null;
    }
  }, [context, querySet]);

  const contextReady =
    url.trim().length > 3 &&
    productName.trim().length > 1 &&
    category.trim().length > 1 &&
    buyer.trim().length > 1 &&
    marketCode.length === 2;
  const confirmReady =
    categoryConfirmed && aliases.some((candidate) => candidate.confirmed);
  const message = errorMessage(errorCode);

  return (
    <div id="geo-agent-workbench" className="scroll-mt-24">
      <div
        ref={alertRef}
        tabIndex={-1}
        className="scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        {message !== null && (
          <p
            role="alert"
            className="mb-4 rounded-row border border-brand-border-dashed bg-brand-panel-sunken px-4 py-3 text-[12.5px] text-text-dark-primary"
          >
            {message}
          </p>
        )}
        {rejections.length > 0 && (
          <ul
            role="alert"
            className="mb-4 grid gap-1 rounded-row border border-brand-border-dashed bg-brand-panel-sunken px-4 py-3"
          >
            {rejections.map((code) => (
              <li key={code} className="text-[12.5px] text-text-dark-primary">
                {t(`rejections.${code}`)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {stage === "context" && (
        <section className="rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6">
          <h2 className="text-[16px] font-semibold text-text-dark-primary">
            {t("workbench.contextTitle")}
          </h2>
          <p className={HINT_CLASS}>{t("workbench.contextHint")}</p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-url">
                {t("workbench.urlLabel")}
              </label>
              <input
                id="geo-url"
                className={`${FIELD_CLASS} mt-1.5`}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("workbench.urlPlaceholder")}
                autoComplete="url"
                inputMode="url"
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-product">
                {t("workbench.productLabel")}
              </label>
              <input
                id="geo-product"
                className={`${FIELD_CLASS} mt-1.5`}
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder={t("workbench.productPlaceholder")}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-category">
                {t("workbench.categoryLabel")}
              </label>
              <input
                id="geo-category"
                className={`${FIELD_CLASS} mt-1.5`}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={t("workbench.categoryPlaceholder")}
              />
              <p className={HINT_CLASS}>{t("workbench.categoryHint")}</p>
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-buyer">
                {t("workbench.buyerLabel")}
              </label>
              <input
                id="geo-buyer"
                className={`${FIELD_CLASS} mt-1.5`}
                value={buyer}
                onChange={(event) => setBuyer(event.target.value)}
                placeholder={t("workbench.buyerPlaceholder")}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-jtbd">
                {t("workbench.jtbdLabel")}
              </label>
              <input
                id="geo-jtbd"
                className={`${FIELD_CLASS} mt-1.5`}
                value={jtbd}
                onChange={(event) => setJtbd(event.target.value)}
                placeholder={t("workbench.jtbdPlaceholder")}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-rivals">
                {t("workbench.rivalsLabel")}
              </label>
              <input
                id="geo-rivals"
                className={`${FIELD_CLASS} mt-1.5`}
                value={rivals}
                onChange={(event) => setRivals(event.target.value)}
              />
              <p className={HINT_CLASS}>{t("workbench.rivalsHint")}</p>
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-market">
                {t("workbench.marketLabel")}
              </label>
              <select
                id="geo-market"
                className={`${FIELD_CLASS} mt-1.5`}
                value={marketCode}
                onChange={(event) => setMarketCode(event.target.value)}
              >
                <option value="">{t("workbench.marketPlaceholder")}</option>
                {MARKETS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <p className={HINT_CLASS}>{t("workbench.marketHint")}</p>
            </div>
            <div>
              <span className={LABEL_CLASS}>
                {t("workbench.queryLanguageLabel")}
              </span>
              <p className="mt-1.5 flex h-11 items-center rounded-[10px] border border-brand-border-dashed px-3 font-mono text-[12px] text-text-dark-secondary">
                en
              </p>
              <p className={HINT_CLASS}>{t("workbench.queryLanguageHint")}</p>
            </div>
          </div>

          <button
            type="button"
            className={`${PRIMARY_BUTTON_CLASS} mt-5`}
            disabled={!contextReady}
            onClick={handleProposeContext}
          >
            {t("workbench.review")}
            <Radar aria-hidden="true" className="size-4" />
          </button>
        </section>
      )}

      {stage === "review" && (
        <section className="rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6">
          <h2 className="text-[16px] font-semibold text-text-dark-primary">
            {t("review.title")}
          </h2>
          <p className={HINT_CLASS}>{t("review.hint")}</p>

          <h3 className="mt-5 text-[12.5px] font-semibold text-text-dark-primary">
            {t("review.aliasesTitle")}
          </h3>
          <p className={HINT_CLASS}>{t("review.aliasesHint")}</p>
          <ul className="mt-2 grid gap-2">
            {aliases.map((candidate) => (
              <li key={candidate.alias} className="flex items-start gap-2">
                <input
                  id={`geo-alias-${candidate.alias}`}
                  type="checkbox"
                  className={`${CHECKBOX_CLASS} mt-1`}
                  checked={candidate.confirmed}
                  onChange={() => handleToggleAlias(candidate.alias)}
                />
                <label
                  className="text-[12.5px] leading-[1.5] text-text-dark-primary"
                  htmlFor={`geo-alias-${candidate.alias}`}
                >
                  {candidate.alias}
                  <span className="ml-2 font-mono text-[10.5px] text-text-dark-tertiary">
                    {t(`review.aliasSource.${candidate.source}`)}
                  </span>
                </label>
              </li>
            ))}
            {aliases.length === 0 && (
              <li className="text-[12.5px] text-text-dark-secondary">
                {t("review.aliasesEmpty")}
              </li>
            )}
          </ul>

          <h3 className="mt-5 text-[12.5px] font-semibold text-text-dark-primary">
            {t("review.categoryTitle")}
          </h3>
          <div className="mt-2 flex items-start gap-2">
            <input
              id="geo-category-confirm"
              type="checkbox"
              className={`${CHECKBOX_CLASS} mt-1`}
              checked={categoryConfirmed}
              onChange={() => setCategoryConfirmed((current) => !current)}
            />
            <label
              className="text-[12.5px] leading-[1.5] text-text-dark-primary"
              htmlFor="geo-category-confirm"
            >
              {t("review.categoryConfirm", { category: category.trim() })}
            </label>
          </div>

          <h3 className="mt-5 text-[12.5px] font-semibold text-text-dark-primary">
            {t("review.provenanceTitle")}
          </h3>
          <ul className="mt-2 grid gap-1">
            {buildGeoContextSourceSummary({
              hasCompetitors: splitList(rivals).length > 0,
              hasJtbd: jtbd.trim().length > 0,
              aliasSources: aliases
                .filter((candidate) => candidate.confirmed)
                .map((candidate) => candidate.source),
            }).map((entry) => (
              <li
                key={entry.field}
                className="text-[11.5px] leading-[1.55] text-text-dark-secondary"
              >
                <span className="font-mono text-[10.5px] text-text-dark-tertiary">
                  {t(`review.field.${entry.field}`)}
                </span>{" "}
                {t(`review.source.${entry.source}`)}
                {entry.limitationCode !== null && (
                  <> · {t(`review.limitation.${entry.limitationCode}`)}</>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-[1.55] text-text-dark-tertiary">
            {t("review.notVerified")}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              disabled={!confirmReady}
              onClick={() => {
                void handleConfirmContext();
              }}
            >
              {t("review.confirm")}
            </button>
            <button
              type="button"
              className={GHOST_BUTTON_CLASS}
              onClick={() => setStage("context")}
            >
              {t("workbench.back")}
            </button>
          </div>
        </section>
      )}

      {(stage === "queries" || stage === "running") &&
        context !== null &&
        querySet !== null && (
          <section className="grid gap-4 rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6">
            <GeoQueryReview
              querySet={querySet}
              context={context}
              disabled={stage === "running"}
              onEdit={handleQueryEdit}
            />
            <GeoRunPlan querySet={querySet} context={context} />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={PRIMARY_BUTTON_CLASS}
                disabled={stage === "running"}
                onClick={() => {
                  void handleRun();
                }}
              >
                {stage === "running" ? (
                  <>
                    <Loader2
                      aria-hidden="true"
                      className="size-4 motion-safe:animate-spin"
                    />
                    {t("workbench.running")}
                  </>
                ) : (
                  t("workbench.run", { calls: geoPlannedCallCount(querySet) })
                )}
              </button>
              {stage === "queries" && (
                <button
                  type="button"
                  className={GHOST_BUTTON_CLASS}
                  onClick={() => setStage("review")}
                >
                  {t("workbench.back")}
                </button>
              )}
            </div>
            {stage === "running" && (
              <p className={HINT_CLASS}>{t("workbench.runningHint")}</p>
            )}
          </section>
        )}

      {stage === "report" &&
        report !== null &&
        context !== null &&
        querySet !== null && (
          <GeoReportView
            report={report}
            capture={{ context, querySet }}
            locale={locale}
            onRestart={() => {
              // Starting over forgets the stored report as well as the rendered
              // one. A restore that outlived the visitor's own "back" would put
              // the report they just dismissed back on screen.
              clearGeoReportSession(geoSessionStorage());
              setReport(null);
              setStage("queries");
            }}
          />
        )}

      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </div>
  );
}
