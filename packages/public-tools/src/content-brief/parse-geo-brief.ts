// @input -- an untrusted GEO brief or shared fixed-key handoff
// @output -- exact version, reference, derived-field and fingerprint validation, including the historical empty-facts readiness projection
// @pos -- consistency validation only; a fingerprint is NOT proof of authentic observations
import { fingerprintCanonical } from "./canonical.ts";
import { geoOutlineSupportViolation } from "./geo-fact-support.ts";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES, CONTENT_BRIEF_HANDOFF_TTL_MS } from "./contract.ts";
import { GEO_CONTENT_BRIEF_SCHEMA, GEO_MUST_ANSWER_CAP, GEO_OUTLINE_CAP, type GeoContentBrief, type SharedContentBrief, type SharedContentBriefHandoff } from "./geo-contract.ts";
import { parseContentBrief, parseContentBriefHandoff, recomputed, sameSet } from "./parse-brief.ts";
import { array, byteLength, finite, identifier, integer, invalid, isRecord, literal, nonEmpty, nullable, object, ok, oneOf, reference, tagged, text, timestamp, unavailableShape, type Decoded, type Decoder, type ParseBriefFailure } from "./parse-brief-shape.ts";

const id = text(200, 1);
const hash: Decoder<string> = (value, path) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? ok(value) : invalid(path);
const bool: Decoder<boolean> = (value, path) => typeof value === "boolean" ? ok(value) : invalid(path);
const httpUrl: Decoder<string> = (value, path) => {
  if (typeof value !== "string" || value.length > 2048) return invalid(path);
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? ok(value) : invalid(path); } catch { return invalid(path); }
};
const unavailable = object(unavailableShape);
const origins = oneOf(["kb", "ai_sample", "crawl", "product_profile", "site_index", "user_input"] as const);
const model = object({ method: literal("model"), derived_from: array(origins, { min: 1, max: 6, unique: true }) });
const question = object({ id: identifier("Q"), q: text(500, 1), source: oneOf(["kb", "ai_sample", "user_input"] as const), cluster: object({ canonical_heading: text(500, 1), members: array(object({ sample_id: id, heading: text(500, 1) }), { max: 200 }) }), covered_by: integer(), sample_total: integer() });
const outline = tagged("status", {
  available: object({ status: literal("available"), items: nonEmpty(object({ id: identifier("O"), h2: text(200, 1), h3: array(text(200, 1), { max: 8 }), answers: array(identifier("Q"), { max: GEO_MUST_ANSWER_CAP, unique: true }), provenance: model }), { max: GEO_OUTLINE_CAP }) }),
  unavailable,
});
export const geoOriginShape = object({ kind: oneOf(["manual", "visibility"] as const), question: object({ id: nullable(id), text: text(500, 1) }), role: nullable(text(200, 1)), layer: nullable(text(100, 1)), gap: nullable(oneOf(["A", "B", "D"] as const)), run_ref: nullable(object({ id, fingerprint: hash })), sample_refs: array(id, { max: 200, unique: true }), kb_ref: object({ kb_id: id, snapshot_id: id, revision: integer(1), content_hash: hash }), promptset_ref: object({ schema: id, registry_version: id, hash }), profile_ref: nullable(object({ website_id: id, snapshot_id: id, snapshot_revision: integer(1), profile_schema: id, profile_hash: hash })) });
const excerpt: Decoder<string> = (value, path) => typeof value === "string" && [...value].length <= 300 ? ok(value) : invalid(path);
export const geoEvidenceShape = object({
  kb_requirements: array(object({ id, text: text(500, 1) }), { max: GEO_MUST_ANSWER_CAP - 1 }),
  samples: array(object({ id, run_id: id, question_id: id, engine: id, collected_at: timestamp, status: oneOf(["answered", "failed"] as const), search_enabled: nullable(bool), excerpt, topics: array(text(500, 1), { max: 50, unique: true }) }), { max: 200 }),
  facts: array(object({ id: identifier("[KCP]"), source: oneOf(["kb", "crawl", "product_profile"] as const), text: text(2000, 1), observed_at: timestamp, url: nullable(httpUrl) }), { max: 100 }),
  site_index: array(object({ id, url: httpUrl, title: text(500), observed_at: timestamp }), { max: 100 }),
});
const decode: Decoder<GeoContentBrief> = object({
  schema: literal(GEO_CONTENT_BRIEF_SCHEMA), source: literal("geo"),
  run: object({ run_id: id, collected_at: timestamp, elapsed_ms: finite(0), budget_ms: integer(1), fingerprint: hash }),
  keyword: object({ primary: text(500, 1), supporting: array(text(500, 1), { max: 10, unique: true }), market: text(10, 1), language: text(20, 1) }),
  geo_origin: geoOriginShape,
  evidence: geoEvidenceShape,
  lead_answer: object({ question_id: literal("Q1"), requirement: text(500, 1), required_entities: array(text(200, 1), { max: 30, unique: true }), source: oneOf(["kb", "user_input"] as const), fact_refs: array(identifier("[KCP]"), { max: 100, unique: true }) }),
  must_answer: object({ status: literal("available"), items: array(question, { min: 1, max: GEO_MUST_ANSWER_CAP }) }),
  fact_table: array(object({ id: identifier("F"), label: text(200, 1), value: nullable(text(2000, 1)), reason: nullable(oneOf(["missing", "conflicting", "unverified", "notPublished", "fetchFailed", "lowConfidence"] as const)), evidence_refs: array(identifier("[KCP]"), { max: 20, unique: true }) }), { max: 100 }),
  outline,
  intent: tagged("status", { available: object({ status: literal("available"), value: oneOf(["informational", "commercial", "transactional", "navigational"] as const), provenance: object({ method: literal("heuristic"), origin: oneOf(["kb", "user_input"] as const) }) }), unavailable }),
  format: tagged("status", { available: object({ status: literal("available"), value: oneOf(["comparison", "guide", "product_page"] as const), reason: oneOf(["gap_d_comparison", "intent_derived"] as const), provenance: object({ method: literal("heuristic"), origin: oneOf(["kb", "user_input", "ai_sample"] as const) }) }), unavailable }),
  verdict: object({ action: literal("undecidable"), reason: literal("geo_not_serp"), provenance: literal(null) }),
  length: unavailable, gap_angle: unavailable,
  internal_links: tagged("status", { available: object({ status: literal("available"), items: array(object({ page_ref: id, why: text(500, 1), source: literal("site_index") }), { max: 10 }) }), unavailable }),
  do_not_cover: unavailable,
  budget: object({ outline_cap: literal(GEO_OUTLINE_CAP), must_answer_cap: literal(GEO_MUST_ANSWER_CAP), must_answer_candidates: integer(1), must_answer_shown: integer(1), must_answer_hidden: integer() }),
  draft_readiness: object({ writable: array(identifier("O"), { max: GEO_OUTLINE_CAP, unique: true }), gaps: array(oneOf(["no_outline", "missing_facts"] as const), { max: 2, unique: true }) }),
});

