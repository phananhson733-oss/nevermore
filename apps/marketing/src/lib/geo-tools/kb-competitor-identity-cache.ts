// @input  -- a competitor domain, and the brand identity one crawl of that domain produced
// @output -- a shared 24h identity read from public_tool_crawl_cache, or a miss
// @pos    -- server only: it reaches the shared crawl cache through the Supabase service role and must not be imported by a client component

/**
 * Competitor identity (brand name and aliases) is a fact about a public
 * domain, not about the account that asked. Two GEO users with the same
 * competitor should not each pay for a crawl of it, and the site should not
 * receive that traffic twice.
 *
 * So it goes in the existing shared crawl cache (`public_tool_crawl_cache`)
 * under its own namespace, with the same failure discipline as every other
 * user of that table: a cache that cannot be read means we crawl, and a write
 * that fails never turns a successful crawl into an error.
 */

import { z } from "zod";
import {
  DEFAULT_CRAWL_CACHE_DEPENDENCIES,
  readCrawlCache,
  writeCrawlCache,
  type CachedCrawl,
} from "../tools/crawl-cache.ts";

/** The `tool` column's value for these rows. It is what isolates them from the audit tools' rows. */
export const GEO_COMPETITOR_IDENTITY_CACHE_NAMESPACE = "geo-competitor-identity";

/**
 * 24 h, per the redesign's section 3.
 *
 * Well under the store's own seven-day sweep in
 * `read_public_tool_crawl_cache`, so a row is always expired by this TTL
 * before it is deleted for age.
 */
export const GEO_COMPETITOR_IDENTITY_TTL_SECONDS = 24 * 60 * 60;

export const GEO_COMPETITOR_IDENTITY_SCHEMA_VERSION = "geo-competitor-identity.v1";

export interface GeoCompetitorIdentity {
  readonly domain: string;
  readonly brandName: string | null;
  readonly aliases: readonly string[];
  readonly observedAt: string;
}

const payloadSchema = z
  .object({
    schemaVersion: z.literal(GEO_COMPETITOR_IDENTITY_SCHEMA_VERSION),
    domain: z.string().min(1).max(255),
    brandName: z.string().min(1).max(200).nullable(),
    aliases: z.array(z.string().min(1).max(200)).max(32),
    observedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  })
  .strict();

/**
 * The exact host, lowercased. `www.` is deliberately NOT stripped.
 *
 * The crawl cache is keyed on the exact host on purpose: apex and `www` may
 * serve different content, and one host's answer must never be returned as
 * the other's. Only the gate's anti-relay quota merges the two, and that is a
 * different key for a different reason.
 */
export function normalizeCompetitorDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed.length > 2_048) return null;
  try {
    const host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname
      .toLowerCase()
      .replace(/\.$/u, "");
    return host === "" || !host.includes(".") || host.length > 255 ? null : host;
  } catch {
    return null;
  }
}

export interface GeoCompetitorIdentityCacheDependencies {
  readonly readCache: (
    namespace: string,
    targetHost: string,
    maxAgeSeconds: number,
  ) => Promise<CachedCrawl | null>;
  readonly writeCache: (namespace: string, targetHost: string, payload: unknown) => Promise<void>;
}

export const DEFAULT_GEO_COMPETITOR_IDENTITY_CACHE_DEPENDENCIES: GeoCompetitorIdentityCacheDependencies = {
  readCache: (namespace, targetHost, maxAgeSeconds) =>
    readCrawlCache(namespace, targetHost, DEFAULT_CRAWL_CACHE_DEPENDENCIES, maxAgeSeconds),
  writeCache: (namespace, targetHost, payload) => writeCrawlCache(namespace, targetHost, payload),
};

export async function readCachedCompetitorIdentity(
  domain: string,
  dependencies: GeoCompetitorIdentityCacheDependencies = DEFAULT_GEO_COMPETITOR_IDENTITY_CACHE_DEPENDENCIES,
): Promise<GeoCompetitorIdentity | null> {
  const host = normalizeCompetitorDomain(domain);
  if (host === null) return null;
  try {
    const cached = await dependencies.readCache(
      GEO_COMPETITOR_IDENTITY_CACHE_NAMESPACE,
      host,
      GEO_COMPETITOR_IDENTITY_TTL_SECONDS,
    );
    if (cached === null) return null;
    const parsed = payloadSchema.safeParse(cached.payload);
    // The payload names the domain it describes, and that name has to match
    // the row we asked for. A shared table plus a namespace typo is otherwise
    // enough to hand one competitor's brand name back for another's domain.
    if (!parsed.success || parsed.data.domain !== host) return null;
    return {
      domain: host,
      brandName: parsed.data.brandName,
      aliases: parsed.data.aliases,
      observedAt: new Date(parsed.data.observedAt).toISOString(),
    };
  } catch {
    // Fail soft, exactly like the cache it sits on: a miss means we crawl.
    return null;
  }
}

export async function writeCachedCompetitorIdentity(
  identity: GeoCompetitorIdentity,
  dependencies: GeoCompetitorIdentityCacheDependencies = DEFAULT_GEO_COMPETITOR_IDENTITY_CACHE_DEPENDENCIES,
): Promise<void> {
  const host = normalizeCompetitorDomain(identity.domain);
  if (host === null) return;
  const observedAt = Date.parse(identity.observedAt);
  if (!Number.isFinite(observedAt)) return;
  const parsed = payloadSchema.safeParse({
    schemaVersion: GEO_COMPETITOR_IDENTITY_SCHEMA_VERSION,
    domain: host,
    brandName: identity.brandName,
    aliases: [...new Set(identity.aliases)].slice(0, 32),
    observedAt: new Date(observedAt).toISOString(),
  });
  if (!parsed.success) return;
  try {
    await dependencies.writeCache(GEO_COMPETITOR_IDENTITY_CACHE_NAMESPACE, host, parsed.data);
  } catch {
    // A failed cache write must never fail the run that produced the identity.
  }
}
