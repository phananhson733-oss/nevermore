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

const ENDPOINTS = {
  load: "/api/tools/ai-visibility-check/load",
  run: "/api/tools/ai-visibility-check/run",
  status: "/api/tools/ai-visibility-check/run/status",
} as const;

/** The route the empty state points at. It exists, so the button is allowed to. */
const KNOWLEDGE_BASE_PATH = "/tools/geo-knowledge-base";

/** Polling floor and ceiling. The server's own `Retry-After` decides in between. */
const POLL_DEFAULT_MS = 2_000;
const POLL_MAX_MS = 5_000;

/**
 * How many unreadable status replies in a row before the page stops asking.
 *
 * A run that cannot be read is not a run that failed, so the message says so;
 * what it must not do is poll a dead endpoint for the fifteen minutes the run
 * would otherwise have taken.
 */
const MAX_STATUS_FAILURES = 5;

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
  readonly origin: string;
  readonly host: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly questionCount: number;
  readonly retrievalCount: number;
}

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | {
      readonly kind: "running";
      /** Null whenever the run does not report per-call progress. */
      readonly done: number | null;
      readonly total: number | null;
    }
  | { readonly kind: "done"; readonly report: VisibilityReport }
  | { readonly kind: "error"; readonly code: string };

type StatusOutcome =
  | { readonly kind: "running"; readonly done: number | null; readonly total: number | null }
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
  if (data["status"] === "running") {
    return {
      kind: "running",
      done: countOf(data["completedCalls"]),
      total: countOf(data["totalCalls"]),
    };
  }
  return { kind: "invalid" };
}

/**
 * The server's own cooldown, clamped.
 *
 * `Retry-After` arrives from a response, and a hostile or broken value must not
 * park the button for a week.
 */
function retryAfterSecondsFrom(response: Response): number {
  const seconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3_600) : 0;
}

