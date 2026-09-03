// @input  -- nothing; this module is a constant table
// @output -- the complete set of records one site-wide crawl publishes
// @pos    -- single authority shared by the producer and every consumer guard
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { INDEX_COVERAGE_LIMITATION_CODES } from "./index-coverage.ts";

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
  page_without_any_discovery_path: "links",
  sitemap_page_without_observed_inlink: "links",
  internal_target_http_error: "links",
  faq_schema_question_not_on_page: "structured_data",
  page_near_duplicate_of_another_page: "structure",
  json_ld_parse_error: "structured_data",
  viewport_missing: "structure",
  lang_missing: "metadata",
  charset_missing: "metadata",
  favicon_missing: "metadata",
  thin_body_text: "structure",
  external_link_blank_without_noopener: "links",
  client_rendered_content: "structure",
  html_document_oversized: "structure",
  page_outbound_broken_link: "links",
  page_not_in_sitemap: "crawl",
  title_length_outside_range: "metadata",
  meta_description_length_outside_range: "metadata",
  page_without_outbound_internal_link: "links",
  click_depth_beyond_reviewed_limit: "links",
  json_ld_missing: "structured_data",
  soft_404_page: "indexability",
  hreflang_target_http_error: "indexability",
  content_to_code_ratio: "structure",
  render_blocking_head_resource: "structure",
  first_image_lazy_loaded: "structure",
  json_ld_missing_required_property: "structured_data",
  external_link_follow_mix: "links",
  page_disallowed_for_search_crawler: "crawl",
  sitemap_url_disallowed_by_robots: "crawl",
  page_without_breadcrumb_list: "structured_data",
  image_without_alt_text: "structure",
  image_alt_coverage: "structure",
  image_in_legacy_format: "structure",
  open_graph_incomplete: "metadata",
  heading_level_skipped: "structure",
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
  "viewport_declared",
  "html_lang",
  "charset_declared",
  "favicon_declared",
  "body_text_units",
  "reviewed_floor",
  "blank_without_noopener",
  "external_links",
  "script_bytes",
  "visible_text_bytes",
  "html_bytes",
  "reviewed_ceiling",
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
  "source_pages",
  "matched_phrase",
  "similarity_to_nearest_page",
  "nearest_page",
  "distinctive_blocks_compared",
  "declared_faq_questions",
  "questions_not_found_in_visible_text",
  "first_missing_question",
  "broken_hreflang_targets",
  "declared_hreflang_alternates",
  "broken_hreflang_sample",
  "visible_text_bytes",
  "render_blocking_stylesheets",
  "render_blocking_scripts",
  "first_image_lazy_loaded",
  "first_image_width",
  "first_image_height",
  "missing_required_properties",
  "judged_json_ld_types",
  "html_bytes",
  "script_bytes",
  "content_to_code_ratio",
  "external_links",
  "external_links_nofollow",
  "external_links_blank_without_noopener",
  "body_text_units",
  "text_units_basis",
  "text_units_floor",
  "malformed_blocks",
  "types_observed",
  "broken_link_targets",
  "title_display_width",
  "description_display_width",
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
  "robots_user_agent",
  "robots_allowed",
  "images_without_alt",
  "alt_coverage_share",
  "pages_with_images",
  "pages_with_uncovered_images",
  "images_observed",
  "images_on_page",
  "modern_format_share",
  "legacy_format_share",
  "images_with_readable_format",
  "open_graph_title",
  "open_graph_description",
  "open_graph_image",
  "skipped_from_level",
  "skipped_to_level",
  "heading_levels_observed",
];

/**
 * Every limitation code those records publish.
 *
 * The third fail-closed list this ledger now covers, and the one that caught us
 * out: a record's limitation code is checked by the same display seam as its id
 * and its observation labels, and a code it cannot name blanks the whole panel
 * silently. `average_response_time` publishes one unconditionally, so a single
 * unlisted code took every audit dark.
 */
