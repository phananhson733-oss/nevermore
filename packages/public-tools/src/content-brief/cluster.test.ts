import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  clusterHeadings,
  normalizeHeading,
  selectMustAnswer,
  type HeadingCluster,
  type HeadingInput,
} from "./cluster.ts";
import {
  CRAWL_HEADINGS_PER_PAGE_MAX,
  HEADING_CLUSTER_JACCARD,
  HEADING_MAX_CHARS,
  MUST_ANSWER_CAP,
  MUST_ANSWER_MIN_PAGES,
  PRESERVED_QUESTION_PREFIXES,
  STOPWORDS,
} from "./constants.ts";

const NO_BRAND: readonly string[] = [];

/**
 * Perf gate for clusterHeadings, measured in reference units rather than
 * milliseconds.
 *
 * The gate exists to catch a return to the naive O(H^2) pairwise scan, which
 * measured 1843 ms at CLUSTER_PERF_HEADINGS against roughly 46 ms today. A
 * millisecond budget cannot tell that regression from a busy machine: this
 * unchanged algorithm measured 824 ms against the old 300 ms budget while a
 * type-check ran beside it, and which of the three cases tripped varied from
 * run to run.
 *
 * So each case reports its cost in units of a reference workload measured in
 * the same process. Two things make that number stable. The ratio absorbs a
 * slower or busier machine, because both sides slow together. Taking the best
 * of several attempts absorbs a scheduler hiccup inside one attempt, which the
 * single unwarmed measurement this replaces had no defence against.
 *
 * Budgets sit at roughly three times the highest units observed across repeated
 * idle and loaded runs, so the naive scan (about 40x the current cost) is still
 * caught with room to spare. Load moves the ratio down, not up: the reference
 * allocates more than the clustering does and gives up more under contention,
 * so a busy machine measures cheaper than an idle one and never fails here.
 */
const CLUSTER_PERF_HEADINGS = 3000;
const CLUSTER_PERF_BUDGET_UNITS = 40; // observed 13.2 idle, 5.6 with the suite loading the box
const CLUSTER_PERF_VOCABULARY = 200;
const CLUSTER_PERF_MIN_TOKENS = 2;
const CLUSTER_PERF_MAX_TOKENS = 6;
const CLUSTER_PERF_PAGES = 10;
/** Worst case for the inverted index: every heading shares one token, so every pair is a candidate. */
const CLUSTER_WORST_CASE_LEVELS = 2;
const CLUSTER_WORST_CASE_HEADINGS = CRAWL_HEADINGS_PER_PAGE_MAX * CLUSTER_WORST_CASE_LEVELS * CLUSTER_PERF_PAGES;
/**
 * The one-token case runs shortest of the three, so its ratio is the noisiest.
 * Its budget therefore only catches a large
 * constant-factor regression; a measured 29% one (allocating an array per pair
 * inside sharedTokenCount) sits inside the natural spread and passes. The
 * sharp guards are the other two. What this case really pins is the assertion
 * below it: nothing merges, so all 800 survive as separate clusters.
 */
const CLUSTER_ONE_TOKEN_BUDGET_UNITS = 12; // observed 4.0 idle, 2.7 loaded
/** Catches removing the already-connected short circuit, which this case leans on. */
const CLUSTER_LONG_PREFIX_BUDGET_UNITS = 8; // observed 2.1 idle, 0.5 loaded
const REFERENCE_ROUNDS = 20_000;
const REFERENCE_SEED = 20_260_907;
const PERF_ATTEMPTS = 5;

/** `prefix u0`, `prefix u1`, ... : one shared token per heading, one unique token. */
function sharedPrefixHeadings(count: number, prefix: string): HeadingInput[] {
  return Array.from({ length: count }, (_, i) => {
    const page = (i % CLUSTER_PERF_PAGES) + 1;
    const level = Math.floor(i / CLUSTER_PERF_PAGES) % CLUSTER_WORST_CASE_LEVELS === 0 ? "h2" : "h3";
    return { observation_id: `C${page}`, rank: page, heading: `${prefix} u${i}`, level };
  });
}

