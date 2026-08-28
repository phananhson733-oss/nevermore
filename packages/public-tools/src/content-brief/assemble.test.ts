// @input  -- hand-built reads and evidence for one brief run
// @output -- proof every derived field follows the contract's truth table
// @pos    -- the assembly engine's unit tests
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  applyModelOutput,
  assembleContentBrief,
  buildCrawlReadMeta,
  buildDraftReadiness,
  buildFormatField,
  buildIntentField,
  buildLengthField,
  buildMustAnswerDraft,
  buildSerpObservations,
  deriveBriefRunMode,
  planCrawlTargets,
  type AssembleContentBriefInput,
} from "./assemble.ts";
import { briefFingerprint } from "./canonical.ts";
import {
  CRAWL_MIN_FOR_LENGTH,
  FORMAT_PLURALITY_MIN,
  MUST_ANSWER_CAP,
  MUST_ANSWER_MIN_PAGES,
  OUTLINE_MIN_QUESTIONS,
  SERP_DEPTH,
} from "./constants.ts";
import type {
  BriefRunMeta,
  CrawlObservation,
  LlmReadMeta,
  ModelBriefOutput,
  SerpObservation,
  SerpReadMeta,
} from "./contract.ts";

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

function serpRows(count: number, host = (i: number) => `site${i}.example`) {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    url: `https://${host(index + 1)}/blog/how-to-brew-coffee-${index + 1}`,
    domain: host(index + 1),
    title: `How to brew coffee ${index + 1}`,
  }));
}

function serpComplete(returned = SERP_DEPTH): SerpReadMeta {
  return { status: returned === SERP_DEPTH ? "complete" : "partial", requested: SERP_DEPTH, returned, unresolved: 0 };
}

function page(
  id: number,
  overrides: Partial<CrawlObservation> & { readonly h2?: string[] } = {},
): CrawlObservation {
  const base = {
    id: `C${id}`,
    serp_id: `S${id}`,
    url: `https://site${id}.example/blog/how-to-brew-coffee-${id}`,
    final_url: `https://site${id}.example/blog/how-to-brew-coffee-${id}`,
    fetched_at: "2026-08-29T00:00:00.000Z",
    h2: ["What is pour over coffee", "How much coffee per cup", "Water temperature"],
    h3: [],
    excerpts: [
      { heading: "What is pour over coffee", level: "h2" as const, text: "Pour over is a manual method." },
    ],
    content_hash: `hash-${id}`,
  };
  if (overrides.body_complete === false) {
    return { ...base, ...overrides, body_complete: false, word_count: null };
  }
  const { body_complete: _ignored, word_count, ...rest } = overrides;
  return { ...base, ...rest, body_complete: true, word_count: word_count ?? 900 + id * 100 };
}

const LLM_COMPLETE: LlmReadMeta = {
  status: "complete",
  calls: 1,
  model_id: "gpt-test",
  temperature_requested: 0.2,
  temperature_effective: null,
  input_tokens: 100,
  output_tokens: 50,
};

