/**
 * Keyword matrix (jsx:428-435, 500-511, 561-612): the prototype's query
 * templates, an intent classifier with real word boundaries, hash-seeded
 * estimates, an opportunity score without the random AI Overview bonus, and
 * row assembly that dedupes by `normQ` with GSC rows first. Every estimate is
 * mock data; nothing here reads the clock or `Math.random`.
 */
import type {
  GscRow,
  GscStatus,
  KeywordRow,
  PageType,
  Profile,
  Stage,
} from "../types.ts";
import { gscStatus } from "./gsc.ts";
import {
  AI_PATTERNS,
  PATTERNS,
  SERP_POOL,
  type KeywordPattern,
} from "./keyword-patterns.ts";
import { hashOf, rngOf, sampleDistinct, seedKey } from "./rng.ts";
import { matchesBrand, normQ, slugify, splitList } from "./text.ts";

/** The templates live in keyword-patterns.ts for file size; this module stays their import path. */
export { AI_PATTERNS, PATTERNS, SERP_POOL };
export type { KeywordPattern };

/* ---------------- classify ---------------- */

type Classification = Pick<KeywordRow, "intent" | "stage" | "page">;

const NAVIGATIONAL: Classification = {
  intent: "navigational",
  stage: "BOFU",
  page: "landing",
};
const TOFU: Classification = {
  intent: "informational",
  stage: "TOFU",
  page: "blog",
};
const COMMERCIAL: Classification = {
  intent: "commercial",
  stage: "BOFU",
  page: "comparison",
};
const TRANSACTIONAL: Classification = {
  intent: "transactional",
  stage: "BOFU",
  page: "landing",
};
const INFORMATIONAL: Classification = {
  intent: "informational",
  stage: "MOFU",
  page: "blog",
};

/**
 * Word edges for the English rules. `\b` would be wrong twice: it sees "ä" as a
 * non-word character ("bestätigen" matches "best") and it is what lets an
 * English word touch Chinese ("2026年best seo工具"). So a word character is any
 * letter, mark, number or `_`, except the space-less CJK scripts.
 */
const CJK =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const WORD_START = `(?<=^|[^\\p{L}\\p{M}\\p{N}_]|[${CJK}])`;
const WORD_END = `(?=$|[^\\p{L}\\p{M}\\p{N}_]|[${CJK}])`;
const wholeWords = (alternatives: string): RegExp =>
  new RegExp(`${WORD_START}(?:${alternatives})${WORD_END}`, "u");

const TOFU_START = new RegExp(
  `^(?:how|what|why|when|which|who)${WORD_END}|^(?:怎么|如何|什么)`,
  "u",
);
const COMMERCIAL_TERMS = wholeWords(
  "vs\\.?|versus|alternatives?|best|top \\d+|reviews?|compare|comparison",
);
const COMMERCIAL_ZH = /对比|替代/u;
const TRANSACTIONAL_TERMS = wholeWords(
  "pric(?:e|es|ing)|cost|buy|free trial|download|trial",
);
const TRANSACTIONAL_ZH = /价格|多少钱/u;

/** Rules in the prototype's order: brand, question start, commercial, transactional, else informational / MOFU. */
export function classify(query: string, brand: string): Classification {
  if (matchesBrand(query, brand)) return NAVIGATIONAL;
  const text = normQ(query);
  if (TOFU_START.test(text)) return TOFU;
  if (COMMERCIAL_TERMS.test(text) || COMMERCIAL_ZH.test(text))
    return COMMERCIAL;
  if (TRANSACTIONAL_TERMS.test(text) || TRANSACTIONAL_ZH.test(text))
    return TRANSACTIONAL;
  return INFORMATIONAL;
}

/* ---------------- estimates ---------------- */

