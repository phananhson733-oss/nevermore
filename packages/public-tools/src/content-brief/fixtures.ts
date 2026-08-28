// @input  -- nothing at runtime; fixture knobs or DeepPartial overrides from a test
// @output -- ContentBrief values assembled through the same assemble.ts builders the producer uses, plus a helper that stamps the real fingerprint
// @pos    -- the shared test fixture for the content chain; every content-brief test starts from one of these instead of hand-writing a brief
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildCrawlReadMeta,
  buildDraftReadiness,
  buildFormatField,
  buildIntentField,
  buildLengthField,
  buildMustAnswerDraft,
  buildSerpObservations,
  deriveBriefRunMode,
  modelDerivedFrom,
} from "./assemble.ts";
import { briefFingerprint } from "./canonical.ts";
import { GSC_LOOKBACK_DAYS, MUST_ANSWER_CAP, MUST_ANSWER_MIN_PAGES, OUTLINE_CAP, RUN_BUDGET_MS } from "./constants.ts";
import { CONTENT_BRIEF_SCHEMA } from "./contract.ts";
import { computeVerdict } from "./verdict.ts";
import type { VerdictResult } from "./verdict.ts";
import type {
  BriefRunMeta,
  ContentBrief,
  CrawlFailure,
  CrawlObservation,
  CrawlSkipped,
  DoNotCoverField,
  GapAngleField,
  InternalLinksField,
  LlmReadMeta,
  MustAnswerField,
  MustAnswerItem,
  Origin,
  OutlineField,
  OutlineItem,
  ProfileFact,
  Unavailable,
  Verdict,
} from "./contract.ts";

/* ------------------------------------------------------------------ */
/* overrides                                                            */
/* ------------------------------------------------------------------ */

/**
 * Arrays are replaced wholesale, objects are merged key by key. A union
 * branch is therefore swapped by spreading, not by overriding: merging an
 * `unavailable` read into a `complete` one would keep the complete-only keys
 * and the parser would reject the leftover.
 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeDeep(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeDeep(base[key], value);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* knobs                                                                */
/* ------------------------------------------------------------------ */

export interface FixtureOptions {
  /** SERP read failed: no ledger, every downstream field unavailable, mode unavailable. */
  readonly serp?: "complete" | "unavailable";
  /** Budget exhausted before any URL started: SERP ledger present, crawl read `timeout / 0`, no crawl ledger. */
  readonly crawlTimeout?: boolean;
  /** Every SERP row without a URL: the crawl read is available but fully skipped. */
  readonly allSkipped?: boolean;
  /** LLM output rejected by validation: heuristic questions, no model-written field. */
  readonly llm?: "complete" | "validation_failed";
  /** "en" by default; a language without whitespace tokenisation nulls word counts and three fields. */
  readonly language?: "en" | "zh";
  /** Fifth page read completely, so five full pages make the length field available. */
  readonly completeC5?: boolean;
  /** GSC and the product profile connected: update verdict, gap angle, links, do-not-cover. */
  readonly connected?: boolean;
  /** Connected, but the primary keyword never appeared in the GSC query rows. */
  readonly notObserved?: boolean;
}

const COLLECTED_AT = "2026-08-28T10:00:00.000Z";
const FETCHED_AT = "2026-08-28T10:00:07.000Z";
const OWNED_PAGE = "https://acme.example/blog/email-warmup";
const TOOL_PAGE = "https://acme.example/tools/warmup";
const PRICING_PAGE = "https://acme.example/pricing";

interface SerpSeed {
  readonly domain: string;
  readonly url: string;
  readonly title: string;
}

/** Classified by classifySerpFormat at fixture time: guide x5, listicle x2, comparison, tool, unknown. */
const SERP_SEEDS: readonly SerpSeed[] = [
  { domain: "mailwarm.example", url: "https://mailwarm.example/guide/email-warmup", title: "Email warmup: the complete guide" },
  { domain: "deliverability.example", url: "https://deliverability.example/blog/what-is-email-warmup", title: "What is email warm-up?" },
  { domain: "toolsreview.example", url: "https://toolsreview.example/best-email-warmup-tools", title: "10 best email warmup tools" },
  { domain: "sendhub.example", url: "https://sendhub.example/learn/email-warmup", title: "How to warm up an email domain" },
  { domain: "compare.example", url: "https://compare.example/compare/warmup-a-vs-b", title: "Warmup A vs Warmup B" },
  { domain: "inboxlab.example", url: "https://inboxlab.example/guide/warmup", title: "Email warmup guide" },
  { domain: "listly.example", url: "https://listly.example/top-warmup-services", title: "Top 7 warmup services" },
  { domain: "warmtool.example", url: "https://warmtool.example/tools/warmup-calculator", title: "Warmup calculator" },
  { domain: "deliverability.example", url: "https://deliverability.example/blog/warmup-schedule", title: "Warmup schedule" },
  { domain: "misc.example", url: "https://misc.example/page", title: "Email warmup" },
];

