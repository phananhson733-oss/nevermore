import { describe, expect, it, vi } from "vitest";

import {
  CRAWL_EXCERPTS_PER_PAGE_MAX,
  CRAWL_EXCERPT_MAX_CHARS,
  CRAWL_HEADINGS_PER_PAGE_MAX,
  DO_NOT_COVER_CAP,
  GSC_PAGE_ROWS_MAX,
  HEADING_MAX_CHARS,
  INTERNAL_LINKS_CAP,
  MODEL_TEXT_MAX_CHARS,
  MUST_ANSWER_CAP,
  OUTLINE_CAP,
  PROFILE_FACT_MAX_CHARS,
  QUESTION_MAX_CHARS,
  RUN_BUDGET_MS,
  SERP_DEPTH,
  SUPPORTING_KEYWORDS_MAX,
} from "./constants.ts";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES, CONTENT_BRIEF_HANDOFF_TTL_MS, CONTENT_BRIEF_SCHEMA } from "./contract.ts";
import type { ContentBrief, Origin } from "./contract.ts";
import { contentBriefFixture, validConnectedContentBrief, validContentBrief, withFingerprint } from "./fixtures.ts";
import { parseContentBrief, parseContentBriefHandoff, parseContentBriefShape } from "./parse-brief.ts";
import { decodeBriefShape } from "./parse-brief-shape.ts";
import type { ParseBriefFailure } from "./parse-brief.ts";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

// Mutants are deliberately ill-typed (unknown keys, wrong types), so the
// draft is loosened once here instead of sprinkling casts through the file.
type Draft = { [key: string]: any };

function mutated(brief: ContentBrief, edit: (draft: Draft) => void): ContentBrief {
  const draft = structuredClone(brief) as Draft;
  edit(draft);
  return draft as ContentBrief;
}

function failure(code: ParseBriefFailure["code"], path: string): ParseBriefFailure {
  return { ok: false, code, path };
}

function expectShape(input: unknown, code: ParseBriefFailure["code"], path: string): void {
  expect(parseContentBriefShape(input)).toEqual(failure(code, path));
}

function expectReference(input: unknown, path: string): void {
  expectShape(input, "brief_reference_invalid", path);
}

function expectAccepted(input: unknown): ContentBrief {
  const result = parseContentBriefShape(input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

const unavailable = (reason: string, attempted: number | null) => ({ status: "unavailable", reason, attempted });

/** Rewrites every model provenance so a ledger change can be tested on its own. */
function setDerivedFrom(draft: Draft, origins: readonly Origin[]): void {
  const provenance = { method: "model", derived_from: [...origins] };
  if (draft.must_answer.status === "available") {
    for (const item of draft.must_answer.items) if (item.q_provenance.method === "model") item.q_provenance = provenance;
  }
  if (draft.outline.status === "available") for (const item of draft.outline.items) item.provenance = provenance;
  if (draft.gap_angle.status === "available") draft.gap_angle.provenance = provenance;
  if (draft.internal_links.status === "available") for (const item of draft.internal_links.items) item.why_provenance = provenance;
  if (draft.do_not_cover.status === "available") for (const item of draft.do_not_cover.items) item.topic_provenance = provenance;
}

/** Stable stand-in for canonical.ts so parser tests do not depend on it. */
function fakeFingerprint(brief: ContentBrief): Promise<string> {
  const body = JSON.stringify({ ...brief, run: { ...brief.run, fingerprint: "", elapsed_ms: 0 } });
  let hash = 5381;
  for (let index = 0; index < body.length; index += 1) hash = Math.imul(hash, 33) ^ body.charCodeAt(index);
  return Promise.resolve(`fake-${(hash >>> 0).toString(16)}`);
}

async function fakeStamped(brief: ContentBrief): Promise<ContentBrief> {
  return { ...brief, run: { ...brief.run, fingerprint: await fakeFingerprint(brief) } };
}

const llmFailed = () => contentBriefFixture({ llm: "validation_failed" });
const serpUnavailable = () => contentBriefFixture({ serp: "unavailable" });
const lengthAvailable = () => contentBriefFixture({ completeC5: true });
const nonWhitespace = () => contentBriefFixture({ language: "zh" });
const allSkipped = () => contentBriefFixture({ allSkipped: true });
const crawlTimeout = () => contentBriefFixture({ crawlTimeout: true });
const notObserved = () => contentBriefFixture({ notObserved: true });

/* ------------------------------------------------------------------ */
/* accepted                                                            */
/* ------------------------------------------------------------------ */

describe("parseContentBriefShape accepts", () => {
  it("the base fixture, returning an equal but distinct object", () => {
    const brief = validContentBrief();
    const value = expectAccepted(brief);
    expect(value).toEqual(brief);
    expect(value).not.toBe(brief);
  });

  it("every fixture variant assembled through the builders", () => {
    const variants = [
      validConnectedContentBrief(),
      serpUnavailable(),
      llmFailed(),
      nonWhitespace(),
      lengthAvailable(),
      notObserved(),
      allSkipped(),
      crawlTimeout(),
      contentBriefFixture({ connected: true, llm: "validation_failed" }),
    ];
    for (const brief of variants) expectAccepted(brief);
    expect(allSkipped().run.reads.crawl).toEqual({ status: "complete", attempted: 10, observed: 0, truncated: 0, failed: 0, skipped: 10 });
    expect(crawlTimeout().run.reads.crawl).toEqual({ status: "unavailable", reason: "timeout", attempted: 0 });
    expect(serpUnavailable().run.reads.crawl).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 0 });
  });

  it("the fixture facts the negatives below rely on", () => {
    const brief = validContentBrief();
    expect(brief.must_answer.status === "available" && brief.must_answer.items.map((item) => [item.id, item.covered_by])).toEqual([["Q1", 4], ["Q2", 4], ["Q3", 3], ["Q4", 3]]);
    expect(brief.intent).toMatchObject({ status: "available", value: "informational", matched: 5, confidence: "provisional" });
    expect(brief.evidence.serp.map((row) => row.format.value)).toEqual(["guide", "guide", "listicle", "guide", "comparison", "guide", "listicle", "tool", "guide", "unknown"]);
    expect(brief.run.mode).toBe("partial");
  });

  it("a SERP row without a URL when it is skipped as no_url", () => {
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.evidence.serp[9].url = null;
      draft.evidence.crawl.failed.splice(2, 1);
      draft.evidence.crawl.skipped.push({ serp_id: "S10", reason: "no_url", kept_serp_id: null });
      draft.run.reads.crawl = { ...draft.run.reads.crawl, failed: 2, skipped: 2 };
    }));
  });

  it("a same_host skip whose kept entry is a failed fetch", () => {
    // S9 moves onto S7's host (path:blog keeps its classification); the re-planned skip now keeps S7.
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.evidence.serp[8] = { ...draft.evidence.serp[8], domain: "listly.example", url: "https://listly.example/blog/warmup-schedule" };
      draft.evidence.crawl.skipped[0].kept_serp_id = "S7";
    }));
  });

  it("a fully connected run whose crawl was fully skipped: gap_angle needs observed pages", () => {
    const skippedAndConnected = contentBriefFixture({ connected: true, allSkipped: true });
    expect(skippedAndConnected.gap_angle).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 0 });
    expectAccepted(skippedAndConnected);
    expectReference(mutated(skippedAndConnected, (draft) => { draft.gap_angle = validConnectedContentBrief().gap_angle; }), "gap_angle.status");
    expectReference(mutated(skippedAndConnected, (draft) => { draft.gap_angle = unavailable("validation_failed", 1); }), "gap_angle.reason");
  });

  it("a partial SERP read with unresolved provider rows", () => {
    expectAccepted(mutated(validContentBrief(), (draft) => { draft.run.reads.serp = { ...draft.run.reads.serp, status: "partial", unresolved: 1 }; }));
  });

  it("an outline the model failed to return under a complete LLM read", () => {
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.outline = unavailable("validation_failed", 1);
      draft.draft_readiness = { writable: [], gaps: ["no_product_profile", "no_gsc", "no_outline"] };
      draft.run.mode = "degraded";
    }));
  });

  it("a heuristic question under a complete LLM read (the model skipped that id)", () => {
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.must_answer.items[0].q_provenance = { method: "heuristic", origin: "crawl" };
      draft.must_answer.items[0].q = draft.must_answer.items[0].cluster.canonical_heading;
    }));
  });

  it("strings and arrays exactly at their caps", () => {
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.keyword.supporting = Array.from({ length: SUPPORTING_KEYWORDS_MAX }, (_, index) => `kw ${index}`);
      draft.evidence.crawl.observed[0].excerpts[0].text = "t".repeat(CRAWL_EXCERPT_MAX_CHARS);
      draft.must_answer.items[0].q = "q".repeat(QUESTION_MAX_CHARS);
      draft.outline.items[0].h2 = "h".repeat(MODEL_TEXT_MAX_CHARS);
    }));
  });

  it("a crawl excerpt containing astral Unicode exactly at its code-point cap", () => {
    const excerpt = "😀".repeat(CRAWL_EXCERPT_MAX_CHARS);

    expect(excerpt).toHaveLength(CRAWL_EXCERPT_MAX_CHARS * 2);
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.observed[0].excerpts[0].text = excerpt;
    }));
  });

  it("producer-owned crawl headings containing astral Unicode exactly at their code-point cap", () => {
    const heading = "😀".repeat(HEADING_MAX_CHARS);
    const brief = mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.observed[0].h2[0] = heading;
      draft.evidence.crawl.observed[0].h3[0] = heading;
      draft.evidence.crawl.observed[0].excerpts[0].heading = heading;
    });

    expect(heading).toHaveLength(HEADING_MAX_CHARS * 2);
    expect(decodeBriefShape(brief, "")).toMatchObject({ ok: true });
  });
});