export async function geoFingerprint(brief: GeoContentBrief): Promise<string> {
  const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = brief.run;
  return fingerprintCanonical({ ...brief, run });
}

export function deriveGeoFormat(brief: Pick<GeoContentBrief, "geo_origin" | "intent">): GeoContentBrief["format"] {
  if (brief.geo_origin.gap === "D") return { status: "available", value: "comparison", reason: "gap_d_comparison", provenance: { method: "heuristic", origin: "ai_sample" } };
  if (brief.intent.status === "unavailable") return { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
  const value = brief.intent.value === "commercial" ? "comparison" : brief.intent.value === "transactional" || brief.intent.value === "navigational" ? "product_page" : "guide";
  return { status: "available", value, reason: "intent_derived", provenance: brief.intent.provenance };
}

export function deriveGeoReadiness(brief: Pick<GeoContentBrief, "outline" | "fact_table">): GeoContentBrief["draft_readiness"] {
  return { writable: brief.outline.status === "available" ? brief.outline.items.map(item => item.id) : [], gaps: [...(brief.outline.status === "unavailable" ? ["no_outline" as const] : []), ...(brief.fact_table.length === 0 || brief.fact_table.some(fact => fact.value === null) ? ["missing_facts" as const] : [])] };
}

function readinessViolation(brief: GeoContentBrief): ParseBriefFailure | null {
  const expected = deriveGeoReadiness(brief);
  const failure = recomputed(expected, brief.draft_readiness, "draft_readiness");
  if (failure === null || brief.fact_table.length > 0) return failure;
  // Old v1.1 exports omitted missing_facts only when the table was empty.
  // Preserve their bytes/fingerprint and exact structural section IDs. Factual
  // sufficiency must come from fact_table/evidence, never this legacy gaps list.
  return recomputed({ ...expected, gaps: expected.gaps.filter(gap => gap !== "missing_facts") }, brief.draft_readiness, "draft_readiness");
}

function topicKey(text: string): string { return text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim(); }
export function deriveGeoMustAnswer(lead: GeoContentBrief["lead_answer"], samples: GeoContentBrief["evidence"]["samples"], requirements: GeoContentBrief["evidence"]["kb_requirements"] = []): Pick<GeoContentBrief, "must_answer" | "budget"> {
  const answered = samples.filter(sample => sample.status === "answered");
  const topics = new Map<string, { sample_id: string; heading: string }[]>();
  for (const sample of answered) for (const heading of sample.topics) { const key = topicKey(heading); const members = topics.get(key) ?? []; if (!members.some(member => member.sample_id === sample.id)) topics.set(key, [...members, { sample_id: sample.id, heading }]); }
  const selected = [...topics.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, GEO_MUST_ANSWER_CAP - 1 - requirements.length);
  const items: GeoContentBrief["must_answer"]["items"] = [
    { id: "Q1", q: lead.requirement, source: lead.source, cluster: { canonical_heading: lead.requirement, members: [] }, covered_by: 0, sample_total: answered.length },
    ...requirements.map((requirement, index) => ({ id: `Q${index + 2}`, q: requirement.text, source: "kb" as const, cluster: { canonical_heading: requirement.text, members: [] }, covered_by: 0, sample_total: answered.length })),
    ...selected.map(([, members], index) => ({ id: `Q${index + 2 + requirements.length}`, q: members[0]!.heading, source: "ai_sample" as const, cluster: { canonical_heading: members[0]!.heading, members }, covered_by: members.length, sample_total: answered.length })),
  ];
  return { must_answer: { status: "available", items }, budget: { outline_cap: GEO_OUTLINE_CAP, must_answer_cap: GEO_MUST_ANSWER_CAP, must_answer_candidates: topics.size + 1 + requirements.length, must_answer_shown: items.length, must_answer_hidden: topics.size + 1 + requirements.length - items.length } };
}

function uniqueIds(items: readonly { id: string }[]): boolean { return new Set(items.map(item => item.id)).size === items.length; }
function invariants(brief: GeoContentBrief): ParseBriefFailure | null {
  const { geo_origin: origin, evidence, must_answer: { items }, lead_answer: lead } = brief;
  const headingFailure = geoOutlineSupportViolation(brief);
  if (headingFailure !== null) return reference(headingFailure);
  if (brief.keyword.primary !== origin.question.text) return reference("keyword.primary");
  if (origin.kind === "manual" && (origin.run_ref !== null || origin.sample_refs.length > 0 || origin.gap !== null || evidence.samples.length > 0)) return reference("geo_origin");
  if (origin.question.id === null ? lead.source !== "user_input" || lead.required_entities.length > 0 || evidence.kb_requirements.length > 0 : lead.source !== "kb") return reference("lead_answer.source");
  if (origin.kind === "visibility" && (origin.run_ref === null || origin.question.id === null || origin.gap === null || origin.sample_refs.length === 0)) return reference("geo_origin");
  if (origin.kind === "visibility" && !sameSet(origin.sample_refs, evidence.samples.map(sample => sample.id))) return reference("geo_origin.sample_refs");
  if (!uniqueIds(evidence.kb_requirements) || !uniqueIds(evidence.samples) || !uniqueIds(evidence.facts) || !uniqueIds(evidence.site_index) || !uniqueIds(brief.fact_table)) return reference("evidence");
  for (const sample of evidence.samples) {
    if (sample.status === "failed" && (sample.excerpt !== "" || sample.topics.length > 0)) return reference("evidence.samples");
    if (origin.kind === "visibility" && (sample.run_id !== origin.run_ref?.id || sample.question_id !== origin.question.id)) return reference("evidence.samples");
    if (Date.parse(sample.collected_at) > Date.parse(brief.run.collected_at)) return reference("evidence.samples.collected_at");
  }
  const facts = new Map(evidence.facts.map(fact => [fact.id, fact]));
  for (const fact of evidence.facts) {
    const prefix = { kb: "K", crawl: "C", product_profile: "P" }[fact.source];
    if (!fact.id.startsWith(prefix) || (fact.source === "crawl" && fact.url === null) || (fact.source === "product_profile" && origin.profile_ref === null) || Date.parse(fact.observed_at) > Date.parse(brief.run.collected_at)) return reference("evidence.facts");
  }
  for (const row of brief.fact_table) {
    if (row.value === null ? row.reason === null : row.reason !== null || row.evidence_refs.length === 0) return reference("fact_table");
    for (const ref of row.evidence_refs) {
      const fact = facts.get(ref);
      if (fact === undefined || (row.value !== null && row.value !== fact.text)) return reference("fact_table.evidence_refs");
    }
  }
  const eligibleFactIds = new Set(brief.fact_table.filter(row => row.value !== null).flatMap(row => row.evidence_refs));
  if (lead.fact_refs.some(ref => !eligibleFactIds.has(ref))) return reference("lead_answer.fact_refs");
  const first = items[0];
  if (first?.id !== "Q1" || first.source !== lead.source || first.q !== lead.requirement || first.cluster.canonical_heading !== lead.requirement || first.cluster.members.length !== 0 || first.covered_by !== 0) return reference("must_answer.items[0]");
  const answered = evidence.samples.filter(sample => sample.status === "answered");
  const samples = new Map(answered.map(sample => [sample.id, sample]));
  const headings = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (item.id !== `Q${index + 1}` || item.sample_total !== answered.length) return reference("must_answer.items");
    if (index === 0 || item.source === "kb") continue;
    if (item.source !== "ai_sample" || item.cluster.members.length === 0 || item.q !== item.cluster.canonical_heading || headings.has(item.q)) return reference("must_answer.items");
    headings.add(item.q);
    const sampleIds = new Set<string>();
    for (const member of item.cluster.members) {
      const sample = samples.get(member.sample_id);
      if (sample === undefined || !sample.topics.includes(member.heading) || topicKey(member.heading) !== topicKey(item.q) || sampleIds.has(member.sample_id)) return reference("must_answer.items.cluster.members");
      sampleIds.add(member.sample_id);
    }
    if (item.covered_by !== sampleIds.size) return reference("must_answer.items.covered_by");
  }
  if (brief.outline.status === "available") {
    if (!brief.outline.items[0].answers.includes("Q1")) return reference("outline.items[0].answers");
    const answers: string[] = [];
    for (const [index, section] of brief.outline.items.entries()) {
      if (section.id !== `O${index + 1}`) return reference("outline.items.id");
      const availableSources = new Set(["kb", "user_input", ...(answered.length ? ["ai_sample"] : []), ...evidence.facts.map(fact => fact.source), ...(evidence.site_index.length ? ["site_index"] : [])]);
      if (section.provenance.derived_from.some(source => !availableSources.has(source))) return reference("outline.items.provenance");
      answers.push(...section.answers);
    }
    if (!sameSet([...new Set(answers)], items.map(item => item.id))) return reference("outline.items.answers");
  }
  if (brief.internal_links.status === "available") {
    const pageIds = new Set(evidence.site_index.map(page => page.id));
    if (brief.internal_links.items.some(item => !pageIds.has(item.page_ref)) || new Set(brief.internal_links.items.map(item => item.page_ref)).size !== brief.internal_links.items.length) return reference("internal_links.items");
  }
  const derived = deriveGeoMustAnswer(lead, evidence.samples, evidence.kb_requirements);
  return recomputed(derived.must_answer, brief.must_answer, "must_answer")
    ?? recomputed(derived.budget, brief.budget, "budget")
    ?? recomputed(deriveGeoFormat(brief), brief.format, "format")
    ?? readinessViolation(brief);
}

