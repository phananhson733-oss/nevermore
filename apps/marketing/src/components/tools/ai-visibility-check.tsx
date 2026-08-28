"use client";

// @input  -- the signed-in visitor's frozen knowledge-base versions, and one sampling run of the questions they imply
// @output -- the cost and duration a run would spend before it starts, an honest clock while it runs, and its numbers after
// @pos    -- the only client surface of /tools/ai-visibility-check; it starts a run and renders one, it never judges one

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  GEO_VISIBILITY_SCHEMA_VERSION,
  VISIBILITY_MIN_SUCCESS_RATIO,
  VISIBILITY_RUNS_PER_DAY,
  VISIBILITY_SAMPLES_DEFAULT,
  VISIBILITY_SAMPLES_OPTIONS,
  visibilityCallCount,
  visibilityCostEstimateUsd,
  visibilityMinutesEstimate,
  type VisibilityCitedDomain,
  type VisibilityComparison,
  type VisibilityProportion,
  type VisibilityQuestionResult,
  type VisibilityReport,
} from "../../lib/geo-tools/visibility-contract.ts";
import {
  describeProportion,
  minTrialsForZeroClaim,
  normalCdf,
  Z95,
  ZERO_CLAIM_UPPER_BOUND,
  type ProportionDescription,
} from "../../lib/geo-tools/stats.ts";
import { localePath } from "../../lib/locale-path.ts";
import {
  clearVisibilityRunPointer,
  readVisibilityRunPointer,
  writeVisibilityRunPointer,
} from "./ai-visibility-run-pointer.ts";

const ENDPOINTS = {
  load: "/api/tools/ai-visibility-check/load",
  run: "/api/tools/ai-visibility-check/run",
  status: "/api/tools/ai-visibility-check/run/status",
} as const;

/** The route the empty state points at. It exists, so the button is allowed to. */
const KNOWLEDGE_BASE_PATH = "/tools/geo-knowledge-base";

/**
 * Polling floor and ceiling.
 *
 * The server's own `retryAfterSeconds` decides in between. It arrives in the
 * body rather than a header: `privateJson` sets only `Cache-Control`, so a
 * client reading `Retry-After` reads nothing and polls at the floor forever —
 * about four hundred and fifty authenticated requests for one fifteen-minute
 * answer.
 */
const POLL_DEFAULT_MS = 2_000;
const POLL_MAX_MS = 5_000;

/**
 * How long one mounted page will watch a run before it stops asking.
 *
 * A run is about a quarter of an hour, so half an hour is generous; what it
 * rules out is a tab left open overnight polling a run that will never answer.
 * The budget is per polling session rather than per run: the pointer outlives
 * it in storage, so reloading gives the visitor another window rather than
 * stranding a run that has already been paid for.
 */
const MAX_POLL_WALL_CLOCK_MS = 30 * 60 * 1_000;

/**
 * How many unreadable status replies in a row before the page stops asking.
 *
 * A run that cannot be read is not a run that failed, so the message says so;
 * what it must not do is poll a dead endpoint for the fifteen minutes the run
 * would otherwise have taken.
 */
const MAX_STATUS_FAILURES = 5;

/**
 * Error codes that mean "this stored pointer is no good", not "your run broke".
 *
 * An expired pointer opens to nothing and comes back 404; a mangled one comes
 * back 503. Neither is news to somebody who just opened the page, so a restored
 * run that gets one of these goes quietly back to the form.
 */
const STALE_POINTER_CODES = new Set([
  "not_found",
  "run_unavailable",
  "invalid_request",
]);

/** Cited URLs shown per domain. The rest are in the run, not on the page. */
const SAMPLE_URLS_SHOWN = 3;

const PANEL =
  "rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7";
const HEADING = "text-[19px] text-text-dark-primary";
const BODY = "text-[13.5px] leading-[1.7] text-text-dark-secondary";
const NOTE = "text-[12.5px] leading-[1.6] text-text-dark-secondary";
const FIELD =
  "mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary";
const PRIMARY_BUTTON =
  "rounded-lg bg-brand-accent px-4 py-2 text-[14px] font-medium text-brand-on-accent disabled:opacity-60";
const SECONDARY_BUTTON =
  "rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60";
const TH =
  "px-3 py-3 text-left font-mono text-[11px] tracking-[0.07em] whitespace-nowrap uppercase text-text-dark-secondary";
const TD = "px-3 py-3 align-top text-[13px] text-text-dark-primary";

/**
 * One frozen knowledge-base version, as the load endpoint reports it.
 *
 * The selection key is the snapshot rather than the knowledge base: one site
 * can have several frozen revisions and a run is pinned to exactly one of them.
 */
interface FrozenVersion {
  readonly kbId: string;
  readonly snapshotId: string;
  readonly host: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly questionCount: number;
  readonly retrievalCount: number;
}

/** What the load endpoint reports beside the choices themselves. */
interface LoadedChoices {
  readonly versions: readonly FrozenVersion[];
  /**
   * False only when the server says so. Absent means the account has no frozen
   * version at all, which is the empty state — refusing the button there would
   * be an answer to a question nobody asked.
   */
  readonly providerConfigured: boolean;
  readonly runsPerDay: number;
}

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  /** Queued and running are one state here: both mean "paid for, still going". */
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly report: VisibilityReport }
  | { readonly kind: "error"; readonly code: string };

