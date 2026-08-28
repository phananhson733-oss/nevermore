// @input  -- the per-source reads and evidence a brief run collected
// @output -- the derived fields and the assembled, fingerprinted ContentBrief
// @pos    -- the only place brief fields are derived; pure, deterministic, clock-free
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { briefFingerprint } from "./canonical.ts";
import { classifyIntent, classifySerpFormat, registrableLabel } from "./classify.ts";
import {
  clusterHeadings,
  selectMustAnswer,
  type HeadingCluster,
  type HeadingInput,
} from "./cluster.ts";
import {
  CRAWL_MIN_FOR_LENGTH,
  DO_NOT_COVER_CAP,
  FORMAT_PLURALITY_MIN,
  INTENT_CONFIRMED_MIN_RATIO,
  NAVIGATIONAL_BRAND_MIN_CHARS,
  INTERNAL_LINKS_CAP,
  MUST_ANSWER_CAP,
  MUST_ANSWER_MIN_PAGES,
  OUTLINE_CAP,
  OUTLINE_MIN_QUESTIONS,
  SERP_DEPTH,
  isWhitespaceTokenizedLanguage,
} from "./constants.ts";
import {
  CONTENT_BRIEF_SCHEMA,
  type BriefGscPageRow,
  type BriefGscQueryPageRow,
  type BriefRunMeta,
  type ClassifiedSerpFormat,
  type ContentBrief,
  type CrawlFailure,
  type CrawlObservation,
  type CrawlReadMeta,
  type CrawlSkipped,
  type DoNotCoverField,
  type DraftReadiness,
  type FormatField,
  type GapAngleField,
  type GapKind,
  type GscReadMeta,
  type IntentField,
  type InternalLinksField,
  type LengthField,
  type LlmReadMeta,
  type ModelBriefOutput,
  type MustAnswerField,
  type MustAnswerItem,
  type Origin,
  type OutlineField,
  type OutlineItem,
  type ProfileFact,
  type ProfileReadMeta,
  type RunMode,
  type SerpObservation,
  type SerpReadMeta,
  type Unavailable,
  type Verdict,
} from "./contract.ts";

/**
 * Why this module is pure.
 *
 * Every field on a brief is a function of what was read. Deriving them here,
 * with no clock, no randomness and no I/O, is what lets the fingerprint mean
 * something: two runs that read the same evidence assemble byte-identical
 * briefs, and the draft side can recompute the hash to prove nothing was
 * edited in between. The handler owns the reads; this module owns the truth
 * table that turns reads into fields, including every "unavailable" branch.
 */

/* ------------------------------------------------------------------ */
/* SERP → observations, crawl plan                                      */
/* ------------------------------------------------------------------ */

export interface SerpRowInput {
  readonly rank: number;
  readonly url: string | null;
  readonly domain: string;
  readonly title: string | null;
}

export function buildSerpObservations(
  rows: readonly SerpRowInput[],
): SerpObservation[] {
  return rows.map((row, index) => {
    const format = classifySerpFormat({
      url: row.url,
      title: row.title,
      domain: row.domain,
    });
    return {
      id: `S${index + 1}`,
      rank: row.rank,
      url: row.url,
      domain: row.domain,
      title: row.title,
      format: {
        value: format.value,
        method: "heuristic",
        rules_hit: [...format.rules_hit],
      },
    };
  });
}

export interface CrawlPlan {
  readonly targets: readonly {
    readonly serp_id: string;
    readonly url: string;
  }[];
  readonly skipped: readonly CrawlSkipped[];
}

/**
 * Same-host rows are collapsed onto the best-ranked one: the host's anti-relay
 * quota is shared by every caller, and two pages of one site say the same
 * thing about format. Rows without a URL cannot be fetched at all.
 */
export function planCrawlTargets(
  serp: readonly SerpObservation[],
  hostKeyOf: (url: string) => string | null,
): CrawlPlan {
  const keptByHost = new Map<string, string>();
  const targets: { serp_id: string; url: string }[] = [];
  const skipped: CrawlSkipped[] = [];
  const ordered = [...serp].sort((a, b) => a.rank - b.rank);
  for (const row of ordered) {
    if (row.url === null) {
      skipped.push({ serp_id: row.id, reason: "no_url", kept_serp_id: null });
      continue;
    }
    const host = hostKeyOf(row.url) ?? row.url;
    const kept = keptByHost.get(host);
    if (kept !== undefined) {
      skipped.push({
        serp_id: row.id,
        reason: "same_host",
        kept_serp_id: kept,
      });
      continue;
    }
    keptByHost.set(host, row.id);
    targets.push({ serp_id: row.id, url: row.url });
  }
  return { targets, skipped };
}

