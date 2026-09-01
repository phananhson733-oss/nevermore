"use client";

// @input  -- a page URL and an optional target question, typed by a visitor
// @output -- the citability report rendered from message keys, or one stated error
// @pos    -- the only client surface of /tools/page-citability-check; it renders, it does not judge

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

import {
  CITABILITY_ANON_IP_MAX,
  CITABILITY_FETCH_TIMEOUT_MS,
  CITABILITY_MAX_QUESTION_CHARS,
  CITABILITY_SIGNED_IN_IP_MAX,
  CITABILITY_TARGET_MAX,
  CITABILITY_WINDOW_SECONDS,
  type CitabilityCheck,
  type CitabilityReport,
  type CitabilityState,
} from "../../lib/geo-tools/citability-contract.ts";
import { CITABILITY_RAW_RENDER_RATIO_FLOOR, CITABILITY_RENDER_SCHEMA, type CitabilityRenderEvidence } from "../../lib/geo-tools/citability-render-contract.ts";
import { consumeToolHandoff } from "../../lib/tools/tool-handoff.ts";
import { consumeGeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";
import { buildCitabilityConclusion, type CitabilityConclusion } from "../../lib/geo-tools/citability-conclusion.ts";
import { isCitabilityAiReview, type CitabilityAiReview } from "../../lib/geo-tools/citability-ai-contract.ts";

const ENDPOINT = "/api/tools/page-citability-check";
const AI_ENDPOINT = `${ENDPOINT}/ai-review`;

type CopyState = "idle" | "done" | "failed";
type AiFailure = { readonly kind: "failed"; readonly code: string; readonly outcomeUnknown: boolean; readonly costUsd: number | null; readonly providerTaskId: string | null; readonly retryAfterSeconds: number | null };
type AiState = { readonly kind: "idle" } | { readonly kind: "done"; readonly review: CitabilityAiReview } | AiFailure;
const AI_ERROR_CODES = new Set(["auth_required", "auth_unavailable", "invalid_origin", "invalid_request", "payload_too_large", "unsupported_media_type", "invalid_url", "provider_unconfigured", "fetch_blocked", "fetch_timeout", "fetch_failed", "page_not_ok", "not_html", "not_utf8", "evidence_incomplete", "evidence_changed", "rate_limited", "quota_unavailable", "review_already_requested", "input_budget_exceeded", "evidence_invalid", "provider_invalid_response", "provider_error", "provider_timeout", "provider_network_error", "internal_error"]);

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
    isRenderEvidence(record["render"]) &&
    Array.isArray(record["rootCauses"]) && record["rootCauses"].every((cause: unknown) => {
      if (typeof cause !== "object" || cause === null) return false;
      const group = cause as Record<string, unknown>;
      return typeof group["id"] === "string" && ["crawlerAccess", "rendering", "canonical", "answerStructure", "claimEvidence", "faq", "advisory"].includes(group["id"]) &&
        typeof group["basis"] === "string" && ["sharedEvidence", "possibleDependency", "independent"].includes(group["basis"]) &&
        Array.isArray(group["checkIds"]) && group["checkIds"].every((id: unknown) => typeof id === "string") &&
        Array.isArray(group["relatedCheckIds"]) && group["relatedCheckIds"].every((id: unknown) => typeof id === "string");
    }) &&
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
    ["passed", "failed", "fetchError", "notApplicable", "counted", "total"].every((key) => {
      const count = (summary as Record<string, unknown>)[key];
      return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
    }) && isReportConclusion(record["conclusion"], record)
  );
}

/** Validate the server projection against its evidence; never fill in a missing conclusion. */
function isReportConclusion(value: unknown, report: Record<string, unknown>): value is CitabilityConclusion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const checks = report["checks"];
  if (!Array.isArray(checks) || !checks.every((check: unknown) => {
    if (typeof check !== "object" || check === null) return false;
    const row = check as Record<string, unknown>;
    return typeof row["ruleId"] === "string" && typeof row["weight"] === "string" && ["counted", "advisory"].includes(row["weight"]) &&
      typeof row["state"] === "string" && ["pass", "fail", "fetchError", "notApplicable"].includes(row["state"]) &&
      typeof row["kind"] === "string" && ["deterministic", "heuristic"].includes(row["kind"]);
  })) return false;
  const expected = buildCitabilityConclusion({ checks: checks as CitabilityCheck[], render: report["render"] as CitabilityRenderEvidence, targetQuestion: report["targetQuestion"] as string | null });
  const conclusion = value as Record<string, unknown>;
  return (Object.keys(expected) as (keyof CitabilityConclusion)[]).every(key => JSON.stringify(conclusion[key]) === JSON.stringify(expected[key]));
}