type StatusOutcome =
  | { readonly kind: "running" }
  | { readonly kind: "completed"; readonly report: VisibilityReport }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "invalid" };

/* ------------------------------------------------------------------ */
/* Reading responses                                                   */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorCodeOf(value: unknown): string | null {
  const error = asRecord(asRecord(value)?.["error"]);
  const code = error?.["code"];
  return typeof code === "string" && code.length > 0 ? code : null;
}

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

/**
 * One frozen choice, field by field.
 *
 * A `as readonly FrozenVersion[]` cast is why the page shipped reading
 * `data.versions` while the handler sent `data.choices`: the assertion made
 * `undefined` typecheck as a list of versions, so nothing between the two
 * modules ever compared them. Checking the fields the form indexes into is
 * what turns that class of mistake into a load error instead of a blank page.
 */
function asFrozenVersion(value: unknown): FrozenVersion | null {
  const record = asRecord(value);
  if (record === null) return null;
  const kbId = record["kbId"];
  const snapshotId = record["snapshotId"];
  const host = record["host"];
  const frozenAt = record["frozenAt"];
  const revision = countOf(record["revision"]);
  const questionCount = countOf(record["questionCount"]);
  const retrievalCount = countOf(record["retrievalCount"]);
  if (
    typeof kbId !== "string" ||
    kbId.length === 0 ||
    typeof snapshotId !== "string" ||
    snapshotId.length === 0 ||
    typeof host !== "string" ||
    typeof frozenAt !== "string" ||
    revision === null ||
    questionCount === null ||
    retrievalCount === null
  ) {
    return null;
  }
  return {
    kbId,
    snapshotId,
    host,
    frozenAt,
    revision,
    questionCount,
    retrievalCount,
  };
}

/** The load endpoint's payload, or null when it is not the shape the form reads. */
function asLoadedChoices(body: unknown): LoadedChoices | null {
  const data = asRecord(asRecord(body)?.["data"]);
  if (data === null) return null;
  const list = data["choices"];
  if (!Array.isArray(list)) return null;
  const versions: FrozenVersion[] = [];
  for (const entry of list) {
    const version = asFrozenVersion(entry);
    if (version === null) return null;
    versions.push(version);
  }
  return {
    versions,
    providerConfigured: data["providerConfigured"] !== false,
    runsPerDay: countOf(data["runsPerDay"]) ?? VISIBILITY_RUNS_PER_DAY,
  };
}

/**
 * Accept a report only when the shapes the page indexes into are present.
 *
 * The schema version is checked because a tab left open across a deploy would
 * otherwise render an older reading of newer fields, and a stale bundle is
 * exactly the case where a wrong number looks like a real one.
 */
function asReport(value: unknown): VisibilityReport | null {
  const record = asRecord(value);
  if (record === null) return null;
  const manifest = asRecord(record["manifest"]);
  const metrics = asRecord(record["metrics"]);
  if (manifest === null || metrics === null) return null;
  if (manifest["schemaVersion"] !== GEO_VISIBILITY_SCHEMA_VERSION) return null;
  if (!Array.isArray(metrics["byLayer"])) return null;
  if (!Array.isArray(record["questions"])) return null;
  if (!Array.isArray(record["citedDomains"])) return null;
  if (!Array.isArray(record["limits"])) return null;
  return value as VisibilityReport;
}

function readStatus(httpStatus: number, body: unknown): StatusOutcome {
  const code = errorCodeOf(body);
  if (httpStatus >= 400) {
    return code === null ? { kind: "invalid" } : { kind: "error", code };
  }
  const data = asRecord(asRecord(body)?.["data"]);
  if (data === null) return { kind: "invalid" };
  if (data["status"] === "completed") {
    const report = asReport(data["report"]);
    return report === null
      ? { kind: "error", code: "schema_mismatch" }
      : { kind: "completed", report };
  }
  // Queued is not a failure. The workflow reports `pending` before it reports
  // `running`, and a client that treated the first as unreadable spent five
  // polls — about ten seconds — declaring a paid run dead while several
  // hundred provider calls were still in flight.
  if (data["status"] === "running" || data["status"] === "queued") {
    return { kind: "running" };
  }
  return { kind: "invalid" };
}

/**
 * The server's own cooldown, clamped.
 *
 * It travels in the body, not in `Retry-After`: `privateJson` sets only
 * `Cache-Control`. A hostile or broken value must still not park the button
 * for a week, hence the ceiling.
 */
function retryAfterSecondsFrom(body: unknown): number {
  const record = asRecord(body);
  const seconds =
    countOf(record?.["retryAfterSeconds"]) ??
    countOf(asRecord(record?.["data"])?.["retryAfterSeconds"]) ??
    0;
  return Math.min(seconds, 3_600);
}

function pollDelayMs(body: unknown): number {
  const seconds = retryAfterSecondsFrom(body);
  return seconds > 0 ? Math.min(POLL_MAX_MS, seconds * 1_000) : POLL_DEFAULT_MS;
}

function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/* ------------------------------------------------------------------ */
/* Proportions                                                         */
/* ------------------------------------------------------------------ */