/* ------------------------------------------------------------------ */
/* shape rejections                                                    */
/* ------------------------------------------------------------------ */

describe("parseContentBriefShape rejects", () => {
  it("non-object roots", () => {
    for (const input of [null, undefined, "brief", 42, [], true]) expectShape(input, "invalid_request", "");
  });

  it("a brief above CONTENT_BRIEF_HANDOFF_MAX_BYTES before looking at its shape", () => {
    const brief = mutated(validContentBrief(), (draft) => {
      draft.evidence.serp[0].format.rules_hit = Array.from({ length: 140 }, () => "x".repeat(2000));
    });
    expect(new TextEncoder().encode(JSON.stringify(brief)).byteLength).toBeGreaterThan(CONTENT_BRIEF_HANDOFF_MAX_BYTES);
    expectShape(brief, "invalid_request", "");
  });

  it("a wrong or missing schema literal with brief_schema_mismatch", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.schema = "gengrowth.content_brief/v2"; }), "brief_schema_mismatch", "schema");
    expectShape(mutated(validContentBrief(), (draft) => { delete draft.schema; }), "brief_schema_mismatch", "schema");
    expect(CONTENT_BRIEF_SCHEMA).toBe("gengrowth.content_brief/v1");
  });

  it("unknown keys at the root, nested, and injected through __proto__", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.extra = 1; }), "invalid_request", "extra");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.reads.serp.extra = 1; }), "invalid_request", "run.reads.serp.extra");
    const injected = JSON.parse(`${JSON.stringify(validContentBrief()).slice(0, -1)},"__proto__":{"polluted":true}}`) as unknown;
    expectShape(injected, "invalid_request", "__proto__");
  });

  it("missing required keys and wrong primitive types", () => {
    expectShape(mutated(validContentBrief(), (draft) => { delete draft.keyword.market; }), "invalid_request", "keyword.market");
    expectShape(mutated(validContentBrief(), (draft) => { delete draft.run.reads.serp.unresolved; }), "invalid_request", "run.reads.serp.unresolved");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.elapsed_ms = "21"; }), "invalid_request", "run.elapsed_ms");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.elapsed_ms = -1; }), "invalid_request", "run.elapsed_ms");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.elapsed_ms = 1.5; }), "invalid_request", "run.elapsed_ms");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.collected_at = "yesterday"; }), "invalid_request", "run.collected_at");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].rank = 0; }), "invalid_request", "evidence.serp[0].rank");
    expectShape(mutated(validContentBrief(), (draft) => { draft.format.has_plurality = "true"; }), "invalid_request", "format.has_plurality");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.fingerprint = 123; }), "invalid_request", "run.fingerprint");
  });

  it("string length caps: free text, url, heading, excerpt, question, model text, profile fact", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.keyword.primary = "k".repeat(2001); }), "invalid_request", "keyword.primary");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].url = `https://a.example/${"x".repeat(2048)}`; }), "invalid_request", "evidence.serp[0].url");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].h2[0] = "h".repeat(HEADING_MAX_CHARS + 1); }), "invalid_request", "evidence.crawl.observed[0].h2[0]");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].excerpts[0].text = "t".repeat(CRAWL_EXCERPT_MAX_CHARS + 1); }), "invalid_request", "evidence.crawl.observed[0].excerpts[0].text");
    expectShape(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].q = "q".repeat(QUESTION_MAX_CHARS + 1); }), "invalid_request", "must_answer.items[0].q");
    expectShape(mutated(validContentBrief(), (draft) => { draft.outline.items[0].h2 = "h".repeat(MODEL_TEXT_MAX_CHARS + 1); }), "invalid_request", "outline.items[0].h2");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.rationale = "r".repeat(MODEL_TEXT_MAX_CHARS + 1); }), "invalid_request", "gap_angle.rationale");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.profile.facts[0].text = "f".repeat(PROFILE_FACT_MAX_CHARS + 1); }), "invalid_request", "evidence.profile.facts[0].text");
  });

  it("crawl strings one code point above their caps at the exact field path", () => {
    const heading = "😀".repeat(HEADING_MAX_CHARS + 1);
    const excerpt = "😀".repeat(CRAWL_EXCERPT_MAX_CHARS + 1);

    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].h2[0] = heading; }), "invalid_request", "evidence.crawl.observed[0].h2[0]");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].h3[0] = heading; }), "invalid_request", "evidence.crawl.observed[0].h3[0]");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].excerpts[0].heading = heading; }), "invalid_request", "evidence.crawl.observed[0].excerpts[0].heading");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].excerpts[0].text = excerpt; }), "invalid_request", "evidence.crawl.observed[0].excerpts[0].text");
  });

  it("URLs that are not http(s)", () => {
    for (const url of ["ftp://mailwarm.example/guide", "javascript:alert(1)", "not a url", "", "//mailwarm.example/guide"]) {
      expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].url = url; }), "invalid_request", "evidence.serp[0].url");
    }
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.gsc_pages[0].page = "acme.example/blog"; }), "invalid_request", "evidence.gsc_pages[0].page");
  });

  it("array length caps", () => {
    expect(SERP_DEPTH).toBe(10);
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.serp.push({ ...draft.evidence.serp[0], id: "S11", rank: 11 }); }), "invalid_request", "evidence.serp");
    expectShape(mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.observed[0].excerpts = Array.from({ length: CRAWL_EXCERPTS_PER_PAGE_MAX + 1 }, () => draft.evidence.crawl.observed[0].excerpts[0]);
    }), "invalid_request", "evidence.crawl.observed[0].excerpts");
    expectShape(mutated(validContentBrief(), (draft) => {
      draft.must_answer.items = Array.from({ length: MUST_ANSWER_CAP + 1 }, (_, index) => ({ ...draft.must_answer.items[0], id: `Q${index + 1}` }));
    }), "invalid_request", "must_answer.items");
    expectShape(mutated(validContentBrief(), (draft) => {
      draft.outline.items = Array.from({ length: OUTLINE_CAP + 1 }, (_, index) => ({ ...draft.outline.items[0], id: `O${index + 1}` }));
    }), "invalid_request", "outline.items");
    expectShape(mutated(validConnectedContentBrief(), (draft) => {
      draft.internal_links.items = Array.from({ length: INTERNAL_LINKS_CAP + 1 }, () => draft.internal_links.items[0]);
    }), "invalid_request", "internal_links.items");
    expectShape(mutated(validConnectedContentBrief(), (draft) => {
      draft.do_not_cover.items = Array.from({ length: DO_NOT_COVER_CAP + 1 }, () => draft.do_not_cover.items[0]);
    }), "invalid_request", "do_not_cover.items");
    expectShape(mutated(validContentBrief(), (draft) => {
      draft.keyword.supporting = Array.from({ length: SUPPORTING_KEYWORDS_MAX + 1 }, (_, index) => `kw ${index}`);
    }), "invalid_request", "keyword.supporting");
    expectShape(mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.gsc_pages = Array.from({ length: GSC_PAGE_ROWS_MAX + 1 }, (_, index) => ({ ...draft.evidence.gsc_pages[0], id: `G${index + 1}` }));
    }), "invalid_request", "evidence.gsc_pages");
  });

  it("heading arrays above CRAWL_HEADINGS_PER_PAGE_MAX", () => {
    expectShape(mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.observed[0].h2 = Array.from({ length: CRAWL_HEADINGS_PER_PAGE_MAX + 1 }, (_, index) => `Heading ${index}`);
    }), "invalid_request", "evidence.crawl.observed[0].h2");
    expectShape(mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.observed[0].h3 = Array.from({ length: CRAWL_HEADINGS_PER_PAGE_MAX + 1 }, (_, index) => `Sub ${index}`);
    }), "invalid_request", "evidence.crawl.observed[0].h3");
  });

  it("model text that is empty, unclean or over its code-point cap", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].q = ""; }), "invalid_request", "must_answer.items[0].q");
    expectShape(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].q = "What is <b>warmup</b>?"; }), "invalid_request", "must_answer.items[0].q");
    expectShape(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].q = `${"😀".repeat(QUESTION_MAX_CHARS)}?`; }), "invalid_request", "must_answer.items[0].q");
    expectAccepted(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].q = "😀".repeat(QUESTION_MAX_CHARS); }));
    expectShape(mutated(validContentBrief(), (draft) => { draft.outline.items[0].h2 = "Two  spaces"; }), "invalid_request", "outline.items[0].h2");
    expectShape(mutated(validContentBrief(), (draft) => { draft.outline.items[0].h3 = [""]; }), "invalid_request", "outline.items[0].h3[0]");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.value = "Lead\u0007with"; }), "invalid_request", "gap_angle.value");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.internal_links.items[0].why = "trailing space "; }), "invalid_request", "internal_links.items[0].why");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.do_not_cover.items[0].topic = "a<b"; }), "invalid_request", "do_not_cover.items[0].topic");
  });

  it("a format distribution that is not exactly the eight classified formats", () => {
    expectShape(mutated(validContentBrief(), (draft) => { delete draft.format.distribution.news; }), "invalid_request", "format.distribution.news");
    expectShape(mutated(validContentBrief(), (draft) => { draft.format.distribution.unknown = 1; }), "invalid_request", "format.distribution.unknown");
    expectShape(mutated(validContentBrief(), (draft) => { draft.format.distribution.guide = 4.5; }), "invalid_request", "format.distribution.guide");
  });

  it("enum values outside the closed sets", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.mode = "great"; }), "invalid_request", "run.mode");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.reads.gsc.reason = "nope"; }), "invalid_request", "run.reads.gsc.reason");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].format.value = "podcast"; }), "invalid_request", "evidence.serp[0].format.value");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.failed[0].reason = "not_requested"; }), "invalid_request", "evidence.crawl.failed[0].reason");
    expectShape(mutated(validContentBrief(), (draft) => { draft.draft_readiness.gaps = ["no_budget"]; }), "invalid_request", "draft_readiness.gaps[0]");
  });

  it("discriminated-union branches whose keys do not match the discriminator", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.reads.llm.reason = "timeout"; }), "invalid_request", "run.reads.llm.reason");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.reads.llm.status = "weird"; }), "invalid_request", "run.reads.llm.status");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[4].word_count = 5; }), "invalid_request", "evidence.crawl.observed[4].word_count");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.profile.facts[1].provenance = { method: "observed", origin: "product_profile" }; }), "invalid_request", "evidence.profile.facts[1].provenance.method");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { delete draft.verdict.target_url; }), "invalid_request", "verdict.target_url");
    expectShape(mutated(validContentBrief(), (draft) => { draft.verdict.action = "delete"; }), "invalid_request", "verdict.action");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.skipped[0].kept_serp_id = null; }), "invalid_request", "evidence.crawl.skipped[0].kept_serp_id");
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].format.method = "model"; }), "invalid_request", "evidence.serp[0].format.method");
    expectShape(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].q_provenance = { method: "heuristic", origin: "gsc" }; }), "invalid_request", "must_answer.items[0].q_provenance.origin");
    expectShape(mutated(validContentBrief(), (draft) => { draft.intent.provenance.origin = "crawl"; }), "invalid_request", "intent.provenance.origin");
  });

  it("identifiers that do not follow their prefix pattern", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].id = "S0"; }), "invalid_request", "evidence.serp[0].id");
    expectShape(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].id = "Q1x"; }), "invalid_request", "must_answer.items[0].id");
    expectShape(mutated(validContentBrief(), (draft) => { draft.outline.items[0].id = "X1"; }), "invalid_request", "outline.items[0].id");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.gsc_pages[0].id = "g1"; }), "invalid_request", "evidence.gsc_pages[0].id");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.profile.facts[0].id = "P01"; }), "invalid_request", "evidence.profile.facts[0].id");
  });

  it("constants echoed into the brief that drifted from constants.ts", () => {
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.budget_ms = RUN_BUDGET_MS + 1; }), "invalid_request", "run.budget_ms");
    expectShape(mutated(validContentBrief(), (draft) => { draft.format.plurality_threshold = 4; }), "invalid_request", "format.plurality_threshold");
    expectShape(mutated(validContentBrief(), (draft) => { draft.budget.outline_cap = 6; }), "invalid_request", "budget.outline_cap");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.window.lookback_days = 27; }), "invalid_request", "run.reads.gsc.window.lookback_days");
  });

  it("numbers outside their domain and duplicate members of set-valued arrays", () => {
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.gsc_query_page[0].position = 0; }), "invalid_request", "evidence.gsc_query_page[0].position");
    expectShape(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.truncated = ["query", "query"]; }), "invalid_request", "run.reads.gsc.truncated");
    expectShape(mutated(validContentBrief(), (draft) => { draft.outline.items[0].provenance.derived_from = ["crawl", "crawl", "user_input"]; }), "invalid_request", "outline.items[0].provenance.derived_from");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.reads.llm.temperature_requested = Number.NaN; }), "invalid_request", "run.reads.llm.temperature_requested");
    expectShape(mutated(validContentBrief(), (draft) => { draft.run.reads.serp.unresolved = -1; }), "invalid_request", "run.reads.serp.unresolved");
  });
});

