import { describe, expect, it } from "vitest";
import type { ResearchPage } from "@sf/public-tools/content-brief/v2-contract";
import type { BriefV2Context } from "@sf/public-tools/content-brief/v2-generation-contract";
import { buildResearchBundle } from "@sf/public-tools/content-brief/v2-research";
import { buildSerpObservations } from "@sf/public-tools/content-brief/assemble";
import { buildBriefV2Observations } from "./content-brief-v2-observations.ts";

function page(id: string, value = 100, options: {
  readonly finalUrl?: string;
  readonly unit?: "words" | "non_whitespace_characters";
  readonly complete?: boolean;
  readonly omitted?: number;
  readonly truncated?: boolean;
  readonly heading?: string;
  readonly text?: string;
} = {}): ResearchPage {
  const finalUrl = options.finalUrl ?? `https://${id.toLowerCase()}.example/article`;
  const unit = options.unit ?? "words";
  const segments = value === 0 ? [] : [{
    heading: options.heading ? { level: "h2" as const, text: options.heading } : null,
    text: options.text ?? (unit === "words" ? "Observation." : "观测"),
    truncated: options.truncated ?? false,
  }];
  return {
    id, role: id.startsWith("T") ? "owned" : "competitor", url: finalUrl, final_url: finalUrl,
    fetched_at: "2026-08-31T00:00:00.000Z", content_hash: "a".repeat(64), body_complete: options.complete ?? true,
    research: {
      segments, segments_total: segments.length + (options.omitted ?? 0), omitted_segments: options.omitted ?? 0,
      length: { value, unit, tokenizer: unit === "words" ? "whitespace" : "unicode_code_points" },
    },
  };
}

function context(pages: readonly ResearchPage[]): BriefV2Context {
  const research = buildResearchBundle(pages, []);
  if (!research.ok) throw new Error(`fixture: ${research.path}`);
  return {
    input: { primary: "observations", supporting: [], market: "US", language: "en" },
    research: research.value, facts: [], profile_snapshot: null,
    gsc: { status: "unavailable", property: null, window: null, reason: "not_requested", matches: [], omitted_matches: 0 },
    candidates: [],
  };
}

