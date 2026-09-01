// @input -- one validated shared GEO Brief
// @output -- Markdown/JSON/name projections of the same immutable data
// @pos -- preserves sources, missing values, counts and exact version anchors
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { geoBriefQuality, geoBriefQuestionSource } from "./brief-quality.ts";

const questionSources = {
  openingFrozen: "System opening rule based on the frozen question",
  openingManual: "System opening rule based on your typed question",
  frozenCriterion: "Decision requirement from the frozen role",
  observedQuestion: "Topic observed in answer samples",
};
export function sharedGeoBriefJson(brief: GeoContentBrief): string { return `${JSON.stringify(brief, null, 2)}\n`; }
export function sharedGeoBriefFileName(brief: GeoContentBrief, extension: "md" | "json"): string { return `geo-brief-${brief.run.run_id.replace(/[^a-z0-9-]/gi, "-")}-${brief.run.collected_at.slice(0, 10)}.${extension}`; }
export function sharedGeoBriefMarkdown(brief: GeoContentBrief, options: { questionNeedsRevision?: boolean } = {}): string {
  const quality = geoBriefQuality(brief, options);
  const lines = ["# GEO ContentBrief v1.1", "", `market: ${brief.keyword.market} · language: ${brief.keyword.language}`, "", "## Evidence quality and limitations",
    `${quality.outlineSections} outline sections; ${quality.usableFacts} facts with source records; ${quality.observedQuestions} observed topics from ${quality.answeredSamples} answered samples.`,
    "Outline section IDs are not a guarantee of factual readiness or complete research. Review the question and all source records before writing."];
  if (options.questionNeedsRevision) lines.push("The exact frozen question needs revision. Do not generate a Draft until a corrected version is confirmed.");
  if (quality.outlineSections === 0) lines.push("No usable outline was supplied; Draft cannot be generated.");
  if (quality.usableFacts === 0) lines.push(`${quality.outlineSections > 0 ? "Structure only: no" : "No"} facts with matching source records were supplied. Do not add product claims, numbers or comparisons.`);
  if (quality.missingFacts > 0) lines.push(`Listed facts without a usable value or matching source record: ${quality.missingFacts}.`);
  if (quality.answeredSamples === 0) lines.push("No successful visibility answers are linked. Required questions are not observed coverage.");
  if (quality.answeredSamples > 0 && quality.observedQuestions === 0) lines.push("Linked answers were present, but they did not yield any reusable observed topics for this Brief.");
  if (!quality.hasProfile) lines.push("No linked website profile snapshot; current profile edits are not substituted for frozen evidence.");
  if (!quality.hasSiteIndex) lines.push("No usable site index was supplied; do not invent internal links.");
  lines.push("This GEO workflow does not collect a search-result length baseline or decide whether to create or update a page.", "The original question and facts are preserved verbatim; this export does not silently translate or repair them.", "", "## geo_origin", "```json", JSON.stringify(brief.geo_origin, null, 2), "```", "", "## lead_answer", brief.lead_answer.requirement, `source: ${brief.lead_answer.source} · ${questionSources[brief.geo_origin.question.id === null ? "openingManual" : "openingFrozen"]}`, "This is a system opening rule, not a separately confirmed scoring criterion.", `required_entities (terms from the frozen question): ${brief.lead_answer.required_entities.join(" · ")}`, "", "## must_answer");
  for (const item of brief.must_answer.items) lines.push(`- ${item.id}: ${item.q} · source=${item.source} · ${questionSources[geoBriefQuestionSource(brief, item)]} · ${item.source === "ai_sample" ? `${item.covered_by}/${item.sample_total} answered samples` : "writing requirement, not observed coverage"}`);
  lines.push(`candidates=${brief.budget.must_answer_candidates} · shown=${brief.budget.must_answer_shown} · hidden=${brief.budget.must_answer_hidden}`, "", "## fact_table");
  if (brief.fact_table.length === 0) lines.push("No facts were supplied. Add facts with their sources and observation dates, then freeze a new version.");
  for (const fact of brief.fact_table) {
    lines.push(`- ${fact.id} ${fact.label}: ${fact.value ?? `null (${fact.reason})`}`);
    for (const id of fact.evidence_refs) { const receipt = brief.evidence.facts.find(row => row.id === id); if (receipt) lines.push(`  - ${id} · source=${receipt.source} · ${receipt.observed_at} · ${receipt.url ?? "no URL"}`); }
  }
  lines.push("", "## outline");
  if (brief.outline.status === "available") for (const section of brief.outline.items) { lines.push(`### ${section.h2}`, `source=model · answers=${section.answers.join(", ") || "supplementary"}`); for (const h3 of section.h3) lines.push(`- ${h3}`); }
  else lines.push(`unavailable: ${brief.outline.reason}`);
  lines.push("", "## format / verdict / length", `format: ${brief.format.status === "available" ? `${brief.format.value} (${brief.format.reason}; ${brief.format.provenance.origin})` : `unavailable (${brief.format.reason})`}`, `verdict: ${brief.verdict.action} (${brief.verdict.reason})`, `length: unavailable (${brief.length.reason})`, "", "## internal_links");
  if (brief.internal_links.status === "available") for (const link of brief.internal_links.items) { const page = brief.evidence.site_index.find(row => row.id === link.page_ref); if (page) lines.push(`- ${page.id}: ${page.url} · source=site_index · ${page.observed_at} · ${link.why}`); }
  else lines.push(`unavailable: ${brief.internal_links.reason}`);
  lines.push("", "## sample evidence (not factual sources)");
  for (const sample of brief.evidence.samples) lines.push(`- ${sample.id} · ${sample.engine} · ${sample.status} · search=${sample.search_enabled ?? "unknown"} · ${sample.collected_at}: ${sample.excerpt}`);
  if (brief.evidence.kb_requirements.length) lines.push("", "## Frozen role requirements", ...brief.evidence.kb_requirements.map(requirement => `- ${requirement.id}: ${requirement.text}`));
  lines.push("", `draft_readiness: ${brief.draft_readiness.writable.join(", ")} · gaps=${brief.draft_readiness.gaps.join(", ")}`, `run_id: ${brief.run.run_id}`, `collected_at: ${brief.run.collected_at}`, `fingerprint: ${brief.run.fingerprint}`);
  return `${lines.join("\n")}\n`;
}
