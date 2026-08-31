import { describe, expect, it } from "vitest";
import * as generation from "./v2-generation.ts";
import { buildResearchBundle } from "./v2-research.ts";
import { measureResearchLength, type ResearchPage } from "./v2-contract.ts";
import type { BriefV2Context, ModelBriefV2Output } from "./v2-generation-contract.ts";

function page(id: string, role: "competitor" | "owned", url: string, text: string): ResearchPage {
  return { id, role, url, final_url: url, fetched_at: "2026-08-31T00:00:00.000Z", content_hash: "a".repeat(64), body_complete: true,
    research: { segments: [{ heading: null, text, truncated: false }], segments_total: 1, omitted_segments: 0, length: measureResearchLength(text, "en") } };
}

function context(): BriefV2Context {
  const built = buildResearchBundle([
    page("C1", "competitor", "https://competitor.test/reporting", "Search Console reports can lag behind actual events."),
    page("T1", "owned", "https://owned.test/reporting", "Our reporting page explains how to read Search Console."),
    page("T2", "owned", "https://owned.test/dates", "Compare finalized date ranges to avoid incomplete data."),
  ], [{ id: "A1", question: "How late is Search Console data?", seed_question: null }]);
  if (!built.ok) throw new Error(built.path);
  return {
    input: { primary: "GSC delay", supporting: ["Search Console data"], market: "US", language: "en" }, research: built.value,
    facts: [{ id: "P1", field: "coreFeatures[0]", text: "Compares finalized date ranges", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } }],
    profile_snapshot: { website_id: "website-1", revision: 1, hash: "b".repeat(64) },
    gsc: { status: "complete", property: "sc-domain:owned.test", window: { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 }, reason: null, omitted_matches: 0, matches: [
      { id: "G1", query: "ＧＳＣ  DELAY", keyword: "GSC delay", scope: "primary", page: "https://owned.test/reporting", clicks: 1, impressions: 3, position: 70 },
      { id: "G2", query: "search console data", keyword: "Search Console data", scope: "supporting", page: "https://owned.test/dates", clicks: 0, impressions: 1, position: null },
    ] },
    candidates: [
      { id: "T1", url: "https://owned.test/reporting", match_refs: ["G1"], read: "observed" },
      { id: "T2", url: "https://owned.test/dates", match_refs: ["G2"], read: "observed" },
    ],
  };
}

function model(): ModelBriefV2Output {
  return {
    research: { questions: [{ anchor: "U1", q: "Why is Search Console data delayed?", sources: ["U1", "U4"] }], outline: [{ h2: "Understand reporting delays", h3: ["Check finalized dates"], answers: ["U1"] }] },
    intent: { value: "informational", rationale: "Readers need reporting guidance." },
    format: { value: "guide", rationale: "Explain the reporting process." },
    page_plan: { action: "update", rationale: "The existing reporting page addresses this topic.", target_ref: "T1", steps: [
      { kind: "keep", instruction: "Retain the reporting introduction.", sources: ["U2"], answers: [] },
      { kind: "add", instruction: "Explain reporting delays and finalized dates.", sources: ["U1"], answers: ["U1"] },
    ] },
    gap_angle: { value: "Show finalized date comparisons", rationale: "Connect reporting advice to the declared feature.", fact_refs: ["P1"], sources: ["U1"] },
    internal_links: [{ page_ref: "T2", anchor: "finalized date ranges", why: "Explain the comparison method." }],
    do_not_cover: [{ page_ref: "T2", topic: "Full date comparison setup", why: "The dedicated page already covers it." }],
  };
}

function changed(value: unknown, path: readonly (string | number)[], replacement: unknown): unknown {
  const copy = structuredClone(value) as Record<string | number, unknown>;
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[path.at(-1)!] = replacement;
  return copy;
}