function isRenderEvidence(value: unknown): value is CitabilityRenderEvidence {
  if (typeof value !== "object" || value === null) return false;
  const render = value as Record<string, unknown>;
  const capture = (entry: unknown): boolean => {
    if (typeof entry !== "object" || entry === null) return false;
    const record = entry as Record<string, unknown>;
    return typeof record["text"] === "string" && record["text"].length <= 100_000 && typeof record["textChars"] === "number" && typeof record["complete"] === "boolean";
  };
  return render["schemaVersion"] === CITABILITY_RENDER_SCHEMA &&
    typeof render["status"] === "string" && ["measured", "partial", "unavailable"].includes(render["status"]) &&
    (render["reason"] === null || (typeof render["reason"] === "string" && ["not_configured", "timeout", "service_failed", "invalid_response", "blocked", "resource_limit", "truncated", "navigation"].includes(render["reason"]))) &&
    capture(render["raw"]) && (render["rendered"] === null || capture(render["rendered"])) &&
    (render["rawToRenderedRatio"] === null || (typeof render["rawToRenderedRatio"] === "number" && Number.isFinite(render["rawToRenderedRatio"]) && render["rawToRenderedRatio"] >= 0)) &&
    typeof render["measuredAt"] === "string" && typeof render["requestCount"] === "number" &&
    typeof render["blockedRequests"] === "number" && typeof render["bytes"] === "number";
}

