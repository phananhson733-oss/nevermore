"use client";

// @input  -- a page URL and an optional target question, typed by a visitor
// @output -- the citability report rendered from message keys, or one stated error
// @pos    -- the only client surface of /tools/page-citability-check; it renders, it does not judge

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  CITABILITY_ANON_IP_MAX,
  CITABILITY_FETCH_TIMEOUT_MS,
  CITABILITY_SIGNED_IN_IP_MAX,
  CITABILITY_TARGET_MAX,
  CITABILITY_WINDOW_SECONDS,
  type CitabilityCheck,
  type CitabilityReport,
  type CitabilityState,
} from "../../lib/geo-tools/citability-contract.ts";

const ENDPOINT = "/api/tools/page-citability-check";
const MAX_QUESTION_CHARS = 200;

type CopyState = "idle" | "done" | "failed";

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly report: CitabilityReport }
  | {
      readonly kind: "failed";
      readonly code: string;
      readonly retryAfterSeconds: number | null;
      /** The ceiling that actually applied, when the server named one. */
      readonly limit: number | null;
      readonly signedIn: boolean;
    };

/** Error codes this tool owns. Anything else renders as the network message. */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "invalid_url",
  "rate_limited",
  "target_busy",
  "gate_unavailable",
  "fetch_blocked",
  "fetch_timeout",
  "fetch_failed",
  "not_html",
  "page_not_ok",
  "internal_error",
  "already_running",
  "not_utf8",
]);

const STATE_STYLES: Record<CitabilityState, string> = {
  pass: "border-brand-accent/30 bg-brand-accent/[0.08] text-brand-accent-text",
  fail: "border-brand-error/40 bg-brand-error/[0.08] text-brand-error",
  // Dashed, because "we could not read this" must not look like a verdict.
  fetchError:
    "border-dashed border-brand-border-card bg-brand-bg text-text-dark-secondary",
  notApplicable:
    "border-dashed border-brand-border-card bg-brand-bg text-text-dark-secondary",
};

function formatTime(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  // Named, because an unlabelled UTC clock reads as the visitor's own and a
  // check run at 22:03 local looks eight hours stale.
  //
  // Spelled out field by field rather than with `dateStyle`/`timeStyle`:
  // ECMA-402 forbids combining either of those with `timeZoneName`, and V8
  // throws `Invalid option : option` for the pair. Thrown from render, it took
  // down the whole report the moment one came back.
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

/**
 * The report is read from a response this page did not build.
 *
 * A rolling deploy can serve an older shape to a tab that already has the new
 * bundle; without this guard the first `.filter` on a missing array takes the
 * whole tree down and the visitor loses the form they just filled in.
 */
function isCitabilityReport(value: unknown): value is CitabilityReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const summary = record["summary"];
  const question = record["targetQuestion"];
  return (
    Array.isArray(record["checks"]) &&
    Array.isArray(record["limits"]) &&
    Array.isArray(record["questionTerms"]) &&
    typeof record["fetchedAt"] === "string" &&
    typeof record["finalUrl"] === "string" &&
    // Every field this component actually reads, not only the ones it maps
    // over. `url` decides whether the redirect line appears and `textChars` is
    // printed as a number; a shape missing either is the same rolling-deploy
    // drift, and a guard that waves them through renders "undefined" as a
    // measurement.
    typeof record["url"] === "string" &&
    typeof record["textChars"] === "number" &&
    (question === null || typeof question === "string") &&
    typeof summary === "object" &&
    summary !== null &&
    typeof (summary as Record<string, unknown>)["counted"] === "number"
  );
}

/**
 * The two lines that state what was asked, or nothing when nothing was.
 *
 * Shared by the page and by the copied report so the pasted text cannot say
 * something different from the screen it was copied from.
 */
function questionLines(
  t: (key: string, values?: Readonly<Record<string, string | number>>) => string,
  report: CitabilityReport,
): readonly string[] {
  if (report.targetQuestion === null) return [];
  return [
    t("summary.question", { question: report.targetQuestion }),
    report.questionTerms.length > 0
      ? t("summary.questionTerms", { terms: report.questionTerms.join(", ") })
      : t("summary.questionNoTerms"),
  ];
}

