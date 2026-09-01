// @input  -- nothing; the shared vocabulary the page-citability checks are written in
// @output -- check identity, four-state outcome, weight, and the fetched inputs a check may read
// @pos    -- the seam between what was fetched and what this tool is willing to claim
import type { CitabilityRenderEvidence } from "./citability-render-contract.ts";
import type { CitabilityConclusion } from "./citability-conclusion.ts";
export type { CitabilityRenderEvidence } from "./citability-render-contract.ts";

/** Explicit lineage for corrected rule semantics in newly persisted site evidence. */
export const CITABILITY_RULES_VERSION = "marketing-page-citability-rules.v2" as const;

/**
 * Four states, because three of them were being made to carry two meanings.
 *
 * - `pass` / `fail`   we read the page and reached a verdict
 * - `fetchError`      we could not read the input this check needs; retrying may help
 * - `notApplicable`   there is nothing to check — no target question was given,
 *                     or the page declares no FAQ markup at all
 *
 * `notApplicable` exists so "you did not ask for this" stops being reported as
 * "the fetch failed", which is what a three-state contract forces. Neither one
 * enters the pass/fail denominator, but they are different sentences and lead
 * to different next actions.
 */
export type CitabilityState = "pass" | "fail" | "fetchError" | "notApplicable";

export type CitabilitySection = "readable" | "extractable";

/** Whether a rule's outcome is a threshold call or a pattern proxy for one. */
export type CitabilityRuleKind = "deterministic" | "heuristic";

/**
 * Whether a row participates in the conclusion.
 *
 * `advisory` rows stay outside the cross-engine denominator: ClaudeBot, GPTBot and
 * Google-Extended have product-specific training/grounding semantics, while
 * `/llms.txt` is a discovery convenience rather than a reading precondition.
 */
export type CitabilityWeight = "counted" | "advisory";

/**
 * `detail` names an i18n message and the values it interpolates rather than a
 * sentence. A rule engine that returns prose cannot serve `/en`, and this tool
 * publishes both locales from the same run.
 */
export interface CitabilityDetail {
  /** Message key under `tools.pageCitability.details`. */
  readonly key: string;
  readonly values?: Readonly<Record<string, string | number>>;
}

export interface CitabilityCheck {
  readonly ruleId: string;
  readonly section: CitabilitySection;
  readonly kind: CitabilityRuleKind;
  readonly weight: CitabilityWeight;
  readonly state: CitabilityState;
  /** What was actually observed, always specific enough to locate. */
  readonly measured: CitabilityDetail;
  /** Present exactly when `state === "fail"`. */
  readonly fix?: CitabilityDetail;
}

/**
 * How `robots.txt` came back.
 *
 * A missing file and an unreachable one are different facts with opposite
 * consequences: RFC 9309 §2.3.1.3 treats 404 as full allowance, while a 5xx or
 * a timeout means we do not know what the site permits. Collapsing both into
 * `null` is what turns "there are no rules" into "the check failed".
 */
export type RobotsFetch =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "incomplete"; readonly httpStatus: number; readonly bytes: number }
  | { readonly status: "absent"; readonly httpStatus: number }
  | { readonly status: "unreachable"; readonly httpStatus: number | null };

/** How `/llms.txt` came back. Incomplete bytes describe only the captured prefix. Advisory in every branch. */
export type LlmsTxtFetch =
  | { readonly status: "ok"; readonly bytes: number }
  | { readonly status: "incomplete"; readonly httpStatus: number; readonly bytes: number }
  | { readonly status: "absent"; readonly httpStatus: number }
  | { readonly status: "unreachable"; readonly httpStatus: number | null };

/** Everything a rule may read. Assembled once, passed to every rule. */
export interface CitabilityInput {
  readonly render?: CitabilityRenderEvidence;
  /** The URL the visitor submitted, after normalization. */
  readonly url: string;
  /** Where the fetch actually landed after redirects. */
  readonly finalUrl: string;
  /** HTML exactly as a client that does not run JavaScript receives it. */
  readonly rawHtml: string;
  /**
   * False when only the first bounded slice of the response was read.
   *
   * Every "this is not present" conclusion depends on having seen the whole
   * document. A truncated app shell cut mid-script reported 1.5 million
   * characters of body text and passed the very check it should have failed,
   * because the unclosed script turned its own source into copy.
   */
  readonly bodyComplete: boolean;
  readonly robots: RobotsFetch;
  readonly llmsTxt: LlmsTxtFetch;
  /** Null when the visitor named no target question. */
  readonly targetQuestion: string | null;
}

/** Text projections computed once and shared by every rule. */
export interface CitabilityContext {
  /** Visible text with tags removed. */
  readonly text: string;
  /** Same text, with a marker where an anchor was, so a link stays observable. */
  readonly textWithLinkMarkers: string;
  readonly textChars: number;
  readonly scriptBytes: number;
  /** Content words derived from the target question; empty when none was given. */
  readonly questionTerms: readonly string[];
}

export interface CitabilitySummary {
  readonly passed: number;
  readonly failed: number;
  readonly fetchError: number;
  readonly notApplicable: number;
  /** passed + failed. The denominator printed next to the result. */
  readonly counted: number;
  /** Every row, including advisory ones. */
  readonly total: number;
}