describe("v2 exact frozen generation context", () => {
  it("rejects a foreign page even when every owned-page reference has been consistently rewritten", () => {
    const input = context();
    const foreign = "https://foreign.test/owned";
    const corrupted = { ...input,
      gsc: { ...input.gsc, matches: input.gsc.matches.map((item) => item.id === "G1" ? { ...item, page: foreign } : item) },
      candidates: input.candidates.map((item) => item.id === "T1" ? { ...item, url: foreign } : item),
      research: { ...input.research, pages: input.research.pages.map((item) => item.id === "T1" ? { ...item, url: foreign, final_url: foreign } : item) },
    };
    expect(generation.parseBriefV2Context(corrupted).ok).toBe(false);
    expect(generation.validateModelBriefV2(model(), corrupted).ok).toBe(false);
  });

  it.each(["url", "final_url"] as const)("does not count known owned-property %s as competitor evidence", (key) => {
    expect(generation.parseBriefV2Context(changed(context(), ["research", "pages", 0, key], "https://owned.test/another-page")).ok).toBe(false);
  });

  it("does not allow owned candidates without a known GSC property", () => {
    const input = context();
    const unknown = { ...input,
      gsc: { status: "unavailable" as const, reason: "not_requested" as const, property: null, window: null, matches: [], omitted_matches: 0 },
      candidates: input.candidates.map((item) => ({ ...item, match_refs: [] })),
    };
    expect(generation.parseBriefV2Context(unknown).ok).toBe(false);
  });

  it("validates the property itself even when the GSC sample has no rows", () => {
    const input = { ...context(), research: { ...context().research, pages: [], units: [] }, candidates: [] };
    const research = buildResearchBundle([], []);
    if (!research.ok) throw new Error(research.path);
    for (const property of ["unknown", "sc-domain:", "sc-domain:owned.test/path", "https://owned.test/?q=x"]) {
      expect(generation.parseBriefV2Context({ ...input, research: research.value, gsc: { ...input.gsc, property, matches: [] } }).ok).toBe(false);
    }
  });

  it("enforces the URL-prefix property on owned submitted and final URLs", () => {
    const input = context();
    const onePage = { ...input, gsc: { ...input.gsc, property: "https://owned.test/reporting", matches: [input.gsc.matches[0]!] }, candidates: [input.candidates[0]!] };
    const research = buildResearchBundle(input.research.pages.filter((item) => item.id !== "T2"), input.research.paa);
    if (!research.ok) throw new Error(research.path);
    const valid = { ...onePage, research: research.value };
    expect(generation.parseBriefV2Context(valid).ok).toBe(true);
    expect(generation.parseBriefV2Context(changed(valid, ["research", "pages", 1, "final_url"], "https://www.owned.test/reporting")).ok).toBe(false);
    expect(generation.parseBriefV2Context(changed(valid, ["gsc", "property"], "https://owned.test/report")).ok).toBe(false);
  });

  it("rejects duplicate canonical candidate pages and their alias self-link", () => {
    const input = context();
    const alias = "https://owned.test/reporting/?utm_source=test";
    const duplicated = { ...input,
      gsc: { ...input.gsc, matches: input.gsc.matches.map((item) => item.id === "G2" ? { ...item, page: alias } : item) },
      candidates: input.candidates.map((item) => item.id === "T2" ? { ...item, url: alias } : item),
      research: { ...input.research, pages: input.research.pages.map((item) => item.id === "T2" ? { ...item, url: alias, final_url: alias } : item) },
    };
    expect(generation.parseBriefV2Context(duplicated).ok).toBe(false);
    expect(generation.validateModelBriefV2(model(), duplicated).ok).toBe(false);
  });

  it("accepts candidate match references across canonical aliases while retaining raw URL observations", () => {
    const input = context();
    const alias = "https://owned.test/%72eporting/?utm_source=test#part";
    const source = { ...input, gsc: { ...input.gsc, matches: input.gsc.matches.map((item) => item.id === "G1" ? { ...item, page: alias } : item) } };
    const parsed = generation.parseBriefV2Context(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.path);
    expect(parsed.value.gsc.matches[0]?.page).toBe(alias);
    expect(parsed.value.candidates[0]?.url).toBe("https://owned.test/reporting");
  });

  it("retains distinct observed URL aliases and accepts all their refs on one canonical candidate", () => {
    const input = context();
    const repeated = { ...input, gsc: { ...input.gsc, matches: [...input.gsc.matches,
      { ...input.gsc.matches[0]!, id: "G3", page: "https://owned.test/reporting/?utm_source=extra" },
    ] }, candidates: input.candidates.map((item) => item.id === "T1" ? { ...item, match_refs: ["G1", "G3"] } : item) };
    expect(generation.parseBriefV2Context(repeated).ok).toBe(true);
  });

  it.each([
    ["https://owned.test/another-page", false],
    ["https://foreign.test/reporting", false],
    ["https://blog.owned.test/reporting", false],
    ["https://owned.test/reporting?mode=new", false],
    ["http://owned.test/reporting", false],
    ["https://www.owned.test/reporting/", true],
    ["https://owned.test/%72eporting?utm_source=test#part", true],
  ])("independently binds observed target final URL %s", (destination, accepted) => {
    expect(generation.parseBriefV2Context(changed(context(), ["research", "pages", 1, "final_url"], destination)).ok).toBe(accepted);
  });

  it("retains primary and supporting query scope independently, even with weak ranking signals", () => {
    expect(generation.parseBriefV2Context).toBeTypeOf("function");
    const input = context();
    const result = generation.parseBriefV2Context(input);
    expect(result).toEqual({ ok: true, value: input });
    if (!result.ok) throw new Error(result.path);
    expect(result.value).not.toBe(input);
    expect(result.value.research.pages).not.toBe(input.research.pages);
  });

  it("accepts page-only owned candidates with no matched query refs", () => {
    expect(generation.parseBriefV2Context).toBeTypeOf("function");
    expect(generation.parseBriefV2Context(changed(context(), ["candidates", 1, "match_refs"], [])).ok).toBe(true);
  });

  it("preserves inferred profile provenance without rebranding it observed", () => {
    expect(generation.parseBriefV2Context).toBeTypeOf("function");
    const facts = [{ id: "P1", field: "positioning", text: "Possible angle", derivation: "inferred", provenance: { method: "model", derived_from: ["product_profile"] } }];
    expect(generation.parseBriefV2Context(changed(context(), ["facts"], facts)).ok).toBe(true);
  });

  it.each([
    ["extra field", ["unexpected"], true],
    ["empty primary", ["input", "primary"], "  "],
    ["long primary", ["input", "primary"], "𠀀".repeat(201)],
    ["unnormalized primary whitespace", ["input", "primary"], " GSC  delay "],
    ["equivalent supporting duplicate", ["input", "supporting"], ["Search Console data", "Ｓｅａｒｃｈ Console DATA"]],
    ["supporting equals primary", ["input", "supporting"], ["ＧＳＣ delay"]],
    ["supporting overflow", ["input", "supporting"], Array.from({ length: 9 }, (_v, i) => `query ${i}`)],
    ["empty market", ["input", "market"], ""],
    ["long language", ["input", "language"], "a".repeat(65)],
    ["empty fact", ["facts", 0, "text"], ""],
    ["long fact", ["facts", 0, "text"], "𠀀".repeat(301)],
    ["fact provenance mismatch", ["facts", 0, "derivation"], "inferred"],
    ["facts without source snapshot", ["profile_snapshot"], null],
    ["invalid snapshot hash", ["profile_snapshot", "hash"], "bad"],
    ["zero snapshot revision", ["profile_snapshot", "revision"], 0],
    ["fractional snapshot revision", ["profile_snapshot", "revision"], 1.5],
    ["duplicate fact id", ["facts"], [context().facts[0], context().facts[0]]],
    ["fact overflow", ["facts"], Array.from({ length: 33 }, (_v, i) => ({ ...context().facts[0], id: `P${i + 1}` }))],
    ["supporting mislabeled primary", ["gsc", "matches", 1, "scope"], "primary"],
    ["unrelated query", ["gsc", "matches", 1, "query"], "search console data pricing"],
    ["unrelated declared keyword", ["gsc", "matches", 1, "keyword"], "GSC delay"],
    ["noncanonical G id", ["gsc", "matches", 1, "id"], "G3"],
    ["negative clicks", ["gsc", "matches", 0, "clicks"], -1],
    ["infinite impressions", ["gsc", "matches", 0, "impressions"], Infinity],
    ["zero position", ["gsc", "matches", 0, "position"], 0],
    ["complete with omission", ["gsc", "omitted_matches"], 1],
    ["complete with reason", ["gsc", "reason"], "provider_error"],
    ["complete without property", ["gsc", "property"], null],
    ["complete without window", ["gsc", "window"], null],
    ["impossible start date", ["gsc", "window", "start"], "2026-02-30"],
    ["invalid date format", ["gsc", "window", "start"], "2026-8-1"],
    ["wrong inclusive window", ["gsc", "window", "start"], "2026-08-02"],
    ["reversed window", ["gsc", "window", "start"], "2026-08-29"],
    ["wrong lookback", ["gsc", "window", "lookback_days"], 27],
    ["credentials in page", ["gsc", "matches", 0, "page"], "https://user:pass@owned.test/reporting"],
    ["duplicate raw query-page", ["gsc", "matches"], [context().gsc.matches[0], { ...context().gsc.matches[0], id: "G2", page: "https://owned.test/reporting#section" }]],
    ["unknown candidate query ref", ["candidates", 0, "match_refs"], ["G99"]],
    ["duplicate candidate query ref", ["candidates", 0, "match_refs"], ["G1", "G1"]],
    ["candidate query ref belongs to other page", ["candidates", 0, "match_refs"], ["G2"]],
    ["observed candidate URL mismatch", ["candidates", 0, "url"], "https://owned.test/unread"],
    ["unavailable candidate retains body", ["candidates", 0, "read"], "unavailable"],
    ["redirected candidate retains body", ["candidates", 0, "read"], "redirected"],
    ["orphan owned research page", ["candidates"], [context().candidates[0]]],
    ["duplicate canonical candidate URL", ["candidates", 1, "url"], "https://owned.test/reporting#two"],
    ["candidate outside id cap", ["candidates", 1, "id"], "T4"],
    ["forged research unit", ["research", "units", 0, "page_ref"], "C99"],
  ] as const)("rejects %s", (_label, path, replacement) => {
    expect(generation.parseBriefV2Context).toBeTypeOf("function");
    expect(generation.parseBriefV2Context(changed(context(), path, replacement)).ok).toBe(false);
  });

  it("pins unavailable GSC reason/property and empty-match semantics", () => {
    expect(generation.parseBriefV2Context).toBeTypeOf("function");
    const input = context();
    const research = buildResearchBundle([], []);
    if (!research.ok) throw new Error(research.path);
    const base = { ...input, research: research.value, candidates: [], gsc: { status: "unavailable", property: null, window: null, reason: "not_requested", matches: [], omitted_matches: 0 } };
    expect(generation.parseBriefV2Context(base).ok).toBe(true);
    expect(generation.parseBriefV2Context(changed(base, ["gsc", "property"], "sc-domain:owned.test")).ok).toBe(false);
    expect(generation.parseBriefV2Context(changed(base, ["gsc", "window"], context().gsc.window)).ok).toBe(false);
    expect(generation.parseBriefV2Context(changed(base, ["gsc", "reason"], "timeout")).ok).toBe(false);
    expect(generation.parseBriefV2Context(changed(base, ["gsc", "reason"], null)).ok).toBe(false);
    expect(generation.parseBriefV2Context(changed(base, ["gsc", "matches"], context().gsc.matches)).ok).toBe(false);
    expect(generation.parseBriefV2Context({ ...base, gsc: { ...base.gsc, property: "sc-domain:owned.test", reason: "not_connected" } }).ok).toBe(true);
    expect(generation.parseBriefV2Context({ ...base, gsc: { ...base.gsc, property: "sc-domain:owned.test", reason: "timeout" } }).ok).toBe(true);
  });

  it("preserves raw provider spelling variants for the same normalized query and page", () => {
    const input = context();
    const matches = [...input.gsc.matches, { ...input.gsc.matches[0]!, id: "G3", query: "gsc delay" }];
    expect(generation.parseBriefV2Context({ ...input, gsc: { ...input.gsc, matches } }).ok).toBe(true);
  });

  it("allows no facts with no snapshot or an observed empty snapshot", () => {
    const input = { ...context(), facts: [] };
    expect(generation.parseBriefV2Context(input).ok).toBe(true);
    expect(generation.parseBriefV2Context({ ...input, profile_snapshot: null }).ok).toBe(true);
  });

  it("does not treat an owned page with no retained body as an observed candidate", () => {
    const input = context();
    const research = buildResearchBundle(input.research.pages.map((item) => item.id === "T1"
      ? { ...item, research: { ...item.research, segments: [], omitted_segments: 1 } } : item), input.research.paa);
    if (!research.ok) throw new Error(research.path);
    expect(generation.parseBriefV2Context({ ...input, research: research.value }).ok).toBe(false);
  });
});

