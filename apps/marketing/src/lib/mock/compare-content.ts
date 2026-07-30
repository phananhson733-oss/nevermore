// @input  -- none (static data)
// @output -- comparison page data for all competitors, getComparison(), getComparisons()
// @pos    -- data layer for /compare/* programmatic SEO pages
// once this file is updated, update header comments and _DIR.md in this folder

export interface ComparisonDimension {
  readonly name: string;
  readonly gengrowth: string;
  readonly competitor: string;
  readonly verdict: "gengrowth" | "competitor" | "tie";
}

export interface ComparisonFaq {
  readonly question: string;
  readonly answer: string;
}

export interface ComparisonPage {
  readonly slug: string;
  readonly competitor: string;
  readonly locale: string;
  readonly heroTitle: string;
  readonly heroDescription: string;
  readonly tldr: string;
  readonly dimensions: ReadonlyArray<ComparisonDimension>;
  readonly bestFor: {
    readonly gengrowth: ReadonlyArray<string>;
    readonly competitor: ReadonlyArray<string>;
  };
  readonly faqs: ReadonlyArray<ComparisonFaq>;
}

export const COMPARISON_SLUGS = [
  "manual-growth",
  "okara-ai-cmo",
  "babylovegrowth",
  "ahrefs",
] as const;

export type ComparisonSlug = (typeof COMPARISON_SLUGS)[number];

export function getComparisons(): ReadonlyArray<ComparisonSlug> {
  return COMPARISON_SLUGS;
}

export function isValidComparisonSlug(
  slug: string,
): slug is ComparisonSlug {
  return COMPARISON_SLUGS.includes(slug as ComparisonSlug);
}