export interface CitabilityReport {
  readonly conclusion: CitabilityConclusion;
  readonly render: CitabilityRenderEvidence;
  readonly rootCauses: readonly CitabilityRootCause[];
  readonly url: string;
  readonly finalUrl: string;
  readonly targetQuestion: string | null;
  readonly questionTerms: readonly string[];
  readonly fetchedAt: string;
  readonly textChars: number;
  readonly checks: readonly CitabilityCheck[];
  readonly summary: CitabilitySummary;
  /**
   * Stated limits, rendered with the report rather than left in a pull request.
   * Keys under `tools.pageCitability.limits`.
   */
  readonly limits: readonly string[];
}

export interface CitabilityRootCause {
  readonly id: "crawlerAccess" | "rendering" | "canonical" | "answerStructure" | "claimEvidence" | "faq" | "advisory";
  readonly basis: "sharedEvidence" | "possibleDependency" | "independent";
  readonly checkIds: readonly string[];
  readonly relatedCheckIds: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Thresholds — printed on the page, never inlined into a component    */
/* ------------------------------------------------------------------ */

/**
 * Retrieval crawlers: the ones that fetch a page in order to answer with it.
 *
 * This inventory is purpose-specific, not the shared crawler's bot list.
 * Claude-SearchBot and Claude-User are not measured in this fourteen-row version.
 */
export const CITABILITY_RETRIEVAL_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
] as const;

/**
 * Model-specific controls. Shown, never counted in the cross-engine summary.
 *
 * `ClaudeBot` and `GPTBot` govern training-corpus collection; their allowance
 * does not establish citability. Google-Extended additionally
 * controls Gemini grounding, but does not control Google Search inclusion or
 * ranking. Keep these separate from the generic retrieval denominator.
 */
export const CITABILITY_TRAINING_BOTS = ["ClaudeBot", "GPTBot", "Google-Extended"] as const;

/** Below this many characters of visible text, the HTML is not carrying the copy. */
export const CITABILITY_TEXT_FLOOR_CHARS = 400;

/** Script bytes this many times the visible text marks a client-rendered shell. */
export const CITABILITY_SCRIPT_DOMINANCE = 5;

/** The window a direct answer has to appear in. */
export const CITABILITY_LEAD_ANSWER_CHARS = 200;

/** A list needs at least this many items before it is a list rather than a nav. */
export const CITABILITY_MIN_LIST_ITEMS = 3;

/** Above this share of items being links, a list is navigation. */
export const CITABILITY_LIST_LINK_DENSITY_MAX = 0.5;

export const CITABILITY_FETCH_TIMEOUT_MS = 8_000;
export const CITABILITY_MAX_BODY_BYTES = 1_500_000;
/** Same bound as shared Draft handoffs; question identity is never truncated. */
export const CITABILITY_MAX_QUESTION_CHARS = 512;

/**
 * This tool's own quota, deliberately not the site-wide crawl gate.
 *
 * `crawl-gate` admits whole-site crawls of up to thousands of requests and is
 * shared by the audit tools; a page, two discovery files and a strictly bounded
 * render have their own ceiling, and a visitor fixing a page
 * needs to re-check it several times in a row without spending the budget that
 * governs site crawls.
 */
export const CITABILITY_ANON_IP_MAX = 20;
export const CITABILITY_SIGNED_IN_IP_MAX = 60;
export const CITABILITY_TARGET_MAX = 30;
export const CITABILITY_WINDOW_SECONDS = 60 * 60;

export type CitabilityErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "invalid_url"
  | "rate_limited"
  | "target_busy"
  | "already_running"
  | "gate_unavailable"
  | "fetch_blocked"
  | "fetch_timeout"
  | "fetch_failed"
  | "not_html"
  | "page_not_ok"
  | "internal_error"
  | "not_utf8";

/* ------------------------------------------------------------------ */
/* Construction helpers                                                */
/* ------------------------------------------------------------------ */

export function citabilityCheck(
  ruleId: string,
  section: CitabilitySection,
  kind: CitabilityRuleKind,
  weight: CitabilityWeight,
  state: CitabilityState,
  measured: CitabilityDetail,
  fix?: CitabilityDetail,
): CitabilityCheck {
  if (state === "fail" && !fix) {
    throw new Error(`rule ${ruleId} failed without a fix`);
  }
  return {
    ruleId,
    section,
    kind,
    weight,
    state,
    measured,
    ...(state === "fail" && fix ? { fix } : {}),
  };
}

export function summarizeCitability(
  checks: readonly CitabilityCheck[],
): CitabilitySummary {
  let passed = 0;
  let failed = 0;
  let fetchError = 0;
  let notApplicable = 0;
  for (const check of checks) {
    if (check.weight !== "counted") continue;
    if (check.state === "pass") passed += 1;
    else if (check.state === "fail") failed += 1;
    else if (check.state === "fetchError") fetchError += 1;
    else notApplicable += 1;
  }
  return {
    passed,
    failed,
    fetchError,
    notApplicable,
    counted: passed + failed,
    total: checks.length,
  };
}