describe("v2 browser-safe owned page identity", () => {
  it("shares canonical subject identity without collapsing meaningful queries", () => {
    expect(generation.briefV2PageKey).toBeTypeOf("function");
    expect(generation.briefV2PageKey("https://owned.test/%67uide/?utm_source=x&b=2&a=1#part")).toBe("https://owned.test/guide?a=1&b=2");
    expect(generation.briefV2PageKey("https://owned.test/guide?view=one")).not.toBe(generation.briefV2PageKey("https://owned.test/guide?view=two"));
    expect(generation.briefV2PageKey("https://user:pass@owned.test/guide")).toBeNull();
  });
  it.each([
    ["http://owned.test/report", "https://www.owned.test/report/", true],
    ["https://www.owned.test/report/", "https://owned.test/report", true],
    ["https://owned.test/report?a=1&b=2", "https://owned.test/report?b=2&a=1", true],
    ["https://owned.test/report?q=old", "https://owned.test/report?q=new", false],
    ["https://owned.test/report", "http://owned.test/report", false],
    ["https://owned.test/report", "https://foreign.test/report", false],
    ["https://owned.test/report", "https://blog.owned.test/report", false],
    ["https://www.owned.test/report", "https://www.www.owned.test/report", false],
    ["https://user:pass@owned.test/report", "https://owned.test/report", false],
    ["https://owned.test/report", "https://user:pass@owned.test/report", false],
    ["ftp://owned.test/report", "https://owned.test/report", false],
    ["not a URL", "https://owned.test/report", false],
  ])("compares %s to %s", (submitted, destination, accepted) => {
    expect(generation.sameBriefV2OwnedPage).toBeTypeOf("function");
    expect(generation.sameBriefV2OwnedPage(submitted, destination)).toBe(accepted);
  });
});