function pollDelayMs(retryAfter: string | null): number {
  const seconds = Number.parseInt(retryAfter ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(POLL_MAX_MS, seconds * 1_000)
    : POLL_DEFAULT_MS;
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

function Overview({ report }: { readonly report: VisibilityReport }) {
  const t = useTranslations("tools.aiVisibility");
  const metrics = report.metrics;
  const cards = [
    ["unpromptedMention", metrics.unpromptedMention],
    ["promptedMention", metrics.promptedMention],
    ["citation", metrics.citation],
    ["questionsMentioned", metrics.questionsMentioned],
  ] as const;

  return (
    <section className={PANEL}>
      <h3 className={HEADING}>{t("overview.title")}</h3>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {cards.map(([name, proportion]) => (
          <div
            className="rounded-lg border border-brand-border-card p-4"
            key={name}
          >
            <p className="text-[13px] text-text-dark-secondary">
              {t(`overview.${name}.label`)}
            </p>
            <p className="mt-2 text-[16px] text-text-dark-primary">
              <ProportionValue proportion={proportion} />
            </p>
            <p className={`mt-2 ${NOTE}`}>{t(`overview.${name}.help`)}</p>
          </div>
        ))}
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
      <p className={`mt-1.5 ${NOTE}`}>
        {t(`layers.names.${question.layer}`)} ·{" "}
        {t(`questions.modes.${question.mode}`)}
        {question.calibrated ? "" : ` · ${t("questions.uncalibrated")}`}
      </p>
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
                {t("questions.sampleLabel", { index: sample.sampleIndex + 1 })} ·{" "}
                {t(`questions.sampleStatus.${sample.status}`)} ·{" "}
                {sample.webSearchPerformed === null
                  ? t("questions.sampleSearchUnknown")
                  : sample.webSearchPerformed
                    ? t("questions.sampleSearched")
                    : t("questions.sampleNoSearch")}
              </p>
              <p className={`mt-2 ${BODY}`}>
                {sample.excerpt === null
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
                  {!row.testable
                    ? t("comparison.notTestable")
                    : row.changed && row.diff !== null
                      ? t("comparison.changed", {
                          diff: Math.round(row.diff * 1000) / 10,
                          lo: Math.round((row.lo ?? 0) * 1000) / 10,
                          hi: Math.round((row.hi ?? 0) * 1000) / 10,
                        })
                      : t("comparison.unchanged")}
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
          <p>
            {t("results.model", {
              model: manifest.model,
              market: manifest.marketCode,
            })}
          </p>
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

      <Overview report={report} />
      <LayerTable report={report} />
      <DomainTable domains={report.citedDomains} />
      <QuestionList questions={report.questions} />
      {report.comparison === null ? null : (
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
  const [versions, setVersions] = useState<readonly FrozenVersion[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [samples, setSamples] = useState<number>(VISIBILITY_SAMPLES_DEFAULT);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const startedAt = useRef<number | null>(null);

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
    if (startedAt.current === null) startedAt.current = monotonicNow();
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
      const list = asRecord(asRecord(body)?.["data"])?.["versions"];
      if (!Array.isArray(list)) {
        setLoadError("unknown");
        return;
      }
      const parsed = list as readonly FrozenVersion[];
      setVersions(parsed);
      setSelected((current) =>
        parsed.some((version) => version.snapshotId === current)
          ? current
          : (parsed[0]?.snapshotId ?? ""),
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
    ): Promise<void> => {
      let delay = firstDelayMs;
      let failures = 0;
      // Awaiting each response before scheduling the next is what keeps a
      // single request in flight; a timer that fires on its own schedule would
      // stack requests on a slow run.
      while (!controller.signal.aborted) {
        await waitFor(delay, controller.signal);
        if (controller.signal.aborted) return;
        try {
          const response = await fetch(ENDPOINTS.status, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runToken: token }),
            signal: controller.signal,
          });
          const body: unknown = await response.json();
          delay = pollDelayMs(response.headers.get("Retry-After"));
          const outcome = readStatus(response.status, body);
          if (outcome.kind === "completed") {
            setRun({ kind: "done", report: outcome.report });
            return;
          }
          if (outcome.kind === "running") {
            failures = 0;
            setRun({
              kind: "running",
              done: outcome.done,
              total: outcome.total,
            });
            continue;
          }
          if (outcome.kind === "error") {
            setRun({ kind: "error", code: outcome.code });
            setCooldown(retryAfterSecondsFrom(response));
            return;
          }
          failures += 1;
          if (failures >= MAX_STATUS_FAILURES) {
            setRun({ kind: "error", code: "run_unavailable" });
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
          // A transport error says nothing about the run itself, so it is worth
          // a bounded number of retries before the page gives the wait back.
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
        setCooldown(retryAfterSecondsFrom(response));
        return;
      }
      const token = asRecord(asRecord(body)?.["data"])?.["runToken"];
      if (typeof token !== "string" || token.length === 0) {
        setRun({ kind: "error", code: "run_unavailable" });
        return;
      }
      setRun({ kind: "running", done: null, total: null });
      await poll(
        token,
        controller,
        pollDelayMs(response.headers.get("Retry-After")),
      );
    } catch {
      if (controller.signal.aborted) return;
      setRun({ kind: "error", code: "network" });
    }
  }, [poll, samples, version]);

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

  if (versions === null) {
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
        <p className={`mt-1.5 ${NOTE}`}>
          {t("form.dailyLimit", { runs: VISIBILITY_RUNS_PER_DAY })}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className={PRIMARY_BUTTON}
            disabled={busy || version === null || cooldown > 0}
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
          <p className={`mt-2 ${BODY}`}>
            {run.kind === "running" && run.done !== null && run.total !== null
              ? t("running.calls", { done: run.done, total: run.total })
              : t("running.noCount")}
          </p>
          <p className={`mt-3 ${NOTE}`}>{t("running.tabNote")}</p>
        </section>
      ) : null}

      {run.kind === "done" ? <Report locale={locale} report={run.report} /> : null}

      <p className="sr-only">{GEO_VISIBILITY_SCHEMA_VERSION}</p>
    </div>
  );
}
