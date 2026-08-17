// @input  -- authenticated POST with one Search Console property and optional brand terms
// @output -- the SEO Quick Wins evidence envelope, or a stable error code
// @pos    -- shared handler behind /api/tools/quick-wins
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  createPublicToolError,
  type QuickWinsEnvelope,
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
import { REQUEST_BUDGET_MS } from "./quick-wins-reader.ts";
import {
  readTrafficDropSession,
  resolveTrafficDropGrant,
  type TrafficDropSession,
} from "./traffic-drop-session.ts";

/**
 * The Google grant belongs to the visitor, not to one tool.
 *
 * `TrafficDropSession` is named after the first tool that needed it; both
 * connected tools read the same cookie and the same property list. Renaming
 * the module is a separate change from adding a second consumer.
 */
export type GscGrantSession = TrafficDropSession;

/** Room for a property plus a short brand list, nothing more. */
const REQUEST_BODY_LIMIT_BYTES = 4_096;

export const MAX_BRAND_TERMS = 10;
export const MAX_BRAND_TERM_LENGTH = 60;

export interface QuickWinsHandlerDependencies {
  /**
   * The page-level view: which properties, read from the visitor's own cookie.
   *
   * Costs no network call, which is what makes it safe to consult before
   * admission control.
   */
  readonly readSession: () => Promise<GscGrantSession>;
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
  /** Runs the report. Injected so the route stays transport-free. */
  readonly runReport: (input: {
    readonly property: string;
    readonly brandTerms: readonly string[];
    /** From this request's resolution; never captured at module scope. */
    readonly accessToken: string;
    /** Milliseconds left before the route must answer. See the call site. */
    readonly remainingMs: () => number;
  }) => Promise<QuickWinsEnvelope>;
  readonly now: () => Date;
  readonly extractClientIp: (headers: Headers) => string;
  /**
   * Admission to the shared Search Console budget.
   *
   * Injected so the route stays transport-free and tests can drive the
   * refusal branches without a quota store.
   */
  readonly openGate: (clientIp: string) => Promise<GscGateResult>;
  /**
   * Records that a run completed, so a referred visitor's first qualifying run
   * can pay its reward.
   *
   * Optional and never awaited: the reporter defers its own work past the
   * response, and a run that produced evidence must not fail because a credit
   * could not be recorded.
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
  readonly brandTerms: readonly string[];
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

  const rawTerms = (body as { readonly brandTerms?: unknown }).brandTerms;
  if (rawTerms !== undefined && !Array.isArray(rawTerms)) return { ok: false };

  const terms: string[] = [];
  for (const term of rawTerms ?? []) {
    if (typeof term !== "string") return { ok: false };
    if (term.length > MAX_BRAND_TERM_LENGTH) return { ok: false };
    const trimmed = term.trim();
    // A blank term is contained in every query and would empty the curve in
    // one step. Dropping it is safer than matching on it.
    if (trimmed !== "") terms.push(trimmed);
  }
  if (terms.length > MAX_BRAND_TERMS) return { ok: false };

  return { ok: true, value: { property: property.trim(), brandTerms: terms } };
}

/**
 * Run the evidence table for one property the visitor has granted access to.
 *
 * The grant is checked TWICE, and the split is deliberate. The cheap check
 * comes first, off the visitor's own cookie, so a caller who was never granted
 * a property is turned away without a single outbound call. Renewing the token
 * comes last, after admission control, because that step is itself two calls
 * on a shared OAuth client and a per-project quota — a limiter it runs ahead
 * of is not a limiter.
 */
export async function handleQuickWinsRequest(
  request: Request,
  dependencies: QuickWinsHandlerDependencies,
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

  // ONE clock for the whole route, started here rather than inside the report.
  // Everything the budget is meant to bound — the Search Console reads, the
  // draft crawls, the model calls — runs after `resolveGrant`, which can
  // itself refresh an OAuth token and re-list properties. A clock started at
  // the first read hands a full budget to a request that has already spent a
  // third of the platform's limit, and the report then overruns `maxDuration`
  // — which costs the finished envelope, not just the slow part of it.
  const deadlineAt = dependencies.now().getTime() + REQUEST_BUDGET_MS;
  const remainingMs = (): number => deadlineAt - dependencies.now().getTime();

  // Off the cookie, so this costs nothing and can safely run before the gate.
  const session = await dependencies.readSession();
  if (session.properties === null) {
    return json(createPublicToolError("gsc_unavailable"), 401);
  }
  if (!session.properties.includes(input.value.property)) {
    // Not 403: we do not confirm whether a property we were not granted exists.
    return json(createPublicToolError("gsc_unavailable"), 404);
  }

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

    const envelope = await dependencies.runReport({
      property: input.value.property,
      brandTerms: input.value.brandTerms,
      accessToken: grant.accessToken,
      remainingMs,
    });
    dependencies.reportFirstRun?.("quick-wins");
    return json({ data: envelope }, 200);
  } catch {
    // Never substitute an estimate for data we could not read.
    return json(createPublicToolError("gsc_unavailable"), 502);
  } finally {
    gate.release();
  }
}

export const DEFAULT_QUICK_WINS_DEPENDENCIES: Pick<
  QuickWinsHandlerDependencies,
  "readSession" | "resolveGrant" | "now" | "openGate" | "reportFirstRun"
> = {
  // The route builds its own reader so the access token stays in the request
  // scope; these defaults carry everything that does not depend on it.
  readSession: readTrafficDropSession,
  resolveGrant: resolveTrafficDropGrant,
  now: () => new Date(),
  openGate: (clientIp) => openGscGate(clientIp),
  reportFirstRun: reportFirstToolRun,
};