describe("v2 whole model result", () => {
  it("requires research to be an own field rather than accepting a prototype value", () => {
    const { research, ...writing } = model();
    const inherited = Object.assign(Object.create({ research }) as Record<string, unknown>, writing);
    expect(generation.validateModelBriefV2(inherited, context()).ok).toBe(false);
  });

  it("normalizes only free text and derives stable question references in the whole writing plan", () => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    const input = changed(changed(model(), ["research", "questions", 0, "q"], "  Why is\nSearch Console data delayed? "), ["page_plan", "rationale"], "  Existing\tpage. ");
    const parsed = generation.validateModelBriefV2(input, context());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.path);
    expect(parsed.value.research.questions).toEqual([{ id: "Q1", anchor: "U1", q: "Why is Search Console data delayed?", source_refs: ["U1", "U4"], covered_by: 1, paa_refs: ["A1"] }]);
    expect(parsed.value.research.outline[0]).toEqual({ id: "O1", h2: "Understand reporting delays", h3: ["Check finalized dates"], answers: ["Q1"] });
    expect(parsed.value.page_plan.rationale).toBe("Existing page.");
    expect(parsed.value.page_plan.steps[1]?.answers).toEqual(["Q1"]);
    expect(model().page_plan.steps[1]?.answers).toEqual(["U1"]);
  });

  it("allows a PAA-supported added question with no factual source", () => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    expect(generation.validateModelBriefV2(changed(model(), ["page_plan", "steps", 1, "sources"], []), context()).ok).toBe(true);
  });

  it("accepts one PAA-only question without a competitor-page threshold or fabricated factual coverage", () => {
    const input = context();
    const research = buildResearchBundle([], input.research.paa);
    if (!research.ok) throw new Error(research.path);
    const paaOnly = { ...input, research: research.value, candidates: [], gsc: { ...input.gsc, matches: [] } };
    const output = { ...model(),
      research: { questions: [{ anchor: "U1", q: "How late is Search Console data?", sources: ["U1"] }], outline: [{ h2: "Understand reporting delays", h3: [], answers: ["U1"] }] },
      page_plan: { action: "create", rationale: "No matching page appears in the observed GSC sample.", target_ref: null, steps: [] },
      gap_angle: null, internal_links: [], do_not_cover: [],
    };
    const parsed = generation.validateModelBriefV2(output, paaOnly);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.path);
    expect(parsed.value.research.questions[0]).toMatchObject({ covered_by: 0, paa_refs: ["A1"] });
  });

  it("allows a rewrite step only when bound to actual target text", () => {
    const output = changed(model(), ["page_plan", "steps", 1], { kind: "rewrite", instruction: "Rewrite the reporting introduction to explain the delay.", sources: ["U2"], answers: ["U1"] });
    expect(generation.validateModelBriefV2(output, context()).ok).toBe(true);
    expect(generation.validateModelBriefV2(changed(output, ["page_plan", "steps", 1, "sources"], ["U1"]), context()).ok).toBe(false);
  });

  it("allows a safe create only with complete GSC and observed candidates, or an explicit undecidable recommendation", () => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    const create = changed(model(), ["page_plan"], { action: "create", rationale: "Observed candidates address distinct topics.", target_ref: null, steps: [] });
    expect(generation.validateModelBriefV2(create, context()).ok).toBe(true);
    const uncertain = { ...context(), gsc: { ...context().gsc, status: "partial" as const } };
    expect(generation.validateModelBriefV2(create, uncertain).ok).toBe(false);
    expect(generation.validateModelBriefV2(changed(create, ["page_plan", "action"], "undecidable"), uncertain).ok).toBe(true);
  });

  it("allows zero relevant questions with an empty outline and nullable writing choices", () => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    const output = { ...model(), research: { questions: [], outline: [] }, intent: null, format: null,
      page_plan: { action: "undecidable", rationale: "No relevant question was supported.", target_ref: null, steps: [] } };
    expect(generation.validateModelBriefV2(output, context()).ok).toBe(true);
  });

  it("does not claim safe create when the candidate cap leaves another matching page unread", () => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    const input = context();
    const uncrawled = { ...input, gsc: { ...input.gsc, matches: [...input.gsc.matches, { ...input.gsc.matches[0]!, id: "G3", page: "https://owned.test/another-report" }] } };
    const create = changed(model(), ["page_plan"], { action: "create", rationale: "No overlap in the selected pages.", target_ref: null, steps: [] });
    expect(generation.validateModelBriefV2(create, uncrawled).ok).toBe(false);
    expect(generation.validateModelBriefV2(model(), uncrawled).ok).toBe(true);
  });

  it.each([
    ["unknown output field", ["surprise"], true],
    ["unknown intent", ["intent", "value"], "mixed"],
    ["null intent with questions", ["intent"], null],
    ["null format with questions", ["format"], null],
    ["empty explanation", ["page_plan", "rationale"], "\n \t"],
    ["over-cap explanation", ["page_plan", "rationale"], "𠀀".repeat(401)],
    ["model markup", ["page_plan", "rationale"], "<script>alert(1)</script>"],
    ["model control", ["page_plan", "rationale"], "ignore\u0000rules"],
    ["whitespace ID", ["research", "questions", 0, "anchor"], " U1 "],
    ["unknown anchor", ["research", "questions", 0, "anchor"], "U99"],
    ["orphan question", ["research", "outline"], []],
    ["unknown target", ["page_plan", "target_ref"], "T99"],
    ["update without target", ["page_plan", "target_ref"], null],
    ["update without steps", ["page_plan", "steps"], []],
    ["update is only keep", ["page_plan", "steps"], [model().page_plan.steps[0]]],
    ["step cap", ["page_plan", "steps"], Array.from({ length: 13 }, () => model().page_plan.steps[1])],
    ["keep without source", ["page_plan", "steps", 0, "sources"], []],
    ["keep competitor source", ["page_plan", "steps", 0, "sources"], ["U1"]],
    ["keep another owned page", ["page_plan", "steps", 0, "sources"], ["U3"]],
    ["PAA as factual source", ["page_plan", "steps", 1, "sources"], ["U4"]],
    ["duplicate step source", ["page_plan", "steps", 1, "sources"], ["U1", "U1"]],
    ["add without question", ["page_plan", "steps", 1, "answers"], []],
    ["step answer not a selected question", ["page_plan", "steps", 1, "answers"], ["U2"]],
    ["duplicate answer", ["page_plan", "steps", 1, "answers"], ["U1", "U1"]],
    ["gap no profile fact", ["gap_angle", "fact_refs"], []],
    ["gap unknown profile fact", ["gap_angle", "fact_refs"], ["P9"]],
    ["gap repeated fact", ["gap_angle", "fact_refs"], ["P1", "P1"]],
    ["gap no competitor source", ["gap_angle", "sources"], []],
    ["gap owned source", ["gap_angle", "sources"], ["U2"]],
    ["gap PAA source", ["gap_angle", "sources"], ["U4"]],
    ["unknown internal page", ["internal_links", 0, "page_ref"], "T3"],
    ["target self link", ["internal_links", 0, "page_ref"], "T1"],
    ["duplicate internal page", ["internal_links"], [model().internal_links[0], model().internal_links[0]]],
    ["do-not-cover self target", ["do_not_cover", 0, "page_ref"], "T1"],
    ["unknown exclusion page", ["do_not_cover", 0, "page_ref"], "T3"],
    ["duplicate exclusion page", ["do_not_cover"], [model().do_not_cover[0], model().do_not_cover[0]]],
  ] as const)("rejects the whole result for %s", (_label, path, replacement) => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    expect(generation.validateModelBriefV2(changed(model(), path, replacement), context()).ok).toBe(false);
  });

  it("rejects update and create when a candidate was not observed, preserving undecidable", () => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    const input = context();
    const research = buildResearchBundle(input.research.pages.filter((item) => item.id !== "T1"), input.research.paa);
    if (!research.ok) throw new Error(research.path);
    const unread = { ...input, research: research.value, candidates: input.candidates.map((item) => item.id === "T1" ? { ...item, read: "unavailable" as const } : item) };
    const empty = { ...model(), research: { questions: [], outline: [] }, intent: null, format: null, gap_angle: null, internal_links: [], do_not_cover: [] };
    for (const read of ["unavailable", "redirected"] as const) {
      const state = { ...unread, candidates: unread.candidates.map((item) => item.id === "T1" ? { ...item, read } : item) };
      expect(generation.validateModelBriefV2(empty, state).ok).toBe(false);
      expect(generation.validateModelBriefV2({ ...empty, page_plan: { action: "create", rationale: "No current content", target_ref: null, steps: [] } }, state).ok).toBe(false);
      expect(generation.validateModelBriefV2({ ...empty, page_plan: { action: "undecidable", rationale: "Read the target before deciding", target_ref: null, steps: [] } }, state).ok).toBe(true);
    }
  });
});

describe("v2 frozen generated result", () => {
  it("recomputes both the research graph and plan answer mapping, without repairing exported text", () => {
    expect(generation.validateModelBriefV2).toBeTypeOf("function");
    expect(generation.parseBriefV2Generated).toBeTypeOf("function");
    const parsed = generation.validateModelBriefV2(model(), context());
    if (!parsed.ok) throw new Error(parsed.path);
    expect(generation.parseBriefV2Generated(parsed.value, context())).toEqual(parsed);
    for (const [path, replacement] of [
      [["research", "questions", 0, "covered_by"], 2],
      [["research", "questions", 0, "id"], "Q9"],
      [["research", "outline", 0, "id"], "O9"],
      [["page_plan", "steps", 1, "answers"], ["U1"]],
      [["page_plan", "steps", 1, "answers"], ["Q9"]],
      [["page_plan", "rationale"], " Unnormalized text "],
      [["research", "questions", 0, "q"], " Unnormalized question? "],
    ] as const) expect(generation.parseBriefV2Generated(changed(parsed.value, path, replacement), context()).ok).toBe(false);
  });
});
