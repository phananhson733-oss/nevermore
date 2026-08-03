// @input  -- authenticated POST with one Search Console property, plus the visitor's grant
// @output -- traffic drop diagnosis envelope with its daily series, or a stable error code
// @pos    -- shared handler behind /api/tools/traffic-drop
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildTrafficDropReport,
  createPublicToolError,
  isManualActionStatus,
  type ManualActionStatus,
  type TrafficChangePoint,
  type TrafficDailyPoint,
  type TrafficQueryEvidence,
} from "@sf/public-tools";
import { openGscGate, type GscGateResult } from "./gsc-gate.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import {
  readTrafficDropSession,
  type TrafficDropSession,
} from "./traffic-drop-session.ts";

/** Room for a property, a manual-action answer and a short brand list. */
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
  readonly seriesEndDate: string;
}

export interface TrafficDropHandlerDependencies {
  readonly readSession: () => Promise<TrafficDropSession>;
  /** Fetches the [date]-dimension series. Injected so the route stays transport-free. */
  readonly readDailySeries: (input: {
    readonly property: string;
    readonly lookbackDays: number;
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
  readonly manualAction: ManualActionStatus;
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

  // Absent means the visitor has not been asked yet, which is a real answer
  // and the default. An unrecognised value is rejected rather than coerced:
  // silently mapping a typo onto "no manual action" would hand out the one
  // reassurance this tool has no standing to give.
  const rawStatus = (body as { readonly manualAction?: unknown }).manualAction;
  if (rawStatus !== undefined && !isManualActionStatus(rawStatus)) {
    return { ok: false };
  }
  const manualAction: ManualActionStatus = isManualActionStatus(rawStatus)
    ? rawStatus
    : "not_checked";

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
      manualAction,
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
 * else's site and have us read it.
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
    const daily = await dependencies.readDailySeries({
      property: input.value.property,
      lookbackDays: TRAFFIC_DROP_LOOKBACK_DAYS,
    });
    if (daily.length === 0) {
      return json(createPublicToolError("no_gsc_data"), 200);
    }

    const completedAt = dependencies.now().toISOString();
    const base = {
      daily,
      completedAt,
      manualAction: input.value.manualAction,
      brandTerms: input.value.brandTerms,
      brandTermsConfirmed: input.value.brandTermsConfirmed,
    } as const;

    // Built once to locate the event, which is what the query windows are
    // anchored on. The build is pure and cheap; the alternative is duplicating
    // the detector at the transport boundary.
    const firstPass = buildTrafficDropReport(base);
    const seriesEndDate = firstPass.result.dataEndDate;

    const queryEvidence =
      dependencies.readQueryEvidence === undefined || seriesEndDate === null
        ? null
        : await readQueryEvidenceSoftly(dependencies.readQueryEvidence, {
            property: input.value.property,
            changePoint: firstPass.result.changePoint,
            seriesEndDate,
          });

    const envelope =
      queryEvidence === null
        ? firstPass
        : buildTrafficDropReport({ ...base, queryEvidence });

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
  "readSession" | "now" | "openGate"
> = {
  // The route builds its own dependencies so the access token stays in the
  // request scope; this default exists for callers that only need the
  // page-level session view.
  readSession: readTrafficDropSession,
  now: () => new Date(),
  openGate: (clientIp) => openGscGate(clientIp),
};
