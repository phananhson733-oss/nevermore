// @input  -- CaseStudyMetric type from case-study-metrics component
// @output -- slug-to-metrics registry for case study posts
// @pos    -- case study metrics registry, consumed by blog-article-content.tsx
// once this file is updated, update header comments and _DIR.md in this folder

import type { CaseStudyMetric } from "@/components/blog/case-study-metrics";

/**
 * Map of slug -> locale -> metrics for case study posts.
 * Used by blog-article-content.tsx to render metrics above article body.
 *
 * Empty since 2026-08-25. The only entry was the AstrologyWiki case study,
 * whose before/after card claimed 5,000+ monthly users, 247 indexed pages, and
 * a 3.2% signup conversion rate. None of those are traceable to a reviewable
 * record in this repository. The 2026-08-13 pass rewrote that article's body
 * into an evidence-boundary correction but left this card in place, so the page
 * rendered the disputed numbers directly above the text retracting them. The
 * article is now retired and the card with it.
 *
 * Anything added here renders as a factual before/after claim to every reader.
 * Add a slug only when each number traces to a dated, reviewable source.
 */
export const CASE_STUDY_METRICS_MAP: Record<
  string,
  Record<string, readonly CaseStudyMetric[]>
> = {};
