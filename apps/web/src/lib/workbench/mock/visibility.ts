/**
 * AI visibility mock (jsx:513-533, 1613-1629, 1714-1718): a local prompt set,
 * prompt-list parsing, a seeded answer matrix whose hit / rank / brands always
 * agree with each other, and the derivations the views and badges share. Every
 * answer is mock data (`real: false`); nothing here reads the clock or
 * `Math.random`, and no third-party name or domain is invented (R9).
 */
import type { KeywordRow, Profile, PromptKind, VisResult } from "../types.ts";
import { AI_PATTERNS, PATTERNS, SERP_POOL } from "./keywords.ts";
import { rngOf, sampleDistinct, seedKey } from "./rng.ts";
import { competitorNames, normQ, splitList } from "./text.ts";

export interface PromptSeed {
  readonly q: string;
  readonly kind: PromptKind;
}

/** One prompt the brand was missing from: where, and who was named instead. */
export interface VisGap {
  readonly p: string;
  readonly missedPlatforms: readonly string[];
  readonly rivals: readonly string[];
}

export const PLATFORMS = [
  "ChatGPT",
  "Perplexity",
  "Google AI Overview",
  "Gemini",
  "Claude",
] as const;

export const VIS_PROMPT_LIMIT = 6;

const PLATFORM_ORDER: readonly string[] = PLATFORMS;
const HIT_THRESHOLD = 0.62;
const RIVAL_THRESHOLD = 0.45;
/** Four rivals plus the brand keeps `brands` within five without cutting the brand off. */
const MAX_RIVALS = 4;
const DOMAIN_COUNT = 3;
/** Kind of each `AI_PATTERNS` template, by index. */
const TEMPLATE_KINDS: readonly PromptKind[] = ["compare", "discover", "verify"];
/** PATTERNS[5], `what is ${seed}`: the only geo-only keyword template, a definition question. */
const DEFINITION_PATTERN = PATTERNS.find((pattern) => pattern.engine === "geo");
const GEO_ROW_LIMIT = 2;
const LINE_BREAK = /\r\n|\r|\n/;
/** "SEO tools", "rank tool", "dev-tools": the template must not add another "tools". */
const ENDS_WITH_TOOL_WORD = /(?:^|[\s-])tools?$/i;
/** A full stop or question mark a user typed at the end, with any space before it: it would land before the template's own "?". */
const TRAILING_SENTENCE_PUNCTUATION = /(?:\s*[.。!?！？])+$/u;
const SENTENCE_PUNCTUATION = /[.。!?！？;；]/u;

/* ---------------- shared helpers ---------------- */

/** First item for each key, in input order. */
function firstByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly T[] {
  const keys = items.map(keyOf);
  const firstIndex = new Map(
    keys.map((key, index) => [key, index] as const).toReversed(),
  );
  return items.filter(
    (_, index) => firstIndex.get(keys[index] ?? "") === index,
  );
}

const identity = (value: string): string => value;

/** One line, single spaces: a user field can neither break the prompt list nor leave a double space. */
const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

/** A cleaned field that is spliced mid-sentence, without the punctuation that ended it. */
const phraseOf = (value: string): string =>
  clean(value).replace(TRAILING_SENTENCE_PUNCTUATION, "");

/* ---------------- mockVisibility ---------------- */

/** Competitors deduped by `normQ` (placeholders when none), cleaned, without the brand itself. */
function rivalPool(
  profile: Pick<Profile, "competitors">,
  brandKey: string,
): readonly string[] {
  return competitorNames(profile)
    .map(clean)
    .filter((name) => normQ(name) !== brandKey)
    .slice(0, MAX_RIVALS);
}

function answerOf(
  p: string,
  platform: string,
  brand: string,
  pool: readonly string[],
  salt: string,
): VisResult {
  const next = rngOf(seedKey(p, platform, brand, salt));
  // A blank brand cannot be mentioned. The hit draw is still taken, so the
  // rival and domain draws sit at the same stream positions as on a named brand's miss.
  const hit = next() > HIT_THRESHOLD && brand !== "";
  const named = pool.filter(() => next() > RIVAL_THRESHOLD);
  const at = hit ? Math.floor(next() * (named.length + 1)) : -1;
  const brands = hit
    ? [...named.slice(0, at), brand, ...named.slice(at)]
    : named;
  return {
    p,
    platform,
    hit,
    rank: hit ? at + 1 : null,
    brands,
    domains: sampleDistinct(SERP_POOL, DOMAIN_COUNT, next),
    real: false,
  };
}

