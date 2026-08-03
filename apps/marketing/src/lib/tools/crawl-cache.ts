// @input  -- tool name, target host, payload; Supabase service-role client
// @output -- readCrawlCache() / writeCrawlCache()
// @pos    -- shared crawl-result cache for the anonymous public crawl tools
// Once this file is updated, update the header comment and the folder _DIR.md
import { createAdminSupabaseClient } from "../supabase/admin.ts";

/**
 * Cache a crawl by what was crawled, not by who asked.
 *
 * Nothing cached crawl results before this: responses were `no-store` and no
 * lookup existed, so a hundred people auditing the same site meant a hundred
 * full crawls — a hundred times the cost to us and a hundred times the traffic
 * at a site that never asked to be audited.
 *
 * It is also what makes the per-target rate limit humane. Without a cache the
 * fifth caller in an hour gets an error; with one they get the recent result
 * and the timestamp it was captured at.
 *
 * Unlike the quota, this fails SOFT. A cache that cannot be read means we crawl,
 * which is exactly today's behaviour; a quota that cannot be read means an
 * unbounded crawler, which is not.
 */

export const CRAWL_CACHE_MAX_AGE_SECONDS = 60 * 60;

export interface CachedCrawl {
  readonly payload: unknown;
  readonly capturedAt: string;
}

export interface CrawlCacheDependencies {
  readonly read: (
    tool: string,
    targetHost: string,
    maxAgeSeconds: number,
  ) => Promise<CachedCrawl | null>;
  readonly write: (
    tool: string,
    targetHost: string,
    payload: unknown,
  ) => Promise<void>;
}

/**
 * A large site's payload can run to megabytes. Past this, the round trip costs
 * more than the crawl saves, so the result is returned uncached.
 */
const MAX_CACHED_PAYLOAD_BYTES = 1_500_000;

async function readViaSupabase(
  tool: string,
  targetHost: string,
  maxAgeSeconds: number,
): Promise<CachedCrawl | null> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("read_public_tool_crawl_cache", {
    p_tool: tool,
    p_target_host: targetHost,
    p_max_age_seconds: maxAgeSeconds,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  const typed = row as { payload?: unknown; captured_at?: unknown };
  if (typed.payload === undefined || typeof typed.captured_at !== "string") {
    return null;
  }
  return { payload: typed.payload, capturedAt: typed.captured_at };
}

async function writeViaSupabase(
  tool: string,
  targetHost: string,
  payload: unknown,
): Promise<void> {
  const client = createAdminSupabaseClient();
  const { error } = await client.rpc("write_public_tool_crawl_cache", {
    p_tool: tool,
    p_target_host: targetHost,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
}

export const DEFAULT_CRAWL_CACHE_DEPENDENCIES: CrawlCacheDependencies = {
  read: readViaSupabase,
  write: writeViaSupabase,
};

export async function readCrawlCache(
  tool: string,
  targetHost: string,
  dependencies: CrawlCacheDependencies = DEFAULT_CRAWL_CACHE_DEPENDENCIES,
  maxAgeSeconds: number = CRAWL_CACHE_MAX_AGE_SECONDS,
): Promise<CachedCrawl | null> {
  try {
    return await dependencies.read(tool, targetHost, maxAgeSeconds);
  } catch {
    // Fail soft: a missing cache means we crawl.
    return null;
  }
}

export async function writeCrawlCache(
  tool: string,
  targetHost: string,
  payload: unknown,
  dependencies: CrawlCacheDependencies = DEFAULT_CRAWL_CACHE_DEPENDENCIES,
): Promise<void> {
  try {
    // Only bound payloads are stored; an oversized one is simply not cached.
    if (JSON.stringify(payload).length > MAX_CACHED_PAYLOAD_BYTES) return;
    await dependencies.write(tool, targetHost, payload);
  } catch {
    // A write failure must never turn a successful crawl into an error.
  }
}

export function targetHostOf(normalizedUrl: string): string | null {
  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}