/**
 * `started` means the crawl stage was entered, i.e. the SERP read succeeded.
 * A SERP whose rows were all skipped (no URL / same host) still yields the
 * available branch with everything counted under `skipped` — skipping is a
 * decision, not a failure to read.
 */
export function buildCrawlReadMeta(input: {
  readonly serpReturned: number;
  readonly observed: readonly CrawlObservation[];
  readonly failed: readonly CrawlFailure[];
  readonly skipped: readonly CrawlSkipped[];
  readonly started: boolean;
}): CrawlReadMeta {
  if (!input.started) {
    return {
      status: "unavailable",
      reason: "insufficient_evidence",
      attempted: 0,
    };
  }
  const truncated = input.observed.filter((page) => !page.body_complete).length;
  return {
    status: truncated > 0 || input.failed.length > 0 ? "partial" : "complete",
    attempted: input.serpReturned,
    observed: input.observed.length,
    truncated,
    failed: input.failed.length,
    skipped: input.skipped.length,
  };
}

/* ------------------------------------------------------------------ */
/* format / intent / length                                              */
/* ------------------------------------------------------------------ */

const CLASSIFIED_FORMATS: readonly ClassifiedSerpFormat[] = [
  "guide",
  "listicle",
  "comparison",
  "product_page",
  "tool",
  "forum",
  "video",
  "news",
];

function unavailable(
  reason: Unavailable["reason"],
  attempted: number | null,
): Unavailable {
  return { status: "unavailable", reason, attempted };
}

export function buildFormatField(
  serp: readonly SerpObservation[],
  serpReads: SerpReadMeta,
): FormatField {
  if (serpReads.status === "unavailable") {
    return unavailable(serpReads.reason, serpReads.attempted);
  }
  const distribution = Object.fromEntries(
    CLASSIFIED_FORMATS.map((format) => [format, 0]),
  ) as Record<ClassifiedSerpFormat, number>;
  let unknownCount = 0;
  for (const row of serp) {
    if (row.format.value === "unknown") {
      unknownCount += 1;
    } else {
      distribution[row.format.value] += 1;
    }
  }
  const classified = serpReads.returned - unknownCount;
  if (classified <= 0) {
    return unavailable("insufficient_evidence", serpReads.returned);
  }
  const max = Math.max(
    ...CLASSIFIED_FORMATS.map((format) => distribution[format]),
  );
  const values = CLASSIFIED_FORMATS.filter(
    (format) => distribution[format] === max,
  );
  const [first, ...rest] = values;
  if (first === undefined) {
    return unavailable("insufficient_evidence", serpReads.returned);
  }
  return {
    status: "available",
    values: [first, ...rest],
    distribution,
    unknown_count: unknownCount,
    classified,
    plurality_threshold: FORMAT_PLURALITY_MIN,
    has_plurality: max >= FORMAT_PLURALITY_MIN,
    provenance: { method: "heuristic", origin: "dataforseo_serp" },
  };
}