/* ------------------------------------------------------------------ */
/* recomputed through assemble.ts                                      */
/* ------------------------------------------------------------------ */

describe("recompute: SERP rows are re-classified", () => {
  it("catches a title edited without re-classifying, and an edited value", () => {
    // S1 keeps `guide` through its path rule; the title rules it now also hits change rules_hit.
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].title = "10 best warmup tools"; }), "evidence.serp[0].format.rules_hit");
    // S10 has no path rule, so the new title flips its value from unknown to listicle.
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[9].title = "10 best warmup tools"; }), "evidence.serp[9].format.value");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].format.value = "listicle"; }), "evidence.serp[0].format.value");
  });

  it("catches forged, reordered or dropped rules_hit", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].format.rules_hit = ["title:guide", "path:guide"]; }), "evidence.serp[0].format.rules_hit[0]");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[0].format.rules_hit.push("domain:forum"); }), "evidence.serp[0].format.rules_hit");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[9].format.rules_hit = ["path:blog"]; }), "evidence.serp[9].format.rules_hit");
  });

  it("pins ids to their index and ranks to be unique", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[9].id = "S1"; }), "evidence.serp[9].id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[9].rank = 1; }), "evidence.serp[9].rank");
  });

  it("ties the SERP read to the ledger and status to returned / unresolved", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.serp.returned = 0; }), "run.reads.serp.returned");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.serp.returned = 11; }), "run.reads.serp.returned");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.serp.unresolved = 1; }), "run.reads.serp.status");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.serp.status = "partial"; }), "run.reads.serp.status");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.serp = unavailable("timeout", 10); }), "evidence.serp");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.evidence.serp.splice(9, 1);
      draft.evidence.crawl.failed.splice(2, 1);
      draft.run.reads.crawl = { ...draft.run.reads.crawl, attempted: 9, failed: 2 };
    }), "evidence.serp");
  });
});