interface PageSeed {
  readonly h2: readonly string[];
  readonly h3: readonly string[];
  readonly excerpts: readonly { readonly heading: string; readonly level: "h2" | "h3" }[];
  readonly word_count: number | null;
}

/**
 * Headings repeat verbatim across pages so the lexical clusterer (cluster.ts)
 * yields four qualified clusters: "what is email warmup" (C1 C2 C4 C6),
 * "how long does email warmup take" (C1 C2 C3 C4), "best email warmup tools"
 * (C1 C3 C6), "common email warmup mistakes" (C1 C3 C5); "warmup schedule"
 * (C2 C5) stays below MUST_ANSWER_MIN_PAGES.
 */
const PAGE_SEEDS: readonly PageSeed[] = [
  {
    h2: ["What is email warmup", "How long does email warmup take", "Best email warmup tools", "Common email warmup mistakes"],
    h3: ["Manual warmup"],
    excerpts: [{ heading: "What is email warmup", level: "h2" }, { heading: "Manual warmup", level: "h3" }],
    word_count: 1840,
  },
  {
    h2: ["What is email warmup", "How long does email warmup take", "Warmup schedule"],
    h3: [],
    excerpts: [{ heading: "What is email warmup", level: "h2" }],
    word_count: 1210,
  },
  {
    h2: ["How long does email warmup take", "Best email warmup tools", "Common email warmup mistakes"],
    h3: ["Warmup tools compared"],
    excerpts: [{ heading: "Best email warmup tools", level: "h2" }],
    word_count: 2300,
  },
  {
    h2: ["What is email warmup", "Why warm up your email"],
    h3: ["How long does email warmup take"],
    excerpts: [{ heading: "How long does email warmup take", level: "h3" }],
    word_count: 960,
  },
  {
    h2: ["Common email warmup mistakes", "Warmup schedule"],
    h3: [],
    excerpts: [{ heading: "Common email warmup mistakes", level: "h2" }],
    word_count: null,
  },
  { h2: ["What is email warmup", "Best email warmup tools"], h3: [], excerpts: [], word_count: null },
];

/** Model rewrites keyed by canonical heading; anything else keeps a question mark suffix. */
const QUESTION_REWRITES: Readonly<Record<string, string>> = {
  "what is email warmup": "What is email warmup?",
  "how long does email warmup take": "How long does email warmup take?",
  "best email warmup tools": "Which email warmup tools are worth using?",
  "common email warmup mistakes": "Which warmup mistakes should you avoid?",
};

/* ------------------------------------------------------------------ */
/* ledger pieces                                                        */
/* ------------------------------------------------------------------ */

function seedAt(index: number): SerpSeed {
  const seed = SERP_SEEDS[index];
  if (seed === undefined) throw new Error(`fixture: no SERP seed at ${index}`);
  return seed;
}

function observedPages(options: FixtureOptions): CrawlObservation[] {
  const wordless = options.language === "zh";
  return PAGE_SEEDS.map((seed, index) => {
    const serp = seedAt(index);
    const wordCount = index === 4 && options.completeC5 === true ? 500 : seed.word_count;
    const base = {
      id: `C${index + 1}`,
      serp_id: `S${index + 1}`,
      url: serp.url,
      final_url: serp.url,
      fetched_at: FETCHED_AT,
      h2: [...seed.h2],
      h3: [...seed.h3],
      excerpts: seed.excerpts.map((excerpt) => ({
        heading: excerpt.heading,
        level: excerpt.level,
        text: `Excerpt under "${excerpt.heading}" from page ${index + 1}.`,
      })),
      content_hash: `sha256:page-${index + 1}`,
    };
    return wordCount === null
      ? { ...base, body_complete: false as const, word_count: null }
      : { ...base, body_complete: true as const, word_count: wordless ? null : wordCount };
  });
}

const FAILED: readonly CrawlFailure[] = [
  { serp_id: "S7", url: seedAt(6).url, reason: "timeout", code: null },
  { serp_id: "S8", url: seedAt(7).url, reason: "provider_error", code: "blocked" },
  { serp_id: "S10", url: seedAt(9).url, reason: "validation_failed", code: null },
];