export function buildIntentField(
  serp: readonly SerpObservation[],
  serpReads: SerpReadMeta,
  primary: string,
): IntentField {
  if (serpReads.status === "unavailable") {
    return unavailable(serpReads.reason, serpReads.attempted);
  }
  const intent = classifyIntent(
    serp.map((row) => ({
      rank: row.rank,
      format: row.format.value,
      title: row.title,
      domain: row.domain,
      url: row.url,
    })),
    primary,
  );
  if (intent === null) {
    return unavailable("insufficient_evidence", serpReads.returned);
  }
  const confirmed =
    serpReads.returned === SERP_DEPTH &&
    intent.matched / serpReads.returned >= INTENT_CONFIRMED_MIN_RATIO &&
    !intent.tie;
  return {
    status: "available",
    value: intent.value,
    matched: intent.matched,
    confidence: confirmed ? "confirmed" : "provisional",
    provenance: { method: "heuristic", origin: "dataforseo_serp" },
    rules_hit: [...intent.rules_hit],
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return Math.round(
    lowerValue + (upperValue - lowerValue) * (position - lower),
  );
}

export function buildLengthField(
  observed: readonly CrawlObservation[],
  crawlReads: CrawlReadMeta,
  language: string,
): LengthField {
  if (!isWhitespaceTokenizedLanguage(language)) {
    return unavailable("unsupported_language", null);
  }
  if (crawlReads.status === "unavailable") {
    return unavailable("insufficient_evidence", 0);
  }
  const counts = observed
    .filter((page) => page.body_complete && page.word_count !== null)
    .map((page) => page.word_count as number)
    .sort((a, b) => a - b);
  if (counts.length < CRAWL_MIN_FOR_LENGTH) {
    return unavailable("insufficient_evidence", counts.length);
  }
  return {
    status: "available",
    p25: percentile(counts, 0.25),
    median: percentile(counts, 0.5),
    p75: percentile(counts, 0.75),
    pages_counted: counts.length,
    tokenizer: "whitespace",
    provenance: { method: "observed", origin: "crawl" },
  };
}

/* ------------------------------------------------------------------ */
/* must_answer                                                          */
/* ------------------------------------------------------------------ */

export interface MustAnswerDraft {
  readonly field: MustAnswerField;
  /** The selected clusters with their assigned Q ids, in display order. */
  readonly selected: readonly (HeadingCluster & { readonly id: string })[];
  readonly candidates: number;
  readonly hidden: number;
}

function brandTokensOf(observed: readonly CrawlObservation[]): string[] {
  const tokens = new Set<string>();
  for (const page of observed) {
    try {
      const host = new URL(page.final_url).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      const label = registrableLabel(host);
      if (label !== null && label.length >= NAVIGATIONAL_BRAND_MIN_CHARS) tokens.add(label);
    } catch {
      // A page that reached the ledger has a parseable final URL; ignore otherwise.
    }
  }
  return [...tokens].sort();
}

export function buildMustAnswerDraft(input: {
  readonly serp: readonly SerpObservation[];
  readonly observed: readonly CrawlObservation[];
  readonly crawlReads: CrawlReadMeta;
  readonly language: string;
}): MustAnswerDraft {
  const empty = (field: MustAnswerField): MustAnswerDraft => ({
    field,
    selected: [],
    candidates: 0,
    hidden: 0,
  });
  if (!isWhitespaceTokenizedLanguage(input.language)) {
    return empty(unavailable("unsupported_language", null));
  }
  if (input.crawlReads.status === "unavailable") {
    return empty(unavailable("insufficient_evidence", 0));
  }
  if (input.crawlReads.observed < MUST_ANSWER_MIN_PAGES) {
    return empty(
      unavailable("insufficient_evidence", input.crawlReads.observed),
    );
  }
  const rankBySerp = new Map(
    input.serp.map((row) => [row.id, row.rank] as const),
  );
  const headings: HeadingInput[] = [];
  const brandTokens = brandTokensOf(input.observed);
  for (const page of input.observed) {
    const rank = rankBySerp.get(page.serp_id) ?? Number(page.id.slice(1));
    for (const heading of page.h2) {
      headings.push({ observation_id: page.id, rank, heading, level: "h2" });
    }
    for (const heading of page.h3) {
      headings.push({ observation_id: page.id, rank, heading, level: "h3" });
    }
  }
  const clusters = clusterHeadings(headings, input.language, brandTokens);
  const selection = selectMustAnswer(clusters);
  const selected = selection.selected.map((cluster, index) => ({
    ...cluster,
    id: `Q${index + 1}`,
  }));
  const items: MustAnswerItem[] = selected.map((cluster) => {
    const [firstMember, ...restMembers] = cluster.members;
    if (firstMember === undefined) {
      throw new Error("a selected cluster cannot be empty");
    }
    return {
      id: cluster.id,
      q: cluster.canonical_heading,
      q_provenance: { method: "heuristic", origin: "crawl" },
      cluster: {
        canonical_heading: cluster.canonical_heading,
        members: [firstMember, ...restMembers],
      },
      covered_by: cluster.covered_by,
    };
  });
  return {
    field: { status: "available", items },
    selected,
    candidates: selection.candidates,
    hidden: selection.hidden,
  };
}

/* ------------------------------------------------------------------ */
/* model output → fields                                                 */
/* ------------------------------------------------------------------ */

export interface ModelApplication {
  readonly must_answer: MustAnswerField;
  readonly outline: OutlineField;
  readonly gap_angle: GapAngleField;
  readonly internal_links: InternalLinksField;
  readonly do_not_cover: DoNotCoverField;
}

export interface ApplyModelInput {
  readonly mustAnswer: MustAnswerField;
  readonly output: ModelBriefOutput | null;
  readonly llm: LlmReadMeta;
  readonly profile: ProfileReadMeta;
  /** null when no profile was read; an empty list is a confirmed profile with nothing usable. */
  readonly profileFacts: readonly ProfileFact[] | null;
  /** = run.reads.crawl.observed; the gap angle is unavailable without competitor pages. */
  readonly observedCount: number;
  readonly gsc: GscReadMeta;
  readonly gscPages: readonly BriefGscPageRow[];
}

/** Over-cap model output is a validation failure, never a truncation (contract budget note). */
function overCap(length: number): Unavailable {
  return unavailable("validation_failed", length);
}

function llmUnavailable(llm: LlmReadMeta): Unavailable {
  return llm.status === "unavailable"
    ? unavailable(llm.reason, llm.attempted)
    : unavailable("validation_failed", llm.calls);
}

/**
 * What the one model call was actually fed. Computed here from the inputs,
 * never accepted from a caller: provenance that can be asserted is provenance
 * that can lie.
 */
export function modelDerivedFrom(
  profileFacts: readonly ProfileFact[] | null,
  gscPages: readonly BriefGscPageRow[],
): Origin[] {
  const origins: Origin[] = ["crawl", "user_input"];
  if (profileFacts !== null && profileFacts.length > 0) origins.push("product_profile");
  if (gscPages.length > 0) origins.push("gsc");
  return origins;
}

/**
 * The model's answer is applied field by field. A field whose prerequisite is
 * missing (no profile, no pages, too few questions) is unavailable for that
 * reason regardless of what the model said; a field whose prerequisite is met
 * but whose answer never arrived inherits the LLM read's reason.
 */
export function applyModelOutput(input: ApplyModelInput): ModelApplication {
  const { output, llm } = input;
  const derived = modelDerivedFrom(input.profileFacts, input.gscPages);
  const questionsAvailable =
    input.mustAnswer.status === "available" ? input.mustAnswer.items.length : 0;

  const mustAnswer: MustAnswerField =
    input.mustAnswer.status === "available" && output !== null
      ? {
          status: "available",
          items: input.mustAnswer.items.map((item) => {
            const answer = output.questions.find((q) => q.id === item.id);
            return answer === undefined
              ? item
              : {
                  ...item,
                  q: answer.q,
                  q_provenance: { method: "model", derived_from: derived },
                };
          }),
        }
      : input.mustAnswer;

  const outline: OutlineField = (() => {
    if (input.mustAnswer.status === "unavailable") {
      return unavailable(input.mustAnswer.reason, input.mustAnswer.attempted);
    }
    if (questionsAvailable < OUTLINE_MIN_QUESTIONS) {
      return unavailable("insufficient_evidence", questionsAvailable);
    }
    if (output === null || output.outline === null) return llmUnavailable(llm);
    if (output.outline.length > OUTLINE_CAP) return overCap(output.outline.length);
    const items = output.outline.map((section, index) => {
      const [firstAnswer, ...restAnswers] = section.answers;
      if (firstAnswer === undefined) {
        throw new Error("validated outline sections carry at least one answer");
      }
      const item: OutlineItem = {
        id: `O${index + 1}`,
        h2: section.h2,
        h3: [...section.h3],
        answers: [firstAnswer, ...restAnswers],
        provenance: { method: "model", derived_from: derived },
      };
      return item;
    });
    const [first, ...rest] = items;
    if (first === undefined) return llmUnavailable(llm);
    return { status: "available", items: [first, ...rest] };
  })();

  const gapAngle: GapAngleField = (() => {
    if (input.profile.status === "unavailable") {
      return unavailable(input.profile.reason, input.profile.attempted);
    }
    if (input.profileFacts === null || input.profileFacts.length === 0) {
      return unavailable("insufficient_evidence", 0);
    }
    // "Competitors do not cover this" needs competitors: no observed page, no claim.
    if (input.observedCount === 0) {
      return unavailable("insufficient_evidence", 0);
    }
    if (output === null || output.gap_angle === null)
      return llmUnavailable(llm);
    const [firstRef, ...restRefs] = output.gap_angle.profile_fact_refs;
    if (firstRef === undefined) return llmUnavailable(llm);
    return {
      status: "available",
      value: output.gap_angle.value,
      rationale: output.gap_angle.rationale,
      provenance: { method: "model", derived_from: derived },
      profile_fact_refs: [firstRef, ...restRefs],
      checked_against: [...output.gap_angle.checked_against],
    };
  })();

  const pagesUnavailable = (): Unavailable | null => {
    if (input.gsc.status === "unavailable") {
      return unavailable(input.gsc.reason, input.gsc.attempted);
    }
    if (input.gscPages.length === 0) {
      return input.gsc.unreadable_rows.page > 0
        ? unavailable("provider_error", input.gsc.unreadable_rows.page)
        : unavailable("insufficient_evidence", 0);
    }
    return null;
  };

  const internalLinks: InternalLinksField = (() => {
    const blocked = pagesUnavailable();
    if (blocked !== null) return blocked;
    if (output === null || output.internal_links === null)
      return llmUnavailable(llm);
    if (output.internal_links.length > INTERNAL_LINKS_CAP)
      return overCap(output.internal_links.length);
    return {
      status: "available",
      items: output.internal_links.map((item) => ({
        page_ref: item.page_ref,
        why: item.why,
        why_provenance: { method: "model", derived_from: derived },
      })),
    };
  })();

  const doNotCover: DoNotCoverField = (() => {
    const blocked = pagesUnavailable();
    if (blocked !== null) return blocked;
    if (output === null || output.do_not_cover === null)
      return llmUnavailable(llm);
    if (output.do_not_cover.length > DO_NOT_COVER_CAP)
      return overCap(output.do_not_cover.length);
    return {
      status: "available",
      items: output.do_not_cover.map((item) => ({
        page_ref: item.page_ref,
        topic: item.topic,
        topic_provenance: { method: "model", derived_from: derived },
      })),
    };
  })();

  return {
    must_answer: mustAnswer,
    outline,
    gap_angle: gapAngle,
    internal_links: internalLinks,
    do_not_cover: doNotCover,
  };
}

/* ------------------------------------------------------------------ */
/* readiness / mode                                                      */
/* ------------------------------------------------------------------ */

export function buildDraftReadiness(input: {
  readonly outline: OutlineField;
  readonly profile: ProfileReadMeta;
  readonly gsc: GscReadMeta;
  readonly llm: LlmReadMeta;
}): DraftReadiness {
  const gaps: GapKind[] = [];
  if (input.profile.status !== "complete") gaps.push("no_product_profile");
  if (input.gsc.status === "unavailable") gaps.push("no_gsc");
  if (input.llm.status === "unavailable") {
    gaps.push("llm_unavailable");
  } else if (input.outline.status === "unavailable") {
    gaps.push("no_outline");
  }
  return {
    writable:
      input.outline.status === "available"
        ? input.outline.items.map((item) => item.id)
        : [],
    gaps,
  };
}

const MODE_DEGRADING_REASONS: ReadonlySet<Unavailable["reason"]> = new Set([
  "timeout",
  "provider_error",
  "not_configured",
  "validation_failed",
  "unsupported_language",
]);

/** Every derived field is either available or a full Unavailable record. */
export type DerivableField = { readonly status: "available" } | Unavailable;

function fieldDegrades(field: DerivableField): boolean {
  return (
    field.status === "unavailable" && MODE_DEGRADING_REASONS.has(field.reason)
  );
}

export function deriveBriefRunMode(input: {
  readonly reads: BriefRunMeta["reads"];
  readonly fields: readonly DerivableField[];
}): RunMode {
  const { reads } = input;
  if (reads.serp.status === "unavailable") return "unavailable";
  const requestedReads = [
    reads.crawl,
    reads.gsc,
    reads.product_profile,
    reads.llm,
  ];
  const degradedRead = requestedReads.some(
    (read) => read.status === "unavailable" && read.reason !== "not_requested",
  );
  if (degradedRead || input.fields.some(fieldDegrades)) return "degraded";
  const partialRead =
    reads.serp.status === "partial" ||
    reads.crawl.status === "partial" ||
    reads.gsc.status === "partial";
  return partialRead ? "partial" : "complete";
}

/* ------------------------------------------------------------------ */
/* assemble                                                              */
/* ------------------------------------------------------------------ */

export interface AssembleContentBriefInput {
  readonly run: {
    readonly run_id: string;
    readonly collected_at: string;
    readonly elapsed_ms: number;
    readonly budget_ms: number;
  };
  readonly keyword: ContentBrief["keyword"];
  readonly reads: BriefRunMeta["reads"];
  readonly serp: readonly SerpObservation[];
  readonly crawl: {
    readonly observed: readonly CrawlObservation[];
    readonly failed: readonly CrawlFailure[];
    readonly skipped: readonly CrawlSkipped[];
  };
  readonly profileFacts: readonly ProfileFact[] | null;
  readonly gscQueryPage: readonly BriefGscQueryPageRow[];
  readonly gscPages: readonly BriefGscPageRow[];
  readonly verdict: Verdict;
  /** Built by buildMustAnswerDraft from the same serp/crawl inputs. */
  readonly mustAnswer: MustAnswerDraft;
  readonly model: {
    readonly output: ModelBriefOutput | null;
  };
}

export async function assembleContentBrief(
  input: AssembleContentBriefInput,
): Promise<ContentBrief> {
  const format = buildFormatField(input.serp, input.reads.serp);
  const intent = buildIntentField(
    input.serp,
    input.reads.serp,
    input.keyword.primary,
  );
  const length = buildLengthField(
    input.crawl.observed,
    input.reads.crawl,
    input.keyword.language,
  );
  const applied = applyModelOutput({
    mustAnswer: input.mustAnswer.field,
    output: input.model.output,
    llm: input.reads.llm,
    profile: input.reads.product_profile,
    profileFacts: input.profileFacts,
    observedCount: input.crawl.observed.length,
    gsc: input.reads.gsc,
    gscPages: input.gscPages,
  });
  const draftReadiness = buildDraftReadiness({
    outline: applied.outline,
    profile: input.reads.product_profile,
    gsc: input.reads.gsc,
    llm: input.reads.llm,
  });
  const mode = deriveBriefRunMode({
    reads: input.reads,
    fields: [
      intent,
      format,
      length,
      applied.must_answer,
      applied.outline,
      applied.gap_angle,
      applied.internal_links,
      applied.do_not_cover,
    ],
  });
  const shown =
    applied.must_answer.status === "available"
      ? applied.must_answer.items.length
      : 0;
  const withoutFingerprint: ContentBrief = {
    schema: CONTENT_BRIEF_SCHEMA,
    run: {
      run_id: input.run.run_id,
      collected_at: input.run.collected_at,
      elapsed_ms: input.run.elapsed_ms,
      budget_ms: input.run.budget_ms,
      mode,
      reads: input.reads,
      fingerprint: "",
    },
    keyword: { ...input.keyword, supporting: [...input.keyword.supporting] },
    evidence: {
      serp: [...input.serp],
      crawl: {
        observed: [...input.crawl.observed],
        failed: [...input.crawl.failed],
        skipped: [...input.crawl.skipped],
      },
      profile:
        input.reads.product_profile.status === "complete" &&
        input.profileFacts !== null
          ? { facts: [...input.profileFacts] }
          : null,
      gsc_query_page: [...input.gscQueryPage],
      gsc_pages: [...input.gscPages],
    },
    verdict: input.verdict,
    intent,
    format,
    length,
    must_answer: applied.must_answer,
    outline: applied.outline,
    gap_angle: applied.gap_angle,
    internal_links: applied.internal_links,
    do_not_cover: applied.do_not_cover,
    draft_readiness: draftReadiness,
    budget: {
      outline_cap: OUTLINE_CAP,
      must_answer_cap: MUST_ANSWER_CAP,
      must_answer_min_pages: MUST_ANSWER_MIN_PAGES,
      must_answer_candidates: input.mustAnswer.candidates,
      must_answer_shown: shown,
      must_answer_hidden: input.mustAnswer.hidden,
    },
  };
  const fingerprint = await briefFingerprint(withoutFingerprint);
  return {
    ...withoutFingerprint,
    run: { ...withoutFingerprint.run, fingerprint },
  };
}