const HAN_CHARACTER = /\p{Script=Han}/gu;
const LATIN_WORD =
  /[\p{Script=Latin}\p{N}]+(?:['’-][\p{Script=Latin}\p{N}]+)*/gu;
const LONG_TAIL_MIN_WORDS = 5;

/** Two Han characters count as one word; the prototype split on spaces, which counts a Chinese sentence as one word. */
function wordCount(text: string): number {
  const han = text.match(HAN_CHARACTER)?.length ?? 0;
  const latin = text.match(LATIN_WORD)?.length ?? 0;
  return han / 2 + latin;
}

/** Mock search metrics keyed by `normQ`, so spellings that dedupe to one row share one estimate. */
export function kwMetrics(
  query: string,
): Pick<KeywordRow, "volume" | "kd" | "cpc" | "aio"> {
  const key = normQ(query);
  const next = rngOf(hashOf(key));
  const longTail = wordCount(key) > LONG_TAIL_MIN_WORDS;
  const rawVolume = longTail ? 40 + next() * 320 : 200 + next() * 4200;
  return {
    volume: Math.round(rawVolume / 10) * 10,
    kd: Math.round(8 + next() * 70),
    cpc: (0.6 + next() * 9).toFixed(2),
    aio: next() > 0.55,
  };
}

/** Three distinct generic domains for a query, drawn without replacement (R9). */
export function serpTop(query: string): readonly string[] {
  return sampleDistinct(SERP_POOL, 3, rngOf(seedKey("serp", normQ(query))));
}

/* ---------------- opportunity ---------------- */

const STAGE_WEIGHT: Readonly<Record<Stage, number>> = {
  BOFU: 3,
  MOFU: 2,
  TOFU: 1,
};
const VOLUME_TERM_CAP = 30;
const KD_MAX = 100;

/** A volume that is not a positive finite number is missing, not a real zero. */
function volumeTerm(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  return Math.min(VOLUME_TERM_CAP, Math.log10(volume + 1) * 9);
}

/** A kd outside [0, 100] (or NaN) is missing and adds nothing. */
function difficultyTerm(kd: number): number {
  if (!Number.isFinite(kd) || kd < 0 || kd > KD_MAX) return 0;
  return (KD_MAX - kd) * 0.25;
}

function statusTerm(status: GscStatus | undefined): number {
  if (status === "borderline") return 20;
  if (status === "ranked") return -6;
  return 0;
}

/** Integer in [0, 100]. No `aio` input: the prototype added a random +6 for it. */
export function opportunity(
  row: Pick<
    KeywordRow,
    "stage" | "engine" | "volume" | "kd" | "source" | "gscStatus"
  >,
): number {
  const raw =
    STAGE_WEIGHT[row.stage] * 8 +
    (row.engine === "both" ? 8 : 4) +
    volumeTerm(row.volume) +
    difficultyTerm(row.kd) +
    (row.source === "gsc" ? 12 : 0) +
    statusTerm(row.gscStatus);
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/* ---------------- rows ---------------- */

type DraftRow = Omit<KeywordRow, "score" | "slug">;

const SLUG_PREFIX: Readonly<Partial<Record<PageType, string>>> = {
  blog: "blog/",
  tool: "tools/",
};
/** Two different probes: a template whose output changes between them names the brand. */
const BRAND_PROBES = ["\u0001", "\u0002"] as const;

function impressionVolume(impressions: number | null): number {
  if (impressions === null || !Number.isFinite(impressions) || impressions <= 0)
    return 0;
  return Math.ceil(impressions / 10) * 10;
}

function gscDraft(row: GscRow, brand: string): DraftRow {
  const metrics = kwMetrics(row.query);
  return {
    q: row.query,
    seed: "",
    ...classify(row.query, brand),
    engine: "seo",
    source: "gsc",
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.position,
    gscStatus: gscStatus(row),
    ...metrics,
    volume: Math.max(metrics.volume, impressionVolume(row.impressions)),
  };
}

function patternDraft(
  pattern: KeywordPattern,
  seed: string,
  brand: string,
  rival: string | undefined,
): readonly DraftRow[] {
  if (pattern.vs && (brand === "" || rival === undefined)) return [];
  const q = pattern.vs ? `${brand} vs ${rival ?? ""}` : pattern.make(seed);
  const { intent, stage, page, engine } = pattern;
  return [
    {
      q,
      seed: pattern.vs ? "" : seed,
      intent,
      stage,
      page,
      engine,
      source: "generated",
      ...kwMetrics(q),
    },
  ];
}

function aiDraft(
  make: (seed: string, brand: string) => string,
  seed: string,
  brand: string,
): readonly DraftRow[] {
  const namesBrand =
    make(seed, BRAND_PROBES[0]) !== make(seed, BRAND_PROBES[1]);
  if (brand === "" && namesBrand) return [];
  const q = make(seed, brand);
  return [
    {
      q,
      seed,
      intent: "commercial",
      stage: "MOFU",
      page: "answer-page",
      engine: "geo",
      source: "generated",
      ...kwMetrics(q),
    },
  ];
}

function seedDrafts(
  seed: string,
  brand: string,
  rival: string | undefined,
): readonly DraftRow[] {
  return [
    ...PATTERNS.flatMap((pattern) => patternDraft(pattern, seed, brand, rival)),
    ...AI_PATTERNS.flatMap((make) => aiDraft(make, seed, brand)),
  ];
}

/** First spelling of each `normQ` key wins. */
function dedupeByQuery(drafts: readonly DraftRow[]): readonly DraftRow[] {
  const keys = drafts.map((draft) => normQ(draft.q));
  const firstIndex = new Map(
    keys.map((key, index) => [key, index] as const).toReversed(),
  );
  return drafts.filter(
    (_, index) => firstIndex.get(keys[index] ?? "") === index,
  );
}

function toRow(draft: DraftRow): KeywordRow {
  return {
    ...draft,
    score: opportunity(draft),
    slug: `/${SLUG_PREFIX[draft.page] ?? ""}${slugify(draft.q)}`,
  };
}

/**
 * GSC rows, then per seed every pattern and AI template; deduped by `normQ`,
 * scored, sorted by score descending with ties in insertion order. Reads only
 * `profile.brand` and `profile.competitors`: the provider memoizes on exactly
 * those (R13). The vs template uses the first real competitor that is not the
 * brand, and is skipped without one — placeholders never become keywords (R9).
 */
export function buildRows(
  seeds: readonly string[],
  profile: Pick<Profile, "brand" | "competitors">,
  gscRows: readonly GscRow[],
): readonly KeywordRow[] {
  const brand = profile.brand.trim();
  const brandKey = normQ(brand);
  const rival = splitList(profile.competitors).find(
    (name) => normQ(name) !== brandKey,
  );
  const drafts = [
    ...gscRows
      .filter((row) => normQ(row.query) !== "")
      .map((row) => gscDraft(row, brand)),
    ...seeds
      .map((seed) => seed.trim())
      .filter((seed) => seed !== "")
      .flatMap((seed) => seedDrafts(seed, brand, rival)),
  ];
  return dedupeByQuery(drafts)
    .map(toRow)
    .toSorted((a, b) => b.score - a.score);
}

/** A blank query finds nothing because buildRows never emits a blank row. */
export function findRow(
  rows: readonly KeywordRow[],
  query: string,
): KeywordRow | undefined {
  const key = normQ(query);
  return rows.find((row) => normQ(row.q) === key);
}