describe("recompute: crawl read", () => {
  it("rebuilds the read from the ledger with buildCrawlReadMeta", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.crawl.attempted = 11; }), "run.reads.crawl.attempted");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.crawl.observed = 7; }), "run.reads.crawl.observed");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.crawl.truncated = 1; }), "run.reads.crawl.truncated");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.crawl.failed = 2; }), "run.reads.crawl.failed");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.crawl.status = "complete"; }), "run.reads.crawl.status");
  });

  it("only allows an unavailable crawl on a failed SERP read or an up-front timeout", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.reads.crawl = unavailable("timeout", 0); }), "evidence.crawl");
    expectReference(mutated(crawlTimeout(), (draft) => { draft.run.reads.crawl = unavailable("insufficient_evidence", 0); }), "run.reads.crawl.reason");
    expectReference(mutated(crawlTimeout(), (draft) => { draft.run.reads.crawl = unavailable("timeout", null); }), "run.reads.crawl.attempted");
    expectReference(mutated(serpUnavailable(), (draft) => { draft.run.reads.crawl = unavailable("timeout", 0); }), "run.reads.crawl.reason");
    expectReference(mutated(serpUnavailable(), (draft) => {
      draft.run.reads.crawl = { status: "complete", attempted: 0, observed: 0, truncated: 0, failed: 0, skipped: 0 };
    }), "run.reads.crawl.status");
  });

  it("keeps a fully skipped SERP on the available branch", () => {
    expectReference(mutated(allSkipped(), (draft) => {
      draft.run.reads.crawl = unavailable("insufficient_evidence", 0);
      draft.evidence.crawl.skipped = [];
    }), "run.reads.crawl.reason");
    expectReference(mutated(allSkipped(), (draft) => { draft.run.reads.crawl.skipped = 9; }), "run.reads.crawl.skipped");
  });
});

describe("recompute: intent / format / length", () => {
  it("rebuilds intent with classifyIntent", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.intent.value = "commercial"; }), "intent.value");
    expectReference(mutated(validContentBrief(), (draft) => { draft.intent.matched = 7; }), "intent.matched");
    expectReference(mutated(validContentBrief(), (draft) => { draft.intent.confidence = "confirmed"; }), "intent.confidence");
    expectReference(mutated(validContentBrief(), (draft) => { draft.intent.rules_hit.push("intent:forged"); }), "intent.rules_hit");
    expectReference(mutated(validContentBrief(), (draft) => { draft.intent.rules_hit.reverse(); }), "intent.rules_hit[0]");
    expectReference(mutated(validContentBrief(), (draft) => { draft.intent = unavailable("insufficient_evidence", 10); }), "intent.status");
    expectReference(mutated(serpUnavailable(), (draft) => { draft.intent = unavailable("insufficient_evidence", 10); }), "intent.reason");
  });

  it("rebuilds format from the classified rows", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.format.distribution = { ...draft.format.distribution, guide: 4, listicle: 3 }; }), "format.distribution.guide");
    expectReference(mutated(validContentBrief(), (draft) => { draft.format.values = ["listicle"]; }), "format.values[0]");
    expectReference(mutated(validContentBrief(), (draft) => { draft.format.values = ["guide", "listicle"]; }), "format.values");
    expectReference(mutated(validContentBrief(), (draft) => { draft.format.unknown_count = 2; }), "format.unknown_count");
    expectReference(mutated(validContentBrief(), (draft) => { draft.format.classified = 8; }), "format.classified");
    expectReference(mutated(validContentBrief(), (draft) => { draft.format.has_plurality = false; }), "format.has_plurality");
    expectReference(mutated(validContentBrief(), (draft) => { draft.format = unavailable("insufficient_evidence", 10); }), "format.status");
    expectReference(mutated(serpUnavailable(), (draft) => { draft.format = unavailable("timeout", 9); }), "format.attempted");
  });

  it("rebuilds length with the same percentile function", () => {
    expectReference(mutated(lengthAvailable(), (draft) => { draft.length.p25 = 961; }), "length.p25");
    expectReference(mutated(lengthAvailable(), (draft) => { draft.length.median = 1211; }), "length.median");
    expectReference(mutated(lengthAvailable(), (draft) => { draft.length.pages_counted = 6; }), "length.pages_counted");
    expectReference(mutated(validContentBrief(), (draft) => { draft.length = lengthAvailable().length; }), "length.status");
    expectReference(mutated(validContentBrief(), (draft) => { draft.length.attempted = 5; }), "length.attempted");
    expectReference(mutated(nonWhitespace(), (draft) => { draft.length = unavailable("insufficient_evidence", 4); }), "length.reason");
  });
});

describe("recompute: must_answer clusters", () => {
  it("catches a deleted qualified cluster, a re-clustered member and an edited heading", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.must_answer.items.pop(); }), "must_answer.items");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.must_answer.items[2].cluster.members.push(draft.must_answer.items[0].cluster.members.pop());
    }), "must_answer.items[0].cluster.members");
    expectReference(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].cluster.canonical_heading = "email warmup basics"; }), "must_answer.items[0].cluster.canonical_heading");
    expectReference(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].cluster.members[0].heading = "What is warmup"; }), "must_answer.items[0].cluster.members[0].heading");
    expectReference(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].covered_by = 5; }), "must_answer.items[0].covered_by");
  });

  it("catches a reordered list and a forged id", () => {
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.must_answer.items = [draft.must_answer.items[0], draft.must_answer.items[1], draft.must_answer.items[3], draft.must_answer.items[2]];
    }), "must_answer.items[2].id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.must_answer.items[1].id = "Q9"; }), "must_answer.items[1].id");
  });

  it("catches a page heading edited after clustering", () => {
    // C6 leaves the "what is" cluster, which drops to 3 pages and behind "how long" in the order.
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[5].h2[0] = "Email warmup overview"; }), "must_answer.items[0].cluster.canonical_heading");
  });

  it("pins the budget to the draft's candidates / shown / hidden", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.budget.must_answer_candidates = 5; }), "budget.must_answer_candidates");
    expectReference(mutated(validContentBrief(), (draft) => { draft.budget.must_answer_shown = 3; }), "budget.must_answer_shown");
    expectReference(mutated(validContentBrief(), (draft) => { draft.budget.must_answer_hidden = 1; }), "budget.must_answer_hidden");
    expectReference(mutated(serpUnavailable(), (draft) => { draft.budget.must_answer_candidates = 3; }), "budget.must_answer_candidates");
  });

  it("compares the unavailable branch exactly", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.must_answer = unavailable("insufficient_evidence", 6); }), "must_answer.status");
    expectReference(mutated(nonWhitespace(), (draft) => { draft.must_answer = unavailable("unsupported_language", 0); }), "must_answer.attempted");
    expectReference(mutated(serpUnavailable(), (draft) => { draft.must_answer = { status: "available", items: [] }; }), "must_answer.status");
  });

  it("ties q_provenance to the LLM read and heuristic questions to the canonical heading", () => {
    expectReference(mutated(llmFailed(), (draft) => { draft.must_answer.items[0].q_provenance = { method: "model", derived_from: ["crawl", "user_input"] }; }), "must_answer.items[0].q_provenance");
    expectReference(mutated(llmFailed(), (draft) => { draft.must_answer.items[0].q = "Rewritten"; }), "must_answer.items[0].q");
    expectReference(mutated(validContentBrief(), (draft) => { draft.must_answer.items[0].q_provenance.derived_from = ["crawl"]; }), "must_answer.items[0].q_provenance.derived_from");
  });
});