/**
 * `describeProportion` takes the shared `Proportion`, which carries the level
 * its interval was computed at; the run contract's proportions do not, because
 * every interval in a run is the same two-sided Wilson bound. Derived from the
 * z the run used rather than written as 0.95 so the two cannot drift apart.
 * `describeProportion` itself does not read it.
 */
const WILSON_LEVEL = 2 * normalCdf(Z95) - 1;

function describe(proportion: VisibilityProportion): ProportionDescription {
  return describeProportion({ ...proportion, level: WILSON_LEVEL });
}

/**
 * The four shapes a proportion is allowed to take, and nothing else.
 *
 * There is no branch here that assembles a percentage, which is the whole
 * point: "0.0%" beside an n of five is a claim the run cannot support.
 */
function ProportionValue({
  proportion,
}: {
  readonly proportion: VisibilityProportion;
}) {
  const t = useTranslations("tools.aiVisibility");
  const description = describe(proportion);
  switch (description.kind) {
    case "unavailable":
      return <span>{t("proportion.unavailable")}</span>;
    case "unobserved":
      return (
        <span>
          {t("proportion.unobserved", {
            trials: description.trials,
            hi: description.hiPercent,
          })}
        </span>
      );
    case "zero":
      return (
        <span>
          {t("proportion.zero", {
            trials: description.trials,
            hi: description.hiPercent,
          })}
        </span>
      );
    case "observed":
      return (
        <span>
          {t("proportion.observed", {
            percent: description.percent,
            trials: description.trials,
            lo: description.loPercent,
            hi: description.hiPercent,
          })}
        </span>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Report sections                                                     */
/* ------------------------------------------------------------------ */

/**
 * The overview, in the unit the run can actually support.
 *
 * The headline is per question; the per-sample rate is a second line under it.
 * Seven questions asked five times each is thirty-five correlated samples, and
 * a zero over thirty-five clears the "may be written 0.0%" bound while the
 * same zero over seven does not. Leading with the pooled figure is passing
 * repeats of one question off as independent observations.
 */
function Overview({ report }: { readonly report: VisibilityReport }) {
  const t = useTranslations("tools.aiVisibility");
  const metrics = report.metrics;
  const cards = [
    [
      "questionsMentioned",
      metrics.questionsMentioned,
      metrics.unpromptedMention,
    ],
    ["questionsCited", metrics.questionsCited, metrics.citation],
  ] as const;

  return (
    <section className={PANEL}>
      <h3 className={HEADING}>{t("overview.title")}</h3>
      {/* The denominator below is questions that answered, not questions
          asked. The gap has to be on the page rather than divided away. */}
      <p className={`mt-2 max-w-[640px] ${BODY}`}>
        {t("overview.answeredQuestions", {
          answered: metrics.questionsAnswered,
          asked: metrics.questionsAsked,
        })}
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {cards.map(([name, byQuestion, bySample]) => (
          <div
            className="rounded-lg border border-brand-border-card p-4"
            key={name}
          >
            <p className="text-[13px] text-text-dark-secondary">
              {t(`overview.${name}.label`)}
            </p>
            <p className="mt-2 text-[16px] text-text-dark-primary">
              <ProportionValue proportion={byQuestion} />
            </p>
            <p className={`mt-2 ${NOTE}`}>{t(`overview.${name}.help`)}</p>
            <p className={`mt-3 ${NOTE}`}>
              {t("overview.acrossSamples")}{" "}
              <ProportionValue proportion={bySample} />
            </p>
          </div>
        ))}
        <div className="rounded-lg border border-brand-border-card p-4">
          <p className="text-[13px] text-text-dark-secondary">
            {t("overview.promptedMention.label")}
          </p>
          <p className="mt-2 text-[16px] text-text-dark-primary">
            <ProportionValue proportion={metrics.promptedMention} />
          </p>
          <p className={`mt-2 ${NOTE}`}>{t("overview.promptedMention.help")}</p>
        </div>
      </div>
      <p className={`mt-5 ${NOTE}`}>
        {t("proportion.zeroThreshold", {
          percent: Math.round(ZERO_CLAIM_UPPER_BOUND * 100),
          minTrials: minTrialsForZeroClaim(),
        })}
      </p>
    </section>
  );
}

function LayerTable({ report }: { readonly report: VisibilityReport }) {
  const t = useTranslations("tools.aiVisibility");
  return (
    <section className={PANEL}>
      <h3 className={HEADING}>{t("layers.title")}</h3>
      <p className={`mt-2 max-w-[640px] ${BODY}`}>{t("layers.intro")}</p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <caption className="sr-only">{t("layers.title")}</caption>
          <thead>
            <tr className="border-b border-brand-border-strong">
              <th className={TH} scope="col">
                {t("layers.column.layer")}
              </th>
              <th className={TH} scope="col">
                {t("layers.column.mention")}
              </th>
              <th className={TH} scope="col">
                {t("layers.column.citation")}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.metrics.byLayer.map((row) => (
              <tr
                className="border-b border-brand-border-card last:border-0"
                key={row.layer}
              >
                <th className={`${TD} font-normal`} scope="row">
                  {t(`layers.names.${row.layer}`)}
                </th>
                <td className={TD}>
                  <ProportionValue proportion={row.mention} />
                </td>
                <td className={TD}>
                  <ProportionValue proportion={row.citation} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`mt-4 ${NOTE}`}>{t("layers.brandedNote")}</p>
    </section>
  );
}

function DomainTable({
  domains,
}: {
  readonly domains: readonly VisibilityCitedDomain[];
}) {
  const t = useTranslations("tools.aiVisibility");
  return (
    <section className={PANEL}>
      <h3 className={HEADING}>{t("domains.title")}</h3>
      <p className={`mt-2 max-w-[640px] ${BODY}`}>{t("domains.intro")}</p>
      {domains.length === 0 ? (
        <p className={`mt-4 ${BODY}`}>{t("domains.empty")}</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <caption className="sr-only">{t("domains.title")}</caption>
            <thead>
              <tr className="border-b border-brand-border-strong">
                <th className={TH} scope="col">
                  {t("domains.column.domain")}
                </th>
                <th className={TH} scope="col">
                  {t("domains.column.answers")}
                </th>
                <th className={TH} scope="col">
                  {t("domains.column.role")}
                </th>
              </tr>
            </thead>
            <tbody>
              {domains.map((domain) => (
                <tr
                  className="border-b border-brand-border-card last:border-0"
                  key={domain.domain}
                >
                  <th className={`${TD} font-normal`} scope="row">
                    <span className="break-all">{domain.domain}</span>
                    {domain.sampleUrls.length === 0 ? null : (
                      <span className={`mt-1.5 block ${NOTE} break-all`}>
                        {t("domains.samples")}{" "}
                        {domain.sampleUrls
                          .slice(0, SAMPLE_URLS_SHOWN)
                          .join(" · ")}
                      </span>
                    )}
                  </th>
                  <td className={TD}>{domain.answers}</td>
                  <td className={TD}>
                    {domain.isOwn
                      ? t("domains.role.own")
                      : domain.isCompetitor
                        ? t("domains.role.competitor")
                        : t("domains.role.other")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function QuestionRow({
  question,
  open,
  onToggle,
}: {
  readonly question: VisibilityQuestionResult;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const t = useTranslations("tools.aiVisibility");
  return (
    <li className="border-b border-brand-border-card pb-4 last:border-0">
      <p className="text-[14.5px] text-text-dark-primary">{question.text}</p>
      {/* Prompted is decided on the words of the question, not on its stage,
          so it is marked per question rather than inferred from the layer. */}
      <p className={`mt-1.5 ${NOTE}`}>
        {t(`layers.names.${question.layer}`)} ·{" "}
        {t(`questions.modes.${question.mode}`)}
        {question.prompted ? ` · ${t("questions.promptedTag")}` : ""}
        {question.calibrated ? "" : ` · ${t("questions.uncalibrated")}`}
      </p>
      {/*
        Nothing came back for this question, so there is no denominator and no
        count. "Mentioned in 0 of 0 answers" reads as a measured absence; the
        aggregates already refuse to say that, and the per-question line has to
        refuse it too, or the two halves of the same page disagree.
      */}
      {question.answered === 0 ? (
        <p className={`mt-2 ${BODY}`}>{t("questions.noAnswers")}</p>
      ) : (
        <>
          <p className={`mt-2 ${BODY}`}>
            {t("questions.mentionCount", {
              mentioned: question.mentioned,
              answered: question.answered,
            })}
          </p>
          <p className={`mt-1 ${BODY}`}>
            {question.mode === "demand"
              ? t("questions.demandCitationNote", { cited: question.cited })
              : question.citationEvaluable === 0
                ? t("questions.citationNotEvaluable")
                : t("questions.citationCount", {
                    cited: question.cited,
                    evaluable: question.citationEvaluable,
                  })}
          </p>
          {/* An answer whose citation list would not parse is neither cited
              nor uncited. It is out of the denominator above, so the count
              has to be visible or the rate silently shrinks. */}
          {question.citationUnknown === 0 ? null : (
            <p className={`mt-1 ${NOTE}`}>
              {t("questions.citationUnknown", {
                count: question.citationUnknown,
              })}
            </p>
          )}
        </>
      )}
      <button
        className={`mt-3 ${SECONDARY_BUTTON}`}
        onClick={onToggle}
        type="button"
      >
        {open ? t("questions.hideSamples") : t("questions.showSamples")}
      </button>
      {open ? (
        <ul className="mt-3 grid gap-3">
          {question.samples.map((sample) => (
            <li
              className="rounded-lg border border-brand-border-card p-3"
              key={`${sample.questionId}-${String(sample.sampleIndex)}`}
            >
              <p className={NOTE}>
                {t("questions.sampleLabel", { index: sample.sampleIndex + 1 })}{" "}
                · {t(`questions.sampleStatus.${sample.status}`)} ·{" "}
                {sample.webSearchPerformed === null
                  ? t("questions.sampleSearchUnknown")
                  : sample.webSearchPerformed
                    ? t("questions.sampleSearched")
                    : t("questions.sampleNoSearch")}
              </p>
              {/*
                A timed-out sample has no answer, so it cannot have failed to
                mention anyone. Printing "No mention in this answer" beside a
                label that says "timed out" is two contradictory sentences
                about the same empty excerpt.
              */}
              <p className={`mt-2 ${BODY}`}>
                {sample.status !== "ok"
                  ? t("questions.sampleNoAnswer")
                  : sample.excerpt === null
                    ? t("questions.noExcerpt")
                    : sample.excerpt}
              </p>
              {sample.citedDomains.length === 0 ? null : (
                <p className={`mt-2 ${NOTE} break-all`}>
                  {t("questions.citedDomains", {
                    domains: sample.citedDomains.join(" · "),
                  })}
                </p>
              )}
              {sample.competitorsMentioned.length === 0 ? null : (
                <p className={`mt-1 ${NOTE}`}>
                  {t("questions.competitors", {
                    names: sample.competitorsMentioned.join(" · "),
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function QuestionList({
  questions,
}: {
  readonly questions: readonly VisibilityQuestionResult[];
}) {
  const t = useTranslations("tools.aiVisibility");
  const [open, setOpen] = useState<readonly string[]>([]);
  return (
    <section className={PANEL}>
      <h3 className={HEADING}>{t("questions.title")}</h3>
      <p className={`mt-2 max-w-[640px] ${BODY}`}>{t("questions.intro")}</p>
      <ul className="mt-5 grid gap-4">
        {questions.map((question) => (
          <QuestionRow
            key={question.questionId}
            onToggle={() =>
              setOpen((current) =>
                current.includes(question.questionId)
                  ? current.filter((id) => id !== question.questionId)
                  : [...current, question.questionId],
              )
            }
            open={open.includes(question.questionId)}
            question={question}
          />
        ))}
      </ul>
    </section>
  );
}

/** A proportion as a percentage, to one decimal. */
function percent(value: number): number {
  return Math.round(value * 1000) / 10;
}

/**
 * The change column for one aggregate.
 *
 * Counted in questions, because that is the unit the verdict is computed in:
 * "eight of fourteen comparable questions improved, none got worse" is
 * something a reader can act on, where "eighteen points" is a difference of two
 * rates whose denominators are not on the screen.
 *
 * `lo`/`hi` bound the share of the questions that MOVED which moved for the
 * better, so they are centred on a half, not on zero: what makes a change real
 * here is that it is one-sided. They are checked rather than defaulted —
 * `lo ?? 0` printed "0.0 to 0.0" for an interval this run never computed, and
 * that `changed` currently implies both bounds is a relationship between three
 * independent fields, not something either type says.
 */
function ChangeCell({
  row,
}: {
  readonly row: VisibilityComparison["aggregates"][number];
}) {
  const t = useTranslations("tools.aiVisibility");
  if (!row.testable) return <>{t("comparison.notTestable")}</>;
  if (!row.changed) return <>{t("comparison.unchanged")}</>;
  if (row.lo === null || row.hi === null) {
    return (
      <>
        {t("comparison.changedNoInterval", {
          gained: row.gained,
          lost: row.lost,
          pairs: row.pairs,
        })}
      </>
    );
  }
  return (
    <>
      {t("comparison.changed", {
        gained: row.gained,
        lost: row.lost,
        pairs: row.pairs,
        lo: percent(row.lo),
        hi: percent(row.hi),
      })}
    </>
  );
}

function ComparisonBlock({
  comparison,
  locale,
}: {
  readonly comparison: VisibilityComparison;
  readonly locale: string;
}) {
  const t = useTranslations("tools.aiVisibility");
  return (
    <section className={PANEL}>
      <h3 className={HEADING}>{t("comparison.title")}</h3>
      <p className={`mt-2 max-w-[640px] ${BODY}`}>
        {t("comparison.intro", {
          time: formatMoment(comparison.baseFinishedAt, locale),
        })}
      </p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <caption className="sr-only">{t("comparison.title")}</caption>
          <thead>
            <tr className="border-b border-brand-border-strong">
              <th className={TH} scope="col">
                {t("comparison.column.metric")}
              </th>
              <th className={TH} scope="col">
                {t("comparison.column.base")}
              </th>
              <th className={TH} scope="col">
                {t("comparison.column.current")}
              </th>
              <th className={TH} scope="col">
                {t("comparison.column.change")}
              </th>
            </tr>
          </thead>
          <tbody>
            {comparison.aggregates.map((row) => (
              <tr
                className="border-b border-brand-border-card last:border-0"
                key={row.metric}
              >
                <th className={`${TD} font-normal`} scope="row">
                  {t(`comparison.metrics.${row.metric}`)}
                </th>
                <td className={TD}>
                  <ProportionValue proportion={row.base} />
                </td>
                <td className={TD}>
                  <ProportionValue proportion={row.current} />
                </td>
                <td className={TD}>
                  <ChangeCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="mt-6 text-[15px] text-text-dark-primary">
        {t("comparison.questionsTitle")}
      </h4>
      {comparison.questions.length === 0 ? (
        <p className={`mt-2 ${BODY}`}>{t("comparison.empty")}</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {comparison.questions.map((question) => (
            <li key={question.questionId}>
              <p className="text-[14px] text-text-dark-primary">
                {question.text}
              </p>
              <p className={`mt-1 ${NOTE}`}>
                {t(`comparison.direction.${question.direction}`)} ·{" "}
                {t("comparison.questionRow", {
                  base: question.baseMentioned,
                  current: question.currentMentioned,
                  of: question.of,
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatMoment(iso: string, locale: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}

function Report({
  report,
  locale,
}: {
  readonly report: VisibilityReport;
  readonly locale: string;
}) {
  const t = useTranslations("tools.aiVisibility");
  const manifest = report.manifest;
  return (
    <div className="grid gap-8">
      <section className={PANEL}>
        <h3 className={HEADING}>{t("results.title")}</h3>
        <p className={`mt-2 ${BODY}`}>
          {t(`results.status.${manifest.status}`)}
        </p>
        <div className={`mt-4 grid gap-2 ${BODY}`}>
          <p>
            {t("results.coverage", {
              answered: manifest.answered,
              calls: manifest.calls,
            })}
          </p>
          <p>
            {t("results.minSuccess", {
              percent: Math.round(VISIBILITY_MIN_SUCCESS_RATIO * 100),
            })}
          </p>
          <p>
            {t("results.questions", {
              count: manifest.questionCount,
              samples: manifest.samplesPerQuestion,
            })}
          </p>
          <p>
            {t("results.revision", { revision: manifest.snapshotRevision })}
          </p>
          {/* The model and the API it was reached through are two facts. The
              line labelled "model" used to carry the endpoint's name. */}
          <p>
            {t("results.model", {
              model: manifest.model,
              market: manifest.marketCode,
            })}
          </p>
          <p>{t("results.surface", { surface: manifest.surface })}</p>
          <p>
            {t("results.finished", {
              time: formatMoment(manifest.finishedAt, locale),
            })}
          </p>
          <p>
            {manifest.costUsd === null
              ? t("results.costUnavailable")
              : t("results.cost", { cost: manifest.costUsd })}
          </p>
        </div>
      </section>

      {/*
        `results.minSuccess` promises this run draws no conclusions and becomes
        no baseline. The overview, the stage table and the comparison are the
        conclusions: the comparison prints a changed/unchanged verdict outright.
        Rendering them under that sentence would have made the sentence the
        only part of the page that was true. The evidence stays — every
        question, every sample, and what the run cost.
      */}
      {manifest.status === "insufficient" ? (
        <section className={PANEL}>
          <h3 className={HEADING}>{t("results.withheldTitle")}</h3>
          <p className={`mt-2 max-w-[640px] ${BODY}`}>
            {t("results.withheldBody", {
              percent: Math.round(VISIBILITY_MIN_SUCCESS_RATIO * 100),
            })}
          </p>
        </section>
      ) : (
        <>
          <Overview report={report} />
          <LayerTable report={report} />
        </>
      )}
      <DomainTable domains={report.citedDomains} />
      <QuestionList questions={report.questions} />
      {report.comparison === null ||
      manifest.status === "insufficient" ? null : (
        <ComparisonBlock comparison={report.comparison} locale={locale} />
      )}

      <section className={PANEL}>
        <h3 className={HEADING}>{t("limitsTitle")}</h3>
        <ul className="mt-4 grid gap-3">
          {report.limits.map((limit) => (
            <li className={BODY} key={limit}>
              {t(`limits.${limit}`)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The tool                                                            */
/* ------------------------------------------------------------------ */

export function AiVisibilityCheck({
  locale,
  authentication,
}: {
  readonly locale: string;
  readonly authentication: "authenticated" | "unauthenticated" | "unavailable";
}) {
  const t = useTranslations("tools.aiVisibility");
  const [choices, setChoices] = useState<LoadedChoices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [samples, setSamples] = useState<number>(VISIBILITY_SAMPLES_DEFAULT);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const startedAt = useRef<number | null>(null);
  /** How far into a restored run this page arrived, so the clock does not lie. */
  const resumeOffsetMs = useRef(0);
  const restoredOnce = useRef(false);

  const versions = choices?.versions ?? null;
  const signedIn = authentication === "authenticated";
  const busy = run.kind === "starting" || run.kind === "running";

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldown]);

  /**
   * A clock, deliberately not a progress bar.
   *
   * The run reports how many calls finished only when it has that number to
   * report; a bar drawn without one would be a denominator this page invented.
   * What a fifteen-minute wait needs is evidence it is still going, next to the
   * duration the estimate promised.
   */
  useEffect(() => {
    if (!busy) {
      startedAt.current = null;
      return;
    }
    if (startedAt.current === null) {
      startedAt.current = monotonicNow() - resumeOffsetMs.current;
    }
    const ticker = setInterval(() => {
      const start = startedAt.current;
      if (start !== null) setElapsedMs(monotonicNow() - start);
    }, 1_000);
    return () => {
      clearInterval(ticker);
    };
  }, [busy]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(ENDPOINTS.load, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setLoadError(errorCodeOf(body) ?? "unknown");
        return;
      }
      const loaded = asLoadedChoices(body);
      if (loaded === null) {
        setLoadError("schema_mismatch");
        return;
      }
      setChoices(loaded);
      setSelected((current) =>
        loaded.versions.some((version) => version.snapshotId === current)
          ? current
          : (loaded.versions[0]?.snapshotId ?? ""),
      );
    } catch {
      setLoadError("network");
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void load();
  }, [load, signedIn]);

  const version = useMemo(
    () => versions?.find((entry) => entry.snapshotId === selected) ?? null,
    [selected, versions],
  );

  const estimate = useMemo(() => {
    const calls = visibilityCallCount(version?.questionCount ?? 0, samples);
    return {
      calls,
      cost: visibilityCostEstimateUsd(calls),
      minutes: visibilityMinutesEstimate(calls),
    };
  }, [samples, version]);

  const poll = useCallback(
    async (
      token: string,
      controller: AbortController,
      firstDelayMs: number,
      restored: boolean,
    ): Promise<void> => {
      let delay = firstDelayMs;
      let failures = 0;
      const deadline = monotonicNow() + MAX_POLL_WALL_CLOCK_MS;
      // Awaiting each response before scheduling the next is what keeps a
      // single request in flight; a timer that fires on its own schedule would
      // stack requests on a slow run.
      while (!controller.signal.aborted) {
        await waitFor(delay, controller.signal);
        if (controller.signal.aborted) return;
        if (monotonicNow() > deadline) {
          // The pointer stays in storage: the run may still be finishing, and
          // reloading is how the visitor gets another look at it.
          setRun({ kind: "error", code: "polling_stopped" });
          return;
        }
        try {
          const response = await fetch(ENDPOINTS.status, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runToken: token }),
            signal: controller.signal,
          });
          const body: unknown = await response.json();
          delay = pollDelayMs(body);
          const outcome = readStatus(response.status, body);
          if (outcome.kind === "completed") {
            clearVisibilityRunPointer(sessionStorage);
            setRun({ kind: "done", report: outcome.report });
            return;
          }
          if (outcome.kind === "running") {
            failures = 0;
            setRun({ kind: "running" });
            continue;
          }
          if (outcome.kind === "error") {
            clearVisibilityRunPointer(sessionStorage);
            // A restored pointer the server will not answer for is a stale
            // pointer, not a failed run. Reporting it as an error would put a
            // run the visitor never started on the screen; the form is the
            // honest place to land.
            if (restored && STALE_POINTER_CODES.has(outcome.code)) {
              setRun({ kind: "idle" });
              return;
            }
            setRun({ kind: "error", code: outcome.code });
            setCooldown(retryAfterSecondsFrom(body));
            return;
          }
          failures += 1;
          if (failures >= MAX_STATUS_FAILURES) {
            clearVisibilityRunPointer(sessionStorage);
            setRun(
              restored
                ? { kind: "idle" }
                : { kind: "error", code: "run_unavailable" },
            );
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
          // A transport error says nothing about the run itself, so it is worth
          // a bounded number of retries before the page gives the wait back.
          // The pointer is kept for the same reason: the run is still running.
          failures += 1;
          if (failures >= MAX_STATUS_FAILURES) {
            setRun({ kind: "error", code: "network" });
            return;
          }
          delay = Math.max(delay, POLL_DEFAULT_MS);
        }
      }
    },
    [],
  );

  const start = useCallback(async () => {
    if (version === null) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    resumeOffsetMs.current = 0;
    startedAt.current = monotonicNow();
    setElapsedMs(0);
    setRun({ kind: "starting" });
    try {
      const response = await fetch(ENDPOINTS.run, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kbId: version.kbId,
          snapshotId: version.snapshotId,
          samplesPerQuestion: samples,
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setRun({ kind: "error", code: errorCodeOf(body) ?? "unknown" });
        setCooldown(retryAfterSecondsFrom(body));
        return;
      }
      const token = asRecord(asRecord(body)?.["data"])?.["runToken"];
      if (typeof token !== "string" || token.length === 0) {
        setRun({ kind: "error", code: "run_unavailable" });
        return;
      }
      // Written before the first poll, not after it: the calls are already
      // being made, so the window in which a reload loses the run has to be
      // as close to zero as the code can make it.
      writeVisibilityRunPointer(sessionStorage, {
        runToken: token,
        startedAt: Date.now(),
      });
      setRun({ kind: "running" });
      await poll(token, controller, pollDelayMs(body), false);
    } catch {
      if (controller.signal.aborted) return;
      setRun({ kind: "error", code: "network" });
    }
  }, [poll, samples, version]);

  /**
   * Pick a paid run back up after a reload.
   *
   * The server seals the pointer for a day and the page tells the visitor they
   * may leave; both were false while the token lived only in a closure. One
   * shot per mount, so no state update re-enters a poll already in flight.
   */
  useEffect(() => {
    if (!signedIn || restoredOnce.current) return;
    restoredOnce.current = true;
    const pointer = readVisibilityRunPointer(sessionStorage);
    if (pointer === null) return;
    resumeOffsetMs.current = Math.max(0, Date.now() - pointer.startedAt);
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setElapsedMs(resumeOffsetMs.current);
    setRun({ kind: "running" });
    void poll(pointer.runToken, controller, POLL_DEFAULT_MS, true);
  }, [poll, signedIn]);

  if (!signedIn) {
    return (
      <section className={`mt-10 ${PANEL}`}>
        <h2 className={HEADING}>{t("signIn.title")}</h2>
        <p className={`mt-3 max-w-[640px] ${BODY}`}>
          {authentication === "unavailable"
            ? t("signIn.unavailable")
            : t("signIn.body")}
        </p>
      </section>
    );
  }

  if (choices === null || versions === null) {
    return (
      <section className={`mt-10 ${PANEL}`}>
        <p className={BODY}>
          {loadError === null ? t("loading") : t(`errors.${loadError}`)}
        </p>
        {loadError === null ? null : (
          <button
            className={`mt-4 ${SECONDARY_BUTTON}`}
            onClick={() => {
              void load();
            }}
            type="button"
          >
            {t("retryLoad")}
          </button>
        )}
      </section>
    );
  }

  if (versions.length === 0) {
    return (
      <section className={`mt-10 ${PANEL}`}>
        <h2 className={HEADING}>{t("noFrozen.title")}</h2>
        <p className={`mt-3 max-w-[640px] ${BODY}`}>{t("noFrozen.body")}</p>
        <a
          className={`mt-5 inline-block ${PRIMARY_BUTTON}`}
          href={localePath(locale, KNOWLEDGE_BASE_PATH)}
        >
          {t("noFrozen.action")}
        </a>
      </section>
    );
  }

  const elapsedSeconds = Math.floor(elapsedMs / 1_000);
  const providerConfigured = choices.providerConfigured;

  return (
    <div className="mt-10 grid gap-8">
      <section className={PANEL}>
        <h2 className={HEADING}>{t("form.title")}</h2>
        <p className={`mt-2 max-w-[640px] ${BODY}`}>{t("form.intro")}</p>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="visibility-version"
            >
              {t("form.versionLabel")}
            </label>
            <select
              className={FIELD}
              disabled={busy}
              id="visibility-version"
              onChange={(event) => setSelected(event.target.value)}
              value={selected}
            >
              {versions.map((entry) => (
                <option key={entry.snapshotId} value={entry.snapshotId}>
                  {t("form.versionOption", {
                    host: entry.host,
                    revision: entry.revision,
                    time: formatMoment(entry.frozenAt, locale),
                  })}
                </option>
              ))}
            </select>
            {version === null ? null : (
              <p className={`mt-1.5 ${NOTE}`}>
                {t("form.versionQuestions", {
                  count: version.questionCount,
                  retrieval: version.retrievalCount,
                })}
              </p>
            )}
          </div>

          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="visibility-samples"
            >
              {t("form.samplesLabel")}
            </label>
            <select
              className={FIELD}
              disabled={busy}
              id="visibility-samples"
              onChange={(event) =>
                setSamples(Number.parseInt(event.target.value, 10))
              }
              value={String(samples)}
            >
              {VISIBILITY_SAMPLES_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {t("form.samplesOption", { count: option })}
                </option>
              ))}
            </select>
            <p className={`mt-1.5 ${NOTE}`}>{t("form.samplesHelp")}</p>
          </div>
        </div>

        <p className="mt-5 text-[14.5px] text-text-dark-primary">
          {t("form.estimate", {
            calls: estimate.calls,
            cost: estimate.cost,
            minutes: estimate.minutes,
          })}
        </p>
        <p className={`mt-1.5 ${NOTE}`}>{t("form.estimateNote")}</p>
        {/* The server's own number, not this bundle's: a tab open across a
            limit change would otherwise print the figure it was built with. */}
        <p className={`mt-1.5 ${NOTE}`}>
          {t("form.dailyLimit", { runs: choices.runsPerDay })}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className={PRIMARY_BUTTON}
            disabled={
              busy || version === null || cooldown > 0 || !providerConfigured
            }
            onClick={() => {
              void start();
            }}
            type="button"
          >
            {busy ? t("form.starting") : t("form.start")}
          </button>
          {cooldown > 0 ? (
            <span className={NOTE}>
              {t("form.cooldown", { seconds: cooldown })}
            </span>
          ) : null}
        </div>

        {/* The load endpoint reports this so a visitor does not spend a click
            to learn the credentials are missing. Saying it here is what makes
            that reporting worth anything. */}
        {providerConfigured ? null : (
          <p className={`mt-4 text-[13.5px] text-brand-error`} role="alert">
            {t("errors.provider_unconfigured")}
          </p>
        )}

        {run.kind === "error" ? (
          <p className="mt-4 text-[13.5px] text-brand-error" role="alert">
            {t(`errors.${run.code}`)}
          </p>
        ) : null}
      </section>

      {busy ? (
        <section className={PANEL} aria-live="polite">
          <h2 className={HEADING}>{t("running.title")}</h2>
          <p className={`mt-2 max-w-[640px] ${BODY}`}>
            {t("running.body", { minutes: estimate.minutes })}
          </p>
          <p className={`mt-3 ${BODY}`}>
            {t("running.elapsed", {
              minutes: Math.floor(elapsedSeconds / 60),
              seconds: elapsedSeconds % 60,
            })}
          </p>
          {/* The run reports nothing per call, so the page says so rather
              than inventing a denominator to draw a bar with. */}
          <p className={`mt-2 ${BODY}`}>{t("running.noCount")}</p>
          <p className={`mt-3 ${NOTE}`}>{t("running.tabNote")}</p>
        </section>
      ) : null}

      {run.kind === "done" ? (
        <Report locale={locale} report={run.report} />
      ) : null}
    </div>
  );
}