function CheckRow({ check }: { readonly check: CitabilityCheck }) {
  const t = useTranslations("tools.pageCitability");
  const measuredValues = check.measured.values ?? {};
  const fixValues = check.fix?.values ?? {};
  return (
    <li className="grid gap-2 border-b border-brand-border-card py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${STATE_STYLES[check.state]}`}
        >
          {t(`states.${check.state}`)}
        </span>
        <span className="text-[14.5px] text-text-dark-primary">
          {t(`rules.${check.ruleId}`)}
        </span>
        {check.weight === "advisory" ? (
          <span className="rounded-full border border-brand-border-card px-2 py-0.5 text-[11px] text-text-dark-secondary">
            {t("weights.advisory")}
          </span>
        ) : null}
        {check.kind === "heuristic" ? (
          <span className="rounded-full border border-brand-border-card px-2 py-0.5 text-[11px] text-text-dark-secondary">
            {t("kinds.heuristic")}
          </span>
        ) : null}
      </div>
      <p className="text-[13.5px] leading-[1.7] text-text-dark-secondary">
        {t(`details.${check.measured.key}`, measuredValues)}
      </p>
      {check.kind === "heuristic" ? (
        <p className="text-[12.5px] leading-[1.7] text-text-dark-secondary">
          {t("kinds.heuristicNote")}
        </p>
      ) : null}
      {check.fix ? (
        <p className="text-[13.5px] leading-[1.7] text-text-dark-primary">
          <span className="text-text-dark-secondary">{t("fixLabel")}: </span>
          {t(`fixes.${check.fix.key}`, fixValues)}
        </p>
      ) : null}
    </li>
  );
}