describe("recompute: model provenance derived_from", () => {
  it("must equal modelDerivedFrom(profile facts, gsc pages) on every model-written field", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline.items[0].provenance.derived_from = ["crawl", "user_input", "product_profile"]; }), "outline.items[0].provenance.derived_from");
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline.items[0].provenance.derived_from = ["user_input", "crawl"]; }), "outline.items[0].provenance.derived_from[0]");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.provenance.derived_from = ["crawl", "user_input", "product_profile"]; }), "gap_angle.provenance.derived_from");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.internal_links.items[0].why_provenance.derived_from = ["crawl", "user_input"]; }), "internal_links.items[0].why_provenance.derived_from");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.do_not_cover.items[0].topic_provenance.derived_from = ["crawl"]; }), "do_not_cover.items[0].topic_provenance.derived_from");
  });

  it("follows the ledger: no profile facts means no product_profile origin", () => {
    const factless = mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.profile = { facts: [] };
      draft.gap_angle = unavailable("insufficient_evidence", 0);
      setDerivedFrom(draft, ["crawl", "user_input", "gsc"]);
    });
    expectAccepted(factless);
    expectReference(mutated(factless, (draft) => { setDerivedFrom(draft, ["crawl", "user_input", "product_profile", "gsc"]); }), "must_answer.items[0].q_provenance.derived_from");
  });
});

/* ------------------------------------------------------------------ */
/* crawl partition, observations, gsc, profile                          */
/* ------------------------------------------------------------------ */

describe("invariants: crawl partition", () => {
  it("puts every SERP id in exactly one of observed / failed / skipped", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].serp_id = "S11"; }), "evidence.crawl.observed[0].serp_id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[1].serp_id = "S1"; }), "evidence.crawl.observed[1].serp_id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.failed[0].serp_id = "S1"; }), "evidence.crawl.failed[0].serp_id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.skipped[0].serp_id = "S7"; }), "evidence.crawl.skipped[0].serp_id");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.failed.splice(2, 1);
      draft.run.reads.crawl.failed = 2;
    }), "evidence.crawl");
  });

  it("pins observation ids and urls to their SERP row", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].id = "C7"; }), "evidence.crawl.observed[0].id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].url = "https://mailwarm.example/other"; }), "evidence.crawl.observed[0].url");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.failed[0].url = "https://listly.example/other"; }), "evidence.crawl.failed[0].url");
    // S10 carries no path rule, so nulling its url leaves the classification intact and only the failed entry disagrees.
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.serp[9].url = null; }), "evidence.crawl.failed[2].url");
  });

  it("ties serp.url === null to exactly a no_url skip", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.skipped[0] = { serp_id: "S9", reason: "no_url", kept_serp_id: null }; }), "evidence.crawl.skipped[0].reason");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.evidence.serp[8].url = null;
      draft.evidence.serp[8].format = { value: "unknown", method: "heuristic", rules_hit: [] };
    }), "evidence.crawl.skipped[0].reason");
  });

  it("requires kept_serp_id to be a higher-ranked, non-skipped row with a url", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.skipped[0].kept_serp_id = "S11"; }), "evidence.crawl.skipped[0].kept_serp_id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.skipped[0].kept_serp_id = "S9"; }), "evidence.crawl.skipped[0].kept_serp_id");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.skipped[0].kept_serp_id = "S10"; }), "evidence.crawl.skipped[0].kept_serp_id");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.failed.splice(2, 1);
      draft.evidence.crawl.skipped.push({ serp_id: "S10", reason: "same_host", kept_serp_id: "S9" });
      draft.run.reads.crawl = { ...draft.run.reads.crawl, failed: 2, skipped: 2 };
    }), "evidence.crawl.skipped");
  });

  it("re-plans the skip list with hostKey and compares order and content", () => {
    const twoSkips = mutated(validContentBrief(), (draft) => {
      draft.evidence.serp[9].url = null;
      draft.evidence.crawl.failed.splice(2, 1);
      draft.evidence.crawl.skipped.push({ serp_id: "S10", reason: "no_url", kept_serp_id: null });
      draft.run.reads.crawl = { ...draft.run.reads.crawl, failed: 2, skipped: 2 };
    });
    expectAccepted(twoSkips);
    expectReference(mutated(twoSkips, (draft) => { draft.evidence.crawl.skipped.reverse(); }), "evidence.crawl.skipped[0].serp_id");
    // www. and case differences collapse onto one host key, so S9 is still a same_host skip of S2.
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.evidence.serp[8] = { ...draft.evidence.serp[8], url: "https://WWW.deliverability.example/blog/warmup-schedule" };
    }));
    // A row that no longer shares a host must not stay skipped.
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.evidence.serp[8] = { ...draft.evidence.serp[8], domain: "other.example", url: "https://other.example/blog/warmup-schedule" };
    }), "evidence.crawl.skipped");
  });
});

describe("invariants: observations", () => {
  it("requires every excerpt heading to exist on the page at its level", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].excerpts[0].heading = "Nope"; }), "evidence.crawl.observed[0].excerpts[0].heading");
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.crawl.observed[0].excerpts[1].level = "h2"; }), "evidence.crawl.observed[0].excerpts[1].heading");
  });

  it("forbids word counts for languages without whitespace tokenisation", () => {
    expectReference(mutated(nonWhitespace(), (draft) => { draft.evidence.crawl.observed[0].word_count = 12; }), "evidence.crawl.observed[0].word_count");
  });
});

describe("invariants: GSC ledger", () => {
  it("requires an unavailable GSC read to have empty ledgers", () => {
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.evidence.gsc_pages = [{ id: "G1", page: "https://acme.example/", clicks: 1, impressions: 2, position: null }];
    }), "evidence.gsc_pages");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.evidence.gsc_query_page = [{ query: "email warmup", page: "https://acme.example/", clicks: 1, impressions: 2, position: null }];
    }), "evidence.gsc_query_page");
  });

  it("pins status partial to truncated / unreadable rows", () => {
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.truncated = ["query"]; }), "run.reads.gsc.status");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.status = "partial"; }), "run.reads.gsc.status");
    expectAccepted(mutated(validConnectedContentBrief(), (draft) => {
      draft.run.reads.gsc = { ...draft.run.reads.gsc, status: "partial", truncated: ["query"] };
    }));
  });

  it("ties matched_queries === 0 to primary_coverage query_not_in_sample", () => {
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.matched_queries = 0; }), "run.reads.gsc.primary_coverage");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.primary_coverage = { ratio: null, reason: "query_not_in_sample" }; }), "run.reads.gsc.primary_coverage");
  });

  it("rejects duplicate page ids and more distinct queries than matched_queries", () => {
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.gsc_pages[1].id = "G1"; }), "evidence.gsc_pages[1].id");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.matched_queries = 1; }), "run.reads.gsc.matched_queries");
  });

  it("requires every query x page row to be the primary keyword and unique", () => {
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.gsc_query_page[2].query = "email warm up"; }), "evidence.gsc_query_page[2].query");
    // A third raw spelling of the primary keyword is fine once matched_queries counts it.
    expectAccepted(mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.gsc_query_page[2].query = "  EMAIL   warmup ";
      draft.run.reads.gsc.matched_queries = 3;
    }));
    expectReference(mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.gsc_query_page.push({ ...draft.evidence.gsc_query_page[0] });
      draft.run.reads.gsc.rows.query_page = 4;
    }), "evidence.gsc_query_page[3]");
  });

  it("bounds the ledgers by reads.gsc.rows", () => {
    expectShape(mutated(validConnectedContentBrief(), (draft) => { delete draft.run.reads.gsc.rows; }), "invalid_request", "run.reads.gsc.rows");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.rows.page = 2; }), "run.reads.gsc.rows.page");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.rows.query_page = 2; }), "run.reads.gsc.rows.query_page");
    expectAccepted(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.rows = { query: 9, query_page: 9, page: 9 }; }));
  });
});

