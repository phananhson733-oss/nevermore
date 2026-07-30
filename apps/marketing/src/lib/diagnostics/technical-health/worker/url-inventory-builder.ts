// @input  -- UrlInventorySources: crawl PageRecord[] + sitemap/gsc-indexed/
//            gsc-not-indexed/ga4/planned/content-queue/legacy URL string sets
// @output -- buildUrlInventory(sources): UrlInventoryRow[] — one row per distinct
//            normalized_url with the found_in_* flags + http/index facts + meta_robots (AC1).
//            Pure: same sources ⇒ same rows. Exports UrlInventoryRow for the writer.
// @pos    -- D1 v2.1 Phase 4 U6 — the AC1 multi-source reconciliation merge. Zero
//            AI, zero DB. The crawl PageRecord is the authoritative http/index
//            fact carrier; source URL sets only flip found_in_* flags. Dedup by
//            normalizeUrlForDedup (shared with pagesByUrl, no drift).
//            SV1.5: meta_robots='noindex'|null written from PageRecord.robotsNoindex.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { normalizeUrlForDedup } from "./_url-helpers";
import type { PageRecord } from "./types";

/**
 * Insert row shape for `technical_url_inventory`. snake_case to match the
 * migration; handed straight to `supabase.from("technical_url_inventory").insert`.
 * Only the columns U6 populates are present — the rest default in the DDL.
 */
export interface UrlInventoryRow {
  readonly url: string;
  readonly normalized_url: string;
  readonly found_in_crawl: boolean;
  readonly found_in_sitemap: boolean;
  readonly found_in_gsc_indexed: boolean;
  readonly found_in_gsc_not_indexed: boolean;
  readonly found_in_ga4_landing_pages: boolean;
  readonly found_in_planned_urls: boolean;
  readonly found_in_content_queue: boolean;
  readonly found_in_legacy_urls: boolean;
  readonly http_status: number | null;
  readonly final_url: string | null;
  readonly canonical_url: string | null;
  readonly outlinks_count: number | null;
  readonly redirect_chain: readonly string[] | null;
  readonly indexability: string | null;
  /**
   * Tri-state noindex provenance (from PageRecord.robotsNoindex = meta + X-Robots):
   * 'noindex' = scanned, has noindex; 'index' = crawled + fully scanned, NO
   * noindex (indexable-eligible); null = unknown (not crawled / truncated /
   * error / non-crawl source). SV loader counts ONLY 'index' as indexable.
   */
  readonly meta_robots: string | null;
}

/** The eight URL source sets merged into the inventory (AC1). */
export interface UrlInventorySources {
  readonly crawlPages?: readonly PageRecord[];
  readonly sitemapUrls?: readonly string[];
  readonly gscIndexedUrls?: readonly string[];
  readonly gscNotIndexedUrls?: readonly string[];
  readonly ga4LandingUrls?: readonly string[];
  readonly plannedUrls?: readonly string[];
  readonly contentQueueUrls?: readonly string[];
  readonly legacyUrls?: readonly string[];
}

/** Mutable accumulator while merging; frozen into UrlInventoryRow at the end. */
interface Acc {
  url: string;
  normalized: string;
  foundInCrawl: boolean;
  foundInSitemap: boolean;
  foundInGscIndexed: boolean;
  foundInGscNotIndexed: boolean;
  foundInGa4: boolean;
  foundInPlanned: boolean;
  foundInContentQueue: boolean;
  foundInLegacy: boolean;
  httpStatus: number | null;
  finalUrl: string | null;
  canonical: string | null;
  outlinksCount: number | null;
  redirectChain: readonly string[] | null;
  /**
   * noindex 三态溯源：true=已爬取+完整扫描，有 meta/X-Robots noindex；
   * false=已爬取+完整扫描，无 noindex（可索引）；undefined=未爬取/未完整扫描
   * （截断/读错误/解析错误/非 crawl 源）→ unknown。绝不让 undefined 折叠成 false。
   */
  robotsNoindex: boolean | undefined;
}

function emptyAcc(url: string, normalized: string): Acc {
  return {
    url,
    normalized,
    foundInCrawl: false,
    foundInSitemap: false,
    foundInGscIndexed: false,
    foundInGscNotIndexed: false,
    foundInGa4: false,
    foundInPlanned: false,
    foundInContentQueue: false,
    foundInLegacy: false,
    httpStatus: null,
    finalUrl: null,
    canonical: null,
    outlinksCount: null,
    redirectChain: null,
    // 默认 undefined（unknown）：未在 crawl 出现的 URL（sitemap/gsc 等纯源）从未被
    // 扫描 HTML，不能当作"可索引"。只有 crawl loop 才会据 PageRecord 置 true/false。
    robotsNoindex: undefined,
  };
}

/** Get-or-create the accumulator for a URL keyed by its normalized form. */
function upsert(map: Map<string, Acc>, url: string): Acc {
  const normalized = normalizeUrlForDedup(url);
  const existing = map.get(normalized);
  if (existing) return existing;
  // First-seen raw URL wins as the display `url` (deterministic insertion order).
  const acc = emptyAcc(url, normalized);
  map.set(normalized, acc);
  return acc;
}