/** Seeded LCG so the perf fixture is the same on every run; no Math.random in tests. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * One fixed unit of the string splitting and Map counting that clusterHeadings
 * spends its time on, used only to size the machine this is running on. It
 * calls nothing from cluster.ts, so a regression there cannot hide by
 * inflating the denominator. The total is asserted so an engine that optimises
 * the loop away is caught instead of silently reporting a near-zero reference.
 */
function referenceWork(): number {
  const seen = new Map<string, number>();
  const next = seededRandom(REFERENCE_SEED);
  for (let i = 0; i < REFERENCE_ROUNDS; i += 1) {
    const key = `term${Math.floor(next() * CLUSTER_PERF_VOCABULARY)} u${i % 97}`;
    for (const token of key.split(" ")) seen.set(token, (seen.get(token) ?? 0) + 1);
  }
  let total = 0;
  for (const count of seen.values()) total += count;
  if (total !== REFERENCE_ROUNDS * 2) throw new Error(`reference workload did not run: ${total}`);
  return total;
}

/**
 * Cost of `run` on this machine, expressed in reference-workload units.
 *
 * Interference only ever makes a measurement longer, so the fastest attempt on
 * each side is the closest either gets to its true cost and the ratio of the
 * two minima is the estimate. The two sides are interleaved rather than timed
 * in separate blocks, which is what went wrong before: with the whole suite
 * running in parallel, every clustering attempt landed inside a busy stretch
 * and every reference attempt after it, and the main case measured 59.5 units
 * against a budget of 40 that an idle run clears at 13.
 *
 * The minimum of the per-attempt ratios is not the same statistic and is not
 * safe here: one attempt where only the reference is descheduled produces a
 * small ratio all by itself, and the minimum then reports that instead of the
 * clustering cost. Taking each side's own minimum discards a pause wherever it
 * lands. A reference that measures zero contributes no attempt, so a clock too
 * coarse to measure anything fails instead of passing.
 */
function costInReferenceUnits(run: () => unknown): number {
  let bestRun = Number.POSITIVE_INFINITY;
  let bestReference = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < PERF_ATTEMPTS; attempt += 1) {
    const referenceStarted = performance.now();
    referenceWork();
    const referenceMs = performance.now() - referenceStarted;
    const started = performance.now();
    run();
    if (referenceMs > 0) bestReference = Math.min(bestReference, referenceMs);
    bestRun = Math.min(bestRun, performance.now() - started);
  }
  return bestRun / bestReference;
}

function pseudoRandomHeadings(count: number, seed: number): HeadingInput[] {
  const next = seededRandom(seed);
  const vocabulary = Array.from({ length: CLUSTER_PERF_VOCABULARY }, (_, i) => `term${i}`);
  return Array.from({ length: count }, (_, i) => {
    const span = CLUSTER_PERF_MAX_TOKENS - CLUSTER_PERF_MIN_TOKENS + 1;
    const length = CLUSTER_PERF_MIN_TOKENS + Math.floor(next() * span);
    const words = Array.from({ length }, () => vocabulary[Math.floor(next() * vocabulary.length)] ?? "term0");
    const page = (i % CLUSTER_PERF_PAGES) + 1;
    return { observation_id: `C${page}`, rank: page, heading: words.join(" "), level: "h2" };
  });
}

function h2(observation_id: string, rank: number, heading: string): HeadingInput {
  return { observation_id, rank, heading, level: "h2" };
}

function cluster(overrides: Partial<HeadingCluster> & Pick<HeadingCluster, "canonical_heading">): HeadingCluster {
  return {
    members: [{ observation_id: "C1", heading: overrides.canonical_heading, level: "h2" }],
    covered_by: MUST_ANSWER_MIN_PAGES,
    first_rank: 1,
    ...overrides,
  };
}

