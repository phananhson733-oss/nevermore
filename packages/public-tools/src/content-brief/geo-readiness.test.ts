import { describe, expect, it } from "vitest";
import type { GeoContentBrief } from "./geo-contract.ts";
import { geoBriefFixture } from "./geo-fixtures.ts";
import { deriveGeoReadiness, geoFingerprint, parseGeoContentBrief } from "./parse-geo-brief.ts";

// Captured with the pre-fix producer/parser at 977f0bc4. Do not regenerate:
// this synthetic JSON and fingerprint guard immutable v1.1 export compatibility.
const legacyEmptyFactsJson = "{\"schema\":\"gengrowth.content_brief/v1.1\",\"source\":\"geo\",\"run\":{\"run_id\":\"fixture-brief\",\"collected_at\":\"2026-08-31T00:00:00.000Z\",\"elapsed_ms\":0,\"budget_ms\":90000,\"fingerprint\":\"88b7c9496da4ba8a653a7863a5cf1358f13082abeba54b1d2570e1d5bd0cc9e5\"},\"keyword\":{\"primary\":\"Which fixture tool fits a small team?\",\"supporting\":[],\"market\":\"US\",\"language\":\"en\"},\"geo_origin\":{\"kind\":\"visibility\",\"question\":{\"id\":\"fixture-question\",\"text\":\"Which fixture tool fits a small team?\"},\"role\":\"buyer\",\"layer\":\"comparison\",\"gap\":\"D\",\"run_ref\":{\"id\":\"fixture-visibility\",\"fingerprint\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"},\"sample_refs\":[\"S1\",\"S2\"],\"kb_ref\":{\"kb_id\":\"fixture-kb\",\"snapshot_id\":\"fixture-snapshot\",\"revision\":1,\"content_hash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},\"promptset_ref\":{\"schema\":\"fixture-promptset/v1\",\"registry_version\":\"fixture-1\",\"hash\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"},\"profile_ref\":null},\"evidence\":{\"kb_requirements\":[],\"samples\":[{\"id\":\"S1\",\"run_id\":\"fixture-visibility\",\"question_id\":\"fixture-question\",\"engine\":\"chatgpt\",\"collected_at\":\"2026-08-30T00:00:00.000Z\",\"status\":\"answered\",\"search_enabled\":null,\"excerpt\":\"Synthetic fixture answer, not product evidence.\",\"topics\":[\"Team size\"]},{\"id\":\"S2\",\"run_id\":\"fixture-visibility\",\"question_id\":\"fixture-question\",\"engine\":\"chatgpt\",\"collected_at\":\"2026-08-30T00:00:00.000Z\",\"status\":\"answered\",\"search_enabled\":null,\"excerpt\":\"Synthetic fixture answer, not product evidence.\",\"topics\":[\"Team size\"]}],\"facts\":[],\"site_index\":[{\"id\":\"I1\",\"url\":\"https://fixture.example/about\",\"title\":\"About\",\"observed_at\":\"2026-08-30T00:00:00.000Z\"}]},\"lead_answer\":{\"question_id\":\"Q1\",\"requirement\":\"Answer the selected buyer question directly.\",\"required_entities\":[\"fixture tool\"],\"source\":\"kb\",\"fact_refs\":[]},\"must_answer\":{\"status\":\"available\",\"items\":[{\"id\":\"Q1\",\"q\":\"Answer the selected buyer question directly.\",\"source\":\"kb\",\"cluster\":{\"canonical_heading\":\"Answer the selected buyer question directly.\",\"members\":[]},\"covered_by\":0,\"sample_total\":2},{\"id\":\"Q2\",\"q\":\"Team size\",\"source\":\"ai_sample\",\"cluster\":{\"canonical_heading\":\"Team size\",\"members\":[{\"sample_id\":\"S1\",\"heading\":\"Team size\"},{\"sample_id\":\"S2\",\"heading\":\"Team size\"}]},\"covered_by\":2,\"sample_total\":2}]},\"fact_table\":[],\"outline\":{\"status\":\"available\",\"items\":[{\"id\":\"O1\",\"h2\":\"Direct answer\",\"h3\":[],\"answers\":[\"Q1\"],\"provenance\":{\"method\":\"model\",\"derived_from\":[\"kb\",\"ai_sample\"]}},{\"id\":\"O2\",\"h2\":\"Team-size comparison\",\"h3\":[],\"answers\":[\"Q2\"],\"provenance\":{\"method\":\"model\",\"derived_from\":[\"kb\",\"ai_sample\"]}}]},\"intent\":{\"status\":\"available\",\"value\":\"commercial\",\"provenance\":{\"method\":\"heuristic\",\"origin\":\"kb\"}},\"format\":{\"status\":\"available\",\"value\":\"comparison\",\"reason\":\"gap_d_comparison\",\"provenance\":{\"method\":\"heuristic\",\"origin\":\"ai_sample\"}},\"verdict\":{\"action\":\"undecidable\",\"reason\":\"geo_not_serp\",\"provenance\":null},\"length\":{\"status\":\"unavailable\",\"reason\":\"insufficient_evidence\",\"attempted\":0},\"gap_angle\":{\"status\":\"unavailable\",\"reason\":\"not_requested\",\"attempted\":0},\"internal_links\":{\"status\":\"available\",\"items\":[{\"page_ref\":\"I1\",\"why\":\"Owner-site context\",\"source\":\"site_index\"}]},\"do_not_cover\":{\"status\":\"unavailable\",\"reason\":\"not_requested\",\"attempted\":0},\"budget\":{\"outline_cap\":10,\"must_answer_cap\":8,\"must_answer_candidates\":2,\"must_answer_shown\":2,\"must_answer_hidden\":0},\"draft_readiness\":{\"writable\":[\"O1\",\"O2\"],\"gaps\":[]}}";
const legacyFingerprint = "88b7c9496da4ba8a653a7863a5cf1358f13082abeba54b1d2570e1d5bd0cc9e5";