/**
 * Derive the indexability fact for a row. The crawl PageRecord status (when
 * present) is authoritative: 404 ⇒ not_found, 5xx ⇒ server_error, 3xx ⇒
 * redirected. Otherwise a URL confirmed in GSC-indexed is `indexable`; a URL
 * only in GSC-not-indexed stays `unknown` (the not-indexed REASON lives on the
 * coverage snapshot, not fabricated here). Everything else ⇒ unknown.
 */
function deriveIndexability(acc: Acc): string | null {
  if (acc.httpStatus !== null) {
    if (acc.httpStatus === 404) return "not_found";
    if (acc.httpStatus >= 500 && acc.httpStatus < 600) return "server_error";
    if (acc.httpStatus >= 300 && acc.httpStatus < 400) return "redirected";
  }
  if (acc.foundInGscIndexed) return "indexable";
  return acc.foundInCrawl || acc.foundInGscNotIndexed ? "unknown" : null;
}

function markUrls(
  map: Map<string, Acc>,
  urls: readonly string[] | undefined,
  flag: (acc: Acc) => void,
): void {
  for (const url of urls ?? []) flag(upsert(map, url));
}

/**
 * Merge all eight URL source sets into one `technical_url_inventory` row per
 * distinct normalized URL (AC1). The crawl PageRecord carries the http/index
 * facts; the string sets only flip the corresponding `found_in_*` flag.
 *
 * Determinism: insertion order follows first-seen URL across the fixed source
 * iteration order (crawl → sitemap → gsc-indexed → gsc-not-indexed → ga4 →
 * planned → content-queue → legacy). Pure — no DB, no AI, no fabricated URLs.
 */
export function buildUrlInventory(
  sources: UrlInventorySources,
): UrlInventoryRow[] {
  const map = new Map<string, Acc>();

  for (const p of sources.crawlPages ?? []) {
    const acc = upsert(map, p.url);
    acc.foundInCrawl = true;
    acc.httpStatus = p.statusCode > 0 ? p.statusCode : acc.httpStatus;
    acc.finalUrl = p.finalUrl ?? acc.finalUrl;
    acc.canonical = p.canonical ?? acc.canonical;
    // Defensive: tolerate a malformed PageRecord missing internalOutlinks.
    acc.outlinksCount = p.internalOutlinks?.length ?? 0;
    if (p.finalUrl && p.finalUrl !== p.url) {
      acc.redirectChain = [p.url, p.finalUrl];
    }
    // 保留三态：true=有 noindex，false=完整扫描无 noindex，undefined=未/未完整扫描。
    // 绝不 `?? false`——把"未扫描"折叠成"可索引"会让旧 run / 截断页捏造 SV1.5 点亮。
    acc.robotsNoindex = p.robotsNoindex;
  }

  markUrls(map, sources.sitemapUrls, (a) => {
    a.foundInSitemap = true;
  });
  markUrls(map, sources.gscIndexedUrls, (a) => {
    a.foundInGscIndexed = true;
  });
  markUrls(map, sources.gscNotIndexedUrls, (a) => {
    a.foundInGscNotIndexed = true;
  });
  markUrls(map, sources.ga4LandingUrls, (a) => {
    a.foundInGa4 = true;
  });
  markUrls(map, sources.plannedUrls, (a) => {
    a.foundInPlanned = true;
  });
  markUrls(map, sources.contentQueueUrls, (a) => {
    a.foundInContentQueue = true;
  });
  markUrls(map, sources.legacyUrls, (a) => {
    a.foundInLegacy = true;
  });

  return [...map.values()].map((acc) => ({
    url: acc.url,
    normalized_url: acc.normalized,
    found_in_crawl: acc.foundInCrawl,
    found_in_sitemap: acc.foundInSitemap,
    found_in_gsc_indexed: acc.foundInGscIndexed,
    found_in_gsc_not_indexed: acc.foundInGscNotIndexed,
    found_in_ga4_landing_pages: acc.foundInGa4,
    found_in_planned_urls: acc.foundInPlanned,
    found_in_content_queue: acc.foundInContentQueue,
    found_in_legacy_urls: acc.foundInLegacy,
    http_status: acc.httpStatus,
    final_url: acc.finalUrl,
    canonical_url: acc.canonical,
    outlinks_count: acc.outlinksCount,
    redirect_chain: acc.redirectChain,
    indexability: deriveIndexability(acc),
    // 三态：'noindex'=有 noindex；'index'=完整扫描无 noindex（可索引）；
    // null=unknown（未爬/截断/错误/旧 run）。SV loader 仅 'index' 计入 isIndexable。
    meta_robots:
      acc.robotsNoindex === true
        ? "noindex"
        : acc.robotsNoindex === false
          ? "index"
          : null,
  }));
}