const SKIPPED: readonly CrawlSkipped[] = [{ serp_id: "S9", reason: "same_host", kept_serp_id: "S2" }];

function profileFacts(): ProfileFact[] {
  return [
    {
      id: "P1",
      field: "valueProposition",
      text: "Warms inboxes from a shared pool of real mailboxes.",
      derivation: "declared",
      provenance: { method: "observed", origin: "product_profile" },
    },
    {
      id: "P2",
      field: "coreFeatures[0]",
      text: "Per-domain warmup schedules.",
      derivation: "inferred",
      provenance: { method: "model", derived_from: ["product_profile"] },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* model-written fields                                                 */
/* ------------------------------------------------------------------ */

function unavailableOf(reason: Unavailable["reason"], attempted: number | null): Unavailable {
  return { status: "unavailable", reason, attempted };
}

function llmGate(llm: LlmReadMeta): Unavailable {
  return llm.status === "unavailable" ? unavailableOf(llm.reason, llm.attempted) : unavailableOf("validation_failed", llm.calls);
}

function modelQuestions(draft: MustAnswerField, derived: readonly Origin[], llm: LlmReadMeta): MustAnswerField {
  if (draft.status === "unavailable" || llm.status !== "complete") return draft;
  return {
    status: "available",
    items: draft.items.map(
      (item): MustAnswerItem => ({
        ...item,
        q: QUESTION_REWRITES[item.cluster.canonical_heading] ?? `${item.cluster.canonical_heading}?`,
        q_provenance: { method: "model", derived_from: [...derived] },
      }),
    ),
  };
}

const OUTLINE_H2 = ["What email warmup is and why it matters", "How long a warmup takes", "Tools and mistakes"];
const OUTLINE_H3: readonly (readonly string[])[] = [["Definition", "Why inbox providers care"], [], ["Choosing a tool", "What to avoid"]];

function outlineFrom(questions: MustAnswerField, derived: readonly Origin[], llm: LlmReadMeta): OutlineField {
  if (questions.status === "unavailable") return unavailableOf(questions.reason, questions.attempted);
  if (questions.items.length < 3) return unavailableOf("insufficient_evidence", questions.items.length);
  if (llm.status !== "complete") return llmGate(llm);
  const ids = questions.items.map((item) => item.id);
  const [first, second, ...rest] = ids;
  if (first === undefined || second === undefined || rest.length === 0) throw new Error("fixture: outline needs three questions");
  const [third, ...more] = rest;
  const answers: [string, ...string[]][] = [[first], [second], [third as string, ...more]];
  const items = answers.map(
    (sectionAnswers, index): OutlineItem => ({
      id: `O${index + 1}`,
      h2: OUTLINE_H2[index] ?? `Section ${index + 1}`,
      h3: [...(OUTLINE_H3[index] ?? [])],
      answers: sectionAnswers,
      provenance: { method: "model", derived_from: [...derived] },
    }),
  );
  const [head, ...tail] = items;
  if (head === undefined) throw new Error("fixture: empty outline");
  return { status: "available", items: [head, ...tail] };
}

/* ------------------------------------------------------------------ */
/* the brief                                                            */
/* ------------------------------------------------------------------ */

function llmRead(options: FixtureOptions): LlmReadMeta {
  return options.llm === "validation_failed"
    ? { status: "unavailable", reason: "validation_failed", attempted: 1, calls: 1, model_id: "gpt-4.1-brief", input_tokens: 5_200, output_tokens: 900 }
    : {
        status: "complete",
        calls: 1,
        model_id: "gpt-4.1-brief",
        temperature_requested: 0.2,
        temperature_effective: null,
        input_tokens: 5_200,
        output_tokens: 900,
      };
}

/**
 * The connected verdict is computed by verdict.ts from raw Search Console
 * rows, exactly as the handler does: two spellings of the primary keyword,
 * three query x page rows (one without a position), coverage 0.92.
 */
function gscVerdict(options: FixtureOptions): VerdictResult {
  const observed = options.notObserved !== true;
  return computeVerdict({
    primary: "email warmup",
    queryRows: observed
      ? [
          { query: "email warmup", impressions: 1_000, position: 6.5 },
          { query: "Email Warmup", impressions: 120, position: 8.1 },
        ]
      : [],
    queryPageRows: observed
      ? [
          { query: "email warmup", page: OWNED_PAGE, clicks: 40, impressions: 900, position: 6.2 },
          { query: "Email Warmup", page: OWNED_PAGE, clicks: 5, impressions: 120, position: 8.1 },
          { query: "email warmup", page: TOOL_PAGE, clicks: 2, impressions: 80, position: 0 },
        ]
      : [],
    queryPagingTruncated: false,
    queryUnreadableRows: 0,
    coverageOf: () => 0.92,
    minDimensionCoverage: 0.5,
  });
}

function gscRead(options: FixtureOptions, verdict: VerdictResult): BriefRunMeta["reads"]["gsc"] {
  if (options.connected !== true) return unavailableOf("not_requested", null);
  const observed = options.notObserved !== true;
  return {
    status: "complete",
    property: "sc-domain:acme.example",
    window: { start: "2026-07-30", end: "2026-08-26", lookback_days: GSC_LOOKBACK_DAYS },
    matched_queries: verdict.matchedQueries,
    primary_coverage: verdict.primaryCoverage,
    truncated: [],
    // Usable rows per dimension: the query x page ledger keeps 3 of them, the page ledger keeps all 3.
    rows: observed ? { query: 2, query_page: 3, page: 3 } : { query: 4, query_page: 6, page: 3 },
    unreadable_rows: { query: 0, query_page: 0, page: 0 },
  };
}

function verdictFor(options: FixtureOptions, verdict: VerdictResult): Verdict {
  if (options.connected !== true) return { action: "undecidable", reason: "no_gsc_property", provenance: null };
  return verdict.verdict;
}

function gapAngleFor(options: FixtureOptions, derived: readonly Origin[], llm: LlmReadMeta, observedIds: readonly string[]): GapAngleField {
  if (options.connected !== true) return unavailableOf("not_requested", null);
  if (observedIds.length === 0) return unavailableOf("insufficient_evidence", 0);
  if (llm.status !== "complete") return llmGate(llm);
  return {
    status: "available",
    value: "Lead with the shared-pool warmup that competitors' guides never mention.",
    rationale: "None of the observed pages describes pooled warmup.",
    provenance: { method: "model", derived_from: [...derived] },
    profile_fact_refs: ["P1"],
    checked_against: [...observedIds],
  };
}

function pageFieldsFor(options: FixtureOptions, derived: readonly Origin[], llm: LlmReadMeta): { internal_links: InternalLinksField; do_not_cover: DoNotCoverField } {
  if (options.connected !== true) {
    return { internal_links: unavailableOf("not_requested", null), do_not_cover: unavailableOf("not_requested", null) };
  }
  if (llm.status !== "complete") return { internal_links: llmGate(llm), do_not_cover: llmGate(llm) };
  // One object per field: structuredClone keeps shared references, so an alias
  // would let a test mutation of one field silently edit the other.
  const provenance = () => ({ method: "model" as const, derived_from: [...derived] });
  return {
    internal_links: {
      status: "available",
      items: [{ page_ref: "G2", why: "The calculator answers the schedule question directly.", why_provenance: provenance() }],
    },
    do_not_cover: { status: "available", items: [{ page_ref: "G3", topic: "pricing tiers", topic_provenance: provenance() }] },
  };
}

/** Assembles a brief through the same builders assemble.ts uses; `run.fingerprint` is left empty. */
export function contentBriefFixture(options: FixtureOptions = {}): ContentBrief {
  const language = options.language ?? "en";
  const primary = language === "zh" ? "邮件预热" : "email warmup";
  const serpUnavailable = options.serp === "unavailable";
  const crawlTimeout = options.crawlTimeout === true;
  const allSkipped = options.allSkipped === true;
  const connected = options.connected === true || options.notObserved === true;
  const resolved: FixtureOptions = { ...options, connected };

  const serpRows = serpUnavailable
    ? []
    : buildSerpObservations(SERP_SEEDS.map((seed, index) => ({ rank: index + 1, url: allSkipped ? null : seed.url, domain: seed.domain, title: seed.title })));
  const serpRead: BriefRunMeta["reads"]["serp"] = serpUnavailable
    ? unavailableOf("timeout", 10)
    : { status: "complete", requested: 10, returned: 10, unresolved: 0 };
  const noLedger = serpUnavailable || crawlTimeout;
  const observed = noLedger || allSkipped ? [] : observedPages(resolved);
  const failed = noLedger || allSkipped ? [] : [...FAILED];
  const skipped: CrawlSkipped[] = noLedger
    ? []
    : allSkipped
      ? serpRows.map((row) => ({ serp_id: row.id, reason: "no_url" as const, kept_serp_id: null }))
      : [...SKIPPED];
  const crawlRead: BriefRunMeta["reads"]["crawl"] = crawlTimeout
    ? unavailableOf("timeout", 0)
    : buildCrawlReadMeta({ serpReturned: serpUnavailable ? 0 : 10, observed, failed, skipped, started: !serpUnavailable });
  const llm = llmRead(resolved);
  const facts = connected ? profileFacts() : null;
  const gscPages = connected
    ? [
        { id: "G1", page: OWNED_PAGE, clicks: 45, impressions: 1_020, position: 6.4 },
        { id: "G2", page: TOOL_PAGE, clicks: 2, impressions: 80, position: null },
        { id: "G3", page: PRICING_PAGE, clicks: 12, impressions: 300, position: 4.1 },
      ]
    : [];
  const verdict = gscVerdict(resolved);
  const gscQueryPage = connected ? verdict.ledgerRows : [];
  const reads: BriefRunMeta["reads"] = {
    serp: serpRead,
    crawl: crawlRead,
    gsc: gscRead(resolved, verdict),
    product_profile: connected
      ? { status: "complete", website_id: "web_01J6FIXTURE", snapshot_revision: 3, profile_hash: "sha256:profile-3" }
      : unavailableOf("not_requested", null),
    llm,
  };
  const derived: Origin[] = modelDerivedFrom(facts, gscPages);

  const intent = buildIntentField(serpRows, serpRead, primary);
  const format = buildFormatField(serpRows, serpRead);
  const length = buildLengthField(observed, crawlRead, language);
  const draft = buildMustAnswerDraft({ serp: serpRows, observed, crawlReads: crawlRead, language });
  const mustAnswer = modelQuestions(draft.field, derived, llm);
  const outline = outlineFrom(mustAnswer, derived, llm);
  const gapAngle = gapAngleFor(resolved, derived, llm, observed.map((page) => page.id));
  const { internal_links, do_not_cover } = pageFieldsFor(resolved, derived, llm);
  const fields = [intent, format, length, mustAnswer, outline, gapAngle, internal_links, do_not_cover];

  return {
    schema: CONTENT_BRIEF_SCHEMA,
    run: {
      run_id: "brief_01J6FIXTURE000000000000001",
      collected_at: COLLECTED_AT,
      elapsed_ms: 21_340,
      budget_ms: RUN_BUDGET_MS,
      mode: deriveBriefRunMode({ reads, fields }),
      reads,
      fingerprint: "",
    },
    keyword: { primary, supporting: ["email deliverability", "warm up email domain"], market: "US", language },
    evidence: {
      serp: serpRows,
      crawl: { observed, failed, skipped },
      profile: facts === null ? null : { facts },
      gsc_query_page: gscQueryPage,
      gsc_pages: gscPages,
    },
    verdict: verdictFor(resolved, verdict),
    intent,
    format,
    length,
    must_answer: mustAnswer,
    outline,
    gap_angle: gapAngle,
    internal_links,
    do_not_cover,
    draft_readiness: buildDraftReadiness({ outline, profile: reads.product_profile, gsc: reads.gsc, llm }),
    budget: {
      outline_cap: OUTLINE_CAP,
      must_answer_cap: MUST_ANSWER_CAP,
      must_answer_min_pages: MUST_ANSWER_MIN_PAGES,
      must_answer_candidates: draft.candidates,
      must_answer_shown: mustAnswer.status === "available" ? mustAnswer.items.length : 0,
      must_answer_hidden: draft.hidden,
    },
  };
}

/**
 * 10 SERP rows, 6 observed pages (2 truncated), 3 failed, 1 skipped same_host;
 * GSC and product profile not requested; LLM complete; 4 must-answer
 * questions; 3 outline sections. `run.fingerprint` is left empty: stamp it
 * with `withFingerprint` before feeding the brief to `parseContentBrief`.
 */
export function validContentBrief(overrides?: DeepPartial<ContentBrief>): ContentBrief {
  const base = contentBriefFixture();
  return overrides === undefined ? base : (mergeDeep(base, overrides) as ContentBrief);
}

/** Same run with GSC and the product profile connected. */
export function validConnectedContentBrief(): ContentBrief {
  return contentBriefFixture({ connected: true });
}

/** Stamps the real `run.fingerprint` so the brief passes `parseContentBrief`. */
export async function withFingerprint(brief: ContentBrief): Promise<ContentBrief> {
  const fingerprint = await briefFingerprint(brief);
  return { ...brief, run: { ...brief.run, fingerprint } };
}