function renderLines(t: (key: string, values?: Readonly<Record<string, string | number>>) => string, render: CitabilityRenderEvidence, locale: string): readonly string[] {
  return [
    t(`render.status.${render.status}`),
    ...(render.reason ? [t(`render.reasons.${render.reason}`)] : []),
    t("render.rawChars", { chars: render.raw.textChars }),
    ...(render.rendered ? [t("render.renderedChars", { chars: render.rendered.textChars })] : []),
    render.rawToRenderedRatio === null ? t("render.ratioUnknown") : t("render.ratio", { ratio: Math.round(render.rawToRenderedRatio * 1000) / 10 }),
    t("render.time", { time: formatTime(render.measuredAt, locale) }),
    t("render.requests", { count: render.requestCount, blocked: render.blockedRequests, omitted: render.omittedRequests, bytes: render.bytes }),
    t(`render.methods.${render.raw.method}`),
  ];
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

function conclusionLines(t: (key: string, values?: Readonly<Record<string, string | number>>) => string, report: CitabilityReport): readonly string[] {
  const conclusion = report.conclusion;
  return [
    t("conclusion.title"),
    t(`conclusion.verdict.${conclusion.verdict}`),
    t(`conclusion.coverage.${conclusion.coverage}`),
    t("conclusion.counts", { observed: conclusion.observedIssueCheckIds.length, review: conclusion.reviewCheckIds.length, unknown: conclusion.unknownCheckIds.length, notApplicable: conclusion.notApplicableCheckIds.length, advisory: conclusion.advisoryCheckIds.length }),
    t("conclusion.priorityTitle"),
    ...(conclusion.priorityCheckIds.length ? conclusion.priorityCheckIds.map(id => `- ${t(`rules.${id}`)}`) : [t("conclusion.noPriorities")]),
    ...conclusion.limitations.map(limit => `- ${t(`conclusion.limitations.${limit}`)}`),
  ];
}

function aiReviewLines(t: (key: string, values?: Readonly<Record<string, string | number>>) => string, review: CitabilityAiReview, locale: string): readonly string[] {
  return [
    t("ai.model", { requested: review.requestedModel, actual: review.actualModel }),
    t("ai.task", { task: review.providerTaskId }),
    t("ai.observedAt", { time: formatTime(review.observedAt, locale) }),
    t("ai.capturedAt", { time: formatTime(review.capturedAt, locale) }),
    review.costUsd === null ? t("ai.costUnknown") : t("ai.cost", { cost: review.costUsd }),
    t("ai.coverage", { included: review.includedBodyChars, total: review.totalBodyChars, coverage: t(`ai.coverages.${review.coverage}`) }),
    t("ai.identity", { hash: review.rawSha256 }),
  ];
}

function aiFailureLines(t: (key: string, values?: Readonly<Record<string, string | number>>) => string, failure: AiFailure): readonly string[] {
  return [t(`ai.errors.${failure.code}`),
    ...(failure.outcomeUnknown ? [t("ai.outcomeUnknown")] : []),
    ...(failure.retryAfterSeconds ? [t("ai.waitNote", { minutes: Math.ceil(failure.retryAfterSeconds / 60) })] : []),
    ...(failure.providerTaskId ? [t("ai.task", { task: failure.providerTaskId })] : []),
    ...(failure.costUsd !== null ? [t("ai.cost", { cost: failure.costUsd })] : failure.outcomeUnknown ? [t("ai.costUnknown")] : []),
  ];
}

function CheckRow({ check }: { readonly check: CitabilityCheck }) {
  const t = useTranslations("tools.pageCitability");
  const measuredValues = check.measured.values ?? {};
  const fixValues = check.fix?.values ?? {};
  return (
    <li id={`citability-rule-${check.ruleId}`} className="grid scroll-mt-24 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border-b border-brand-border-card/60 px-4 py-4 last:border-b-0 md:gap-x-4 md:px-5">
        <span
          className={`mt-0.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11.5px] ${STATE_STYLES[check.state]}`}
        >
          {t(`states.${check.state}`)}
        </span>
      <div className="min-w-0 space-y-1.5 break-words">
        <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14.5px] text-text-dark-primary">
          {t(`rules.${check.ruleId}`)}
        </span>
        {check.weight === "advisory" ? (
          <span className="rounded-md border border-brand-border-card px-2 py-0.5 font-mono text-[11px] text-text-dark-secondary">
            {t("weights.advisory")}
          </span>
        ) : null}
        {check.kind === "heuristic" ? (
          <span className="rounded-md border border-brand-warning/40 bg-brand-warning/[0.06] px-2 py-0.5 font-mono text-[11px] text-brand-warning">
            {t("kinds.heuristic")}
          </span>
        ) : null}
      </div>
      <p className="text-[13px] leading-[1.65] text-text-dark-secondary">
        {t(`details.${check.measured.key}`, check.measured.key === "ssr.renderUnavailable" ? { ...measuredValues, reason: t(`render.reasons.${String(measuredValues["reason"])}`) } : measuredValues)}
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
      </div>
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
  const [view, setView] = useState<"input" | "result">("input");
  const [copied, setCopied] = useState<CopyState>("idle");
  const [ai, setAi] = useState<AiState>({ kind: "idle" });
  const [aiPending, setAiPending] = useState(false);
  const [handoffSource, setHandoffSource] = useState<"contentDraft" | "geoGap" | null>(null);
  const urlInput = useRef<HTMLInputElement | null>(null);
  const resultHeading = useRef<HTMLHeadingElement | null>(null);
  const inFlight = useRef(false);
  const aiInFlight = useRef(false);
  const reportRevision = useRef(0);
  const handoffConsumed = useRef(false);
  useEffect(() => {
    if (view === "result") resultHeading.current?.focus();
  }, [view]);
  useEffect(() => {
    if (handoffConsumed.current) return;
    handoffConsumed.current = true;
    try {
      const marker = new URLSearchParams(window.location.search).getAll("handoff");
      // Explicit protocol selection prevents a missing or corrupt gap from
      // silently restoring an older unrelated Draft handoff.
      if (marker.length === 1 && marker[0] === "geo-gap") {
        const handoff = consumeGeoGapHandoff(window.sessionStorage, Date.now(), "page-citability-check");
        if (!handoff || handoff.pageUrl === null || handoff.questionText === null) return;
        setUrl(handoff.pageUrl);
        setQuestion(handoff.questionText);
        setHandoffSource("geoGap");
      } else if (marker.length === 0) {
        const handoff = consumeToolHandoff(window.sessionStorage, Date.now(), "page-citability-check");
        if (!handoff) return;
        setUrl(handoff.page);
        setQuestion(handoff.query);
        setHandoffSource("contentDraft");
      }
    } catch {
      // Storage unavailable means manual input. Never read a fallback key.
    }
  }, []);
  const questionTooLong = question.trim().length > CITABILITY_MAX_QUESTION_CHARS;

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    if (question.trim().length > CITABILITY_MAX_QUESTION_CHARS) return;
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      urlInput.current?.focus();
      return;
    }
    inFlight.current = true;
    reportRevision.current += 1;
    setAi({ kind: "idle" });
    setView("input");
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
        setView("result");
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
    } finally {
      inFlight.current = false;
    }
  }, [question, url]);

  const report = run.kind === "done" ? run.report : null;
  const aiEvidenceAvailable = report !== null && typeof report.render.rawSha256 === "string" && /^[a-f0-9]{64}$/.test(report.render.rawSha256) && report.render.raw.complete && report.render.raw.textChars > 0;
  const aiRequestBlocked = ai.kind === "done" || (ai.kind === "failed" && (ai.outcomeUnknown || ["rate_limited", "review_already_requested", "provider_error", "provider_invalid_response", "provider_timeout", "provider_network_error"].includes(ai.code)));

  const requestAiReview = useCallback(async () => {
    if (!report || !aiEvidenceAvailable || aiRequestBlocked || aiInFlight.current) return;
    const revision = reportRevision.current;
    aiInFlight.current = true;
    setAiPending(true);
    setAi({ kind: "idle" });
    setCopied("idle");
    try {
      const response = await fetch(AI_ENDPOINT, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: report.finalUrl, ...(report.targetQuestion !== null ? { question: report.targetQuestion } : {}), rawSha256: report.render.rawSha256 }),
      });
      const payload = await response.json().catch(() => null) as { readonly review?: unknown; readonly error?: { readonly code?: unknown }; readonly outcomeUnknown?: unknown; readonly costUsd?: unknown; readonly providerTaskId?: unknown } | null;
      if (revision !== reportRevision.current) return;
      if (response.ok && isCitabilityAiReview(payload?.review) && payload.review.finalUrl === report.finalUrl && payload.review.targetQuestion === report.targetQuestion && payload.review.rawSha256 === report.render.rawSha256) {
        setAi({ kind: "done", review: payload.review });
        return;
      }
      const code = response.ok ? "receipt_mismatch" : typeof payload?.error?.code === "string" && AI_ERROR_CODES.has(payload.error.code) ? payload.error.code : "internal_error";
      const retryAfter = Number(response.headers.get("Retry-After"));
      setAi({ kind: "failed", code, outcomeUnknown: response.ok || code === "internal_error" || payload?.outcomeUnknown === true,
        costUsd: typeof payload?.costUsd === "number" && Number.isFinite(payload.costUsd) && payload.costUsd >= 0 ? payload.costUsd : null,
        providerTaskId: typeof payload?.providerTaskId === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(payload.providerTaskId) ? payload.providerTaskId : null,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null });
    } catch {
      if (revision === reportRevision.current) setAi({ kind: "failed", code: "network", outcomeUnknown: true, costUsd: null, providerTaskId: null, retryAfterSeconds: null });
    } finally {
      aiInFlight.current = false;
      setAiPending(false);
    }
  }, [aiEvidenceAvailable, aiRequestBlocked, report]);

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
      ...conclusionLines(t, report),
      t("render.title"),
      ...renderLines(t, report.render, locale),
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
          check.measured.key === "ssr.renderUnavailable" ? { ...check.measured.values, reason: t(`render.reasons.${String(check.measured.values?.["reason"])}`) } : check.measured.values ?? {},
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
      t("causes.title"),
      ...report.rootCauses.map((cause) => `${t(`causes.groups.${cause.id}`)} — ${t(`causes.basis.${cause.basis}`)}: ${cause.checkIds.map((id) => t(`rules.${id}`)).join(", ")}${cause.relatedCheckIds.length ? `; ${t("causes.related", { rules: cause.relatedCheckIds.map((id) => t(`rules.${id}`)).join(", ") })}` : ""}`),
      "",
      t("limitsTitle"),
      ...report.limits.map((limit) => `- ${t(`limits.${limit}`)}`),
      "", t("ai.title"), t("ai.boundary"),
      ...(ai.kind === "done" ? [ai.review.summary, ...aiReviewLines(t, ai.review, locale),
        ...ai.review.dimensions.map(dimension => `${t(`ai.dimensions.${dimension.id}`)} — ${t(`ai.verdicts.${dimension.verdict}`)}: ${dimension.reason}${dimension.suggestion ? ` ${t("ai.suggestion", { suggestion: dimension.suggestion })}` : ""} [${dimension.evidenceIds.join(", ")}]`),
        ...ai.review.excerpts.map(excerpt => `${t("ai.source", { id: excerpt.id })}: ${excerpt.text}`)]
        : ai.kind === "failed" ? aiFailureLines(t, ai) : [t(aiPending ? "ai.running" : "ai.idle")]),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied("done");
    } catch {
      // A silent failure is worse than none: the visitor pastes whatever was
      // on the clipboard before and never learns this button did nothing.
      setCopied("failed");
    }
  }, [ai, aiPending, locale, report, t]);

  return (
    <div className="mt-8 grid min-w-0 gap-6">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] tracking-wide text-text-dark-secondary">{t("views.note")}</p>
        <div className="inline-flex h-10 items-center rounded-[10px] border border-brand-border bg-brand-panel-sunken p-[3px]" role="group" aria-label={t("views.label")}>
          {(["input", "result"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              data-testid={`citability-view-${mode}`}
              aria-pressed={view === mode}
              disabled={mode === "result" && !report}
              onClick={() => setView(mode)}
              variant={view === mode ? "outline" : "ghost"}
              size="sm"
              className={view === mode ? "bg-brand-panel" : "border border-transparent"}
            >
              {t(`views.${mode}`)}
            </Button>
          ))}
        </div>
      </div>
      {view === "input" ? <section
        aria-busy={run.kind === "running"}
        aria-labelledby="citability-form"
        className="overflow-hidden rounded-xl border border-brand-border-card bg-brand-panel"
      >
        <h2
          className="border-b border-brand-border px-5 py-4 text-[19px] text-text-dark-primary md:px-6"
          id="citability-form"
        >
          {t("views.input")}
        </h2>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {handoffSource ? <p className="border-b border-brand-border-card px-5 py-4 text-[13px] text-text-dark-secondary md:px-6">{t(`handoff.${handoffSource}`)}</p> : null}
          <div className="grid gap-2 border-b border-brand-border px-5 py-5 md:grid-cols-[180px_minmax(0,1fr)] md:gap-6 md:px-6">
            <label
              className="text-[13px] text-text-dark-primary md:pt-2.5"
              htmlFor="citability-url"
            >
              {t("fields.urlLabel")}
              <span className="ml-1 text-brand-error" aria-hidden="true">*</span>
            </label>
            <div className="min-w-0">
            <Input
              id="citability-url"
              inputMode="url"
              aria-required="true"
              disabled={run.kind === "running"}
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
          </div>
          <div className="grid gap-2 border-b border-brand-border px-5 py-5 md:grid-cols-[180px_minmax(0,1fr)] md:gap-6 md:px-6">
            <label
              className="text-[13px] text-text-dark-primary md:pt-2.5"
              htmlFor="citability-question"
            >
              {t("fields.questionLabel")}
            </label>
            <div className="min-w-0">
            <Input
              id="citability-question"
              maxLength={CITABILITY_MAX_QUESTION_CHARS}
              disabled={run.kind === "running"}
              aria-invalid={questionTooLong || undefined}
              aria-describedby={questionTooLong ? "citability-question-help citability-question-error" : "citability-question-help"}
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
            {questionTooLong ? <p id="citability-question-error" data-testid="citability-question-too-long" role="alert" className="mt-1.5 text-[12.5px] text-brand-error">{t("fields.questionTooLong", { count: question.trim().length, max: CITABILITY_MAX_QUESTION_CHARS })}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-5 py-5 md:px-6">
            <Button
              disabled={run.kind === "running" || questionTooLong}
              type="submit"
            >
              {run.kind === "running"
                ? t("actions.running")
                : report
                  ? t("actions.again")
                  : t("actions.run")}
            </Button>
            <p className="text-[12.5px] text-text-dark-secondary">
              {t("views.runNote")}
            </p>
          </div>
          {run.kind === "failed" ? (
            <div className="px-5 pb-5 md:px-6" role="alert">
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
        </form>
      </section> : null}

      {view === "result" && report && grouped ? (
        <section aria-labelledby="citability-result" className="grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              className="scroll-mt-24 rounded-sm text-[19px] text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
              id="citability-result"
              ref={resultHeading}
              tabIndex={-1}
            >
              {t("summary.title")}
            </h2>
            <Button
              variant="outline"
              size="sm"
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
            </Button>
          </div>

          <section data-testid="citability-conclusion" data-verdict={report.conclusion.verdict} data-coverage={report.conclusion.coverage} className="rounded-xl border border-brand-border-card bg-brand-panel p-5">
            <h3 className="text-[16px] font-semibold text-text-dark-primary">{t("conclusion.title")}</h3>
            <p className="mt-2 text-[13px] font-medium leading-[1.7] text-text-dark-primary">{t(`conclusion.verdict.${report.conclusion.verdict}`)}</p>
            <p className="mt-1 text-[12.5px] leading-[1.7] text-text-dark-secondary">{t(`conclusion.coverage.${report.conclusion.coverage}`)}</p>
            <p className="mt-1 text-[12.5px] leading-[1.7] text-text-dark-secondary">{t("conclusion.counts", { observed: report.conclusion.observedIssueCheckIds.length, review: report.conclusion.reviewCheckIds.length, unknown: report.conclusion.unknownCheckIds.length, notApplicable: report.conclusion.notApplicableCheckIds.length, advisory: report.conclusion.advisoryCheckIds.length })}</p>
            <p className="mt-3 text-[12.5px] font-medium text-text-dark-primary">{t("conclusion.priorityTitle")}</p>
            {report.conclusion.priorityCheckIds.length ? <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-text-dark-secondary">
              {report.conclusion.priorityCheckIds.map(id => <li key={id}><a className="underline underline-offset-2 hover:text-text-dark-primary" href={`#citability-rule-${id}`}>{t(`rules.${id}`)}</a></li>)}
            </ul> : <p className="mt-1 text-[12.5px] text-text-dark-secondary">{t("conclusion.noPriorities")}</p>}
            <ul className="mt-3 grid gap-1 border-t border-brand-border-card pt-3 text-[12.5px] text-text-dark-secondary">
              {report.conclusion.limitations.map(limit => <li key={limit}>{t(`conclusion.limitations.${limit}`)}</li>)}
            </ul>
          </section>

          <div>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { id: "passed", label: t("summary.passed"), value: report.summary.passed, help: t("metrics.passedHelp", { count: report.summary.counted }), tone: "text-brand-accent-text" },
                { id: "failed", label: t("summary.failed"), value: report.summary.failed, help: t("metrics.failedHelp"), tone: "text-brand-error" },
                { id: "fetch-error", label: t("metrics.fetchError"), value: report.summary.fetchError, help: t("metrics.fetchErrorHelp"), tone: "text-text-dark-secondary" },
                { id: "ratio", label: "ssr_ratio", value: report.render.rawToRenderedRatio === null ? t("metrics.unknown") : report.render.rawToRenderedRatio.toFixed(2), help: report.render.rawToRenderedRatio === null ? t("render.ratioUnknown") : t("metrics.ratioHelp", { threshold: CITABILITY_RAW_RENDER_RATIO_FLOOR }), tone: report.render.rawToRenderedRatio !== null && report.render.rawToRenderedRatio < CITABILITY_RAW_RENDER_RATIO_FLOOR ? "text-brand-error" : "text-text-dark-secondary" },
              ].map((metric) => (
                <div key={metric.id} data-testid={`citability-metric-${metric.id}`} className="min-w-0 rounded-xl border border-brand-border-card bg-brand-panel p-4 md:p-5">
                  <dt className="text-[12px] text-text-dark-secondary">{metric.label}</dt>
                  <dd className={`mt-2 break-words font-mono text-[26px] font-semibold leading-tight md:text-[30px] ${metric.tone}`}>{metric.value}</dd>
                  <p className="mt-2 text-[11.5px] leading-[1.7] text-text-dark-secondary">{metric.help}</p>
                </div>
              ))}
            </dl>
            <div className="mt-4 space-y-1.5 text-[12px] leading-[1.7] text-text-dark-secondary">
              <p className="text-[12px] leading-[1.7] text-text-dark-primary">{t("summary.counted", { passed: report.summary.passed, counted: report.summary.counted })}</p>
              <p className="text-[12px] leading-[1.7]">{t("summary.rows", { total: report.summary.total, weighted: report.summary.counted + report.summary.fetchError + report.summary.notApplicable, notApplicable: report.summary.notApplicable, fetchError: report.summary.fetchError, denominator: report.summary.counted })}</p>
              <p className="text-[12px] leading-[1.7]">{t("summary.advisoryNote")}</p>
            </div>
          </div>

          <div data-testid="citability-root-causes" className={`rounded-xl border border-l-4 border-brand-border-card bg-brand-panel p-5 ${report.summary.failed > 0 ? "border-l-brand-error" : "border-l-brand-border-card"}`}>
            <h3 className="text-[16.5px] font-semibold text-text-dark-primary">{t("causes.title")}</h3>
            <p className="mt-1.5 text-[12px] leading-[1.7] text-text-dark-secondary">{t("causes.intro")}</p>
            {report.rootCauses.length === 0 ? <p className="mt-3 text-[13px] text-text-dark-secondary">{t("causes.none")}</p> : (
              <ul className="mt-3 divide-y divide-brand-border">
                {report.rootCauses.map((cause) => <li key={cause.id} className="grid gap-1.5 py-3 text-[12.5px] leading-[1.7] text-text-dark-secondary first:pt-0 last:pb-0 md:grid-cols-[150px_minmax(0,1fr)] md:gap-4">
                  <h4 className="font-medium text-text-dark-primary">{t(`causes.groups.${cause.id}`)}</h4>
                  <div className="min-w-0 break-words">
                    <p className="text-[12.5px] leading-[1.7]">{t(`causes.basis.${cause.basis}`)}</p>
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{cause.checkIds.map((id) => <li key={id}><a className="underline underline-offset-2 hover:text-text-dark-primary" href={`#citability-rule-${id}`}>{t(`rules.${id}`)}</a></li>)}</ul>
                    {cause.relatedCheckIds.length > 0 ? <p className="mt-1 text-[12.5px] leading-[1.7]">{t("causes.related", { rules: cause.relatedCheckIds.map((id) => t(`rules.${id}`)).join(", ") })}</p> : null}
                  </div>
                </li>)}
              </ul>
            )}
          </div>

          <section data-testid="citability-ai-review" className="rounded-xl border border-brand-border-card bg-brand-panel p-5">
            <h3 className="text-[16px] font-semibold text-text-dark-primary">{t("ai.title")}</h3>
            <p className="mt-2 text-[12.5px] leading-[1.7] text-text-dark-secondary">{t("ai.boundary")}</p>
            <p className="mt-2 text-[12.5px] leading-[1.7] text-text-dark-secondary">{t("ai.sendNote")}</p>
            <p className="mt-1 text-[12.5px] leading-[1.7] text-text-dark-secondary">{t("ai.limitNote")}</p>
            {report.targetQuestion === null ? <p className="mt-1 text-[12.5px] leading-[1.7] text-text-dark-secondary">{t("ai.noQuestion")}</p> : null}
            {!aiEvidenceAvailable ? <p className="mt-2 text-[12.5px] text-text-dark-secondary">{t("ai.evidenceUnavailable")}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" data-testid="citability-ai-run" disabled={!aiEvidenceAvailable || aiRequestBlocked || aiPending} onClick={() => { void requestAiReview(); }}>{t(aiPending ? "ai.running" : ai.kind === "done" ? "ai.done" : "ai.run")}</Button>
              {ai.kind === "idle" && !aiPending ? <p className="text-[12px] text-text-dark-secondary">{t("ai.idle")}</p> : null}
            </div>
            {ai.kind === "failed" ? <div data-testid="citability-ai-error" role="alert" className="mt-3 grid gap-1 rounded-lg border border-brand-warning/30 bg-brand-warning/[0.05] p-3">
              {aiFailureLines(t, ai).map((line, index) => <p className="text-[12.5px] leading-[1.7] text-text-dark-secondary" key={index}>{line}</p>)}
            </div> : null}
            {ai.kind === "done" ? <div data-testid="citability-ai-result" className="mt-4 border-t border-brand-border-card pt-4">
              <p className="text-[13px] leading-[1.7] text-text-dark-primary">{ai.review.summary}</p>
              <ul className="mt-3 grid gap-1 text-[11.5px] text-text-dark-secondary [overflow-wrap:anywhere]">
                {aiReviewLines(t, ai.review, locale).map((line, index) => <li key={index}>{line}</li>)}
              </ul>
              <ul className="mt-4 divide-y divide-brand-border-card">
                {ai.review.dimensions.map(dimension => <li data-ai-dimension={dimension.id} className="py-3 first:pt-0 last:pb-0" key={dimension.id}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h4 className="text-[13px] font-medium text-text-dark-primary">{t(`ai.dimensions.${dimension.id}`)}</h4>
                    <span className={`text-[11.5px] ${dimension.verdict === "clear" ? "text-brand-accent-text" : dimension.verdict === "needs_work" ? "text-brand-warning" : "text-text-dark-secondary"}`}>{t(`ai.verdicts.${dimension.verdict}`)}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.7] text-text-dark-secondary">{dimension.reason}</p>
                  {dimension.suggestion ? <p className="mt-1 text-[12.5px] leading-[1.7] text-text-dark-secondary">{t("ai.suggestion", { suggestion: dimension.suggestion })}</p> : null}
                  <ul className="mt-1 flex flex-wrap gap-3 text-[11.5px] text-text-dark-secondary">
                    {dimension.evidenceIds.map(id => <li key={id}><a className="underline underline-offset-2 hover:text-text-dark-primary" href={`#citability-ai-evidence-${id}`} onClick={() => { document.getElementById(`citability-ai-evidence-${id}`)?.closest("details")?.setAttribute("open", ""); }}>{t("ai.source", { id })}</a></li>)}
                  </ul>
                </li>)}
              </ul>
              <details className="mt-4 border-t border-brand-border-card pt-3">
                <summary className="cursor-pointer text-[12.5px] font-medium text-text-dark-primary">{t("ai.excerptsTitle")}</summary>
                <ol className="mt-2 grid gap-3">
                  {ai.review.excerpts.map(excerpt => <li id={`citability-ai-evidence-${excerpt.id}`} className="scroll-mt-24" key={excerpt.id}><span className="font-mono text-[11.5px] text-text-dark-secondary">{excerpt.id}</span><p className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.7] text-text-dark-secondary [overflow-wrap:anywhere]">{excerpt.text}</p></li>)}
                </ol>
              </details>
            </div> : null}
          </section>

          {(
            [
              ["readable", grouped.readable],
              ["extractable", grouped.extractable],
            ] as const
          ).map(([section, checks]) => (
            <div
              data-testid={`citability-stage-${section}`}
              className="min-w-0"
              key={section}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-[16.5px] font-semibold text-text-dark-primary">{t(`sections.${section}`)}</h3>
                <span className="font-mono text-[11.5px] text-text-dark-secondary">{t("metrics.sectionCount", { count: checks.length })}</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-[1.7] text-text-dark-secondary">
                {t(`sections.${section}Intro`)}
              </p>
              <ul className="mt-3 overflow-hidden rounded-xl border border-brand-border-card bg-brand-panel">
                {checks.map((check) => (
                  <CheckRow check={check} key={check.ruleId} />
                ))}
              </ul>
            </div>
          ))}

          <details data-testid="citability-evidence" className="min-w-0 rounded-xl border border-brand-border-card bg-brand-panel p-5">
            <summary className="cursor-pointer text-[14px] font-medium text-text-dark-primary">{t("render.title")}</summary>
            <p className="mt-3 text-[13px] text-text-dark-primary" data-testid="citability-render-status" data-status={report.render.status}>{t(`render.status.${report.render.status}`)}</p>
            <ul className="mt-2 grid gap-1.5 text-[12px] leading-[1.7] text-text-dark-secondary">
              {renderLines(t, report.render, locale).slice(1).map((line) => <li key={line}>{line}</li>)}
            </ul>
            {report.render.rawToRenderedRatio !== null ? <p data-testid="citability-render-ratio" className="mt-2 text-[13px] text-text-dark-primary">{t("render.ratio", { ratio: Math.round(report.render.rawToRenderedRatio * 1000) / 10 })}</p> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <details className="min-w-0"><summary className="cursor-pointer text-[13px] text-text-dark-primary">{t("render.rawBody")}</summary><pre data-testid="citability-render-raw" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] text-text-dark-secondary">{report.render.raw.text}</pre></details>
              {report.render.rendered ? <details className="min-w-0"><summary className="cursor-pointer text-[13px] text-text-dark-primary">{t("render.renderedBody")}</summary><pre data-testid="citability-render-rendered" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] text-text-dark-secondary">{report.render.rendered.text}</pre></details> : null}
            </div>
            <h3 className="mt-5 border-t border-brand-border-card pt-4 text-[14px] text-text-dark-primary">{t("limitsTitle")}</h3>
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
          </details>

          <ul className="grid gap-1.5 border-t border-brand-border-card pt-4 font-mono text-[11.5px] leading-[1.8] text-text-dark-secondary [overflow-wrap:anywhere]">
            <li>{t("summary.finalUrl", { url: report.finalUrl })}</li>
            {report.finalUrl !== report.url ? <li className="text-text-dark-primary">{t("summary.redirected")}</li> : null}
            {questionLines(t, report).map((line) => <li key={line}>{line}</li>)}
            <li>{t("summary.textChars", { chars: report.textChars })}</li>
            <li>{t("summary.fetchedAt", { time: formatTime(report.fetchedAt, locale) })}</li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
