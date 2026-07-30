// @input  -- injectable GscConnector / UrlInspectionConnector (search-visibility-v2)
//            wrapped via a thin GscCoverageDeps port; GSC OAuth access token (DI, absent ⇒ na)
// @output -- buildGscIndexCoverage(deps): Promise<GscIndexCoverage> — a frozen per-run
//            snapshot. status 'ok' carries intendedIndexable / gscIndexed /
//            notIndexedReasons / sample (URL Inspection capped). status 'na'
//            carries a machine reason when GSC is unavailable (no token / quota /
//            API error) — NEVER a fabricated 0% (AC3).
// @pos    -- D1 v2.1 Phase 4 U6 — the deterministic, fixture-testable GSC data
//            source. Wraps the existing connectors (no GSC plumbing rebuilt);
//            degrade-to-na is the whole point. Zero AI, numbers traceable to GSC.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { UrlInspectionSnapshot } from "@/lib/analysis/search-visibility-v2/types/analyze-and-config";

import { inspectionIndexed } from "./gsc-coverage-helpers";

/** Reason codes for a degraded (na) coverage snapshot. Machine-readable. */
export type GscNaReason =
  | "no_token"
  | "not_connected"
  | "quota_exhausted"
  | "api_error";

/**
 * A single page's GSC coverage facts, derived from Search Analytics (by-page)
 * + an optional URL Inspection snapshot. Used to populate technical_url_inventory
 * GSC flags (AC1) and to drive the index-coverage rule (AC2/AC10).
 */
export interface GscCoveragePage {
  /** Page URL as reported by GSC (raw; normalization happens in the merge). */
  readonly url: string;
  /** GSC impressions over the window. AC10: >0 with 0 clicks ⇒ indexed, not a crawl error. */
  readonly impressions: number;
  /** GSC clicks over the window. */
  readonly clicks: number;
  /** True when GSC/URL-Inspection confirm the URL is indexed. */
  readonly indexed: boolean;
  /** URL Inspection coverageState verbatim (e.g. "Submitted and indexed"), if sampled. */
  readonly coverageState?: string;
}

/**
 * The frozen per-run GSC coverage snapshot. A discriminated union so every
 * consumer must branch on `status` — there is no "0% coverage" representation
 * when GSC is unavailable (AC3): that case is `na`, never `ok` with 0.
 */
export type GscIndexCoverage =
  | {
      readonly status: "ok";
      /** Count of URLs the site intends to be indexable (denominator). */
      readonly intendedIndexable: number;
      /** Count of those confirmed indexed by GSC (numerator). */
      readonly gscIndexed: number;
      /** Aggregated GSC "not indexed" reasons → count. */
      readonly notIndexedReasons: Readonly<Record<string, number>>;
      /** Per-page coverage facts (also feeds the inventory GSC flags). */
      readonly sample: readonly GscCoveragePage[];
    }
  | {
      readonly status: "na";
      readonly reason: GscNaReason;
    };

/**
 * Injected dependencies for the source. Tests pass fixtures; production passes a
 * thin adapter over GscConnector + UrlInspectionConnector. Kept as a port so the
 * source stays fixture-testable with zero real credentials (live OAuth is a
 * deploy-time concern).
 */
export interface GscCoverageDeps {
  /**
   * Whether a usable GSC OAuth token + property is available for this run.
   * False ⇒ degrade to na with `not_connected` (AC3). The worker resolves this;
   * U6 never reads secrets directly.
   */
  readonly connected: boolean;
  /**
   * Fetch by-page Search Analytics rows. Resolves the indexed/intended facts.
   * Rejects ⇒ the source degrades to na with `api_error` (never fabricates 0%).
   */
  readonly fetchByPage?: () => Promise<readonly GscCoveragePage[]>;
  /**
   * Count of URLs the site intends to be indexable (from the crawl/sitemap
   * inventory). Denominator for the coverage ratio. Resolved by the caller so
   * the source stays pure over its inputs.
   */
  readonly intendedIndexable: number;
  /**
   * URL Inspection snapshots already fetched for the sampled URLs (quota-capped
   * upstream). Optional — absent when quota is exhausted or inspection skipped.
   */
  readonly inspectionSample?: readonly UrlInspectionSnapshot[];
}

/**
 * Default URL Inspection sample cap per run. URL Inspection is quota-limited
 * (HTTP-call based), so we cap the number of URLs inspected and freeze the
 * resulting snapshot for the whole run (no mid-run re-fetch ⇒ no canonical-vs-GSC
 * time skew). The worker may pass a smaller cap when remaining quota is lower.
 */
export const DEFAULT_INSPECTION_SAMPLE_CAP = 50;

/**
 * Deterministically select up to `cap` URLs for URL Inspection. Dedups first
 * (quota is per distinct URL) then takes the first `cap` in stable input order.
 * Pure: same input + cap ⇒ same sample, so the frozen snapshot is reproducible.
 */
export function selectInspectionSampleUrls(
  urls: readonly string[],
  cap: number = DEFAULT_INSPECTION_SAMPLE_CAP,
): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    deduped.push(url);
  }
  return deduped.slice(0, Math.max(0, cap));
}

/**
 * Build the per-run GSC index-coverage snapshot.
 *
 * Degrade-to-na (AC3): when `connected` is false, or `fetchByPage` is absent, or
 * the fetch rejects, return `{ status: 'na', reason }` — NEVER `ok` with a 0
 * numerator. A missing GSC must never render as "0% index coverage".
 *
 * When ok: `gscIndexed` is the count of pages confirmed indexed (Search
 * Analytics by-page presence OR an indexed URL Inspection coverageState).
 * AC10 is handled at the rule layer (impressions>0/clicks=0 is indexed, not a
 * crawl error) — here we still mark such pages `indexed:true` so they count in
 * the numerator.
 *
 * Pure over its inputs: same deps ⇒ same snapshot (zero AI, fully traceable).
 */
export async function buildGscIndexCoverage(
  deps: GscCoverageDeps,
): Promise<GscIndexCoverage> {
  if (!deps.connected) {
    return { status: "na", reason: "not_connected" };
  }
  if (!deps.fetchByPage) {
    return { status: "na", reason: "no_token" };
  }

  let pages: readonly GscCoveragePage[];
  try {
    pages = await deps.fetchByPage();
  } catch {
    // API error / quota exhaustion surfaced as a throw ⇒ na (never 0%).
    return { status: "na", reason: "api_error" };
  }

  const inspectionByUrl = new Map<string, UrlInspectionSnapshot>(
    (deps.inspectionSample ?? []).map((s) => [s.url, s]),
  );

  const sample: GscCoveragePage[] = pages.map((p) => {
    const snap = inspectionByUrl.get(p.url);
    const indexed =
      p.indexed || (snap !== undefined && inspectionIndexed(snap));
    return {
      url: p.url,
      impressions: p.impressions,
      clicks: p.clicks,
      indexed,
      ...(snap?.coverageState !== undefined
        ? { coverageState: snap.coverageState }
        : p.coverageState !== undefined
          ? { coverageState: p.coverageState }
          : {}),
    };
  });

  const gscIndexed = sample.filter((p) => p.indexed).length;

  const notIndexedReasons: Record<string, number> = {};
  for (const snap of deps.inspectionSample ?? []) {
    if (inspectionIndexed(snap)) continue;
    const reason = snap.coverageState ?? "Unknown";
    notIndexedReasons[reason] = (notIndexedReasons[reason] ?? 0) + 1;
  }

  return {
    status: "ok",
    intendedIndexable: deps.intendedIndexable,
    gscIndexed,
    notIndexedReasons,
    sample,
  };
}