function legacyEmptyFacts(): GeoContentBrief {
  return JSON.parse(legacyEmptyFactsJson) as GeoContentBrief;
}

describe("GEO readiness and immutable historical exports", () => {
  it("reads the captured empty-facts export without rewriting its bytes or fingerprint", async () => {
    const brief = legacyEmptyFacts();
    const parsed = await parseGeoContentBrief(brief);
    expect(parsed).toEqual({ ok: true, value: brief });
    expect(JSON.stringify(brief)).toBe(legacyEmptyFactsJson);
    if (!parsed.ok) throw new Error("historical fixture rejected");
    expect(JSON.stringify(parsed.value)).toBe(legacyEmptyFactsJson);
    expect(parsed.value.run.fingerprint).toBe(legacyFingerprint);
    expect(await geoFingerprint(parsed.value)).toBe(legacyFingerprint);
    expect(parsed.value.draft_readiness.gaps).toEqual([]);
  });

  it("derives missing facts for an empty table without changing structural section IDs", () => {
    expect(deriveGeoReadiness(legacyEmptyFacts())).toEqual({ writable: ["O1", "O2"], gaps: ["missing_facts"] });
  });

  it("derives both missing outline and missing facts when neither exists", () => {
    const brief = legacyEmptyFacts();
    brief.outline = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
    expect(deriveGeoReadiness(brief)).toEqual({ writable: [], gaps: ["no_outline", "missing_facts"] });
  });

  it.each(["available", "unavailable"] as const)("accepts corrected empty-facts readiness with an %s outline", async (status) => {
    const brief = legacyEmptyFacts();
    if (status === "unavailable") brief.outline = { status, reason: "insufficient_evidence", attempted: 0 };
    brief.draft_readiness = status === "available"
      ? { writable: ["O1", "O2"], gaps: ["missing_facts"] }
      : { writable: [], gaps: ["no_outline", "missing_facts"] };
    brief.run.fingerprint = await geoFingerprint(brief);
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
  });

  it("also reads historical empty-facts exports with no outline and only the no_outline gap", async () => {
    const brief = legacyEmptyFacts();
    brief.outline = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
    brief.draft_readiness = { writable: [], gaps: ["no_outline"] };
    brief.run.fingerprint = await geoFingerprint(brief);
    expect(await parseGeoContentBrief(brief)).toEqual({ ok: true, value: brief });
  });

  it.each([
    { writable: ["O2", "O1"], path: "draft_readiness.writable[0]" },
    { writable: ["O1"], path: "draft_readiness.writable" },
    { writable: ["O1", "O3"], path: "draft_readiness.writable[1]" },
    { writable: [], path: "draft_readiness.writable" },
  ])("rejects historical exports with incorrect writable IDs $writable even after rehashing", async ({ writable, path }) => {
    const brief = legacyEmptyFacts();
    brief.draft_readiness.writable = writable;
    brief.run.fingerprint = await geoFingerprint(brief);
    expect(await parseGeoContentBrief(brief)).toMatchObject({ ok: false, path });
  });

  it.each(["available", "unavailable"] as const)("rejects wrong legacy no_outline gaps for an %s outline", async (status) => {
    const brief = legacyEmptyFacts();
    if (status === "unavailable") brief.outline = { status, reason: "insufficient_evidence", attempted: 0 };
    brief.draft_readiness = status === "available"
      ? { writable: ["O1", "O2"], gaps: ["no_outline"] }
      : { writable: [], gaps: [] };
    brief.run.fingerprint = await geoFingerprint(brief);
    expect(await parseGeoContentBrief(brief)).toMatchObject({ ok: false, path: "draft_readiness.gaps" });
  });

  it("does not extend historical compatibility to a nonempty table with null facts", async () => {
    const brief = await geoBriefFixture();
    expect(deriveGeoReadiness(brief).gaps).toEqual(["missing_facts"]);
    brief.draft_readiness.gaps = [];
    brief.run.fingerprint = await geoFingerprint(brief);
    expect(await parseGeoContentBrief(brief)).toMatchObject({ ok: false, path: "draft_readiness.gaps" });
  });

  it("rejects a spurious missing_facts gap when every table row has evidence", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = brief.fact_table.filter(fact => fact.value !== null);
    expect(deriveGeoReadiness(brief).gaps).toEqual([]);
    brief.run.fingerprint = await geoFingerprint(brief);
    expect(await parseGeoContentBrief(brief)).toMatchObject({ ok: false, path: "draft_readiness.gaps" });
  });

  it("still rejects forged source fields in an otherwise historical empty-facts export", async () => {
    const brief = legacyEmptyFacts();
    brief.lead_answer.source = "user_input";
    brief.run.fingerprint = await geoFingerprint(brief);
    expect(await parseGeoContentBrief(brief)).toMatchObject({ ok: false, path: "lead_answer.source" });
  });

  it("does not silently upgrade old readiness under the old fingerprint", async () => {
    const brief = legacyEmptyFacts();
    brief.draft_readiness.gaps = ["missing_facts"];
    expect(await parseGeoContentBrief(brief)).toMatchObject({ ok: false, code: "brief_fingerprint_mismatch", path: "run.fingerprint" });
  });
});