describe("Brief v2 source observations", () => {
  it("returns an explicitly scoped empty observation instead of zero-valued length statistics", () => {
    expect(buildBriefV2Observations(context([]))).toEqual({
      scope: "retained_competitor_pages", question_coverage_denominator: 0, quantile_method: "linear_interpolation_n_minus_1", lengths: [],
      formats: { method: "url_heuristic", read: null, denominator: 0, unknown_count: 0, counts: [], majority: null, candidates: [], pages: [], partial_page_count: 0 },
    });
  });

  it("uses independently calculated linear-interpolation quantiles without mutating the frozen input", () => {
    const input = context([page("C1", 900), page("C2", 100), page("C3", 400), page("C4", 200)]);
    const before = JSON.stringify(input);
    expect(buildBriefV2Observations(input).lengths).toEqual([{
      unit: "words", count: 4, p25: 175, median: 300, p75: 525, min: 100, max: 900,
      page_refs: ["C1", "C2", "C3", "C4"],
    }]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    { values: [10], p25: 10, median: 10, p75: 10 },
    { values: [10, 20], p25: 12.5, median: 15, p75: 17.5 },
    { values: [5, 1, 9, 3, 7], p25: 3, median: 5, p75: 7 },
  ])("keeps exact small-sample quantiles for $values", ({ values, p25, median, p75 }) => {
    const result = buildBriefV2Observations(context(values.map((value, i) => page(`C${i + 1}`, value))));
    expect(result.lengths[0]).toMatchObject({ count: values.length, p25, median, p75 });
  });

  it("keeps CJK character measurements separate from word measurements even for an English run", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 100), page("C2", 1000, { unit: "non_whitespace_characters" }),
      page("C3", 300), page("C4", 3000, { unit: "non_whitespace_characters" }),
    ]));
    expect(result.lengths).toEqual([
      { unit: "words", count: 2, p25: 150, median: 200, p75: 250, min: 100, max: 300, page_refs: ["C1", "C3"] },
      { unit: "non_whitespace_characters", count: 2, p25: 1500, median: 2000, p75: 2500, min: 1000, max: 3000, page_refs: ["C2", "C4"] },
    ]);
  });

  it("excludes incomplete bodies from length statistics while retaining their format observations", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 100, { finalUrl: "https://one.example/blog/a" }),
      page("C2", 9000, { finalUrl: "https://two.example/tools/a", complete: false }),
      page("C3", 300, { finalUrl: "https://three.example/blog/b", omitted: 3, truncated: true }),
    ]));
    expect(result.lengths).toEqual([{ unit: "words", count: 2, p25: 150, median: 200, p75: 250, min: 100, max: 300, page_refs: ["C1", "C3"] }]);
    expect(result.formats).toMatchObject({ denominator: 3, partial_page_count: 2 });
    expect(result.formats.pages[1]).toMatchObject({ page_ref: "C2", format: "tool", body_complete: false });
    expect(result.formats.pages[2]).toMatchObject({ page_ref: "C3", body_complete: true, omitted_segments: 3, truncated_segments: 1 });
  });

  it("does not turn absent or non-finite length measurements into zero", () => {
    const input = context([page("C1"), page("C2"), page("C3"), page("C4", 50)]);
    const lengths = [null, undefined, Number.NaN, 50];
    const malformed = { ...input, research: { ...input.research, pages: input.research.pages.map((item, i) => ({ ...item, research: { ...item.research, length: { ...item.research.length, value: lengths[i] as number } } })) } };
    expect(buildBriefV2Observations(malformed).lengths).toEqual([{ unit: "words", count: 1, p25: 50, median: 50, p75: 50, min: 50, max: 50, page_refs: ["C4"] }]);
  });

  it("retains an actual observed zero measurement without inventing a missing one", () => {
    expect(buildBriefV2Observations(context([page("C1", 0)])).lengths).toEqual([{ unit: "words", count: 1, p25: 0, median: 0, p75: 0, min: 0, max: 0, page_refs: ["C1"] }]);
  });

  it("deduplicates exact final URLs minus fragments and chooses the first reliable length observation", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 9000, { finalUrl: "https://site.example/blog/a#intro", complete: false }),
      page("C2", 100, { finalUrl: "https://site.example/blog/a#conclusion" }),
      page("C3", 900, { finalUrl: "https://site.example/blog/a" }),
      page("C4", 300, { finalUrl: "https://site.example/blog/a?campaign=one" }),
      page("C5", 500, { finalUrl: "https://www.site.example/blog/a" }),
    ]));
    expect(result.lengths).toEqual([{ unit: "words", count: 3, p25: 200, median: 300, p75: 400, min: 100, max: 500, page_refs: ["C2", "C4", "C5"] }]);
    expect(result.formats).toMatchObject({ denominator: 3, counts: [{ format: "guide", count: 3, page_refs: ["C1", "C4", "C5"] }], partial_page_count: 1 });
  });

  it("excludes owned pages from every competitor statistic and source count", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 100, { finalUrl: "https://competitor.example/tools/a" }),
      page("T1", 100000, { finalUrl: "https://owned.example/blog/a", complete: false }),
    ]));
    expect(result.lengths).toEqual([{ unit: "words", count: 1, p25: 100, median: 100, p75: 100, min: 100, max: 100, page_refs: ["C1"] }]);
    expect(result.formats).toMatchObject({ denominator: 1, majority: "tool", candidates: ["tool"], partial_page_count: 0 });
    expect(result.formats.pages.map((item) => item.page_ref)).toEqual(["C1"]);
  });

  it("uses the actual final URL and preserves the ordered classifier rules and URL-only basis", () => {
    const redirected = { ...page("C1", 100, { finalUrl: "https://reddit.com/tools/compare/a" }), url: "https://old.example/blog/a" };
    const result = buildBriefV2Observations(context([redirected]));
    expect(result.formats.pages).toEqual([{
      page_ref: "C1", final_url: "https://reddit.com/tools/compare/a", format: "forum",
      url: "https://reddit.com/tools/compare/a", title: null, rank: null,
      rules_hit: ["host:forum", "path:compare", "path:tools"], basis: "final_url_only",
      body_complete: true, omitted_segments: 0, truncated_segments: 0,
    }]);
    expect(result.formats.method).toBe("url_heuristic");
  });

  it("does not invent a page title from prose or H2 when the contract retains no observed H1", () => {
    const result = buildBriefV2Observations(context([page("C1", 100, { heading: "How to use a tool", text: "10 best tools guide" })]));
    expect(result.formats).toMatchObject({ denominator: 1, unknown_count: 1, majority: null, candidates: [], counts: [{ format: "unknown", count: 1, page_refs: ["C1"] }] });
    expect(result.formats.pages[0]).toMatchObject({ format: "unknown", rules_hit: [], basis: "final_url_only" });
  });

  it("returns all actual known candidates for a tie without treating unknown pages as missing denominator", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 100, { finalUrl: "https://a.example/blog/a" }), page("C2", 100, { finalUrl: "https://b.example/tools/a" }),
      page("C3", 100, { finalUrl: "https://c.example/article" }),
    ]));
    expect(result.formats).toMatchObject({
      denominator: 3, unknown_count: 1, majority: null, candidates: ["guide", "tool"],
      counts: [{ format: "guide", count: 1, page_refs: ["C1"] }, { format: "tool", count: 1, page_refs: ["C2"] }, { format: "unknown", count: 1, page_refs: ["C3"] }],
    });
  });

  it("does not declare a majority at exactly half including unknown pages", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 100, { finalUrl: "https://a.example/blog/a" }), page("C2", 100, { finalUrl: "https://b.example/blog/a" }),
      page("C3", 100, { finalUrl: "https://c.example/tools/a" }), page("C4", 100, { finalUrl: "https://d.example/article" }),
    ]));
    expect(result.formats).toMatchObject({ denominator: 4, unknown_count: 1, majority: null, candidates: ["guide", "tool"] });
  });

  it("declares a known format majority only above half of the entire observed denominator", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 100, { finalUrl: "https://a.example/blog/a" }), page("C2", 100, { finalUrl: "https://b.example/blog/a" }),
      page("C3", 100, { finalUrl: "https://c.example/blog/a" }), page("C4", 100, { finalUrl: "https://d.example/article" }),
    ]));
    expect(result.formats).toMatchObject({ denominator: 4, unknown_count: 1, majority: "guide", candidates: ["guide"] });
  });

  it("uses the same URL serialization and fragment removal as the question coverage validator", () => {
    const result = buildBriefV2Observations(context([
      page("C1", 100, { finalUrl: "https://source.example" }),
      page("C2", 500, { finalUrl: "https://source.example/#part" }),
    ]));
    expect(result.question_coverage_denominator).toBe(1);
    expect(result.formats.denominator).toBe(1);
    expect(result.lengths).toEqual([{ unit: "words", count: 1, p25: 100, median: 100, p75: 100, min: 100, max: 100, page_refs: ["C1"] }]);
  });

  it("uses raw sampled SERP titles and URLs independently of crawled-page lengths and question coverage", () => {
    const input: BriefV2Context = {
      ...context([{ ...page("C1", 100, { finalUrl: "https://competitor.example/blog/final", complete: false }), url: "https://competitor.example/report" }]),
      serp: {
        rows: buildSerpObservations([
          { rank: 1, url: "https://competitor.example/report", domain: "competitor.example", title: "10 best reporting checks" },
          { rank: 2, url: "https://owned.example/pricing", domain: "owned.example", title: "Our pricing" },
          { rank: 3, url: null, domain: "other.example", title: null },
        ]),
        read: { status: "partial", requested: 10, returned: 3, unresolved: 2 },
      },
    };
    const before = JSON.stringify(input);
    const result = buildBriefV2Observations(input);
    expect(result).toMatchObject({ scope: "sampled_serp", question_coverage_denominator: 1, lengths: [] });
    expect(result.formats).toMatchObject({
      method: "url_title_heuristic", read: input.serp!.read, denominator: 3, unknown_count: 1,
      majority: null, candidates: ["listicle", "product_page"], partial_page_count: null,
      counts: [{ format: "listicle", count: 1, page_refs: ["S1"] }, { format: "product_page", count: 1, page_refs: ["S2"] }, { format: "unknown", count: 1, page_refs: ["S3"] }],
    });
    expect(result.formats.pages[0]).toEqual({
      page_ref: "S1", url: "https://competitor.example/report", final_url: null, title: "10 best reporting checks", rank: 1,
      format: "listicle", rules_hit: ["title:leading_number", "title:best"], basis: "serp_title_url",
      body_complete: null, omitted_segments: null, truncated_segments: null,
    });
    expect(result.formats.read).not.toBe(input.serp!.read);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("counts sampled SERP rows separately even when multiple positions resolve to the same URL", () => {
    const input: BriefV2Context = { ...context([]), serp: {
      rows: buildSerpObservations([
        { rank: 1, url: "https://site.example/blog/a", domain: "site.example", title: null },
        { rank: 2, url: "https://site.example/blog/a", domain: "site.example", title: null },
        { rank: 3, url: "https://other.example/article", domain: "other.example", title: null },
      ]), read: { status: "complete", requested: 3, returned: 3, unresolved: 0 },
    } };
    const result = buildBriefV2Observations(input);
    expect(result.question_coverage_denominator).toBe(0);
    expect(result.formats).toMatchObject({ denominator: 3, majority: "guide", counts: [{ format: "guide", count: 2, page_refs: ["S1", "S2"] }, { format: "unknown", count: 1, page_refs: ["S3"] }] });
  });

  it("retains unknown majority and multiple actual candidates without substituting a writing recommendation", () => {
    const rows = buildSerpObservations([
      { rank: 1, url: "https://one.example/article", domain: "one.example", title: "Ordinary article" },
      { rank: 2, url: null, domain: "two.example", title: null },
      { rank: 3, url: "not a URL", domain: "three.example", title: null },
      { rank: 4, url: null, domain: "four.example", title: "How to check a report" },
      { rank: 5, url: "https://five.example/tools/report", domain: "five.example", title: null },
    ]);
    const result = buildBriefV2Observations({ ...context([]), serp: { rows, read: { status: "complete", requested: 5, returned: 5, unresolved: 0 } } });
    expect(result.formats).toMatchObject({ denominator: 5, unknown_count: 3, majority: null, candidates: ["guide", "tool"] });
    expect(result.formats.pages[2]).toMatchObject({ url: "not a URL", final_url: null, format: "unknown", rules_hit: [] });
  });

  it("does not replace unavailable SERP metadata with zero or fallback page-format claims", () => {
    const result = buildBriefV2Observations({ ...context([]), serp: { rows: [], read: { status: "unavailable", reason: "timeout", attempted: null } } });
    expect(result).toMatchObject({ scope: "sampled_serp", question_coverage_denominator: 0, lengths: [], formats: {
      method: "url_title_heuristic", read: { status: "unavailable", reason: "timeout", attempted: null },
      denominator: 0, counts: [], candidates: [], majority: null, partial_page_count: null,
    } });
  });
});
