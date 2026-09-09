// @input -- a maximal confirmed Brief v2 in the widest and the densest script
// @output -- proof the real section prompt stays inside the provider byte ceiling
// @pos -- the guard for SECTION_EVIDENCE_MAX_BYTES; asserts the shipped prompt, not a second model of it
import { SECTION_EVIDENCE_MAX_BYTES } from "@sf/public-tools/content-brief/constants";
import { confirmBriefV2, fingerprintBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import {
  measureResearchLength, RESEARCH_HEADING_MAX_CHARS, RESEARCH_SEGMENT_MAX_CHARS, type ResearchPage,
} from "@sf/public-tools/content-brief/v2-contract";
import { DRAFT_V2_PROMPT_MAX_BYTES, type DraftV2Settings } from "@sf/public-tools/content-brief/v2-draft-contract";
import { buildDraftV2SectionScope } from "@sf/public-tools/content-brief/v2-draft-scope";
import { validateModelBriefV2 } from "@sf/public-tools/content-brief/v2-generation";
import type { BriefV2Context, ContentBriefV2, ModelBriefV2Output } from "@sf/public-tools/content-brief/v2-generation-contract";
import { buildResearchBundle } from "@sf/public-tools/content-brief/v2-research";
import { describe, expect, it } from "vitest";
import { buildDraftV2SectionSystemPrompt, buildDraftV2SectionUserPrompt } from "./content-draft-v2-prompts.ts";

const settings: DraftV2Settings = { tone: "explanatory", person: "second", product_mention: "none" };
const collectedAt = "2026-08-31T01:00:00.000Z";
const encoder = new TextEncoder();

/** The widest brief the research caps allow: RESEARCH_PAGE_UNITS_MAX excerpts, each at its own cap. */
function maximalPages(language: "zh" | "en"): readonly ResearchPage[] {
  const text = language === "zh"
    ? "字".repeat(RESEARCH_SEGMENT_MAX_CHARS)
    : "wordy ".repeat(RESEARCH_SEGMENT_MAX_CHARS).slice(0, RESEARCH_SEGMENT_MAX_CHARS);
  const heading = (language === "zh" ? "标" : "h").repeat(RESEARCH_HEADING_MAX_CHARS);
  return Array.from({ length: 10 }, (_unused, index): ResearchPage => {
    const url = `https://competitor-${index + 1}-with-a-fairly-long-hostname.example.com/some/deep/path/article-${index + 1}`;
    const segments = Array.from({ length: 6 }, () => ({ heading: { level: "h2" as const, text: heading }, text, truncated: false }));
    return {
      id: `C${index + 1}`, role: "competitor", url, final_url: url, fetched_at: collectedAt,
      content_hash: "a".repeat(64), body_complete: true,
      research: {
        segments, segments_total: 6, omitted_segments: 0,
        length: measureResearchLength(segments.map((segment) => segment.text).join(" "), language),
      },
    };
  });
}

/** One section whose single question sources every unit: the largest scope a brief can ask for. */
async function maximalSectionPrompt(language: "zh" | "en") {
  const research = buildResearchBundle(maximalPages(language), []);
  if (!research.ok) throw new Error(`bundle ${research.path}`);
  const pageUnits = research.value.units.filter((unit) => unit.kind === "page");
  const context: BriefV2Context = {
    input: { primary: language === "zh" ? "关键词" : "primary keyword", supporting: [], market: language === "zh" ? "CN" : "US", language },
    research: research.value,
    facts: [{ id: "P1", field: "coreFeatures[0]", text: "Feature", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } }],
    profile_snapshot: { website_id: "website-1", revision: 2, hash: "b".repeat(64) },
    gsc: {
      status: "complete", property: "sc-domain:owned.test", reason: null,
      window: { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 }, omitted_matches: 0, matches: [],
    },
    candidates: [],
  };
  const model: ModelBriefV2Output = {
    research: {
      questions: [{ anchor: pageUnits[0]!.id, q: "Question one?", sources: pageUnits.map((unit) => unit.id) }],
      outline: [{ h2: "Section one", h3: [], answers: [pageUnits[0]!.id] }],
    },
    intent: { value: "informational", rationale: "Explain." },
    format: { value: "guide", rationale: "Sequence." },
    page_plan: { action: "create", target_ref: null, rationale: "Scoped to the observed sample.", steps: [] },
    gap_angle: null, internal_links: [], do_not_cover: [],
  };
  const generated = validateModelBriefV2(model, context);
  if (!generated.ok) throw new Error(`generated ${generated.path}`);
  const unsigned: ContentBriefV2 = {
    schema: "gengrowth.content_brief/v2", context, generated: generated.value,
    run: {
      run_id: "prompt-budget", collected_at: collectedAt, elapsed_ms: 42, budget_ms: 45_000,
      reads: [
        { source: "serp", status: "complete", attempted: 10, retained: 10, reason: null },
        { source: "paa", status: "complete", attempted: 0, retained: 0, reason: null },
        { source: "competitors", status: "complete", attempted: 10, retained: 10, reason: null },
        { source: "owned_pages", status: "complete", attempted: 0, retained: 0, reason: null },
        { source: "gsc", status: "complete", attempted: 0, retained: 0, reason: null },
        { source: "profile", status: "complete", attempted: 1, retained: 1, reason: null },
      ],
      llm: { status: "complete", calls: 1, model_id: "m", temperature_requested: 0.2, temperature_effective: null, input_tokens: 200, output_tokens: 100 },
      serp_cost_usd: 0.004, prompt_bytes: 4096, fingerprint: "0".repeat(64),
    },
  };
  const brief = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintBriefV2(unsigned) } };
  const confirmed = await confirmBriefV2(brief, {
    outline: generated.value.research.outline, revision: 1, confirmed_at: collectedAt, resolution: "accept_recommendation",
  });
  if (!confirmed.ok) throw new Error(`confirm ${confirmed.path}`);
  const scope = buildDraftV2SectionScope(confirmed.value, generated.value.research.outline[0]!.id, settings);
  if (!scope.ok) throw new Error(`scope ${scope.path}`);
  const system = buildDraftV2SectionSystemPrompt();
  const user = buildDraftV2SectionUserPrompt({ confirmed: confirmed.value, scope: scope.value, settings });
  // The seam measures exactly this envelope before sending; measure the same thing.
  return { bytes: encoder.encode(JSON.stringify({ system, user })).byteLength, units: scope.value.page_units.size };
}

describe("Draft v2 section prompt budget", () => {
  // A section that overruns this ceiling does not come back shorter, it comes back
  // failed, so the widest brief the research caps allow has to fit with room to spare.
  it.each(["en", "zh"] as const)("keeps the maximal %s brief inside the provider ceiling", async (language) => {
    const { bytes, units } = await maximalSectionPrompt(language);
    expect(units).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(DRAFT_V2_PROMPT_MAX_BYTES);
  });

  // Chinese serializes each excerpt to roughly twice the bytes of the English one,
  // so a unit-count cap that is safe in one script overruns in the other.
  it("spends the evidence budget on more units in the wider script", async () => {
    const english = await maximalSectionPrompt("en");
    const chinese = await maximalSectionPrompt("zh");
    expect(english.units).toBeGreaterThan(chinese.units);
    expect(chinese.units).toBeGreaterThan(0);
  });

  it("prices the budget below the ceiling it protects", () => {
    expect(SECTION_EVIDENCE_MAX_BYTES).toBeLessThan(DRAFT_V2_PROMPT_MAX_BYTES);
  });
});