describe("invariants: profile", () => {
  it("ties evidence.profile to reads.product_profile.status === complete", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.evidence.profile = { facts: [] }; }), "evidence.profile");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.profile = null; }), "evidence.profile");
  });

  it("rejects duplicate fact ids", () => {
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.evidence.profile.facts[1].id = "P1"; }), "evidence.profile.facts[1].id");
  });
});

/* ------------------------------------------------------------------ */
/* verdict recomputed with aggregateByPage                              */
/* ------------------------------------------------------------------ */

describe("recompute: verdict", () => {
  it("ties the verdict branch to the GSC read", () => {
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.verdict = { action: "create", reason: "not_observed", existing: null, provenance: { method: "heuristic", origin: "gsc" } };
    }), "verdict.action");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.verdict = { action: "undecidable", reason: "no_gsc_property", provenance: null }; }), "verdict.action");
    expectReference(mutated(validConnectedContentBrief(), (draft) => {
      draft.verdict = { action: "undecidable", reason: "gsc_unavailable", provenance: { method: "heuristic", origin: "gsc" } };
    }), "verdict.action");
    // A failed GSC read propagates its own reason into the page-written fields (applyModelOutput).
    const gscTimedOut = mutated(validContentBrief(), (draft) => {
      draft.run.reads.gsc = unavailable("timeout", null);
      draft.internal_links = unavailable("timeout", null);
      draft.do_not_cover = unavailable("timeout", null);
      draft.run.mode = "degraded";
      draft.verdict = { action: "undecidable", reason: "gsc_unavailable", provenance: { method: "heuristic", origin: "gsc" } };
    });
    expectAccepted(gscTimedOut);
    expectReference(mutated(gscTimedOut, (draft) => { draft.internal_links = unavailable("not_requested", null); }), "internal_links.reason");
  });

  it("re-derives the undecidable reasons from reads.gsc", () => {
    const gscHeuristic = { method: "heuristic", origin: "gsc" };
    const lowCoverage = mutated(validConnectedContentBrief(), (draft) => {
      draft.run.reads.gsc.primary_coverage = { ratio: 0.5 };
      draft.verdict = { action: "undecidable", reason: "gsc_partial", provenance: gscHeuristic };
    });
    expectAccepted(lowCoverage);
    expectReference(mutated(lowCoverage, (draft) => { draft.run.reads.gsc.primary_coverage = { ratio: 0.8 }; }), "verdict.action");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.run.reads.gsc.primary_coverage = { ratio: 0.5 }; }), "verdict.action");
    expectAccepted(mutated(validConnectedContentBrief(), (draft) => {
      draft.run.reads.gsc.primary_coverage = { ratio: null, reason: "split_exceeds_total" };
      draft.verdict = { action: "undecidable", reason: "gsc_inconsistent", provenance: gscHeuristic };
    }));
    expectAccepted(mutated(notObserved(), (draft) => {
      draft.run.reads.gsc = { ...draft.run.reads.gsc, status: "partial", truncated: ["query"] };
      draft.verdict = { action: "undecidable", reason: "gsc_partial", provenance: gscHeuristic };
    }));
    expectReference(mutated(notObserved(), (draft) => {
      draft.run.reads.gsc = { ...draft.run.reads.gsc, status: "partial", truncated: ["query"] };
    }), "verdict.action");
  });

  it("rebuilds the observed page with aggregateByPage", () => {
    const connected = validConnectedContentBrief();
    expect(connected.verdict).toMatchObject({ action: "update", observed: { impressions: 1_020, rows: 2, rows_with_position: 2 } });
    expectReference(mutated(connected, (draft) => { draft.verdict.observed.impressions = 1_000; }), "verdict.observed.impressions");
    expectReference(mutated(connected, (draft) => { draft.verdict.observed.avg_position = 6.42; }), "verdict.observed.avg_position");
    expectReference(mutated(connected, (draft) => { draft.verdict.observed.rows_with_position = 1; }), "verdict.observed.rows_with_position");
    expectReference(mutated(connected, (draft) => { draft.verdict.observed.page = "https://acme.example/tools/warmup"; }), "verdict.observed.page");
    expectReference(mutated(connected, (draft) => { draft.verdict.target_url = "https://acme.example/tools/warmup"; }), "verdict.target_url");
    expectReference(mutated(connected, (draft) => { draft.evidence.gsc_query_page[0].impressions = 901; }), "verdict.observed.impressions");
  });

  it("re-applies the self-compete thresholds through the same decision table", () => {
    const gscHeuristic = { method: "heuristic", origin: "gsc" };
    const beyondCap = mutated(validConnectedContentBrief(), (draft) => {
      for (const row of draft.evidence.gsc_query_page) if (row.position !== null) row.position = 40;
      draft.verdict = { action: "create", reason: "beyond_position_cap", existing: { ...draft.verdict.observed, avg_position: 40 }, provenance: gscHeuristic };
    });
    expectAccepted(beyondCap);
    // Same page, same numbers, wrong branch: position 40 is past SELF_COMPETE_MAX_POSITION.
    expectReference(mutated(beyondCap, (draft) => {
      draft.verdict = { action: "update", reason: "self_compete", target_url: draft.verdict.existing.page, observed: draft.verdict.existing, provenance: gscHeuristic };
    }), "verdict.action");
    expectReference(mutated(validConnectedContentBrief(), (draft) => {
      draft.verdict = { action: "create", reason: "beyond_position_cap", existing: draft.verdict.observed, provenance: gscHeuristic };
    }), "verdict.action");
    // 15 impressions on the best page is below SELF_COMPETE_MIN_IMPRESSIONS: update is no longer derivable.
    expectReference(mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.gsc_query_page[0] = { ...draft.evidence.gsc_query_page[0], impressions: 10, position: 6.2 };
      draft.evidence.gsc_query_page[1] = { ...draft.evidence.gsc_query_page[1], impressions: 5, position: 6.2 };
      draft.evidence.gsc_query_page[2].impressions = 3;
      draft.verdict.observed = { ...draft.verdict.observed, impressions: 15, avg_position: 6.2 };
    }), "verdict.action");
    // Shrinking only the owned page hands the best-page slot to the position-less tool page.
    expectReference(mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.gsc_query_page[0].impressions = 10;
      draft.evidence.gsc_query_page[1].impressions = 5;
      draft.verdict.observed.impressions = 15;
    }), "verdict.action");
  });

  it("handles not_observed, below_impression_floor and position_unavailable", () => {
    const gscHeuristic = { method: "heuristic", origin: "gsc" };
    expectReference(mutated(notObserved(), (draft) => {
      draft.evidence.gsc_query_page = validConnectedContentBrief().evidence.gsc_query_page;
      draft.run.reads.gsc.matched_queries = 2;
      draft.run.reads.gsc.primary_coverage = { ratio: 0.92 };
    }), "verdict.action");
    const positionless = mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.gsc_query_page[0].position = null;
      draft.evidence.gsc_query_page[1].position = null;
      draft.verdict = { action: "undecidable", reason: "position_unavailable", provenance: gscHeuristic };
    });
    expectAccepted(positionless);
    expectReference(mutated(validConnectedContentBrief(), (draft) => {
      draft.verdict = { action: "undecidable", reason: "position_unavailable", provenance: gscHeuristic };
    }), "verdict.action");
    const floor = mutated(positionless, (draft) => {
      draft.evidence.gsc_query_page[0].impressions = 10;
      draft.evidence.gsc_query_page[1].impressions = 5;
      draft.evidence.gsc_query_page[2].impressions = 3;
      draft.verdict = {
        action: "create",
        reason: "below_impression_floor",
        existing: { page: "https://acme.example/blog/email-warmup", impressions: 15, rows: 2, rows_with_position: 0, avg_position: null },
        provenance: gscHeuristic,
      };
    });
    expectAccepted(floor);
    expectReference(mutated(floor, (draft) => { draft.verdict.existing = null; }), "verdict.existing");
    expectReference(mutated(floor, (draft) => { draft.verdict.existing.avg_position = 5; }), "verdict.existing.avg_position");
    expectReference(mutated(floor, (draft) => { draft.verdict.existing.rows = 1; }), "verdict.existing.rows");
  });
});

