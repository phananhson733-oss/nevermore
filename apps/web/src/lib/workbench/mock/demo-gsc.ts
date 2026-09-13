/**
 * Search Console rows for the sample site (jsx:2686-2703): the sample paste,
 * one seeded row per seed and keyword template (the vs template never), and a
 * login / pricing pair for a non-blank brand, deduped by `normQ` with the first
 * row winning. Every row's ctr is then derived from its own clicks and
 * impressions, the pasted rows included: the paste's rounded percentages do not
 * match its counts. A ctr that cannot be derived is `null`, never 0.
 */
import type { GscRow, Profile } from "../types.ts";
import { demoGscRows } from "./gsc.ts";
import { PATTERNS } from "./keywords.ts";
import { rngOf, seedKey } from "./rng.ts";
import { domainOf, normQ } from "./text.ts";

interface BrandRowSpec {
  readonly suffix: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

const SEED_TEMPLATE_COUNT = 7;
const SEED_TEMPLATES = PATTERNS.slice(0, SEED_TEMPLATE_COUNT).filter((pattern) => pattern.vs !== true);
const BRAND_ROWS: readonly BrandRowSpec[] = [
  { suffix: "login", clicks: 88, impressions: 140, position: 1.1 },
  { suffix: "pricing", clicks: 41, impressions: 320, position: 1.4 },
];
const RANKED_MAX_POSITION = 10;
const BORDERLINE_MAX_POSITION = 30;

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** A click-through percent typical of the position band; only used to derive clicks. */
function ctrPercentFor(position: number, next: () => number): number {
  if (position <= RANKED_MAX_POSITION) return 2 + next() * 6;
  if (position <= BORDERLINE_MAX_POSITION) return 0.3 + next() * 1.2;
  return 0.05 + next() * 0.3;
}

function seededRow(query: string, next: () => number): GscRow {
  const impressions = Math.round(120 + next() * 3200);
  const position = roundTo(4 + next() * 42, 1);
  const clicks = Math.round((impressions * ctrPercentFor(position, next)) / 100);
  return { query, clicks, impressions, ctr: null, position };
}

function seedRows(profile: Pick<Profile, "url">, seedQueries: readonly string[]): readonly GscRow[] {
  const next = rngOf(seedKey("demo-gsc", domainOf(profile.url)));
  return seedQueries
    .map((seed) => seed.trim())
    .filter((seed) => seed !== "")
    .flatMap((seed) => SEED_TEMPLATES.map((pattern) => seededRow(pattern.make(seed), next)));
}

function brandRows(profile: Pick<Profile, "brand">): readonly GscRow[] {
  const brandKey = normQ(profile.brand);
  if (brandKey === "") return [];
  return BRAND_ROWS.map((spec) => ({
    query: `${brandKey} ${spec.suffix}`,
    clicks: spec.clicks,
    impressions: spec.impressions,
    ctr: null,
    position: spec.position,
  }));
}

function firstByQuery(rows: readonly GscRow[]): readonly GscRow[] {
  const keys = rows.map((row) => normQ(row.query));
  const firstIndex = new Map(keys.map((key, index) => [key, index] as const).toReversed());
  return rows.filter((_, index) => firstIndex.get(keys[index] ?? "") === index);
}

/** Percent with two decimals, from the row's own counts; null without clicks or positive impressions. */
function withDerivedCtr(row: GscRow): GscRow {
  const { clicks, impressions } = row;
  const derivable = clicks !== null && impressions !== null && impressions > 0;
  return {
    query: row.query,
    clicks,
    impressions,
    ctr: derivable ? roundTo((clicks / impressions) * 100, 2) : null,
    position: row.position,
  };
}

export function demoGsc(profile: Pick<Profile, "url" | "brand">, seedQueries: readonly string[]): readonly GscRow[] {
  const rows = [...demoGscRows(profile), ...seedRows(profile, seedQueries), ...brandRows(profile)];
  return firstByQuery(rows).map(withDerivedCtr);
}
