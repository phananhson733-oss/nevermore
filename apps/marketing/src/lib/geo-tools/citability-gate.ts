// @input  -- caller IP, the target host, and whether the caller is signed in
// @output -- an admission decision plus the in-flight release, or a ready 429/503 response
// @pos    -- this tool's own admission point; deliberately not the site-wide crawl gate

import { createPublicToolError } from "@sf/public-tools/contract";

import {
  acquirePublicToolSlot,
  type PublicToolSlot,
} from "../tools/public-tool-request.ts";
import {
  consumePublicToolQuota,
  type PublicToolQuotaOutcome,
} from "../tools/shared-rate-limit.ts";
import {
  CITABILITY_ANON_IP_MAX,
  CITABILITY_SIGNED_IN_IP_MAX,
  CITABILITY_TARGET_MAX,
  CITABILITY_WINDOW_SECONDS,
} from "./citability-contract.ts";

/**
 * Why this tool does not share `crawl-gate`.
 *
 * That gate admits whole-site crawls — up to thousands of requests against one
 * target — and its per-IP budget is spent by the audit tools as well. This
 * tool issues three bounded fetches for one URL, and its normal use is a loop:
 * fix the page, check it again. Sharing the crawl budget would both overstate
 * the risk of a re-check and let an unrelated audit exhaust it, so the numbers
 * printed on the page would be a lie in both directions.
 */
export function citabilityIpBucket(clientIp: string): string {
  return `geo-citability:ip:${clientIp}`;
}

export function citabilityTargetBucket(targetHost: string): string {
  return `geo-citability:target:${targetHost.toLowerCase()}`;
}

export interface CitabilityGateDependencies {
  readonly consumeQuota: (
    bucketKey: string,
    max: number,
    windowSeconds: number,
  ) => Promise<PublicToolQuotaOutcome>;
  readonly acquireSlot: (key: string) => PublicToolSlot;
}

export const DEFAULT_CITABILITY_GATE_DEPENDENCIES: CitabilityGateDependencies = {
  consumeQuota: (bucketKey, max, windowSeconds) =>
    consumePublicToolQuota(bucketKey, max, windowSeconds),
  acquireSlot: acquirePublicToolSlot,
};

export type CitabilityGateResult =
  | { readonly ok: true; readonly release: () => void }
  | { readonly ok: false; readonly response: Response };

function errorResponse(
  code: string,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(createPublicToolError(code), {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export interface CitabilityGateInput {
  readonly clientIp: string;
  readonly targetHost: string;
  readonly signedIn: boolean;
}

/**
 * Admission for one check.
 *
 * Fails closed when the quota store cannot answer: an unbounded anonymous
 * fetcher pointed at third-party sites is a worse outcome than a tool that is
 * briefly unavailable, and that is the same call `crawl-gate` makes.
 */
export async function openCitabilityGate(
  input: CitabilityGateInput,
  dependencies: CitabilityGateDependencies = DEFAULT_CITABILITY_GATE_DEPENDENCIES,
): Promise<CitabilityGateResult> {
  const slot = dependencies.acquireSlot(
    `geo-citability:inflight:${input.clientIp}`,
  );
  if (!slot.acquired) {
    return { ok: false, response: errorResponse("target_busy", 429) };
  }

  const ipMax = input.signedIn
    ? CITABILITY_SIGNED_IN_IP_MAX
    : CITABILITY_ANON_IP_MAX;
  const ip = await dependencies.consumeQuota(
    citabilityIpBucket(input.clientIp),
    ipMax,
    CITABILITY_WINDOW_SECONDS,
  );
  if (ip.kind === "unavailable") {
    slot.release();
    return { ok: false, response: errorResponse("gate_unavailable", 503) };
  }
  if (ip.kind === "limited") {
    slot.release();
    return {
      ok: false,
      response: errorResponse("rate_limited", 429, {
        "Retry-After": String(ip.retryAfterSeconds),
      }),
    };
  }

  const target = await dependencies.consumeQuota(
    citabilityTargetBucket(input.targetHost),
    CITABILITY_TARGET_MAX,
    CITABILITY_WINDOW_SECONDS,
  );
  if (target.kind === "unavailable") {
    slot.release();
    return { ok: false, response: errorResponse("gate_unavailable", 503) };
  }
  if (target.kind === "limited") {
    slot.release();
    return {
      ok: false,
      response: errorResponse("target_busy", 429, {
        "Retry-After": String(target.retryAfterSeconds),
      }),
    };
  }

  return { ok: true, release: () => slot.release() };
}