describe("normalizeHeading", () => {
  it("lowercases, strips punctuation and folds whitespace", () => {
    expect(normalizeHeading("  Pricing &   Plans!!  ", "en", NO_BRAND)).toBe("pricing plans");
  });

  it("drops English stopwords when the language has a table", () => {
    expect(normalizeHeading("The benefits of a CRM for your team", "en", NO_BRAND)).toBe("benefits crm team");
  });

  it("does not strip anything for a language without a stopword table", () => {
    expect(STOPWORDS["de"]).toBeUndefined();
    expect(normalizeHeading("Die Vorteile von einem CRM", "de", NO_BRAND)).toBe("die vorteile von einem crm");
  });

  it("keeps preserved question prefixes ahead of stopword stripping", () => {
    expect(PRESERVED_QUESTION_PREFIXES).toContain("how to");
    expect(PRESERVED_QUESTION_PREFIXES).toContain("what is");
    expect(PRESERVED_QUESTION_PREFIXES).toContain("is");
    expect(normalizeHeading("How to choose the right CRM", "en", NO_BRAND)).toBe("how to choose right crm");
    expect(normalizeHeading("What is a CRM?", "en", NO_BRAND)).toBe("what is crm");
    expect(normalizeHeading("Is a CRM worth it", "en", NO_BRAND)).toBe("is crm worth");
  });

  it("strips leading ordinals in their common shapes", () => {
    expect(normalizeHeading("1. Setup", "en", NO_BRAND)).toBe("setup");
    expect(normalizeHeading("Step 3: Setup", "en", NO_BRAND)).toBe("setup");
    expect(normalizeHeading("#2 Setup", "en", NO_BRAND)).toBe("setup");
    expect(normalizeHeading("(4) Setup", "en", NO_BRAND)).toBe("setup");
    expect(normalizeHeading("2.1 Setup", "en", NO_BRAND)).toBe("setup");
  });

  it("strips trailing ordinals only when they carry a marker", () => {
    expect(normalizeHeading("Setup - Step 3", "en", NO_BRAND)).toBe("setup");
    expect(normalizeHeading("Setup #2", "en", NO_BRAND)).toBe("setup");
    expect(normalizeHeading("Top 10", "en", NO_BRAND)).toBe("top 10");
  });

  it("does not treat a bare leading number as an ordinal", () => {
    expect(normalizeHeading("10 best CRM tools", "en", NO_BRAND)).toBe("10 best crm tools");
  });

  it("strips brand tokens at the head and tail but not in the middle", () => {
    expect(normalizeHeading("Acme pricing", "en", ["acme"])).toBe("pricing");
    expect(normalizeHeading("Pricing | Acme", "en", ["acme"])).toBe("pricing");
    expect(normalizeHeading("Why Acme beats spreadsheets", "en", ["acme"])).toBe("why acme beats spreadsheets");
  });

  it("matches multi-token and dotted brand values as a whole", () => {
    expect(normalizeHeading("Acme Corp — Getting started", "en", ["Acme Corp"])).toBe("getting started");
    expect(normalizeHeading("acme.com pricing", "en", ["acme.com"])).toBe("pricing");
    expect(normalizeHeading("Acmeville pricing", "en", ["acme"])).toBe("acmeville pricing");
  });

  it("strips an ordinal and a brand that stack at the head", () => {
    expect(normalizeHeading("1. Acme setup", "en", ["acme"])).toBe("setup");
  });

  it("truncates to HEADING_MAX_CHARS", () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const out = normalizeHeading(long, "en", NO_BRAND);
    expect(out.length).toBe(HEADING_MAX_CHARS);
    expect(long.length).toBeGreaterThan(HEADING_MAX_CHARS);
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeHeading("The", "en", NO_BRAND)).toBe("");
    expect(normalizeHeading("Acme", "en", ["acme"])).toBe("");
    expect(normalizeHeading("1.", "en", NO_BRAND)).toBe("");
    expect(normalizeHeading("!!!", "en", NO_BRAND)).toBe("");
  });
});