export function parseGeoContentBriefShape(input: unknown): Decoded<GeoContentBrief> {
  if (!isRecord(input) || input["schema"] !== GEO_CONTENT_BRIEF_SCHEMA) return { ok: false, code: "brief_schema_mismatch", path: "schema" };
  const bytes = byteLength(input);
  if (bytes === null || bytes > CONTENT_BRIEF_HANDOFF_MAX_BYTES) return invalid("");
  const parsed = decode(input, "");
  return parsed.ok ? invariants(parsed.value) ?? parsed : parsed;
}
export async function parseGeoContentBrief(input: unknown): Promise<Decoded<GeoContentBrief>> {
  const parsed = parseGeoContentBriefShape(input);
  if (!parsed.ok) return parsed;
  return await geoFingerprint(parsed.value) === parsed.value.run.fingerprint ? parsed : { ok: false, code: "brief_fingerprint_mismatch", path: "run.fingerprint" };
}
export async function parseSharedContentBrief(input: unknown): Promise<Decoded<SharedContentBrief>> {
  return isRecord(input) && input["schema"] === GEO_CONTENT_BRIEF_SCHEMA ? parseGeoContentBrief(input) : parseContentBrief(input);
}
export async function parseSharedContentBriefHandoff(input: unknown, deps: { now?: () => number } = {}): Promise<Decoded<SharedContentBriefHandoff>> {
  if (!isRecord(input) || !isRecord(input["brief"]) || input["brief"]["schema"] !== GEO_CONTENT_BRIEF_SCHEMA) return parseContentBriefHandoff(input, deps);
  const raw: Decoder<unknown> = value => ok(value);
  const envelope = object({ version: literal(1), created_at: finite(0), expires_at: finite(0), brief: raw })(input, "");
  if (!envelope.ok) return envelope;
  const { created_at, expires_at } = envelope.value;
  const now = (deps.now ?? Date.now)();
  if (expires_at !== created_at + CONTENT_BRIEF_HANDOFF_TTL_MS || now >= expires_at) return reference("expires_at");
  if (created_at > now) return reference("created_at");
  const brief = await parseGeoContentBrief(envelope.value.brief);
  return brief.ok ? ok({ version: 1, created_at, expires_at, brief: brief.value }) : { ...brief, path: `brief.${brief.path}` };
}