export function PageCitabilityCheck({
  locale,
}: {
  readonly locale: string;
}) {
  const t = useTranslations("tools.pageCitability");
  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [copied, setCopied] = useState<CopyState>("idle");
  const urlInput = useRef<HTMLInputElement | null>(null);

  const submit = useCallback(async () => {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      urlInput.current?.focus();
      return;
    }
    setRun({ kind: "running" });
    setCopied("idle");
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: trimmed,
          ...(question.trim().length > 0 ? { question: question.trim() } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        readonly data?: unknown;
        readonly error?: { readonly code?: string };
        readonly limit?: unknown;
        readonly signedIn?: unknown;
      } | null;
      if (response.ok && isCitabilityReport(payload?.data)) {
        setRun({ kind: "done", report: payload.data });
        return;
      }
      const retryAfter = Number(response.headers.get("Retry-After"));
      setRun({
        kind: "failed",
        code:
          response.ok && payload?.data !== undefined
            ? "internal_error"
            : (payload?.error?.code ?? "fetch_failed"),
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
        limit: typeof payload?.limit === "number" ? payload.limit : null,
        signedIn: payload?.signedIn === true,
      });
    } catch {
      setRun({
        kind: "failed",
        code: "network",
        retryAfterSeconds: null,
        limit: null,
        signedIn: false,
      });
    }
  }, [question, url]);

  const report = run.kind === "done" ? run.report : null;

  const grouped = useMemo(() => {
    if (!report) return null;
    return {
      readable: report.checks.filter((check) => check.section === "readable"),
      extractable: report.checks.filter(
        (check) => check.section === "extractable",
      ),
    };
  }, [report]);

  const copyReport = useCallback(async () => {
    if (!report) return;
    const lines = [
      `${t("title")} — ${report.finalUrl}`,
      t("summary.fetchedAt", { time: formatTime(report.fetchedAt, locale) }),
      // The question travels with the pasted report. Without it a model is
      // handed a lead-answer row about a question it cannot see.
      ...questionLines(t, report),
      t("summary.counted", {
        passed: report.summary.passed,
        counted: report.summary.counted,
      }),
      "",
      ...report.checks.map((check) => {
        const state = t(`states.${check.state}`);
        const rule = t(`rules.${check.ruleId}`);
        const measured = t(
          `details.${check.measured.key}`,
          check.measured.values ?? {},
        );
        // The pattern-rule caveat travels with the row. Pasted into a model
        // without it, a pattern match reads as a determination.
        const kind =
          check.kind === "heuristic" ? ` (${t("kinds.heuristic")})` : "";
        const fix = check.fix
          ? ` ${t("fixLabel")}: ${t(`fixes.${check.fix.key}`, check.fix.values ?? {})}`
          : "";
        return `- [${state}] ${rule}${kind} — ${measured}${fix}`;
      }),
      "",
      t("limitsTitle"),
      ...report.limits.map((limit) => `- ${t(`limits.${limit}`)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied("done");
    } catch {
      // A silent failure is worse than none: the visitor pastes whatever was
      // on the clipboard before and never learns this button did nothing.
      setCopied("failed");
    }
  }, [locale, report, t]);

  return (
    <div className="mt-10 grid gap-10">
      {/*
        One small live region instead of announcing the whole report.
        `role="status"` on the results section is implicitly atomic, so every
        button label change re-read all fourteen rows.
      */}
      <p aria-live="polite" className="sr-only" role="status">
        {run.kind === "running"
          ? t("actions.running")
          : run.kind === "done"
            ? t("summary.counted", {
                passed: run.report.summary.passed,
                counted: run.report.summary.counted,
              })
            : ""}
      </p>
      <section
        aria-busy={run.kind === "running"}
        aria-labelledby="citability-form"
        className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7"
      >
        <h2
          className="text-[19px] text-text-dark-primary"
          id="citability-form"
        >
          {t("fields.urlLabel")}
        </h2>
        <div className="mt-5 grid gap-4">
          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="citability-url"
            >
              {t("fields.urlLabel")}
            </label>
            <input
              className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
              id="citability-url"
              inputMode="url"
              maxLength={2_048}
              aria-describedby="citability-url-help"
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("fields.urlPlaceholder")}
              ref={urlInput}
              value={url}
            />
            <p
              className="mt-1.5 text-[12.5px] text-text-dark-secondary"
              id="citability-url-help"
            >
              {t("fields.urlHelp")}
            </p>
          </div>
          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="citability-question"
            >
              {t("fields.questionLabel")}
            </label>
            <input
              className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
              id="citability-question"
              maxLength={MAX_QUESTION_CHARS}
              aria-describedby="citability-question-help"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t("fields.questionPlaceholder")}
              value={question}
            />
            <p
              className="mt-1.5 text-[12.5px] text-text-dark-secondary"
              id="citability-question-help"
            >
              {t("fields.questionHelp")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-lg bg-brand-accent px-4 py-2 text-[14px] font-medium text-brand-on-accent disabled:opacity-60"
              disabled={run.kind === "running"}
              onClick={() => {
                void submit();
              }}
              type="button"
            >
              {run.kind === "running"
                ? t("actions.running")
                : report
                  ? t("actions.again")
                  : t("actions.run")}
            </button>
            <p className="text-[12.5px] text-text-dark-secondary">
              {t("summary.advisoryNote")}
            </p>
          </div>
          {run.kind === "failed" ? (
            <div className="grid gap-1" role="alert">
              <p className="text-[14px] text-brand-error">
                {KNOWN_ERROR_CODES.has(run.code)
                  ? t(
                      run.code === "rate_limited" && !run.signedIn
                        ? "errors.rate_limited_anonymous"
                        : `errors.${run.code}`,
                      {
                        limit:
                          run.limit ??
                          (run.code === "target_busy"
                            ? CITABILITY_TARGET_MAX
                            : CITABILITY_ANON_IP_MAX),
                        signedInMax: CITABILITY_SIGNED_IN_IP_MAX,
                        minutes: run.retryAfterSeconds
                          ? Math.max(1, Math.ceil(run.retryAfterSeconds / 60))
                          : Math.round(CITABILITY_WINDOW_SECONDS / 60),
                        seconds: Math.round(CITABILITY_FETCH_TIMEOUT_MS / 1000),
                      },
                    )
                  : t("errors.network")}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {report && grouped ? (
        <section aria-labelledby="citability-result" className="grid gap-6">
          <div className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h2
              className="text-[19px] text-text-dark-primary"
              id="citability-result"
            >
              {t("summary.title")}
            </h2>
            <p className="mt-3 text-[15px] text-text-dark-primary">
              {t("summary.counted", {
                passed: report.summary.passed,
                counted: report.summary.counted,
              })}
            </p>
            <ul className="mt-4 grid gap-1.5 text-[13px] text-text-dark-secondary">
              <li>
                {t("summary.rows", {
                  total: report.summary.total,
                  weighted:
                    report.summary.counted +
                    report.summary.fetchError +
                    report.summary.notApplicable,
                  notApplicable: report.summary.notApplicable,
                  fetchError: report.summary.fetchError,
                  denominator: report.summary.counted,
                })}
              </li>
              <li>
                {t("summary.fetchedAt", {
                  time: formatTime(report.fetchedAt, locale),
                })}
              </li>
              <li>{t("summary.finalUrl", { url: report.finalUrl })}</li>
              {report.finalUrl !== report.url ? (
                <li className="text-text-dark-primary">
                  {t("summary.redirected")}
                </li>
              ) : null}
              <li>{t("summary.textChars", { chars: report.textChars })}</li>
              {/*
                The question the run was actually given, and the words taken
                out of it. Both are in the payload; printing neither is how a
                visitor who typed "which is best?" reads a row that says no
                question was given and has nothing to check it against.
              */}
              {questionLines(t, report).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button
              className="mt-5 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary"
              onClick={() => {
                void copyReport();
              }}
              type="button"
            >
              {copied === "done"
                ? t("actions.copied")
                : copied === "failed"
                  ? t("actions.copyFailed")
                  : t("actions.copy")}
            </button>
          </div>

          {(
            [
              ["readable", grouped.readable],
              ["extractable", grouped.extractable],
            ] as const
          ).map(([section, checks]) => (
            <div
              className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7"
              key={section}
            >
              <h3 className="text-[17px] text-text-dark-primary">
                {t(`sections.${section}`)}
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.7] text-text-dark-secondary">
                {t(`sections.${section}Intro`)}
              </p>
              <ul className="mt-4 grid">
                {checks.map((check) => (
                  <CheckRow check={check} key={check.ruleId} />
                ))}
              </ul>
            </div>
          ))}

          <div className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h3 className="text-[17px] text-text-dark-primary">
              {t("limitsTitle")}
            </h3>
            <ul className="mt-3 grid gap-2">
              {report.limits.map((limit) => (
                <li
                  className="text-[13.5px] leading-[1.7] text-text-dark-secondary"
                  key={limit}
                >
                  {t(`limits.${limit}`)}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
