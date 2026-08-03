// @input  -- authenticated POST with one Search Console property and optional brand terms
// @output -- the SEO Quick Wins evidence envelope, or a stable error code
// @pos    -- shared handler behind /api/tools/quick-wins
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createPublicToolError, type QuickWinsEnvelope } from "@sf/public-tools";
import { openGscGate, type GscGateResult } from "./gsc-gate.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import {
  readTrafficDropSession,
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
  readonly readSession: () => Promise<GscGrantSession>;
  /** Runs the report. Injected so the route stays transport-free. */
  readonly runReport: (input: {
    readonly property: string;
    readonly brandTerms: readonly string[];
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
 * The grant is checked before any Search Console call: a caller who was never
 * granted a property must not be able to make us spend project quota looking
 * it up.
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
    const envelope = await dependencies.runReport({
      property: input.value.property,
      brandTerms: input.value.brandTerms,
    });
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
  "readSession" | "now" | "openGate"
> = {
  // The route builds its own reader so the access token stays in the request
  // scope; these defaults exist for callers that only need the page-level view.
  readSession: readTrafficDropSession,
  now: () => new Date(),
  openGate: (clientIp) => openGscGate(clientIp),
};
