/**
 * Competitor overview and keyword gap (jsx:2529-2550, 2594-2599). A competitor
 * is the name the project entered, never `slugify(name) + ".com"` (R9); the
 * brand itself and the project's own domain are not competitors. Ranks inside
 * one gap row are distinct and 1-based; our rank comes from a matching GSC row
 * when that row has a usable position. Every number is mock data; nothing here
 * reads the clock or `Math.random`.
 */
import type {
  CompData,
  DomainStats,
  GapRow,
  GscRow,
  PageType,
  Profile,
} from "../types.ts";
import { PATTERNS, kwMetrics } from "./keywords.ts";
import { pick, rngOf, seedKey } from "./rng.ts";
import {
  competitorNames,
  domainOf,
  normQ,
  slugify,
  splitList,
} from "./text.ts";

const DR_MAX = 92;
const COMPARED_COMPETITORS = 3;
const GAP_TEMPLATE_COUNT = 8;
const GAP_ROW_LIMIT = 30;
const RANK_MAX = 12;
const RANK_POOL: readonly number[] = Array.from(
  { length: RANK_MAX },
  (_, i) => i + 1,
);
/** A competitor ranks when the draw is above this (jsx `r() > 0.45`). */
const COMPETITOR_RANKS_ABOVE = 0.45;
/** We rank when the draw is above this (jsx `r() > 0.7`). */
const WE_RANK_ABOVE = 0.7;
/** A query is a gap only while our rank is worse than this. */
const GAP_WHEN_OURS_ABOVE = 20;
const OTHER_PAGES = ["/blog", "/pricing", "/compare"] as const;

type GapProfile = Pick<Profile, "brand" | "url" | "competitors">;

interface GapCandidate {
  readonly q: string;
  readonly page: PageType;
}

/* ---------------- domains ---------------- */

/** The own domain's blog page names its first feature; with none it is a plain guide page. */
function ownBlogPath(features: string): string {
  const feature = splitList(features)[0];
  return feature === undefined
    ? "/blog/guide"
    : `/blog/${slugify(feature)}-guide`;
}

/**
 * Mock overview for one subject: the project's own domain or a competitor name
 * as entered. Only the own domain's pages use the project's features; a
 * competitor's pages are fixed, since we know nothing about its site.
 */
export function domainStats(
  subject: string,
  profile: Pick<Profile, "url" | "features">,
): DomainStats {
  const next = rngOf(seedKey("dom", normQ(subject)));
  const own = subject === domainOf(profile.url);
  const scale = own ? 1 : 3 + next() * 40;
  const paths = own
    ? [ownBlogPath(profile.features), "/pricing", "/compare"]
    : OTHER_PAGES;
  return {
    domain: subject,
    traffic: Math.round(((400 + next() * 1800) * scale) / 10) * 10,
    kws: Math.round((80 + next() * 300) * scale),
    dr: Math.min(DR_MAX, Math.round((own ? 18 : 35) + next() * 45)),
    refdomains: Math.round((30 + next() * 400) * Math.sqrt(scale)),
    topPages: paths.map((path, i) => ({
      path,
      share: Math.round(28 - i * 8 + next() * 6),
    })),
  };
}

/** Up to three competitors, skipping the brand itself and the project's own domain; placeholders when none are filled in. */
function comparedCompetitors(profile: GapProfile): readonly string[] {
  const brandKey = normQ(profile.brand);
  const ownDomain = domainOf(profile.url);
  return competitorNames(profile)
    .filter((name) => normQ(name) !== brandKey)
    .filter((name) => ownDomain === "" || domainOf(name) !== ownDomain)
    .slice(0, COMPARED_COMPETITORS);
}

/* ---------------- gap ---------------- */

const GAP_TEMPLATES = PATTERNS.slice(0, GAP_TEMPLATE_COUNT).filter(
  (pattern) => pattern.vs !== true,
);

