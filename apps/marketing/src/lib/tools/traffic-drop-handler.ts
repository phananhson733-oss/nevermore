// @input  -- authenticated POST with one Search Console property, plus the visitor's grant
// @output -- traffic drop diagnosis envelope with its daily series, or a stable error code
// @pos    -- shared handler behind /api/tools/traffic-drop
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildTrafficDropReport,
  createPublicToolError,
  type TrafficDailyPoint,
} from "@sf/public-tools";
import { acquireGscSlot } from "./gsc-inflight.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import {
  readTrafficDropSession,
  type TrafficDropSession,
} from "./traffic-drop-session.ts";

const REQUEST_BODY_LIMIT_BYTES = 2_048;

/**
 * How much history to request.
 *
 * The detector needs twelve weeks minimum and uses everything it is given for
 * the site's own median; sixteen months also lets the year-over-year check
 * switch itself on for properties old enough to have last season.
 */
export const TRAFFIC_DROP_LOOKBACK_DAYS = 480;

export interface TrafficDropHandlerDependencies {
  readonly readSession: () => Promise<TrafficDropSession>;
  /** Fetches the [date]-dimension series. Injected so the route stays transport-free. */
  readonly readDailySeries: (input: {
    readonly property: string;
    readonly lookbackDays: number;
  }) => Promise<readonly TrafficDailyPoint[]>;
  readonly now: () => Date;
  /** Same shape the other public tools use, so the gate keys the same way. */
  readonly extractClientIp: (headers: Headers) => string;
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

function inputProperty(
  body: unknown,
): { readonly ok: true; readonly value: string } | { readonly ok: false } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !Object.hasOwn(body, "property")
  ) {
    return { ok: false };
  }
  const value = (body as { readonly property?: unknown }).property;
  if (typeof value !== "string" || value.trim() === "") return { ok: false };
  return { ok: true, value: value.trim() };
}

/**
 * Run the diagnosis for one property the visitor has granted access to.
 *
 * The property must be one the grant covers — a caller cannot name someone
 * else's site and have us read it.
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

  const input = inputProperty(body.value);
  if (!input.ok) return json(createPublicToolError("invalid_request"), 400);

  const session = await dependencies.readSession();
  if (session.properties === null) {
    return json(createPublicToolError("gsc_unavailable"), 401);
  }
  if (!session.properties.includes(input.value)) {
    // Not 403: we do not confirm whether a property we were not granted exists.
    return json(createPublicToolError("gsc_unavailable"), 404);
  }

  // One Search Console read at a time per client, on the key SHARED with the
  // other connected tool (see gsc-inflight.ts). A single request can hold a
  // Search Console connection for forty seconds across retries, and quota is
  // counted per GCP PROJECT rather than per visitor — so an unbounded caller
  // does not just slow themselves down, they spend the quota every other
  // visitor needs. This used to key on a traffic-drop-only string, which let
  // one caller hold two upstream connections by running both tools at once.
  const slot = acquireGscSlot(dependencies.extractClientIp(request.headers));
  if (!slot.acquired) {
    return json(createPublicToolError("scan_in_progress"), 409, {
      "Retry-After": "5",
    });
  }

  try {
    const daily = await dependencies.readDailySeries({
      property: input.value,
      lookbackDays: TRAFFIC_DROP_LOOKBACK_DAYS,
    });
    if (daily.length === 0) {
      return json(createPublicToolError("no_gsc_data"), 200);
    }

    const envelope = buildTrafficDropReport({
      daily,
      completedAt: dependencies.now().toISOString(),
    });
    return json({ data: { ...envelope, series: daily } }, 200);
  } catch {
    // Never substitute an estimate for data we could not read.
    return json(createPublicToolError("gsc_unavailable"), 502);
  } finally {
    slot.release();
  }
}

export const DEFAULT_TRAFFIC_DROP_DEPENDENCIES: Pick<
  TrafficDropHandlerDependencies,
  "readSession" | "now"
> = {
  // The route builds its own dependencies so the access token stays in the
  // request scope; this default exists for callers that only need the
  // page-level session view.
  readSession: readTrafficDropSession,
  now: () => new Date(),
};
