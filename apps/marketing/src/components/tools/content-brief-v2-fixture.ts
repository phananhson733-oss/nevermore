// @input -- independent synthetic page/PAA evidence and explicit v2 writing plans
// @output -- strictly parsed, fingerprinted v2 Brief fixtures for offline tests
// @pos -- test-only fixture; no v1 conversion or production calls
import * as confirmation from "@sf/public-tools/content-brief/v2-brief";
import { buildResearchBundle, validateResearchOutput } from "@sf/public-tools/content-brief/v2-research";
import { measureResearchLength, type ResearchPage } from "@sf/public-tools/content-brief/v2-contract";
import type { ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";

export type FixtureOptions = { locale?: "en" | "zh"; count?: number; paaOnly?: boolean; action?: "create" | "update" | "undecidable"; unavailable?: boolean; runId?: string };
export async function validContentBriefV2(options: FixtureOptions = {}): Promise<ContentBriefV2> {
  const lang = options.locale ?? "en";
  const chinese = lang === "zh";
  const count = options.count ?? 2;
  const action = options.action ?? "create";
  const body = chinese ? "报告数据存在延迟。请核对采集日期和更新日期。" : "Reporting data arrives late. Compare the collection date with the last update.";
  function page(id: string): ResearchPage {
    const url = `https://${id === "T1" ? "owned" : "competitor"}.example/reporting`;
    return { id, role: id === "T1" ? "owned" : "competitor", url, final_url: url, fetched_at: "2026-08-31T01:00:00.000Z", content_hash: "a".repeat(64), body_complete: true, research: { segments: [{ heading: null, text: body, truncated: false }], segments_total: 1, omitted_segments: 0, length: measureResearchLength(body, lang) } };
  }
  const pages = options.paaOnly ? [] : [page("C1"), ...(action === "update" ? [page("T1")] : [])];
  const paa = Array.from({ length: count }, (_, i) => ({ id: `A${i + 1}`, question: chinese ? (i === 0 ? "为什么报告有延迟？" : "如何核对报告日期？") : (i === 0 ? "Why is reporting delayed?" : "How do I verify reporting dates?"), seed_question: null }));
  const research = buildResearchBundle(pages, paa);
  if (!research.ok) throw new Error(research.path);
  const model = { questions: paa.map((item) => { const anchor = research.value.units.find((unit) => unit.kind === "paa" && unit.paa_ref === item.id)!.id; return { anchor, q: item.question, sources: [...(pages.length ? ["U1"] : []), anchor] }; }), outline: paa.map((_, i) => ({ h2: chinese ? (i === 0 ? "了解报告延迟" : "核对报告日期") : (i === 0 ? "Understand reporting delays" : "Verify reporting dates"), h3: i === 0 ? [chinese ? "采集时间" : "Collection timing"] : [], answers: [research.value.units.find((unit) => unit.kind === "paa" && unit.paa_ref === `A${i + 1}`)!.id] })) };
  const result = validateResearchOutput(model, research.value);
  if (!result.ok) throw new Error(result.path);
  const gsc = action === "undecidable" ? { status: "unavailable" as const, property: null, window: null, reason: "not_requested" as const, matches: [], omitted_matches: 0 } : { status: "complete" as const, property: "sc-domain:owned.example", window: { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 as const }, reason: null, matches: action === "update" ? [{ id: "G1", query: "reporting delays", keyword: "reporting delays", scope: "primary" as const, page: "https://owned.example/reporting", clicks: 0, impressions: 2, position: 67 }] : [], omitted_matches: 0 };
  const brief: ContentBriefV2 = {
    schema: "gengrowth.content_brief/v2",
    context: { input: { primary: "reporting delays", supporting: ["reporting dates"], market: "US", language: lang }, research: research.value, facts: [], profile_snapshot: null, gsc, candidates: action === "update" ? [{ id: "T1", url: "https://owned.example/reporting", match_refs: ["G1"], read: "observed" }] : [] },
    generated: options.unavailable ? null : { research: result.value, intent: count ? { value: "informational", rationale: chinese ? "解释报告的时间差。" : "Explain the reporting timeline." } : null, format: count ? { value: "guide", rationale: chinese ? "按步骤核对报告日期。" : "Provide steps to check report dates." } : null, page_plan: { action, target_ref: action === "update" ? "T1" : null, rationale: chinese ? "根据本次样本作出的页面建议。" : "A page recommendation from the current sample.", steps: action === "update" ? [{ kind: "rewrite", instruction: "Clarify collection and update dates in the existing explanation.", sources: ["U2"], answers: ["Q1"] }] : [] }, gap_angle: null, internal_links: [], do_not_cover: [] },
    run: { run_id: options.runId ?? "fixture-run", collected_at: "2026-08-31T01:00:00.000Z", elapsed_ms: 4200, budget_ms: 45000,
      reads: [
        { source: "serp", status: "complete", attempted: 10, retained: 10, reason: null },
        { source: "paa", status: "complete", attempted: count, retained: count, reason: null },
        pages.length ? { source: "competitors", status: "complete", attempted: 1, retained: 1, reason: null } : { source: "competitors", status: "unavailable", attempted: 0, retained: null, reason: "insufficient_evidence" },
        action === "update" ? { source: "owned_pages", status: "complete", attempted: 1, retained: 1, reason: null } : { source: "owned_pages", status: "unavailable", attempted: 0, retained: null, reason: "not_requested" },
        gsc.status === "complete" ? { source: "gsc", status: "complete", attempted: gsc.matches.length, retained: gsc.matches.length, reason: null } : { source: "gsc", status: "unavailable", attempted: 0, retained: null, reason: "not_requested" },
        { source: "profile", status: "unavailable", attempted: 0, retained: null, reason: "not_requested" },
      ],
      llm: options.unavailable ? { status: "unavailable", reason: "timeout", attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: 256 } : { status: "complete", calls: 1, model_id: "fixture-model", temperature_requested: 0.2, temperature_effective: null, input_tokens: 3144, output_tokens: 256 },
      serp_cost_usd: null, prompt_bytes: 2048, fingerprint: "0".repeat(64),
    },
  };
  const sealed = { ...brief, run: { ...brief.run, fingerprint: await confirmation.fingerprintBriefV2(brief) } };
  const checked = await confirmation.parseContentBriefV2(sealed);
  if (!checked.ok) throw new Error(`fixture: ${checked.path}`);
  return checked.value;
}