/** Each trimmed seed through the first eight templates; the first spelling of each `normQ` key wins. */
function gapCandidates(seeds: readonly string[]): readonly GapCandidate[] {
  const all = seeds
    .map((seed) => seed.trim())
    .filter((seed) => seed !== "")
    .flatMap((seed) =>
      GAP_TEMPLATES.map((pattern) => ({
        q: pattern.make(seed),
        page: pattern.page,
      })),
    );
  const keys = all.map((candidate) => normQ(candidate.q));
  const firstIndex = new Map(
    keys.map((key, index) => [key, index] as const).toReversed(),
  );
  return all.filter((_, index) => firstIndex.get(keys[index] ?? "") === index);
}

/** GSC ranks 1-based; null, zero, negative and non-finite positions are unavailable, not a rank. */
function isUsablePosition(position: number | null): position is number {
  return position !== null && Number.isFinite(position) && position > 0;
}

/** `normQ(query)` → rounded position of the first GSC row with a usable one. */
function gscRankIndex(gscRows: readonly GscRow[]): ReadonlyMap<string, number> {
  const entries = gscRows.flatMap((row) =>
    isUsablePosition(row.position)
      ? [[normQ(row.query), Math.round(row.position)] as const]
      : [],
  );
  return new Map(entries.toReversed());
}

/** One slot per competitor; a ranked competitor takes a rank no other competitor in the row holds. */
function drawRanks(
  count: number,
  next: () => number,
): readonly (number | null)[] {
  const initial: {
    readonly ranks: readonly (number | null)[];
    readonly free: readonly number[];
  } = { ranks: [], free: RANK_POOL };
  return Array.from({ length: count }).reduce<typeof initial>((drawn) => {
    if (next() <= COMPETITOR_RANKS_ABOVE) {
      return { ranks: [...drawn.ranks, null], free: drawn.free };
    }
    const rank = pick(drawn.free, next);
    return {
      ranks: [...drawn.ranks, rank],
      free: drawn.free.filter((taken) => taken !== rank),
    };
  }, initial).ranks;
}

function gapRow(
  candidate: GapCandidate,
  competitorCount: number,
  gscRanks: ReadonlyMap<string, number>,
): GapRow {
  const key = normQ(candidate.q);
  const next = rngOf(seedKey("gap", key));
  const ranks = drawRanks(competitorCount, next);
  const drawnOurs = next() > WE_RANK_ABOVE ? Math.round(5 + next() * 50) : null;
  return {
    q: candidate.q,
    ...kwMetrics(candidate.q),
    ranks,
    ours: gscRanks.get(key) ?? drawnOurs,
    page: candidate.page,
  };
}

function isGap(row: GapRow): boolean {
  return (
    row.ranks.some((rank) => rank !== null) &&
    (row.ours === null || row.ours > GAP_WHEN_OURS_ABOVE)
  );
}

/**
 * Queries where at least one competitor ranks and we do not rank in the top
 * 20: every seed through the first eight keyword templates, our rank from GSC
 * when it has one, sorted by volume descending, at most 30 rows.
 */
export function keywordGap(
  profile: GapProfile,
  seeds: readonly string[],
  gscRows: readonly GscRow[],
): CompData["gap"] {
  const comps = comparedCompetitors(profile);
  const gscRanks = gscRankIndex(gscRows);
  const rows = gapCandidates(seeds)
    .map((candidate) => gapRow(candidate, comps.length, gscRanks))
    .filter(isGap)
    .toSorted((a, b) => b.volume - a.volume)
    .slice(0, GAP_ROW_LIMIT);
  return { comps, rows };
}

/** Own domain first, then the compared competitors in the same order as `gap.comps`. */
export function buildCompData(
  profile: Profile,
  seeds: readonly string[],
  gscRows: readonly GscRow[],
  at: string,
): CompData {
  const gap = keywordGap(profile, seeds, gscRows);
  const subjects = [domainOf(profile.url), ...gap.comps];
  return {
    domains: subjects.map((subject) => domainStats(subject, profile)),
    gap,
    at,
  };
}