/* ------------------------------------------------------------------ */
/* model-written fields                                                 */
/* ------------------------------------------------------------------ */

describe("recompute: model-field gates", () => {
  it("compares outline's unavailable branch against its gate and the LLM read", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline = unavailable("timeout", null); }), "outline.reason");
    expectReference(mutated(llmFailed(), (draft) => { draft.outline = unavailable("validation_failed", null); }), "outline.attempted");
    expectReference(mutated(llmFailed(), (draft) => { draft.outline = validContentBrief().outline; }), "outline.status");
    const twoQuestions = mutated(validContentBrief(), (draft) => {
      draft.evidence.crawl.observed[2].h2.splice(1, 1);
      draft.evidence.crawl.observed[2].h2.splice(1, 1);
      draft.evidence.crawl.observed[2].excerpts = [];
      draft.must_answer.items = draft.must_answer.items.slice(0, 2);
      draft.outline = unavailable("insufficient_evidence", 2);
      draft.draft_readiness = { writable: [], gaps: ["no_product_profile", "no_gsc", "no_outline"] };
      draft.budget = { ...draft.budget, must_answer_candidates: 2, must_answer_shown: 2 };
    });
    expectAccepted(twoQuestions);
    expectReference(mutated(twoQuestions, (draft) => { draft.outline = unavailable("insufficient_evidence", 3); }), "outline.attempted");
    expectReference(mutated(twoQuestions, (draft) => {
      draft.outline = { status: "available", items: [{ id: "O1", h2: "Basics", h3: [], answers: ["Q1"], provenance: { method: "model", derived_from: ["crawl", "user_input"] } }] };
      draft.draft_readiness = { writable: ["O1"], gaps: ["no_product_profile", "no_gsc"] };
    }), "outline.status");
  });

  it("compares gap_angle against the profile gate", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.gap_angle = validConnectedContentBrief().gap_angle; }), "gap_angle.status");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle = unavailable("not_requested", null); }), "gap_angle.reason");
    expectReference(mutated(validContentBrief(), (draft) => { draft.gap_angle = unavailable("timeout", null); }), "gap_angle.reason");
    expectReference(mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.profile = { facts: [] };
      setDerivedFrom(draft, ["crawl", "user_input", "gsc"]);
    }), "gap_angle.status");
    expectReference(mutated(contentBriefFixture({ connected: true, llm: "validation_failed" }), (draft) => { draft.gap_angle = unavailable("validation_failed", 0); }), "gap_angle.attempted");
  });

  it("compares internal_links / do_not_cover against the pages gate", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.internal_links = validConnectedContentBrief().internal_links; }), "internal_links.status");
    expectReference(mutated(validContentBrief(), (draft) => { draft.do_not_cover = validConnectedContentBrief().do_not_cover; }), "do_not_cover.status");
    const unreadablePages = mutated(validConnectedContentBrief(), (draft) => {
      draft.evidence.gsc_pages = [];
      draft.run.reads.gsc = { ...draft.run.reads.gsc, status: "partial", unreadable_rows: { query: 0, query_page: 0, page: 2 } };
      draft.internal_links = unavailable("provider_error", 2);
      draft.do_not_cover = unavailable("provider_error", 2);
      draft.run.mode = "degraded";
      setDerivedFrom(draft, ["crawl", "user_input", "product_profile"]);
    });
    expectAccepted(unreadablePages);
    expectReference(mutated(unreadablePages, (draft) => { draft.run.mode = "partial"; }), "run.mode");
    expectReference(mutated(unreadablePages, (draft) => { draft.internal_links = unavailable("insufficient_evidence", 0); }), "internal_links.reason");
    expectReference(mutated(unreadablePages, (draft) => { draft.do_not_cover = unavailable("provider_error", 1); }), "do_not_cover.attempted");
  });

  it("requires answers to reference existing questions, each at most once", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline.items[0].answers = ["Q9"]; }), "outline.items[0].answers[0]");
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline.items[1].answers = ["Q2", "Q1"]; }), "outline.items[1].answers[1]");
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline.items[0].answers = ["Q1", "Q1"]; }), "outline.items[0].answers[1]");
  });

  it("requires every question to be answered and section ids to run O1..On", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline.items[2].answers = ["Q3"]; }), "outline.items");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.outline.items.pop();
      draft.draft_readiness.writable = ["O1", "O2"];
    }), "outline.items");
    expectReference(mutated(validContentBrief(), (draft) => { draft.outline.items[1].id = "O1"; }), "outline.items[1].id");
    expectReference(mutated(validContentBrief(), (draft) => {
      draft.outline.items[2].id = "O4";
      draft.draft_readiness.writable = ["O1", "O2", "O4"];
    }), "outline.items[2].id");
    expectAccepted(mutated(validContentBrief(), (draft) => {
      draft.outline.items[1].answers = ["Q2", "Q4"];
      draft.outline.items[2].answers = ["Q3"];
    }));
  });

  it("requires fact refs to exist and checked_against to be exactly the observed ids", () => {
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.profile_fact_refs = ["P9"]; }), "gap_angle.profile_fact_refs[0]");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.profile_fact_refs = ["P1", "P1"]; }), "gap_angle.profile_fact_refs[1]");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.checked_against = ["C1", "C2", "C3", "C4", "C5"]; }), "gap_angle.checked_against");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.checked_against = ["C1", "C2", "C3", "C4", "C5", "C5"]; }), "gap_angle.checked_against");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.checked_against = ["C1", "C2", "C3", "C4", "C5", "C7"]; }), "gap_angle.checked_against");
    expectAccepted(mutated(validConnectedContentBrief(), (draft) => { draft.gap_angle.checked_against = ["C6", "C5", "C4", "C3", "C2", "C1"]; }));
  });

  it("requires page_ref to be a distinct gsc_pages id", () => {
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.internal_links.items[0].page_ref = "G9"; }), "internal_links.items[0].page_ref");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.internal_links.items.push({ ...draft.internal_links.items[0] }); }), "internal_links.items[1].page_ref");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.do_not_cover.items[0].page_ref = "G9"; }), "do_not_cover.items[0].page_ref");
    expectReference(mutated(validConnectedContentBrief(), (draft) => { draft.do_not_cover.items.push({ ...draft.do_not_cover.items[0] }); }), "do_not_cover.items[1].page_ref");
  });
});

/* ------------------------------------------------------------------ */
/* readiness and mode                                                   */
/* ------------------------------------------------------------------ */

describe("recompute: draft_readiness and run.mode", () => {
  it("rebuilds readiness with buildDraftReadiness", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.draft_readiness.writable = ["O1", "O2"]; }), "draft_readiness.writable");
    expectReference(mutated(validContentBrief(), (draft) => { draft.draft_readiness.writable = ["O3", "O2", "O1"]; }), "draft_readiness.writable[0]");
    expectReference(mutated(validContentBrief(), (draft) => { draft.draft_readiness.gaps = ["no_product_profile"]; }), "draft_readiness.gaps");
    expectReference(mutated(validContentBrief(), (draft) => { draft.draft_readiness.gaps = ["no_gsc", "no_product_profile"]; }), "draft_readiness.gaps[0]");
    expectReference(mutated(validContentBrief(), (draft) => { draft.draft_readiness.gaps = ["no_product_profile", "no_gsc", "llm_unavailable"]; }), "draft_readiness.gaps");
    expectReference(mutated(llmFailed(), (draft) => { draft.draft_readiness.writable = ["O1"]; }), "draft_readiness.writable");
  });

  it("rebuilds the mode with deriveBriefRunMode", () => {
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.mode = "complete"; }), "run.mode");
    expectReference(mutated(validContentBrief(), (draft) => { draft.run.mode = "degraded"; }), "run.mode");
    expectReference(mutated(serpUnavailable(), (draft) => { draft.run.mode = "degraded"; }), "run.mode");
    expectReference(mutated(llmFailed(), (draft) => { draft.run.mode = "partial"; }), "run.mode");
    expectReference(mutated(allSkipped(), (draft) => { draft.run.mode = "partial"; }), "run.mode");
  });
});