describe("clusterHeadings", () => {
  it("merges synonymous headings that pass the Jaccard threshold", () => {
    expect(HEADING_CLUSTER_JACCARD).toBeLessThanOrEqual(0.75);
    const out = clusterHeadings(
      [
        h2("C1", 1, "CRM pricing plans compared"),
        h2("C2", 2, "Pricing plans compared for CRM"),
        h2("C3", 3, "Compared CRM pricing plans 2026"),
      ],
      "en",
      NO_BRAND,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.members.map((m) => m.observation_id)).toEqual(["C1", "C2", "C3"]);
    expect(out[0]?.covered_by).toBe(3);
  });

  it("merges when one normalised heading is a token-boundary substring of the other", () => {
    const out = clusterHeadings(
      [h2("C1", 1, "How to install"), h2("C2", 2, "How to install on Windows and macOS")],
      "en",
      NO_BRAND,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.canonical_heading).toBe("how to install");
  });

  it("does not merge on a character-level substring that crosses a token boundary", () => {
    const out = clusterHeadings([h2("C1", 1, "Port"), h2("C2", 2, "Support")], "en", NO_BRAND);
    expect(out).toHaveLength(2);
  });

  it("keeps unrelated headings apart", () => {
    const out = clusterHeadings(
      [h2("C1", 1, "Pricing plans"), h2("C2", 2, "Security certifications"), h2("C3", 3, "Customer support hours")],
      "en",
      NO_BRAND,
    );
    expect(out.map((c) => c.canonical_heading)).toEqual([
      "pricing plans",
      "security certifications",
      "customer support hours",
    ]);
  });

  it("counts the same observation only once in covered_by while keeping every member", () => {
    const out = clusterHeadings(
      [
        h2("C1", 1, "Pricing"),
        { observation_id: "C1", rank: 1, heading: "Pricing", level: "h3" },
        h2("C2", 2, "Pricing"),
      ],
      "en",
      NO_BRAND,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.covered_by).toBe(2);
    expect(out[0]?.members).toHaveLength(3);
    expect(out[0]?.members[1]?.level).toBe("h3");
  });

  it("picks the shortest normalised string as the canonical heading", () => {
    const out = clusterHeadings(
      [h2("C1", 1, "How to install the CRM on Windows"), h2("C2", 2, "How to install")],
      "en",
      NO_BRAND,
    );
    expect(out[0]?.canonical_heading).toBe("how to install");
  });

  it("records the minimum SERP rank of the cluster as first_rank", () => {
    const out = clusterHeadings(
      [h2("C3", 7, "Pricing plans"), h2("C1", 2, "Pricing plans"), h2("C2", 5, "Pricing plans")],
      "en",
      NO_BRAND,
    );
    expect(out[0]?.first_rank).toBe(2);
  });

  it("traverses by rank then input order so the output does not depend on input order", () => {
    const a = [h2("C2", 2, "Pricing plans"), h2("C1", 1, "Security"), h2("C3", 3, "Pricing")];
    const b = [h2("C3", 3, "Pricing"), h2("C1", 1, "Security"), h2("C2", 2, "Pricing plans")];
    expect(clusterHeadings(a, "en", NO_BRAND)).toEqual(clusterHeadings(b, "en", NO_BRAND));
    expect(clusterHeadings(a, "en", NO_BRAND).map((c) => c.canonical_heading)).toEqual(["security", "pricing"]);
  });

  it("is deterministic across repeated calls", () => {
    const inputs = [
      h2("C1", 1, "1. Acme pricing"),
      h2("C2", 2, "Pricing"),
      h2("C3", 3, "What is a CRM"),
      h2("C4", 4, "What is CRM software"),
    ];
    expect(clusterHeadings(inputs, "en", ["acme"])).toEqual(clusterHeadings(inputs, "en", ["acme"]));
  });

  it("drops headings whose normalised form is empty", () => {
    const out = clusterHeadings([h2("C1", 1, "The"), h2("C2", 2, "Acme"), h2("C3", 3, "Pricing")], "en", ["acme"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.canonical_heading).toBe("pricing");
  });

  it("keeps the original heading text on members", () => {
    const out = clusterHeadings([h2("C1", 1, "Step 3: Acme Pricing!")], "en", ["acme"]);
    expect(out[0]?.members[0]).toEqual({ observation_id: "C1", heading: "Step 3: Acme Pricing!", level: "h2" });
    expect(out[0]?.canonical_heading).toBe("pricing");
  });

  it("does not crash for a language without a stopword table", () => {
    const out = clusterHeadings([h2("C1", 1, "Die Preise"), h2("C2", 2, "Die Preise")], "de", NO_BRAND);
    expect(out).toHaveLength(1);
    expect(out[0]?.canonical_heading).toBe("die preise");
  });

  it("joins headings that are only connected through a bridge into one component", () => {
    // plans/options share one of three tokens (Jaccard 1/3, below the threshold);
    // "pricing" is a token-boundary substring of both and bridges them.
    const out = clusterHeadings(
      [h2("C1", 1, "Pricing plans"), h2("C2", 2, "Pricing options"), h2("C3", 3, "Pricing")],
      "en",
      NO_BRAND,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.covered_by).toBe(3);
    expect(out[0]?.canonical_heading).toBe("pricing");
    expect(out[0]?.members.map((m) => m.observation_id)).toEqual(["C1", "C2", "C3"]);
  });

  it("gives the same component whether the bridge arrives first, in the middle or last", () => {
    const first = [h2("C1", 1, "Pricing"), h2("C2", 2, "Pricing plans"), h2("C3", 3, "Pricing options")];
    const middle = [h2("C1", 1, "Pricing plans"), h2("C2", 2, "Pricing"), h2("C3", 3, "Pricing options")];
    const last = [h2("C1", 1, "Pricing plans"), h2("C2", 2, "Pricing options"), h2("C3", 3, "Pricing")];
    for (const inputs of [first, middle, last]) {
      const out = clusterHeadings(inputs, "en", NO_BRAND);
      expect(out).toHaveLength(1);
      expect(out[0]?.covered_by).toBe(3);
      expect(out[0]?.canonical_heading).toBe("pricing");
    }
  });

  it("is transitive across a chain of pairwise-similar headings", () => {
    // A ⊂ B, C ⊂ B, but A and C share almost nothing: one component through B.
    const out = clusterHeadings(
      [
        h2("C1", 1, "How to install"),
        h2("C3", 3, "Install on Windows"),
        h2("C2", 2, "How to install on Windows"),
      ],
      "en",
      NO_BRAND,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.covered_by).toBe(3);
    expect(out[0]?.members.map((m) => m.observation_id)).toEqual(["C1", "C2", "C3"]);
  });

  it("keeps two components apart when no chain links them", () => {
    const out = clusterHeadings(
      [h2("C1", 1, "Pricing plans"), h2("C2", 2, "Pricing"), h2("C3", 3, "Security audit"), h2("C4", 4, "Security")],
      "en",
      NO_BRAND,
    );
    expect(out.map((c) => c.canonical_heading)).toEqual(["pricing", "security"]);
    expect(out.map((c) => c.covered_by)).toEqual([2, 2]);
  });

  it(`clusters ${CLUSTER_PERF_HEADINGS} headings within ${CLUSTER_PERF_BUDGET_UNITS} reference units`, () => {
    const inputs = pseudoRandomHeadings(CLUSTER_PERF_HEADINGS, 20_260_829);
    const out = clusterHeadings(inputs, "en", ["acme"]);
    expect(out.length).toBeGreaterThan(0);
    expect(costInReferenceUnits(() => clusterHeadings(inputs, "en", ["acme"])))
      .toBeLessThan(CLUSTER_PERF_BUDGET_UNITS);
  });

  it(`clusters ${CLUSTER_WORST_CASE_HEADINGS} headings that all share one token within ${CLUSTER_ONE_TOKEN_BUDGET_UNITS} reference units`, () => {
    const inputs = sharedPrefixHeadings(CLUSTER_WORST_CASE_HEADINGS, "x");
    const out = clusterHeadings(inputs, "en", NO_BRAND);
    // Jaccard 1/3 and no containment: nothing merges, every pair was still a candidate.
    expect(out).toHaveLength(CLUSTER_WORST_CASE_HEADINGS);
    expect(costInReferenceUnits(() => clusterHeadings(inputs, "en", NO_BRAND)))
      .toBeLessThan(CLUSTER_ONE_TOKEN_BUDGET_UNITS);
  });

  it(`clusters ${CLUSTER_WORST_CASE_HEADINGS} headings that share a long prefix within ${CLUSTER_LONG_PREFIX_BUDGET_UNITS} reference units`, () => {
    const inputs = sharedPrefixHeadings(CLUSTER_WORST_CASE_HEADINGS, "how to brew better coffee at home");
    const out = clusterHeadings(inputs, "en", NO_BRAND);
    // Jaccard 5/7 >= threshold: everything merges into one component of ten pages.
    expect(out).toHaveLength(1);
    expect(out[0]?.covered_by).toBe(CLUSTER_PERF_PAGES);
    expect(costInReferenceUnits(() => clusterHeadings(inputs, "en", NO_BRAND)))
      .toBeLessThan(CLUSTER_LONG_PREFIX_BUDGET_UNITS);
  });

  it("does not mutate the input array", () => {
    const inputs = [h2("C2", 2, "B"), h2("C1", 1, "A")];
    const snapshot = JSON.stringify(inputs);
    clusterHeadings(inputs, "en", NO_BRAND);
    expect(JSON.stringify(inputs)).toBe(snapshot);
  });
});

describe("selectMustAnswer", () => {
  it("drops clusters below MUST_ANSWER_MIN_PAGES", () => {
    const out = selectMustAnswer([
      cluster({ canonical_heading: "a", covered_by: MUST_ANSWER_MIN_PAGES - 1 }),
      cluster({ canonical_heading: "b", covered_by: MUST_ANSWER_MIN_PAGES }),
    ]);
    expect(out.selected.map((c) => c.canonical_heading)).toEqual(["b"]);
    expect(out.candidates).toBe(1);
    expect(out.hidden).toBe(0);
  });

  it("sorts by covered_by descending then first_rank ascending", () => {
    const out = selectMustAnswer([
      cluster({ canonical_heading: "a", covered_by: MUST_ANSWER_MIN_PAGES, first_rank: 5 }),
      cluster({ canonical_heading: "b", covered_by: MUST_ANSWER_MIN_PAGES + 2, first_rank: 9 }),
      cluster({ canonical_heading: "c", covered_by: MUST_ANSWER_MIN_PAGES, first_rank: 2 }),
      cluster({ canonical_heading: "d", covered_by: MUST_ANSWER_MIN_PAGES + 2, first_rank: 3 }),
    ]);
    expect(out.selected.map((c) => c.canonical_heading)).toEqual(["d", "b", "c", "a"]);
  });

  it("truncates to MUST_ANSWER_CAP and reports the hidden remainder", () => {
    const total = MUST_ANSWER_CAP + 3;
    const out = selectMustAnswer(
      Array.from({ length: total }, (_, i) =>
        cluster({ canonical_heading: `q${i}`, covered_by: MUST_ANSWER_MIN_PAGES, first_rank: i + 1 }),
      ),
    );
    expect(out.selected).toHaveLength(MUST_ANSWER_CAP);
    expect(out.candidates).toBe(total);
    expect(out.hidden).toBe(3);
    expect(out.selected.map((c) => c.first_rank)).toEqual(Array.from({ length: MUST_ANSWER_CAP }, (_, i) => i + 1));
  });

  it("returns empty selection with zero counts when nothing qualifies", () => {
    expect(selectMustAnswer([])).toEqual({ selected: [], candidates: 0, hidden: 0 });
  });

  it("does not mutate the input", () => {
    const input = [
      cluster({ canonical_heading: "a", covered_by: MUST_ANSWER_MIN_PAGES, first_rank: 5 }),
      cluster({ canonical_heading: "b", covered_by: MUST_ANSWER_MIN_PAGES + 1, first_rank: 1 }),
    ];
    const snapshot = JSON.stringify(input);
    selectMustAnswer(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
