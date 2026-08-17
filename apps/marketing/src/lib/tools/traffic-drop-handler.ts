// @input  -- authenticated POST with one Search Console property, plus the visitor's grant
// @output -- traffic drop diagnosis envelope with its daily series, or a stable error code
// @pos    -- shared handler behind /api/tools/traffic-drop
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildTrafficDropReport,
  createPublicToolError,
  isSelfCheckAnswer,
  type SelfCheckAnswers,
  type TrafficChangePoint,
  type TrafficDailyPoint,
  type TrafficQueryEvidence,
} from "@sf/public-tools";
import type { GrantResolution } from "../auth/grant-cookie.ts";
import type { QualifyingTool } from "../credits/credits-config.ts";
import { reportFirstToolRun } from "../credits/report-first-run.ts";
import {
  openGscGate,
  refuseWithoutGrant,
  type GscGateResult,
} from "./gsc-gate.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import {
  readTrafficDropSession,
  resolveTrafficDropGrant,
  type TrafficDropSession,
} from "./traffic-drop-session.ts";

/** Room for a property, two self-check answers and a short brand list. */
const REQUEST_BODY_LIMIT_BYTES = 4_096;

/** Matches the sibling tool, which shares the same brand-term form. */
export const MAX_BRAND_TERMS = 10;
export const MAX_BRAND_TERM_LENGTH = 60;

/**
 * How much history to request.
 *
 * The detector needs twelve weeks minimum and uses everything it is given for
 * the site's own median; sixteen months also lets the year-over-year check
 * switch itself on for properties old enough to have last season.
 */
export const TRAFFIC_DROP_LOOKBACK_DAYS = 480;

export interface TrafficDropQueryReadRequest {
  readonly property: string;
  readonly changePoint: TrafficChangePoint;
  /**
   * The run's clock, which is what the later comparison window is derived
   * from — NOT the last day of the series.
   *
   * The daily series is read with `dataState: all` so the visitor can see the
   * days they came about, which puts its last row two to three days past
   * finalisation. The query reads use `final`. Anchoring on the series end
   * therefore asked for 28 days and got about 25, biasing every ratio and,
   * worse, lowering the later window's coverage specifically — the exact
   * asymmetry that manufactures the pattern this tool reports.
   */
  readonly now: Date;
  /** From this request's resolution; never captured at module scope. */
  readonly accessToken: string;
}

export interface TrafficDropHandlerDependencies {
  /**
   * The page-level view: which properties, read from the visitor's own cookie.
   *
   * Costs no network call, which is what makes it safe to consult before
   * admission control.
   */
  readonly readSession: () => Promise<TrafficDropSession>;
  /**
   * Produce the access token for this request.
   *
   * A thunk rather than a value because resolving it can spend two outbound
   * Google calls (the token endpoint, then the site list) against a shared
   * OAuth client and a per-PROJECT Search Console quota. Called once, and only
   * after the gate has admitted the request — otherwise one legitimate grant
   * is enough to drive unlimited traffic through both with no limiter in
   * front of them.
   */
  readonly resolveGrant: () => Promise<GrantResolution>;
  /** Fetches the [date]-dimension series. Injected so the route stays transport-free. */
  readonly readDailySeries: (input: {
    readonly property: string;
    readonly lookbackDays: number;
    /** From this request's resolution; never captured at module scope. */
    readonly accessToken: string;
  }) => Promise<readonly TrafficDailyPoint[]>;
  /**
   * Fetches the optional query-dimension evidence.
   *
   * Absent on a deployment that has not opened the extra Search Console
   * budget, and expected to resolve null rather than reject when a read fails
   * — see the degradation rule on `handleTrafficDropRequest`.
   */
  readonly readQueryEvidence?: (
    input: TrafficDropQueryReadRequest,
  ) => Promise<TrafficQueryEvidence | null>;
  readonly now: () => Date;
  /** Same shape the other public tools use, so the gate keys the same way. */
  readonly extractClientIp: (headers: Headers) => string;
  /**
   * Admission to the shared Search Console budget.
   *
   * Injected so the route stays transport-free and tests can drive the refusal
   * branches without a quota store.
   */
  readonly openGate: (clientIp: string) => Promise<GscGateResult>;
  /**
   * Records that a run completed, so a referred visitor's first qualifying run
   * can pay its reward.
   *
   * Optional and never awaited: the reporter defers its own work past the
   * response, and a run that produced a diagnosis must not fail because a
   * credit could not be recorded.
   */
  readonly reportFirstRun?: (tool: QualifyingTool) => void;
}

