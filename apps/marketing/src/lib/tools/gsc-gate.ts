// @input  -- client IP and the shared-quota dependencies
// @output -- openGscGate(): a released slot, or the Response to return instead
// @pos    -- the single admission point for every Search Console-backed public tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createPublicToolError } from "@sf/public-tools";
import { acquireGscSlot } from "./gsc-inflight.ts";
import type { PublicToolSlot } from "./public-tool-request.ts";
import {
  consumePublicToolQuota,
  DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  type SharedQuotaDependencies,
} from "./shared-rate-limit.ts";

/**
 * Runs per IP per hour, across every Search Console tool.
 *
 * The in-flight slot bounds simultaneity, not volume: it is a per-isolate Set,
 * so a caller looping serially passes it every time. One quick-wins run costs
 * up to ten Search Analytics calls, and Search Console quota is counted per
 * GCP PROJECT rather than per visitor — a single anonymous caller in a loop
 * spends the budget every other visitor needs.
 *
 * Ten is generous for a person (enough to try several properties and re-run
 * with corrected brand terms) and useless for a loop.
 */
export const GSC_IP_MAX = 10;
export const GSC_IP_WINDOW_SECONDS = 60 * 60;

/** Shared across every Search Console tool, for the reason above. */
export function gscIpBucket(clientIp: string): string {
  return `public-gsc:ip:${clientIp}`;
}

export interface GscGateDependencies {
  readonly acquireSlot: (clientIp: string) => PublicToolSlot;
  readonly quota: SharedQuotaDependencies;
}

export const DEFAULT_GSC_GATE_DEPENDENCIES: GscGateDependencies = {
  acquireSlot: acquireGscSlot,
  quota: DEFAULT_SHARED_QUOTA_DEPENDENCIES,
};

export type GscGateResult =
  | { readonly ok: true; readonly release: () => void }
  | { readonly ok: false; readonly response: Response };

function json(body: unknown, status: number, headers: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...headers },
  });
}

/**
 * Admission for one Search Console read.
 *
 * Two layers, cheapest first: the per-isolate in-flight slot stops a
 * double-submit at zero cost, then the durable per-IP counter bounds volume
 * across cold starts. The slot alone was the only gate, and it survives
 * neither a serial loop nor a new isolate.
 *
 * Fails CLOSED when the quota store cannot answer. An endpoint that spends a
 * shared upstream budget with no working limiter is worse than one that is
 * briefly unavailable — the visitor who is turned away can come back, while
 * exhausted project quota takes the tool down for everyone.
 */
export async function openGscGate(
  clientIp: string,
  dependencies: GscGateDependencies = DEFAULT_GSC_GATE_DEPENDENCIES,
): Promise<GscGateResult> {
  const slot = dependencies.acquireSlot(clientIp);
  if (!slot.acquired) {
    return {
      ok: false,
      response: json(createPublicToolError("scan_in_progress"), 409, {
        "Retry-After": "5",
      }),
    };
  }

  const release = slot.release;
  const refuse = (response: Response): GscGateResult => {
    release();
    return { ok: false, response };
  };

  const perIp = await consumePublicToolQuota(
    gscIpBucket(clientIp),
    GSC_IP_MAX,
    GSC_IP_WINDOW_SECONDS,
    dependencies.quota,
  );

  if (perIp.kind === "unavailable") {
    // The reason is logged because this branch fails closed and looks
    // identical from outside to every other cause of a 503. The sibling
    // crawl gate carries the same line, and it is what turned a multi-day
    // "the tools are down" into one look at the deploy log: the store was
    // reachable, the URL was a Postgres pooler DSN, and the client's
    // `fetch failed` never reached anywhere a human would see it.
    console.error("[gsc-gate] quota store unavailable:", perIp.reason);
    return refuse(
      json(createPublicToolError("quota_unavailable"), 503, {
        "Retry-After": "60",
      }),
    );
  }
  if (perIp.kind === "limited") {
    return refuse(
      json(createPublicToolError("rate_limited"), 429, {
        "Retry-After": String(perIp.retryAfterSeconds),
      }),
    );
  }

  return { ok: true, release };
}
