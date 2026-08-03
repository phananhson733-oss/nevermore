// @input  -- client IP, normalized target URL, shared-quota dependencies
// @output -- openCrawlGate(): a released slot, or the Response to return instead
// @pos    -- the single admission point for both anonymous public crawl tools
// Once this file is updated, update the header comment and the folder _DIR.md
import { createPublicToolError } from "@sf/public-tools";
import {
  consumePublicToolQuota,
  crawlIpBucket,
  crawlTargetBucket,
  type SharedQuotaDependencies,
  DEFAULT_SHARED_QUOTA_DEPENDENCIES,
} from "./shared-rate-limit.ts";
import {
  acquirePublicCrawlSlot,
  type PublicToolSlot,
} from "./public-tool-request.ts";
import type { CachedCrawl } from "./crawl-cache.ts";

/**
 * One admission point for /api/tools/seo-audit and
 * /api/tools/internal-link-audit.
 *
 * Both run the same crawler with the same budget against the same target for
 * the same cost, so they must share the same budget. The shipped code gave
 * internal-link-audit a per-isolate 30-per-10-minute fuse and seo-audit
 * nothing at all, and even the fuse was defeated without rotating an IP: hit
 * the other endpoint.
 */

/** Per IP, across both tools. Generous for a human, useless for a loop. */
export const CRAWL_IP_MAX = 12;
export const CRAWL_IP_WINDOW_SECONDS = 60 * 60;

/**
 * Per target host, across every caller.
 *
 * This is the anti-relay control. One 50-byte POST buys up to 4,500 requests
 * and 128 MB pulled from a third party, and the bytes are paid for by that
 * third party, not by us. Without a per-target cap the tool can be pointed at
 * one victim indefinitely.
 *
 * It also removes duplicated work: a hundred people auditing the same site no
 * longer means a hundred crawls of it.
 */
export const CRAWL_TARGET_MAX = 4;
export const CRAWL_TARGET_WINDOW_SECONDS = 60 * 60;

export type CrawlGateResult =
  | { readonly ok: true; readonly kind: "crawl"; readonly release: () => void }
  /**
   * A recent crawl of this same target is available, so no new traffic is sent
   * to it. The payload carries its own capture timestamp, which both tools
   * already display, so the reader is never told a stale result is fresh.
   */
  | {
      readonly ok: true;
      readonly kind: "cached";
      readonly payload: unknown;
      readonly capturedAt: string;
      readonly release: () => void;
    }
  | { readonly ok: false; readonly response: Response };

export interface CrawlGateDependencies {
  readonly quota: SharedQuotaDependencies;
  readonly acquireSlot: (clientIp: string) => PublicToolSlot;
}

export const DEFAULT_CRAWL_GATE_DEPENDENCIES: CrawlGateDependencies = {
  quota: DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  acquireSlot: acquirePublicCrawlSlot,
};

function json(
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function targetHost(normalizedUrl: string): string | null {
  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function openCrawlGate(
  clientIp: string,
  normalizedUrl: string,
  dependencies: CrawlGateDependencies = DEFAULT_CRAWL_GATE_DEPENDENCIES,
  /**
   * Optional lookup for a recent crawl of the same target. Consulted after the
   * per-IP budget and before the per-target budget, because a hit sends no new
   * traffic to the target site.
   */
  cacheProbe?: (targetHost: string) => Promise<CachedCrawl | null>,
): Promise<CrawlGateResult> {
  const host = targetHost(normalizedUrl);
  if (!host) {
    return {
      ok: false,
      response: json(createPublicToolError("invalid_url"), 400),
    };
  }

  // Cheapest check first: one in-flight crawl per IP on this isolate. It does
  // not survive a cold start, which is exactly why the durable checks below
  // exist, but it costs nothing and stops a double-submit.
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
  const refuse = (response: Response): CrawlGateResult => {
    release();
    return { ok: false, response };
  };

  const perIp = await consumePublicToolQuota(
    crawlIpBucket(clientIp),
    CRAWL_IP_MAX,
    CRAWL_IP_WINDOW_SECONDS,
    dependencies.quota,
  );
  if (perIp.kind === "unavailable") {
    // Fail closed. A crawl endpoint with no working quota is an unbounded
    // anonymous crawler pointed at third parties; being briefly unavailable is
    // the better failure.
    //
    // Log the reason. The first time this fired in production it took a
    // deployment to find out why, because the reason was captured and then
    // dropped: a gate that refuses every request while saying nothing about
    // what it could not reach is not operable. The message is server-side
    // only; the caller still gets a bare error code.
    console.error("[crawl-gate] quota store unavailable:", perIp.reason);
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

  // Before spending target budget, see whether a recent crawl of this same
  // site already answers the question. A hit sends no traffic to the target,
  // so it must not consume the target's budget either.
  if (cacheProbe) {
    const cached = await cacheProbe(host);
    if (cached) {
      return {
        ok: true,
        kind: "cached",
        payload: cached.payload,
        capturedAt: cached.capturedAt,
        release,
      };
    }
  }

  const perTarget = await consumePublicToolQuota(
    crawlTargetBucket(host),
    CRAWL_TARGET_MAX,
    CRAWL_TARGET_WINDOW_SECONDS,
    dependencies.quota,
  );
  if (perTarget.kind === "unavailable") {
    console.error("[crawl-gate] quota store unavailable:", perTarget.reason);
    return refuse(
      json(createPublicToolError("quota_unavailable"), 503, {
        "Retry-After": "60",
      }),
    );
  }
  if (perTarget.kind === "limited") {
    return refuse(
      json(createPublicToolError("target_busy"), 429, {
        "Retry-After": String(perTarget.retryAfterSeconds),
      }),
    );
  }

  return { ok: true, kind: "crawl", release };
}
