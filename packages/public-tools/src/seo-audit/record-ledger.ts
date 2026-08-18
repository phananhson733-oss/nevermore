// @input  -- nothing; this module is a constant table
// @output -- the complete set of records one site-wide crawl publishes
// @pos    -- single authority shared by the producer and every consumer guard
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SeoAuditCategory } from "./types.ts";

/**
 * Every record `buildSeoAuditReport` emits, and the category each carries.
 *
 * This exists because there were two of them. The Agent layer kept its own
 * hand-written copy and refused any upstream payload whose ledger differed at
 * all — while its tests built fixtures from that same copy, so nothing ever ran
 * the real producer past the guard. Five detectors landed, a real run started
 * publishing twenty-nine records against a list of twenty-four, and the Agent
 * audit answered 502 with every unit test green.
 *
 * So: one table, and a test that builds an actual report and compares both
 * ways. Adding a detector without adding it here now fails at the producer,
 * which is where someone is looking.
 *
 * Search-performance records are deliberately absent. They belong to one
 * visitor's authorized property, a crawl payload is cached by host and shared,
 * and the payload guard refuses their category for exactly that reason.
 */
export const SEO_AUDIT_RECORD_CATEGORIES = {
  robots_resource: "crawl",
  sitemap_resource: "crawl",
  non_2xx_final_status: "crawl",
  redirect_chain: "crawl",
  redirect_destination_error: "crawl",
  server_error_response: "crawl",
  fetch_without_direct_page: "crawl",
  average_response_time: "crawl",
  average_click_depth: "links",
  http_url: "crawl",
  noindex_directive: "indexability",
  canonical_missing: "indexability",
  canonical_differs: "indexability",
  title_missing: "metadata",
  title_duplicate: "metadata",
  meta_description_missing: "metadata",
  meta_description_duplicate: "metadata",
  h1_missing: "structure",
  multiple_h1: "structure",
  sitemap_page_without_observed_inlink: "links",
  internal_target_http_error: "links",
  json_ld_parse_error: "structured_data",
  page_outbound_broken_link: "links",
  page_not_in_sitemap: "crawl",
  title_length_outside_range: "metadata",
  meta_description_length_outside_range: "metadata",
  page_without_outbound_internal_link: "links",
  click_depth_beyond_reviewed_limit: "links",
  json_ld_missing: "structured_data",
} as const satisfies Readonly<Record<string, SeoAuditCategory>>;

export const SEO_AUDIT_RECORD_IDS = Object.keys(SEO_AUDIT_RECORD_CATEGORIES);

/**
 * Every observation value label those records publish.
 *
 * The UI fails closed on a label it has no name for, which blanks the whole
 * results panel rather than showing an odd row — safe, and completely silent.
 * Declaring them here lets the producer package prove the model publishes
 * nothing else, and lets the UI package prove it can name all of them, without
 * either one importing the other's internals.
 */
export const SEO_AUDIT_EVIDENCE_LABELS: readonly string[] = [
  "fetched",
  "groups_observed",
  "sitemap_references",
  "urls_observed",
  "initial_status",
  "final_status",
  "redirect_hops",
  "final_url",
  "final_protocol",
  "robots_directive",
  "canonical_target",
  "page_subject",
  "title",
  "matching_pages",
  "meta_description",
  "h1_count",
  "sitemap_member",
  "observed_inbound_links",
  "observed_source_pages",
  "malformed_blocks",
  "types_observed",
  "broken_link_targets",
  "title_characters",
  "description_characters",
  "reviewed_range",
  "observed_outbound_internal_links",
  "observed_click_depth",
  "reviewed_limit",
  "json_ld_blocks",
  "average_response_ms",
  "slowest_response_ms",
  "pages_timed",
  "average_click_depth",
  "deepest_click_depth",
  "pages_measured",
];
