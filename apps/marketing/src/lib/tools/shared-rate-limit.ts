// @input  -- bucket key, max hits, window seconds; Supabase service-role client
// @output -- consumePublicToolQuota(): allowed | limited | unavailable
// @pos    -- durable cross-isolate quota for the anonymous public crawl tools
// Once this file is updated, update the header comment and the folder _DIR.md
import { createAdminSupabaseClient } from "../supabase/admin.ts";

/**
 * A quota that survives a cold start.
 *
 * `rate-limit.ts` is an in-memory fixed window and documents its own ceiling:
 * "on Vercel each isolate keeps its own store, so the real limit is
 * ~N_isolates x max". That is a reasonable guard against a casual double-click.
 * It is not a guard against someone replaying a 240-second crawl in a loop,
 * because K concurrent requests scale out to K instances, each with an empty
 * store, and the gate contributes nothing above one instance.
 *
 * The counter therefore lives in Postgres, incremented inside
 * INSERT ... ON CONFLICT DO UPDATE so two callers cannot both read the same
 * pre-increment value.
 */

export type PublicToolQuotaOutcome =
  | { readonly kind: "allowed"; readonly hits: number }
  | { readonly kind: "limited"; readonly retryAfterSeconds: number }
  /**
   * The store could not answer — unconfigured, unreachable, or the migration
   * has not been applied. Callers on the expensive crawl paths must fail
   * closed: an unbounded anonymous crawler is a worse outcome than a tool that
   * is briefly unavailable.
   */
  | { readonly kind: "unavailable"; readonly reason: string };

interface QuotaRow {
  readonly allowed: boolean;
  readonly hits: number;
  readonly reset_at: string;
}

export interface SharedQuotaDependencies {
  readonly callQuota: (
    bucketKey: string,
    max: number,
    windowSeconds: number,
  ) => Promise<QuotaRow>;
}

const RPC_NAME = "consume_public_tool_quota";

async function callQuotaViaSupabase(
  bucketKey: string,
  max: number,
  windowSeconds: number,
): Promise<QuotaRow> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc(RPC_NAME, {
    p_bucket_key: bucketKey,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error(`${RPC_NAME} returned no row`);
  }
  return row as QuotaRow;
}

export const DEFAULT_SHARED_QUOTA_DEPENDENCIES: SharedQuotaDependencies = {
  callQuota: callQuotaViaSupabase,
};

function retryAfterSeconds(resetAt: string, nowMs: number): number {
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(reset)) return 60;
  return Math.max(1, Math.ceil((reset - nowMs) / 1_000));
}

export async function consumePublicToolQuota(
  bucketKey: string,
  max: number,
  windowSeconds: number,
  dependencies: SharedQuotaDependencies = DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  now: () => number = Date.now,
): Promise<PublicToolQuotaOutcome> {
  try {
    const row = await dependencies.callQuota(bucketKey, max, windowSeconds);
    if (row.allowed) return { kind: "allowed", hits: row.hits };
    return {
      kind: "limited",
      retryAfterSeconds: retryAfterSeconds(row.reset_at, now()),
    };
  } catch (error) {
    // The message is kept internal; callers surface a generic code. A quota
    // failure must never describe our infrastructure to an anonymous caller.
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : "quota store failed",
    };
  }
}

/**
 * The two anonymous crawl endpoints share one budget deliberately.
 *
 * Keying per endpoint let a caller exhaust internal-link-audit's fuse and then
 * keep going on seo-audit, which runs the identical crawl against the identical
 * target for the identical cost.
 */
export function crawlIpBucket(clientIp: string): string {
  return `public-crawl:ip:${clientIp}`;
}

/**
 * Per-target budget, shared across all callers.
 *
 * Without this the tool is a relay: one 50-byte POST buys up to 4,500 requests
 * at a third party, and nothing stops the same victim being submitted again the
 * moment the run finishes. It also removes the duplicate-work problem — a
 * hundred people auditing the same site no longer means a hundred crawls.
 */
export function crawlTargetBucket(targetHost: string): string {
  return `public-crawl:target:${targetHost.toLowerCase()}`;
}