/**
 * One answer per prompt per platform. `hit` decides whether the brand is
 * inserted into `brands`, and `rank` is where it was inserted, so
 * `hit ⇔ brands contains brand` and `brands[rank - 1] === brand` hold by
 * construction. Brand and competitor names are cleaned as in `localPromptSet`.
 * Domains come only from `SERP_POOL`, drawn without replacement.
 */
export function mockVisibility(
  profile: Pick<Profile, "brand" | "competitors">,
  prompts: readonly string[],
  salt: string,
): readonly VisResult[] {
  const brand = clean(profile.brand);
  const pool = rivalPool(profile, normQ(brand));
  return prompts.flatMap((p) =>
    PLATFORMS.map((platform) => answerOf(p, platform, brand, pool, salt)),
  );
}

/* ---------------- localPromptSet ---------------- */

interface PromptContext {
  readonly brand: string;
  /** The positioning when it reads as a topic; "" when it is a sentence. */
  readonly topic: string;
  readonly f0: string | undefined;
  readonly f1: string | undefined;
  /** Real competitors only: placeholders never become prompts sent to an AI. */
  readonly rivals: readonly string[];
}

/**
 * "what tools help with Acme helps teams get cited" is nonsense: a positioning
 * that names the brand first, or still holds sentence punctuation once the
 * trailing mark is gone, is not a topic.
 */
function topicOf(positioning: string, brandKey: string): string {
  const key = normQ(positioning);
  const namesBrand =
    brandKey !== "" && (key === brandKey || key.startsWith(`${brandKey} `));
  return namesBrand || SENTENCE_PUNCTUATION.test(positioning)
    ? ""
    : positioning;
}

function contextOf(
  profile: Pick<Profile, "brand" | "positioning" | "features" | "competitors">,
): PromptContext {
  const brand = clean(profile.brand);
  const brandKey = normQ(brand);
  const features = splitList(profile.features)
    .map(phraseOf)
    .filter((feature) => feature !== "");
  const named = splitList(profile.competitors).length > 0;
  const rivals = named
    ? competitorNames(profile)
        .map(clean)
        .filter((name) => normQ(name) !== brandKey)
    : [];
  return {
    brand,
    topic: topicOf(phraseOf(profile.positioning), brandKey),
    f0: features[0],
    f1: features[1] ?? features[0],
    rivals,
  };
}

const seedOf = (q: string, kind: PromptKind): PromptSeed => ({ q, kind });
const toolsOf = (feature: string): string =>
  ENDS_WITH_TOOL_WORD.test(feature) ? feature : `${feature} tools`;
const toolOf = (feature: string): string =>
  ENDS_WITH_TOOL_WORD.test(feature) ? feature : `${feature} tool`;

/** Without a feature, the "best tools" question asks for tools like the brand: an alternatives question. */
function bestSeed(c: PromptContext): PromptSeed | null {
  if (c.f0 !== undefined)
    return seedOf(`best ${toolsOf(c.f0)} for startups`, "discover");
  if (c.brand !== "") return seedOf(`best tools like ${c.brand}`, "alternative");
  return null;
}

function discoverSeeds(c: PromptContext): readonly (PromptSeed | null)[] {
  const topic = c.topic || c.f0;
  const help = topic
    ? seedOf(`what tools help with ${topic}`, "discover")
    : null;
  return [bestSeed(c), help];
}

/** `${brand} vs ${rival}` needs both; otherwise a feature comparison, otherwise nothing. */
function headToHeadSeed(c: PromptContext): PromptSeed | null {
  const [first] = c.rivals;
  if (first !== undefined && c.brand !== "")
    return seedOf(`${c.brand} vs ${first}`, "compare");
  if (c.f0 !== undefined) return seedOf(`${toolsOf(c.f0)} compared`, "compare");
  return null;
}

function chooseSeed(c: PromptContext): PromptSeed | null {
  const [, second] = c.rivals;
  if (c.f1 === undefined) return null;
  if (second === undefined)
    return seedOf(`which ${toolOf(c.f1)} should I pick?`, "compare");
  return seedOf(`is ${second} the best option for ${c.f1}?`, "compare");
}

