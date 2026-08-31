// @input -- one validated shared GEO Brief
// @output -- Markdown/JSON/name projections of the same immutable data
// @pos -- preserves sources, missing values, counts and exact version anchors
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
export function sharedGeoBriefJson(brief: GeoContentBrief): string { return `${JSON.stringify(brief, null, 2)}\n`; }
export function sharedGeoBriefFileName(brief: GeoContentBrief, extension: "md" | "json"): string { return `geo-brief-${brief.run.run_id.replace(/[^a-z0-9-]/gi, "-")}-${brief.run.collected_at.slice(0, 10)}.${extension}`; }
export function sharedGeoBriefMarkdown(brief: GeoContentBrief): string {
  const lines = ["# GEO ContentBrief v1.1", "", `market: ${brief.keyword.market} · language: ${brief.keyword.language}`, "", "## geo_origin", "```json", JSON.stringify(brief.geo_origin, null, 2), "```", "", "## lead_answer", brief.lead_answer.requirement, `source: ${brief.lead_answer.source}`, `required_entities: ${brief.lead_answer.required_entities.join(" · ")}`, "", "## must_answer"];
  for (const item of brief.must_answer.items) lines.push(`- ${item.id}: ${item.q} · source=${item.source} · ${item.source === "ai_sample" ? `${item.covered_by}/${item.sample_total} answered samples` : "requirement"}`);
  lines.push(`candidates=${brief.budget.must_answer_candidates} · shown=${brief.budget.must_answer_shown} · hidden=${brief.budget.must_answer_hidden}`, "", "## fact_table");
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
  lines.push("", `draft_readiness: ${brief.draft_readiness.writable.join(", ")} · gaps=${brief.draft_readiness.gaps.join(", ")}`, `run_id: ${brief.run.run_id}`, `collected_at: ${brief.run.collected_at}`, `fingerprint: ${brief.run.fingerprint}`);
  return `${lines.join("\n")}\n`;
}
