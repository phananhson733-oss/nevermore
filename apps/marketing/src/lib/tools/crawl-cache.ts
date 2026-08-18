// @input  -- tool name, target host, payload; Supabase service-role client
// @output -- readCrawlCache() / writeCrawlCache() / cacheCompletedCrawl()
// @pos    -- shared crawl-result cache for the anonymous public crawl tools
// Once this file is updated, update the header comment and the folder _DIR.md
import {
  crawlRanToCompletion,
  type CrawlCompletionFacts,
} from "@sf/public-tools";
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
 * The ceiling above which a payload is returned uncached.
 *
 * It was 1.5 million and measured with `String#length`, which counts UTF-16
 * code units and is not bytes. Measured: a 600-page site serialised to 708 KB,
 * 1,000 pages to 1.18 MB and 1,400 pages to 1.65 MB — so every site past
 * roughly 1,250 pages fell over the line and was never cached at all. Those are
 * exactly the sites whose crawl takes the full four minutes, so the cache
 * stopped working for the visitors it was built for and did so silently.
 *
 * Eight megabytes covers what this crawler can produce at its own 2,000-page
 * budget with room over. A cache hit that transfers a few megabytes from the
 * database costs a second or two against a crawl that costs four minutes; the
 * trade only looks close if the number is read as a database limit rather than
 * as a round trip against a four-minute alternative. The bound stays because a
 * payload that somehow exceeds it is not something to write to a shared row.
 */
const MAX_CACHED_PAYLOAD_BYTES = 8_000_000;

const PAYLOAD_ENCODER = new TextEncoder();

/** Actual UTF-8 bytes. A CJK payload is about three per character. */
export function cachedPayloadBytes(payload: unknown): number {
  return PAYLOAD_ENCODER.encode(JSON.stringify(payload)).length;
}

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

/**
 * Restate a store's timestamp in the one spelling this cache's readers accept.
 *
 * PostgreSQL renders `timestamptz` with microsecond precision and a numeric UTC
 * offset — `2026-08-18T06:50:55.033741+00:00`. Every reader downstream checks a
 * captured-at against `new Date(value).toISOString()`, which is millisecond
 * precision and `Z`, and rejects anything else. Handing the store's own
 * spelling onward therefore made a successfully written row unrecognisable on
 * the way back: the table filled up, every lookup was refused, and each caller
 * still paid for a full crawl of a site that had just been crawled. Nothing
 * reported it, because both halves of this cache fail silently on purpose.
 *
 * Sub-millisecond precision is dropped, which is what the readers were already
 * comparing against — this value exists to tell a visitor when the crawl behind
 * their answer happened.
 */
function canonicalCapturedAt(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function readCrawlCache(
  tool: string,
  targetHost: string,
  dependencies: CrawlCacheDependencies = DEFAULT_CRAWL_CACHE_DEPENDENCIES,
  maxAgeSeconds: number = CRAWL_CACHE_MAX_AGE_SECONDS,
): Promise<CachedCrawl | null> {
  try {
    const cached = await dependencies.read(tool, targetHost, maxAgeSeconds);
    if (cached === null) return null;
    const capturedAt = canonicalCapturedAt(cached.capturedAt);
    // A row we cannot date is a row we cannot honestly label, and the answer it
    // holds is served as "captured at" that timestamp. Crawl instead.
    if (capturedAt === null) return null;
    return { payload: cached.payload, capturedAt };
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
    if (cachedPayloadBytes(payload) > MAX_CACHED_PAYLOAD_BYTES) return;
    await dependencies.write(tool, targetHost, payload);
  } catch {
    // A write failure must never turn a successful crawl into an error.
  }
}

/**
 * Keep a result only when the crawl behind it ended on its own terms.
 *
 * One cache entry answers every visitor asking about this site for the next
 * hour, without crawling anything. A run cut short by its caller leaving would
 * therefore hand all of them a report that silently under-reports the site,
 * and nothing in that report says a crawl was interrupted. Two independent
 * signals say a run was cut short, and the crawl's own stop reason is the one
 * that knows. The request's abort state cannot add anything: the engine holds
 * that same signal, so an abort it observed is already `aborted` here. The
 * only runs the abort state would additionally reject are ones the engine
 * finished — or stopped at one of this profile's fixed ceilings — before the
 * caller walked away, and discarding those buys nothing while costing the next
 * visitor a full re-crawl of someone else's site.
 *
 * Both crawl tools admit through here. They hold separate rows — the cache is
 * keyed on tool and target host together — so a truncated run of one is never
 * served as the other's answer, but each can still poison its own row, and the
 * rule that stops it must not exist in two drifting copies.
 */
export async function cacheCompletedCrawl<TPayload>(options: {
  readonly raw: CrawlCompletionFacts;
  readonly payload: TPayload;
  readonly normalizedUrl: string;
  readonly cachePayload: (
    normalizedUrl: string,
    payload: TPayload,
  ) => Promise<void>;
}): Promise<void> {
  if (!crawlRanToCompletion(options.raw)) return;
  await options.cachePayload(options.normalizedUrl, options.payload);
}

export function targetHostOf(normalizedUrl: string): string | null {
  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}
