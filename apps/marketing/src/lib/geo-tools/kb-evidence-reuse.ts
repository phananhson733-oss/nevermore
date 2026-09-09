// @input  -- the targets one update run wants to observe, plus the newest stored observation for each
// @output -- which targets are reused, which must be fetched, and which single fetch opens each target's crawl gate
// @pos    -- server side, but pure: it fetches nothing, opens no gate, spends no budget and reads no clock beyond the `now` it is handed

/**
 * One "update knowledge base" decides, before it spends anything, what it
 * already knows.
 *
 * Two separate guarantees come out of here:
 *
 * 1. Reuse. A target whose newest observation is inside its TTL is not
 *    fetched at all, so no traffic reaches the site and no budget is spent.
 *    The criterion is time and only time -- see `kb-evidence-observations.ts`
 *    for why confirming by body hash would rewrite the past.
 *
 * 2. One gate admission per target. The crawl gate budgets four runs per hour
 *    per target, and GEO shares that budget with the Profile scan, seo-audit
 *    and internal-link-audit. A run that reads eight pages of one site must
 *    therefore be admitted once, not eight times, exactly as a crawler is
 *    gated once before it reads many pages. This plan names the single fetch
 *    that opens each gate; every other fetch behind that key rides the same
 *    admission.
 */

import { canonicalCrawlTargetKey } from "../tools/crawl-cache.ts";
import {
  geoEvidenceTtlMs,
  isObservationFresh,
  type GeoEvidenceObservation,
  type GeoEvidenceObservationKind,
} from "./kb-evidence-observations.ts";

export interface GeoEvidenceTarget {
  readonly kind: GeoEvidenceObservationKind;
  /** For `gsc`, the `property + window` key rather than a URL. */
  readonly url: string;
  /**
   * The identity whose per-target hourly crawl budget a fetch of this target
   * would spend, or null for targets that spend none (GSC has its own gate).
   *
   * Build it with `geoEvidenceGateKey`. Do not re-derive the `www` rule here:
   * the gate and the cache disagree on purpose about apex-versus-`www`, and a
   * second copy of that rule is how the two silently drift apart.
   */
  readonly gateKey: string | null;
}

export type GeoEvidenceReuseDecision = "reuse" | "fetch";

export interface GeoEvidenceReuseEntry {
  readonly target: GeoEvidenceTarget;
  readonly decision: GeoEvidenceReuseDecision;
  /** The observation standing in for a fetch. Null on every `fetch` entry. */
  readonly reused: GeoEvidenceObservation | null;
  /**
   * The expired observation a fetch will supersede, if there was one.
   *
   * Carried so the interface can say "last seen on ..." while the new fetch
   * runs, and so a caller can compare body hashes across the two rows
   * afterwards. It is never treated as evidence that the fetch can be skipped.
   */
  readonly superseded: GeoEvidenceObservation | null;
  /** True on exactly one fetch entry per gate key: the one that must open the gate. */
  readonly opensGate: boolean;
}

export interface GeoEvidenceReusePlan {
  readonly entries: readonly GeoEvidenceReuseEntry[];
  /** Distinct gate keys this run opens, in the order their first fetch appears. One admission each. */
  readonly gateOpenings: readonly string[];
  readonly reuseCount: number;
  readonly fetchCount: number;
  /** Targets asked for more than once. They appear once in `entries`; the repeats are counted here. */
  readonly duplicateTargetCount: number;
}

/**
 * Identity of a thing observed: the kind and the exact url together.
 *
 * JSON, not a delimiter-joined string: a url may contain any character we
 * could pick as a separator, and a target key that two different targets can
 * collide on would silently reuse one site's observation for another.
 */
export function geoEvidenceTargetKey(target: {
  readonly kind: GeoEvidenceObservationKind;
  readonly url: string;
}): string {
  return JSON.stringify([target.kind, target.url]);
}

/**
 * The crawl gate's own target identity for a url, re-exported rather than
 * re-implemented so this module cannot drift from what the gate budgets.
 */
export function geoEvidenceGateKey(normalizedUrl: string): string | null {
  return canonicalCrawlTargetKey(normalizedUrl);
}

function observedAtMs(observation: GeoEvidenceObservation): number {
  const parsed = Date.parse(observation.observedAt);
  // An undatable observation loses every comparison, so it can never be
  // chosen as "the newest" and can never suppress a fetch.
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Newest observation per `(kind, url)`, from however many the caller loaded. */
function indexLatest(
  observations: readonly GeoEvidenceObservation[],
): ReadonlyMap<string, GeoEvidenceObservation> {
  const latest = new Map<string, GeoEvidenceObservation>();
  for (const observation of observations) {
    const key = geoEvidenceTargetKey(observation);
    const held = latest.get(key);
    if (held === undefined || observedAtMs(held) < observedAtMs(observation)) {
      latest.set(key, observation);
    }
  }
  return latest;
}

export function planGeoEvidenceReuse(input: {
  readonly targets: readonly GeoEvidenceTarget[];
  readonly observations: readonly GeoEvidenceObservation[];
  readonly now: Date;
  /** Injectable so a caller can shorten a TTL for one run; defaults to the library's own table. */
  readonly ttlMs?: (kind: GeoEvidenceObservationKind) => number;
}): GeoEvidenceReusePlan {
  const ttlOf = input.ttlMs ?? geoEvidenceTtlMs;
  const latest = indexLatest(input.observations);
  const entries: GeoEvidenceReuseEntry[] = [];
  const gateOpenings: string[] = [];
  const requested = new Set<string>();
  const opened = new Set<string>();
  let duplicateTargetCount = 0;

  for (const target of input.targets) {
    const key = geoEvidenceTargetKey(target);
    // The same page asked for twice in one run is one fetch, not two. Without
    // this, a homepage that is both "the site root" and "the about hub's
    // parent" would be fetched twice and counted twice against the target.
    if (requested.has(key)) {
      duplicateTargetCount += 1;
      continue;
    }
    requested.add(key);
    const observation = latest.get(key) ?? null;
    /*
     * Two questions, and freshness only answers the first.
     *
     * "Have we looked recently" is time, and `isObservationFresh` is the whole
     * of it. "Do we have anything" is the outcome, and a reading that
     * established nothing answers no -- it is a record that an attempt was
     * made, not evidence about the site. Reusing one serves the failure for
     * the rest of its TTL: on 2026-09-09 a redirect bug made four resources
     * `unavailable`, the fix shipped twenty minutes later, and the next run
     * fetched nothing at all and failed identically, because those rows were
     * still fresh. A whole day of retries would have done the same.
     *
     * The failed row is not discarded. It rides along as `superseded`, which
     * is what the previous attempt found and what this run replaces.
     */
    const usable = observation !== null && observation.status.kind === "ok";
    if (usable && isObservationFresh(observation, input.now, ttlOf(target.kind))) {
      entries.push({ target, decision: "reuse", reused: observation, superseded: null, opensGate: false });
      continue;
    }
    let opensGate = false;
    if (target.gateKey !== null && !opened.has(target.gateKey)) {
      opened.add(target.gateKey);
      gateOpenings.push(target.gateKey);
      opensGate = true;
    }
    entries.push({ target, decision: "fetch", reused: null, superseded: observation, opensGate });
  }

  const fetchCount = entries.filter((entry) => entry.decision === "fetch").length;
  return {
    entries,
    gateOpenings,
    reuseCount: entries.length - fetchCount,
    fetchCount,
    duplicateTargetCount,
  };
}