function json(
  body: unknown,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    // A report about someone's own property is never cached or shared.
    headers: { "Cache-Control": "no-store, private", ...extraHeaders },
  });
}

interface ParsedInput {
  readonly property: string;
  readonly selfChecks: SelfCheckAnswers;
  readonly brandTerms: readonly string[];
  readonly brandTermsConfirmed: boolean;
}

function parseInput(
  body: unknown,
): { readonly ok: true; readonly value: ParsedInput } | { readonly ok: false } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false };
  }

  const property = (body as { readonly property?: unknown }).property;
  if (typeof property !== "string" || property.trim() === "") {
    return { ok: false };
  }

  // Both self-checks are REQUIRED, and there is no default. Absent used to
  // mean "not asked yet", which made a run possible with the question
  // unanswered — and a report built that way has to hedge every sentence, so
  // the hedged version was the one visitors read first. Answering now precedes
  // running, and a request without both answers is malformed.
  //
  // An unrecognised value is rejected rather than coerced: silently mapping a
  // typo onto "no issue" would hand out the one reassurance this tool has no
  // standing to give.
  const rawChecks = (body as { readonly selfChecks?: unknown }).selfChecks;
  if (typeof rawChecks !== "object" || rawChecks === null) {
    return { ok: false };
  }
  const rawManualAction = (rawChecks as { readonly manualAction?: unknown })
    .manualAction;
  const rawSecurityIssue = (rawChecks as { readonly securityIssue?: unknown })
    .securityIssue;
  if (!isSelfCheckAnswer(rawManualAction)) return { ok: false };
  if (!isSelfCheckAnswer(rawSecurityIssue)) return { ok: false };

  // The answers must name the property they were given for, and it must be the
  // one being diagnosed.
  //
  // This does NOT verify that a human looked at that property — nothing can;
  // Google publishes no API for either page, which is the entire reason these
  // arrive from the visitor. What it does verify is that the CLIENT's own two
  // claims agree. That is worth a field: a report where site A's "no issues"
  // was attached to site B shipped in this very branch, produced by a client
  // that reset the brand list on a property change and forgot to reset these.
  // The browser now binds them structurally, and this is the backstop that
  // turns the next such regression into a 400 instead of a false all-clear.
  const checkedProperty = (rawChecks as { readonly property?: unknown })
    .property;
  if (typeof checkedProperty !== "string") return { ok: false };
  if (checkedProperty.trim() !== property.trim()) return { ok: false };

  const rawTerms = (body as { readonly brandTerms?: unknown }).brandTerms;
  if (rawTerms !== undefined && !Array.isArray(rawTerms)) return { ok: false };

  const terms: string[] = [];
  for (const term of rawTerms ?? []) {
    if (typeof term !== "string") return { ok: false };
    if (term.length > MAX_BRAND_TERM_LENGTH) return { ok: false };
    const trimmed = term.trim();
    // A blank term is contained in every query and would classify the whole
    // property as brand in one step.
    if (trimmed !== "") terms.push(trimmed);
  }
  if (terms.length > MAX_BRAND_TERMS) return { ok: false };

  const rawConfirmed = (body as { readonly brandTermsConfirmed?: unknown })
    .brandTermsConfirmed;
  if (rawConfirmed !== undefined && typeof rawConfirmed !== "boolean") {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      property: property.trim(),
      selfChecks: {
        manualAction: rawManualAction,
        securityIssue: rawSecurityIssue,
      },
      brandTerms: terms,
      // Confirmation has to be asserted, and it means nothing without terms.
      // A client that sends the flag with an empty list has confirmed an empty
      // list, which is not a brand list.
      brandTermsConfirmed: rawConfirmed === true && terms.length > 0,
    },
  };
}

/**
 * Run the diagnosis for one property the visitor has granted access to.
 *
 * The property must be one the grant covers — a caller cannot name someone
 * else's site and have us read it. That is checked twice: once off the
 * visitor's own cookie before the gate, which costs nothing, and again against
 * the token this request resolved, which is the list Google agrees with. The
 * resolution itself waits for the gate, because renewing a token is two calls
 * on a shared OAuth client and a per-project quota — a limiter it runs ahead
 * of is not a limiter.
 *
 * The optional query-dimension evidence follows a strict degradation rule: it
 * is read AFTER a complete report already exists, and anything that goes wrong
 * with it costs two checks, never the report. The two failure modes this rule
 * exists to prevent are opposite and both bad — turning an attachment's
 * failure into a 502 for a visitor whose decline analysis was fine, and
 * quietly computing a split out of whatever happened to come back.
 */