export const SEO_AUDIT_LIMITATION_CODES: readonly string[] = [
  "declared_meta_viewport_only_no_rendering",
  "declared_html_lang_attribute_only",
  "meta_charset_and_content_type_header_only",
  "declared_link_rel_icon_only_no_root_probe",
  "static_text_units_reviewed_floor_not_a_documented_rule",
  "declared_anchor_attributes_only",
  "transferred_markup_only_no_rendering",
  "transferred_markup_bytes_only",
  "resource_not_observed_does_not_prove_absence",
  "static_response_directives_only",
  "normalised_text_match_within_inspected_pages",
  "bounded_static_html_crawl_inlinks_only",
  "crawl_incomplete_inlinks_unreliable",
  "faq_match_against_collected_paragraphs_only",
  "similarity_measured_on_collected_paragraphs_after_chrome",
  "uncollected_link_targets_not_classified",
  "static_html_json_ld_only",
  "no_sitemap_collected_membership_not_testable",
  "display_width_approximation_rendered_pixel_width_not_measured",
  "bounded_static_html_crawl_outlinks_only",
  "depth_from_bounded_crawl_entry_point_only",
  "single_uncached_request_per_url_not_a_field_measurement",
  "redirect_destination_status_not_observed_for_every_redirect",
  "soft_404_needs_both_a_not_found_phrase_and_a_body_below_the_published_floor",
  "hreflang_targets_outside_this_crawl_were_not_classified",
  "utf8_bytes_of_the_delivered_html_no_rendering_performed",
  "declared_in_the_head_markup_no_lab_run_and_no_network_timing",
  "first_image_in_document_order_with_a_declared_size_no_viewport_is_available",
  "only_types_in_the_reviewed_required_property_table_are_judged",
  "external_links_counted_by_destination_not_by_anchor",
  "robots_rules_read_for_one_search_crawler_token_only",
  "robots_rules_hit_this_runs_cap_so_a_disallow_may_have_been_dropped",
  "sitemap_urls_hit_this_runs_cap_so_a_declared_url_may_be_missing",
  "breadcrumb_markup_presence_only_not_compared_to_visible_trail",
  "static_html_img_tags_only_css_and_script_rendered_images_not_seen",
  "format_read_from_the_url_extension_only_not_from_the_response",
  "static_html_meta_tags_only",
  "heading_levels_read_from_static_html_in_document_order",
];

/** Limitation codes the per-visitor search region publishes. */
export const SEARCH_PERFORMANCE_LIMITATION_CODES: readonly string[] = [
  ...INDEX_COVERAGE_LIMITATION_CODES,
  "abandoned_share_counts_only_urls_this_crawl_fetched_and_resolved",
  "too_few_of_this_propertys_impressions_landed_on_crawled_pages_to_judge",
  "query_rows_hit_the_row_cap_so_the_reported_total_is_short",
  "share_of_reported_queries_only_banded_by_one_average_position_each",
  "page_rows_hit_the_row_cap_so_a_page_with_impressions_may_be_missing",
  "search_console_window_may_predate_a_recently_published_page",
  "no_target_query_was_confirmed_for_this_page_so_there_is_no_band_to_report",
  "the_submitted_page_was_not_collected_so_no_per_page_query_rows_were_requested",
  "target_page_query_rows_hit_the_row_cap_so_a_confirmed_query_may_be_missing",
  "search_console_reported_no_impressions_for_the_confirmed_queries_on_this_url",
  "some_confirmed_queries_had_no_impressions_on_this_url_and_are_not_in_this_average",
  "one_impression_weighted_average_per_query_over_the_reported_window_only",
  "search_console_returned_a_position_this_run_cannot_band_for_this_url",
  "no_clicks_were_reported_in_the_window_so_there_is_no_split_to_publish",
  "brand_terms_derived_from_the_property_and_matched_as_substrings",
];