function compareSeeds(c: PromptContext): readonly (PromptSeed | null)[] {
  return [headToHeadSeed(c), chooseSeed(c)];
}

function laterSeeds(c: PromptContext): readonly (PromptSeed | null)[] {
  const replaced = c.rivals[0] ?? c.brand;
  return [
    c.brand ? seedOf(`is ${c.brand} worth using?`, "verify") : null,
    replaced ? seedOf(`${replaced} alternatives`, "alternative") : null,
    c.f0 === undefined
      ? null
      : seedOf(
          `I have a small team and no SEO budget, how do I get started with ${c.f0}?`,
          "scenario",
        ),
  ];
}

/**
 * `buildRows` does not record which template made a geo row, so the row is
 * re-made from the definition template and each AI template and compared by
 * `normQ`. The definition question names no brand; an AI row built for
 * another brand matches nothing and falls back to `scenario`.
 */
function geoKind(row: KeywordRow, brand: string): PromptKind {
  const key = normQ(row.q);
  const remade = (q: string): boolean => normQ(q) === key;
  if (DEFINITION_PATTERN !== undefined && remade(DEFINITION_PATTERN.make(row.seed)))
    return "discover";
  const index = AI_PATTERNS.findIndex((make) => remade(make(row.seed, brand)));
  return TEMPLATE_KINDS[index] ?? "scenario";
}

/**
 * The prototype's seven questions with its filler removed: a template whose
 * feature, competitor or brand is missing is skipped rather than padded with
 * "tools", "growth" or an empty slot, and a sentence-shaped positioning gives
 * way to the first feature. Then the first two geo rows; deduped by `normQ`,
 * first spelling wins.
 */
export function localPromptSet(
  profile: Pick<Profile, "brand" | "positioning" | "features" | "competitors">,
  rows: readonly KeywordRow[],
): readonly PromptSeed[] {
  const c = contextOf(profile);
  const fromRows = rows
    .filter((row) => row.engine === "geo")
    .slice(0, GEO_ROW_LIMIT)
    .map((row) => seedOf(clean(row.q), geoKind(row, c.brand)));
  const seeds = [
    ...discoverSeeds(c),
    ...compareSeeds(c),
    ...laterSeeds(c),
    ...fromRows,
  ].filter((seed): seed is PromptSeed => seed !== null && seed.q !== "");
  return firstByKey(seeds, (seed) => normQ(seed.q));
}

/* ---------------- parsing and derivations ---------------- */

/** One prompt per non-blank line, trimmed. */
export function parsePromptList(text: string): readonly string[] {
  return text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Hits over total in 0..1; `null` when nothing ran (zero hits is a real 0). */
export function mentionRate(results: readonly VisResult[]): number | null {
  if (results.length === 0) return null;
  return results.filter((result) => result.hit).length / results.length;
}

/** Prompts with at least one miss, once each, in order of first appearance. */
export function missedPrompts(
  results: readonly VisResult[],
): readonly string[] {
  const missed = new Set(
    results.filter((result) => !result.hit).map((result) => result.p),
  );
  return firstByKey(
    results.map((result) => result.p),
    identity,
  ).filter((p) => missed.has(p));
}

/** Known platforms in `PLATFORMS` order, then any other platform in first-appearance order. */
function orderPlatforms(platforms: readonly string[]): readonly string[] {
  const rankOf = (platform: string): number => {
    const index = PLATFORM_ORDER.indexOf(platform);
    return index === -1 ? PLATFORM_ORDER.length : index;
  };
  return firstByKey(platforms, identity).toSorted(
    (a, b) => rankOf(a) - rankOf(b),
  );
}

/**
 * Per missed prompt: the platforms that did not name the brand, and who those
 * answers named instead (deduped by `normQ`, never the brand). Every answer
 * naming the brand gives `[]`.
 */
export function visibilityGaps(
  results: readonly VisResult[],
  brand: string,
): readonly VisGap[] {
  const brandKey = normQ(brand);
  const misses = results.filter((result) => !result.hit);
  return missedPrompts(results).map((p) => {
    const answers = misses.filter((result) => result.p === p);
    const named = answers
      .flatMap((result) => result.brands)
      .filter((name) => normQ(name) !== "" && normQ(name) !== brandKey);
    return {
      p,
      missedPlatforms: orderPlatforms(answers.map((result) => result.platform)),
      rivals: firstByKey(named, normQ),
    };
  });
}