export async function handleTrafficDropRequest(
  request: Request,
  dependencies: TrafficDropHandlerDependencies,
): Promise<Response> {
  const body = await readPublicToolJson(request, REQUEST_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status =
      body.code === "unsupported_media_type"
        ? 415
        : body.code === "payload_too_large"
          ? 413
          : 400;
    return json(createPublicToolError(body.code), status);
  }

  const input = parseInput(body.value);
  if (!input.ok) return json(createPublicToolError("invalid_request"), 400);

  // Off the cookie, so this costs nothing and can safely run before the gate.
  const session = await dependencies.readSession();
  if (session.properties === null) {
    return json(createPublicToolError("gsc_unavailable"), 401);
  }
  if (!session.properties.includes(input.value.property)) {
    // Not 403: we do not confirm whether a property we were not granted exists.
    return json(createPublicToolError("gsc_unavailable"), 404);
  }

  // Two layers, on the key SHARED with the other connected tool: the
  // per-isolate in-flight slot stops a double-submit for free, and the durable
  // per-IP counter bounds volume across cold starts and serial re-runs. The
  // slot alone used to be the whole gate here, and it survives neither. This
  // endpoint now issues up to five upstream calls per run against a quota
  // counted per GCP PROJECT, so an unbounded caller does not merely slow
  // themselves down — they spend what every other visitor needs.
  const gate = await dependencies.openGate(
    dependencies.extractClientIp(request.headers),
  );
  if (!gate.ok) return gate.response;

  try {
    // Inside the gate, so a silent refresh cannot be driven faster than the
    // per-IP budget allows, and inside the try so the slot is released on
    // every path out of here.
    const grant = await dependencies.resolveGrant();
    if (grant.kind !== "grant") return refuseWithoutGrant(grant);
    if (!grant.properties.includes(input.value.property)) {
      // The resolution may have re-listed from Google since the cookie was
      // written. The newer list is the one we are allowed to read with.
      return json(createPublicToolError("gsc_unavailable"), 404);
    }

    const daily = await dependencies.readDailySeries({
      property: input.value.property,
      lookbackDays: TRAFFIC_DROP_LOOKBACK_DAYS,
      accessToken: grant.accessToken,
    });
    if (daily.length === 0) {
      return json(createPublicToolError("no_gsc_data"), 200);
    }

    const runAt = dependencies.now();
    const completedAt = runAt.toISOString();
    const base = {
      daily,
      completedAt,
      selfChecks: input.value.selfChecks,
      brandTerms: input.value.brandTerms,
      brandTermsConfirmed: input.value.brandTermsConfirmed,
    } as const;

    // Built once to locate the event, which is what the query windows are
    // anchored on. The build is pure and cheap; the alternative is duplicating
    // the detector at the transport boundary.
    const firstPass = buildTrafficDropReport(base);

    const queryEvidence =
      dependencies.readQueryEvidence === undefined
        ? null
        : await readQueryEvidenceSoftly(dependencies.readQueryEvidence, {
            property: input.value.property,
            changePoint: firstPass.result.changePoint,
            now: runAt,
            accessToken: grant.accessToken,
          });

    const envelope =
      queryEvidence === null
        ? firstPass
        : buildTrafficDropReport({ ...base, queryEvidence });

    dependencies.reportFirstRun?.("traffic-drop");
    return json({ data: { ...envelope, series: daily } }, 200);
  } catch {
    // Never substitute an estimate for data we could not read.
    return json(createPublicToolError("gsc_unavailable"), 502);
  } finally {
    gate.release();
  }
}

/**
 * Run the optional read without letting it fail the request.
 *
 * The reader is expected to resolve null on its own failures; this catch is
 * the belt to that suspenders, so a reader throwing for a reason nobody
 * anticipated still costs two checks rather than the whole report.
 */
async function readQueryEvidenceSoftly(
  read: (
    input: TrafficDropQueryReadRequest,
  ) => Promise<TrafficQueryEvidence | null>,
  input: TrafficDropQueryReadRequest,
): Promise<TrafficQueryEvidence | null> {
  try {
    return await read(input);
  } catch {
    return null;
  }
}

export const DEFAULT_TRAFFIC_DROP_DEPENDENCIES: Pick<
  TrafficDropHandlerDependencies,
  "readSession" | "resolveGrant" | "now" | "openGate" | "reportFirstRun"
> = {
  // The route builds its own readers so the access token stays in the request
  // scope; these defaults carry everything that does not depend on it.
  readSession: readTrafficDropSession,
  resolveGrant: resolveTrafficDropGrant,
  now: () => new Date(),
  openGate: (clientIp) => openGscGate(clientIp),
  reportFirstRun: reportFirstToolRun,
};