/* ------------------------------------------------------------------ */
/* freshness                                                            */
/* ------------------------------------------------------------------ */

describe("parseContentBriefShape output", () => {
  it("is a deep copy that later mutation of the input cannot reach", () => {
    const input = validContentBrief();
    const value = expectAccepted(input);
    expect(value.evidence.serp).not.toBe(input.evidence.serp);
    expect(value.run.reads).not.toBe(input.run.reads);
    (input as Draft).keyword.primary = "changed";
    (input.evidence.serp as Draft[]).pop();
    (input.evidence.crawl.observed[0] as Draft).h2.push("late");
    expect(value.keyword.primary).toBe("email warmup");
    expect(value.evidence.serp).toHaveLength(10);
    expect(value.evidence.crawl.observed[0]?.h2).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* fingerprint                                                          */
/* ------------------------------------------------------------------ */

describe("parseContentBrief", () => {
  it("accepts a brief whose fingerprint matches the injected hasher", async () => {
    const brief = await fakeStamped(validContentBrief());
    expect(await parseContentBrief(brief, { fingerprint: fakeFingerprint })).toEqual({ ok: true, value: brief });
  });

  it("rejects a count edited after the fingerprint was stamped", async () => {
    const stamped = await fakeStamped(validContentBrief());
    const edited = mutated(stamped, (draft) => { draft.run.reads.llm.input_tokens = 5_201; });
    expect(await parseContentBrief(edited, { fingerprint: fakeFingerprint })).toEqual(failure("brief_fingerprint_mismatch", "run.fingerprint"));
  });

  it("hands the hasher the parsed copy, and never calls it on a malformed brief", async () => {
    const stamped = await fakeStamped(validContentBrief());
    const seen: ContentBrief[] = [];
    const spy = vi.fn(async (brief: ContentBrief) => {
      seen.push(brief);
      return fakeFingerprint(brief);
    });
    await parseContentBrief(stamped, { fingerprint: spy });
    expect(seen[0]).not.toBe(stamped);
    expect(seen[0]).toEqual(stamped);
    spy.mockClear();
    expect(await parseContentBrief(mutated(stamped, (draft) => { draft.run.mode = "complete"; }), { fingerprint: spy })).toEqual(failure("brief_reference_invalid", "run.mode"));
    expect(await parseContentBrief({ schema: "nope" }, { fingerprint: spy })).toEqual(failure("brief_schema_mismatch", "schema"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("uses briefFingerprint from canonical.ts by default and ignores elapsed_ms", async () => {
    const brief = await withFingerprint(validConnectedContentBrief());
    expect(await parseContentBrief(brief)).toEqual({ ok: true, value: brief });
    const slower = { ...brief, run: { ...brief.run, elapsed_ms: brief.run.elapsed_ms + 1 } };
    expect(await parseContentBrief(slower)).toEqual({ ok: true, value: slower });
    const tampered = mutated(brief, (draft) => { draft.keyword.supporting[0] = "email deliverability tips"; });
    expect(await parseContentBrief(tampered)).toEqual(failure("brief_fingerprint_mismatch", "run.fingerprint"));
  });

  it("rejects a re-fingerprinted brief whose derived fields no longer match the ledger", async () => {
    const forged = await withFingerprint(mutated(validContentBrief(), (draft) => { draft.intent.value = "commercial"; }));
    expect(await parseContentBrief(forged)).toEqual(failure("brief_reference_invalid", "intent.value"));
  });
});

/* ------------------------------------------------------------------ */
/* handoff                                                              */
/* ------------------------------------------------------------------ */

describe("parseContentBriefHandoff", () => {
  const createdAt = 1_756_375_200_000;
  const deps = { fingerprint: fakeFingerprint, now: () => createdAt + 1_000 };

  async function handoff(edit?: (draft: Draft) => void): Promise<unknown> {
    const brief = await fakeStamped(validContentBrief());
    const draft: Draft = { version: 1, created_at: createdAt, expires_at: createdAt + CONTENT_BRIEF_HANDOFF_TTL_MS, brief: structuredClone(brief) };
    edit?.(draft);
    return draft;
  }

  it("accepts a well-formed handoff and returns a fresh copy", async () => {
    const input = await handoff();
    const result = await parseContentBriefHandoff(input, deps);
    expect(result).toEqual({ ok: true, value: input });
    if (result.ok) expect(result.value.brief).not.toBe((input as Draft).brief);
  });

  it("pins expires_at to created_at + TTL", async () => {
    expect(await parseContentBriefHandoff(await handoff((draft) => { draft.expires_at += 1; }), deps)).toEqual(failure("brief_reference_invalid", "expires_at"));
  });

  it("only accepts a handoff whose window contains now", async () => {
    const input = await handoff();
    const at = (now: number) => parseContentBriefHandoff(input, { fingerprint: fakeFingerprint, now: () => now });
    expect(await at(createdAt)).toMatchObject({ ok: true });
    expect(await at(createdAt + CONTENT_BRIEF_HANDOFF_TTL_MS - 1)).toMatchObject({ ok: true });
    expect(await at(createdAt + CONTENT_BRIEF_HANDOFF_TTL_MS)).toEqual(failure("brief_reference_invalid", "expires_at"));
    expect(await at(createdAt + CONTENT_BRIEF_HANDOFF_TTL_MS + 60_000)).toEqual(failure("brief_reference_invalid", "expires_at"));
    expect(await at(createdAt - 1)).toEqual(failure("brief_reference_invalid", "created_at"));
    expect(await parseContentBriefHandoff(await handoff((draft) => {
      draft.created_at = createdAt + 5_000;
      draft.expires_at = draft.created_at + CONTENT_BRIEF_HANDOFF_TTL_MS;
    }), deps)).toEqual(failure("brief_reference_invalid", "created_at"));
  });

  it("rejects the wrong version, unknown keys and a missing brief", async () => {
    expect(await parseContentBriefHandoff(await handoff((draft) => { draft.version = 2; }), deps)).toEqual(failure("invalid_request", "version"));
    expect(await parseContentBriefHandoff(await handoff((draft) => { draft.nonce = "x"; }), deps)).toEqual(failure("invalid_request", "nonce"));
    expect(await parseContentBriefHandoff(await handoff((draft) => { delete draft.brief; }), deps)).toEqual(failure("invalid_request", "brief"));
    expect(await parseContentBriefHandoff("nope", deps)).toEqual(failure("invalid_request", ""));
  });

  it("prefixes nested brief failures with brief.", async () => {
    expect(await parseContentBriefHandoff(await handoff((draft) => { draft.brief.schema = "x"; }), deps)).toEqual(failure("brief_schema_mismatch", "brief.schema"));
    expect(await parseContentBriefHandoff(await handoff((draft) => { draft.brief.run.elapsed_ms = "1"; }), deps)).toEqual(failure("invalid_request", "brief.run.elapsed_ms"));
    expect(await parseContentBriefHandoff(await handoff((draft) => { draft.brief.run.mode = "complete"; }), deps)).toEqual(failure("brief_reference_invalid", "brief.run.mode"));
    expect(await parseContentBriefHandoff(await handoff((draft) => { draft.brief.run.reads.llm.input_tokens = 1; }), deps)).toEqual(failure("brief_fingerprint_mismatch", "brief.run.fingerprint"));
  });
});