function baseReads(overrides: Partial<BriefRunMeta["reads"]> = {}): BriefRunMeta["reads"] {
  return {
    serp: serpComplete(),
    crawl: { status: "complete", attempted: SERP_DEPTH, observed: 6, truncated: 0, failed: 0, skipped: 4 },
    gsc: { status: "unavailable", reason: "not_requested", attempted: null },
    product_profile: { status: "unavailable", reason: "not_requested", attempted: null },
    llm: LLM_COMPLETE,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* serp / crawl plan                                                    */
/* ------------------------------------------------------------------ */

describe("buildSerpObservations", () => {
  it("numbers rows S1..Sn and classifies each with the heuristic ruleset", () => {
    const serp = buildSerpObservations(serpRows(3));
    expect(serp.map((row) => row.id)).toEqual(["S1", "S2", "S3"]);
    expect(serp[0]?.format.method).toBe("heuristic");
    expect(serp[0]?.format.value).toBe("guide");
  });
});

describe("planCrawlTargets", () => {
  it("keeps the best-ranked page per host and records the rest as skipped", () => {
    const serp = buildSerpObservations([
      ...serpRows(2, () => "same.example"),
      { rank: 3, url: null, domain: "nourl.example", title: "x" },
    ]);
    const plan = planCrawlTargets(serp, (url) => new URL(url).host);
    expect(plan.targets).toEqual([{ serp_id: "S1", url: serp[0]?.url }]);
    expect(plan.skipped).toEqual([
      { serp_id: "S2", reason: "same_host", kept_serp_id: "S1" },
      { serp_id: "S3", reason: "no_url", kept_serp_id: null },
    ]);
  });
});

describe("buildCrawlReadMeta", () => {
  it("is unavailable only when nothing was attempted", () => {
    expect(buildCrawlReadMeta({ serpReturned: 0, observed: [], failed: [], skipped: [], started: false })).toEqual({
      status: "unavailable",
      reason: "insufficient_evidence",
      attempted: 0,
    });
  });

  it("is partial on truncation or failure, never on skips alone", () => {
    const skipped = [{ serp_id: "S2", reason: "same_host" as const, kept_serp_id: "S1" }];
    expect(
      buildCrawlReadMeta({ serpReturned: 2, observed: [page(1)], failed: [], skipped, started: true }).status,
    ).toBe("complete");
    expect(
      buildCrawlReadMeta({
        serpReturned: 2,
        observed: [page(1, { body_complete: false })],
        failed: [],
        skipped,
        started: true,
      }),
    ).toMatchObject({ status: "partial", truncated: 1, observed: 1, skipped: 1, attempted: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* format / intent / length                                              */
/* ------------------------------------------------------------------ */

describe("buildFormatField", () => {
  it("returns every tied top format and reports plurality against the threshold", () => {
    const serp: SerpObservation[] = buildSerpObservations(serpRows(10)).map((row, index) => ({
      ...row,
      format: {
        value: index < 3 ? "guide" : index < 6 ? "listicle" : index < 9 ? "comparison" : "tool",
        method: "heuristic",
        rules_hit: [],
      },
    }));
    const field = buildFormatField(serp, serpComplete());
    expect(field.status).toBe("available");
    if (field.status !== "available") return;
    expect(field.values).toEqual(["guide", "listicle", "comparison"]);
    expect(field.has_plurality).toBe(false);
    expect(field.plurality_threshold).toBe(FORMAT_PLURALITY_MIN);
    expect(field.classified).toBe(10);
  });

  it("is unavailable when no row could be classified", () => {
    const serp = buildSerpObservations(serpRows(2)).map((row) => ({
      ...row,
      format: { value: "unknown" as const, method: "heuristic" as const, rules_hit: [] },
    }));
    expect(buildFormatField(serp, serpComplete(2))).toEqual({
      status: "unavailable",
      reason: "insufficient_evidence",
      attempted: 2,
    });
  });

  it("inherits the SERP read's unavailability", () => {
    expect(buildFormatField([], { status: "unavailable", reason: "timeout", attempted: 10 })).toMatchObject({
      status: "unavailable",
      reason: "timeout",
    });
  });
});

describe("buildIntentField", () => {
  it("confirms only a full SERP with a clear majority", () => {
    const serp = buildSerpObservations(serpRows(10));
    const field = buildIntentField(serp, serpComplete(), "brew coffee");
    expect(field.status).toBe("available");
    if (field.status !== "available") return;
    expect(field.value).toBe("informational");
    expect(field.confidence).toBe("confirmed");
    expect(field.matched).toBe(10);
  });

  it("stays provisional on a short SERP", () => {
    const serp = buildSerpObservations(serpRows(4));
    const field = buildIntentField(serp, serpComplete(4), "brew coffee");
    expect(field).toMatchObject({ status: "available", confidence: "provisional" });
  });
});

describe("buildLengthField", () => {
  const crawl = { status: "complete" as const, attempted: 10, observed: 6, truncated: 0, failed: 0, skipped: 4 };

  it("needs the minimum number of complete pages", () => {
    const pages = [1, 2, 3, 4].map((id) => page(id));
    expect(buildLengthField(pages, crawl, "en")).toEqual({
      status: "unavailable",
      reason: "insufficient_evidence",
      attempted: 4,
    });
    expect(CRAWL_MIN_FOR_LENGTH).toBe(5);
  });

  it("excludes truncated pages from the count", () => {
    const pages = [1, 2, 3, 4, 5].map((id) => page(id)).concat(page(6, { body_complete: false }));
    const field = buildLengthField(pages, crawl, "en");
    expect(field).toMatchObject({ status: "available", pages_counted: 5, tokenizer: "whitespace" });
    if (field.status !== "available") return;
    expect(field.p25).toBeLessThanOrEqual(field.median);
    expect(field.median).toBeLessThanOrEqual(field.p75);
  });

  it("refuses non-whitespace languages before counting anything", () => {
    expect(buildLengthField([1, 2, 3, 4, 5, 6].map((id) => page(id)), crawl, "zh")).toMatchObject({
      status: "unavailable",
      reason: "unsupported_language",
    });
  });
});

/* ------------------------------------------------------------------ */
/* must_answer                                                          */
/* ------------------------------------------------------------------ */

describe("buildMustAnswerDraft", () => {
  const serp = buildSerpObservations(serpRows(10));

  it("clusters shared headings, assigns Q ids in order and reports the budget", () => {
    const observed = [1, 2, 3, 4, 5, 6].map((id) => page(id));
    const crawlReads = { status: "complete" as const, attempted: 10, observed: 6, truncated: 0, failed: 0, skipped: 4 };
    const draft = buildMustAnswerDraft({ serp, observed, crawlReads, language: "en" });
    expect(draft.field.status).toBe("available");
    if (draft.field.status !== "available") return;
    expect(draft.field.items.length).toBeGreaterThan(0);
    expect(draft.field.items.length).toBeLessThanOrEqual(MUST_ANSWER_CAP);
    expect(draft.field.items[0]?.id).toBe("Q1");
    expect(draft.field.items[0]?.covered_by).toBeGreaterThanOrEqual(MUST_ANSWER_MIN_PAGES);
    expect(draft.field.items[0]?.q_provenance).toEqual({ method: "heuristic", origin: "crawl" });
    expect(draft.selected.map((cluster) => cluster.id)).toEqual(draft.field.items.map((item) => item.id));
  });

  it("is unavailable below the page floor, with the observed count as attempted", () => {
    const crawlReads = { status: "partial" as const, attempted: 10, observed: 2, truncated: 0, failed: 8, skipped: 0 };
    const draft = buildMustAnswerDraft({ serp, observed: [page(1), page(2)], crawlReads, language: "en" });
    expect(draft.field).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* model application                                                    */
/* ------------------------------------------------------------------ */

function mustAnswerWith(count: number) {
  return {
    status: "available" as const,
    items: Array.from({ length: count }, (_, index) => ({
      id: `Q${index + 1}`,
      q: `heading ${index + 1}`,
      q_provenance: { method: "heuristic" as const, origin: "crawl" as const },
      cluster: {
        canonical_heading: `heading ${index + 1}`,
        members: [{ observation_id: "C1", heading: `Heading ${index + 1}`, level: "h2" as const }] as [
          { observation_id: string; heading: string; level: "h2" | "h3" },
        ],
      },
      covered_by: 3,
    })),
  };
}

const MODEL_OUTPUT: ModelBriefOutput = {
  questions: [{ id: "Q1", q: "What is pour over coffee?" }],
  outline: [
    { h2: "Getting started", h3: [], answers: ["Q1", "Q2"] },
    { h2: "Dialling in", h3: ["Grind"], answers: ["Q3"] },
  ],
  gap_angle: null,
  internal_links: null,
  do_not_cover: null,
};

describe("applyModelOutput", () => {
  const reads = baseReads();

  it("upgrades answered questions to model provenance and keeps the rest heuristic", () => {
    const applied = applyModelOutput({
      mustAnswer: mustAnswerWith(3),
      output: MODEL_OUTPUT,
      llm: LLM_COMPLETE,
      profile: reads.product_profile,
      profileFacts: null,
      observedCount: 6,
      gsc: reads.gsc,
      gscPages: [],
    });
    expect(applied.must_answer.status).toBe("available");
    if (applied.must_answer.status !== "available") return;
    expect(applied.must_answer.items[0]).toMatchObject({
      q: "What is pour over coffee?",
      q_provenance: { method: "model", derived_from: ["crawl", "user_input"] },
    });
    expect(applied.must_answer.items[1]?.q_provenance).toEqual({ method: "heuristic", origin: "crawl" });
    expect(applied.outline).toMatchObject({ status: "available" });
    if (applied.outline.status !== "available") return;
    expect(applied.outline.items.map((item) => item.id)).toEqual(["O1", "O2"]);
    expect(applied.gap_angle).toEqual({ status: "unavailable", reason: "not_requested", attempted: null });
    expect(applied.internal_links).toEqual({ status: "unavailable", reason: "not_requested", attempted: null });
  });

  it("keeps outline unavailable for too few questions even when the model answered", () => {
    const applied = applyModelOutput({
      mustAnswer: mustAnswerWith(OUTLINE_MIN_QUESTIONS - 1),
      output: MODEL_OUTPUT,
      llm: LLM_COMPLETE,
      profile: reads.product_profile,
      profileFacts: null,
      observedCount: 6,
      gsc: reads.gsc,
      gscPages: [],
    });
    expect(applied.outline).toEqual({
      status: "unavailable",
      reason: "insufficient_evidence",
      attempted: OUTLINE_MIN_QUESTIONS - 1,
    });
  });

  it("inherits the LLM read's reason when the answer never came", () => {
    const applied = applyModelOutput({
      mustAnswer: mustAnswerWith(3),
      output: null,
      llm: { status: "unavailable", reason: "timeout", attempted: 1, calls: 1, model_id: "m", input_tokens: null, output_tokens: null },
      profile: { status: "complete", website_id: "w", snapshot_revision: 1, profile_hash: "h" },
      profileFacts: [{ id: "P1", field: "productName", text: "Brewly", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } }],
      observedCount: 6,
      gsc: reads.gsc,
      gscPages: [],
    });
    expect(applied.outline).toMatchObject({ status: "unavailable", reason: "timeout" });
    expect(applied.gap_angle).toMatchObject({ status: "unavailable", reason: "timeout" });
    expect(applied.must_answer.status).toBe("available");
  });
});

/* ------------------------------------------------------------------ */
/* readiness / mode                                                     */
/* ------------------------------------------------------------------ */

describe("buildDraftReadiness", () => {
  it("lists writable sections and one gap per kind", () => {
    const readiness = buildDraftReadiness({
      outline: { status: "available", items: [{ id: "O1", h2: "x", h3: [], answers: ["Q1"], provenance: { method: "model", derived_from: ["crawl"] } }] },
      profile: { status: "unavailable", reason: "not_requested", attempted: null },
      gsc: { status: "unavailable", reason: "not_requested", attempted: null },
      llm: LLM_COMPLETE,
    });
    expect(readiness).toEqual({ writable: ["O1"], gaps: ["no_product_profile", "no_gsc"] });
  });

  it("records llm_unavailable instead of no_outline when the model was the cause", () => {
    const readiness = buildDraftReadiness({
      outline: { status: "unavailable", reason: "timeout", attempted: 1 },
      profile: { status: "complete", website_id: "w", snapshot_revision: 1, profile_hash: "h" },
      gsc: { status: "unavailable", reason: "not_requested", attempted: null },
      llm: { status: "unavailable", reason: "timeout", attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: null },
    });
    expect(readiness.gaps).toEqual(["no_gsc", "llm_unavailable"]);
  });
});

describe("deriveBriefRunMode", () => {
  it("is unavailable without a SERP", () => {
    expect(
      deriveBriefRunMode({
        reads: baseReads({ serp: { status: "unavailable", reason: "timeout", attempted: 10 } }),
        fields: [],
      }),
    ).toBe("unavailable");
  });

  it("ignores not_requested reads and evidence-shortfalls, degrades on failures", () => {
    expect(deriveBriefRunMode({ reads: baseReads(), fields: [{ status: "unavailable", reason: "insufficient_evidence", attempted: 2 }] })).toBe("complete");
    expect(deriveBriefRunMode({ reads: baseReads(), fields: [{ status: "unavailable", reason: "validation_failed", attempted: 1 }] })).toBe("degraded");
    expect(
      deriveBriefRunMode({
        reads: baseReads({ llm: { status: "unavailable", reason: "not_configured", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null } }),
        fields: [],
      }),
    ).toBe("degraded");
  });

  it("is partial when a read was partial", () => {
    expect(deriveBriefRunMode({ reads: baseReads({ serp: serpComplete(7) }), fields: [] })).toBe("partial");
  });
});

/* ------------------------------------------------------------------ */
/* assemble                                                             */
/* ------------------------------------------------------------------ */

describe("assembleContentBrief", () => {
  function input(): AssembleContentBriefInput {
    const serp = buildSerpObservations(serpRows(10));
    const observed = [1, 2, 3, 4, 5, 6].map((id) => page(id));
    const crawlReads = { status: "complete" as const, attempted: 10, observed: 6, truncated: 0, failed: 0, skipped: 4 };
    return {
      run: { run_id: "run-1", collected_at: "2026-08-29T00:00:00.000Z", elapsed_ms: 1234, budget_ms: 45_000 },
      keyword: { primary: "brew coffee", supporting: ["pour over"], market: "US", language: "en" },
      reads: baseReads({ crawl: crawlReads }),
      serp,
      crawl: {
        observed,
        failed: [],
        skipped: [7, 8, 9, 10].map((id) => ({ serp_id: `S${id}`, reason: "same_host" as const, kept_serp_id: "S1" })),
      },
      profileFacts: null,
      gscQueryPage: [],
      gscPages: [],
      verdict: { action: "undecidable", reason: "no_gsc_property", provenance: null },
      mustAnswer: buildMustAnswerDraft({ serp, observed, crawlReads, language: "en" }),
      model: { output: null },
    };
  }

  it("produces a brief whose fingerprint recomputes and ignores elapsed_ms", async () => {
    const brief = await assembleContentBrief(input());
    expect(brief.schema).toBe("gengrowth.content_brief/v1");
    expect(brief.run.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    await expect(briefFingerprint(brief)).resolves.toBe(brief.run.fingerprint);
    const later = await assembleContentBrief({ ...input(), run: { ...input().run, elapsed_ms: 9999 } });
    expect(later.run.fingerprint).toBe(brief.run.fingerprint);
    expect(brief.budget.must_answer_cap).toBe(MUST_ANSWER_CAP);
    expect(brief.evidence.profile).toBeNull();
  });

  it("does not mutate its inputs", async () => {
    const before = input();
    const snapshot = JSON.stringify(before);
    await assembleContentBrief(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
