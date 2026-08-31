// @input -- immutable GEO knowledge, actual answer samples and site-index receipts
// @output -- the explicit GEO branch of the shared Brief/Draft contract
// @pos -- no SERP or crawl ledger is synthesized to make a GEO brief resemble SEO v1
import type { ContentBrief, ContentBriefHandoff, Unavailable } from "./contract.ts";

export const GEO_CONTENT_BRIEF_SCHEMA = "gengrowth.content_brief/v1.1" as const;
export const GEO_OUTLINE_CAP = 10;
export const GEO_MUST_ANSWER_CAP = 8;
/** Generation follows the English registry; the immutable original locale is not rewritten. */
export function geoGenerationLanguage(locale: string): "en" | null {
  if (!locale || locale !== locale.trim()) return null;
  try { return new Intl.Locale(locale).language === "en" ? "en" : null; } catch { return null; }
}
export function requireGeoGenerationLanguage(locale: string): "en" {
  const language = geoGenerationLanguage(locale);
  if (language === null) throw new RangeError("GEO generation supports English locales only.");
  return language;
}
export type GeoSource = "kb" | "ai_sample" | "crawl" | "product_profile" | "site_index" | "user_input";
export interface GeoSnapshotReference { kb_id: string; snapshot_id: string; revision: number; content_hash: string }
export interface GeoOrigin {
  kind: "manual" | "visibility";
  question: { id: string | null; text: string };
  role: string | null;
  layer: string | null;
  gap: "A" | "B" | "D" | null;
  run_ref: { id: string; fingerprint: string } | null;
  sample_refs: string[];
  kb_ref: GeoSnapshotReference;
  promptset_ref: { schema: string; registry_version: string; hash: string };
  profile_ref: { website_id: string; snapshot_id: string; snapshot_revision: number; profile_schema: string; profile_hash: string } | null;
}
export interface GeoSampleRef {
  id: string;
  run_id: string;
  question_id: string;
  engine: string;
  collected_at: string;
  status: "answered" | "failed";
  search_enabled: boolean | null;
  /** Actual successful answer excerpt, never a factual source for Draft. */
  excerpt: string;
  topics: string[];
}
export interface GeoFactEvidence {
  id: string;
  source: "kb" | "crawl" | "product_profile";
  text: string;
  observed_at: string;
  url: string | null;
}
export interface GeoFact {
  id: string;
  label: string;
  value: string | null;
  reason: "missing" | "conflicting" | "unverified" | "notPublished" | "fetchFailed" | "lowConfidence" | null;
  evidence_refs: string[];
}
export interface GeoMustAnswerItem {
  id: string;
  q: string;
  source: "kb" | "ai_sample" | "user_input";
  cluster: { canonical_heading: string; members: { sample_id: string; heading: string }[] };
  covered_by: number;
  sample_total: number;
}
export interface GeoOutlineItem {
  id: string;
  h2: string;
  h3: string[];
  answers: string[];
  provenance: { method: "model"; derived_from: GeoSource[] };
}
export interface GeoContentBrief {
  schema: typeof GEO_CONTENT_BRIEF_SCHEMA;
  source: "geo";
  run: { run_id: string; collected_at: string; elapsed_ms: number; budget_ms: number; fingerprint: string };
  keyword: ContentBrief["keyword"];
  geo_origin: GeoOrigin;
  evidence: {
    /** Additional immutable scoring requirements, not model suggestions. */
    kb_requirements: { id: string; text: string }[];
    samples: GeoSampleRef[];
    facts: GeoFactEvidence[];
    site_index: { id: string; url: string; title: string; observed_at: string }[];
  };
  lead_answer: { question_id: "Q1"; requirement: string; required_entities: string[]; source: "kb" | "user_input"; fact_refs: string[] };
  must_answer: { status: "available"; items: GeoMustAnswerItem[] };
  fact_table: GeoFact[];
  outline: { status: "available"; items: [GeoOutlineItem, ...GeoOutlineItem[]] } | Unavailable;
  intent: { status: "available"; value: "informational" | "commercial" | "transactional" | "navigational"; provenance: { method: "heuristic"; origin: "kb" | "user_input" } } | Unavailable;
  format: { status: "available"; value: "comparison" | "guide" | "product_page"; reason: "gap_d_comparison" | "intent_derived"; provenance: { method: "heuristic"; origin: "kb" | "user_input" | "ai_sample" } } | Unavailable;
  verdict: { action: "undecidable"; reason: "geo_not_serp"; provenance: null };
  length: Unavailable;
  gap_angle: Unavailable;
  internal_links: { status: "available"; items: { page_ref: string; why: string; source: "site_index" }[] } | Unavailable;
  do_not_cover: Unavailable;
  budget: { outline_cap: typeof GEO_OUTLINE_CAP; must_answer_cap: typeof GEO_MUST_ANSWER_CAP; must_answer_candidates: number; must_answer_shown: number; must_answer_hidden: number };
  draft_readiness: { writable: string[]; gaps: ("no_outline" | "missing_facts")[] };
}
export type SharedContentBrief = ContentBrief | GeoContentBrief;
export type SharedContentBriefHandoff = Omit<ContentBriefHandoff, "brief"> & { brief: SharedContentBrief };
export function isGeoContentBrief(brief: SharedContentBrief): brief is GeoContentBrief {
  return brief.schema === GEO_CONTENT_BRIEF_SCHEMA;
}
