// @input  -- authenticated POST with one Search Console property and optional confirmed brand terms
// @output -- the Daily Search Briefing envelope plus remaining shared-run facts, or a stable error code
// @pos    -- shared handler behind /api/tools/daily-search-briefing

import {
  createPublicToolError,
  type DailyBriefingEnvelope,
} from "@sf/public-tools";
import type { GrantResolution } from "../auth/grant-cookie.ts";
import {
  GSC_IP_MAX,
  openGscGate,
  refuseWithoutGrant,
  type GscGateResult,
} from "./gsc-gate.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import { REQUEST_BUDGET_MS } from "./daily-briefing-reader.ts";
import {
  readTrafficDropSession,
  resolveTrafficDropGrant,
  type TrafficDropSession,
} from "./traffic-drop-session.ts";

export type DailyBriefingGrantSession = TrafficDropSession;

/** Room for one property plus a short brand list. */
const REQUEST_BODY_LIMIT_BYTES = 4_096;

export const MAX_BRAND_TERMS = 10;
export const MAX_BRAND_TERM_LENGTH = 60;

export interface DailyBriefingHandlerDependencies {
  readonly readSession: () => Promise<DailyBriefingGrantSession>;
  readonly resolveGrant: () => Promise<GrantResolution>;
  readonly runReport: (input: {
    readonly property: string;
    readonly brandTerms: readonly string[];
    readonly brandTermsConfirmed: boolean;
    readonly accessToken: string;
    readonly remainingMs: () => number;
  }) => Promise<DailyBriefingEnvelope>;
  readonly now: () => Date;
  readonly extractClientIp: (headers: Headers) => string;
  readonly openGate: (clientIp: string) => Promise<GscGateResult>;
}

function json(
  body: unknown,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extraHeaders },
  });
}

interface ParsedInput {
  readonly property: string;
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

  const rawTerms = (body as { readonly brandTerms?: unknown }).brandTerms;
  if (rawTerms !== undefined && !Array.isArray(rawTerms)) return { ok: false };

  const terms: string[] = [];
  for (const term of rawTerms ?? []) {
    if (typeof term !== "string") return { ok: false };
    if (term.length > MAX_BRAND_TERM_LENGTH) return { ok: false };
    const trimmed = term.trim();
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
      brandTerms: terms,
      brandTermsConfirmed: rawConfirmed === true,
    },
  };
}

/**
 * Run the briefing for one property the visitor has granted access to.
 *
 * The cheap property check runs off the browser's own cookie before admission
 * control. Grant resolution stays inside the gate because it can spend two
 * outbound Google calls on a shared OAuth client and quota.
 */
export async function handleDailyBriefingRequest(
  request: Request,
  dependencies: DailyBriefingHandlerDependencies,
): Promise<Response> {
  // One clock covers parsing, admission, grant renewal and every GSC read.
  const deadlineAt = dependencies.now().getTime() + REQUEST_BUDGET_MS;
  const remainingMs = (): number =>
    Math.max(0, deadlineAt - dependencies.now().getTime());

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
    return json(createPublicToolError("gsc_unavailable"), 404);
  }

  const gate = await dependencies.openGate(
    dependencies.extractClientIp(request.headers),
  );
  if (!gate.ok) return gate.response;

  try {
    const grant = await dependencies.resolveGrant();
    if (grant.kind !== "grant") return refuseWithoutGrant(grant);
    if (!grant.properties.includes(input.value.property)) {
      return json(createPublicToolError("gsc_unavailable"), 404);
    }

    const envelope = await dependencies.runReport({
      property: input.value.property,
      brandTerms: input.value.brandTerms,
      brandTermsConfirmed: input.value.brandTermsConfirmed,
      accessToken: grant.accessToken,
      remainingMs,
    });
    return json(
      {
        data: envelope,
        meta: {
          rateLimit: {
            limit: gate.limit ?? GSC_IP_MAX,
            remaining: gate.remaining ?? null,
          },
        },
      },
      200,
    );
  } catch {
    return json(createPublicToolError("gsc_unavailable"), 502);
  } finally {
    gate.release();
  }
}

export const DEFAULT_DAILY_BRIEFING_DEPENDENCIES: Pick<
  DailyBriefingHandlerDependencies,
  "readSession" | "resolveGrant" | "now" | "openGate"
> = {
  readSession: readTrafficDropSession,
  resolveGrant: resolveTrafficDropGrant,
  now: () => new Date(),
  openGate: (clientIp) => openGscGate(clientIp),
};
