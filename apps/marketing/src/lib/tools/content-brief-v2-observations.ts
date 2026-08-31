// @input -- frozen Brief v2/v3 context, independent of model availability
// @output -- unit-separated lengths, competitor question denominator and version-scoped format heuristics
// @pos -- pure Marketing presentation; v3 sampled SERP titles/URLs never impersonate full-SERP measurements

import type { ClassifiedSerpFormat, SerpFormat, SerpReadMeta } from "@sf/public-tools/content-brief/contract";
import { classifySerpFormat } from "@sf/public-tools/content-brief/classify";
import type { ResearchLength, ResearchPage } from "@sf/public-tools/content-brief/v2-contract";
import type { BriefV2Context } from "@sf/public-tools/content-brief/v2-generation-contract";

export interface BriefV2LengthStatistics {
  readonly unit: ResearchLength["unit"];
  readonly count: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly min: number;
  readonly max: number;
  readonly page_refs: readonly string[];
}

export interface BriefV2FormatPageObservation {
  readonly page_ref: string;
  /** Raw SERP URL or the legacy observed final URL; callers must validate before linking. */
  readonly url: string | null;
  readonly final_url: string | null;
  readonly title: string | null;
  readonly rank: number | null;
  readonly format: SerpFormat;
  readonly rules_hit: readonly string[];
  readonly basis: "final_url_only" | "serp_title_url";
  readonly body_complete: boolean | null;
  readonly omitted_segments: number | null;
  readonly truncated_segments: number | null;
}

export interface BriefV2FormatObservations {
  readonly method: "url_heuristic" | "url_title_heuristic";
  readonly read: Readonly<SerpReadMeta> | null;
  readonly denominator: number;
  readonly unknown_count: number;
  readonly counts: readonly {
    readonly format: SerpFormat;
    readonly count: number;
    readonly page_refs: readonly string[];
  }[];
  readonly majority: ClassifiedSerpFormat | null;
  /** All observed known formats, count-descending; ties keep source order. */
  readonly candidates: readonly ClassifiedSerpFormat[];
  readonly pages: readonly BriefV2FormatPageObservation[];
  readonly partial_page_count: number | null;
}

export interface BriefV2Observations {
  readonly scope: "retained_competitor_pages" | "sampled_serp";
  readonly question_coverage_denominator: number;
  readonly quantile_method: "linear_interpolation_n_minus_1";
  readonly lengths: readonly BriefV2LengthStatistics[];
  readonly formats: BriefV2FormatObservations;
}

/** Same final-page identity as question coverage; retain query, host and path distinctions. */
function pageKey(page: ResearchPage): string {
  const url = new URL(page.final_url);
  url.hash = "";
  return url.href;
}

/**
 * For sorted x and percentile p, h=(n-1)*p; interpolate x[floor(h)] and
 * x[ceil(h)]. A single sample is its own percentile. No rounding is applied.
 */
function quantile(sorted: readonly number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  return sorted[lower]! + (sorted[Math.ceil(position)]! - sorted[lower]!) * (position - lower);
}

function observedLengths(pages: readonly ResearchPage[]): readonly BriefV2LengthStatistics[] {
  const seen = new Set<string>();
  const groups = new Map<ResearchLength["unit"], ResearchPage[]>();
  for (const page of pages) {
    const measurement = page.research.length;
    if (!page.body_complete || !Number.isFinite(measurement.value)) continue;
    const key = pageKey(page);
    if (seen.has(key)) continue;
    seen.add(key);
    groups.set(measurement.unit, [...(groups.get(measurement.unit) ?? []), page]);
  }
  return [...groups.entries()].map(([unit, samples]) => {
    const ordered = samples.map((page) => page.research.length.value).toSorted((a, b) => a - b);
    return {
      unit, count: samples.length, p25: quantile(ordered, 0.25), median: quantile(ordered, 0.5), p75: quantile(ordered, 0.75),
      min: ordered[0]!, max: ordered.at(-1)!, page_refs: samples.map((page) => page.id),
    };
  });
}

function observedFormats(pages: readonly ResearchPage[]): BriefV2FormatObservations {
  const distinct = new Map<string, ResearchPage>();
  const partial = new Set<string>();
  for (const page of pages) {
    const key = pageKey(page);
    if (!distinct.has(key)) distinct.set(key, page);
    if (!page.body_complete || page.research.omitted_segments > 0 || page.research.segments.some((segment) => segment.truncated)) partial.add(key);
  }
  const observations: readonly BriefV2FormatPageObservation[] = [...distinct.values()].map((page) => {
    // V2 retains neither title nor H1. An H2/H3 or prose excerpt is not a page
    // title, so only the observed final URL may drive the shared classifier.
    const classified = classifySerpFormat({ url: page.final_url, title: null, domain: "" });
    return {
      page_ref: page.id, final_url: page.final_url, format: classified.value, rules_hit: classified.rules_hit,
      url: page.final_url, title: null, rank: null,
      basis: "final_url_only", body_complete: page.body_complete, omitted_segments: page.research.omitted_segments,
      truncated_segments: page.research.segments.filter((segment) => segment.truncated).length,
    };
  });
  return { ...formatDistribution(observations), method: "url_heuristic", read: null, partial_page_count: partial.size };
}

function formatDistribution(observations: readonly BriefV2FormatPageObservation[]) {
  const grouped = new Map<SerpFormat, string[]>();
  for (const page of observations) grouped.set(page.format, [...(grouped.get(page.format) ?? []), page.page_ref]);
  const counts = [...grouped.entries()].map(([format, page_refs]) => ({ format, count: page_refs.length, page_refs }))
    .toSorted((a, b) => b.count - a.count);
  const known = counts.filter((item): item is typeof item & { readonly format: ClassifiedSerpFormat } => item.format !== "unknown");
  return {
    denominator: observations.length, unknown_count: grouped.get("unknown")?.length ?? 0,
    counts, majority: known.find((item) => item.count > observations.length / 2)?.format ?? null,
    candidates: known.map((item) => item.format), pages: observations,
  };
}

function sampledSerpFormats(serp: NonNullable<BriefV2Context["serp"]>): BriefV2FormatObservations {
  const observations: readonly BriefV2FormatPageObservation[] = serp.rows.map((row) => {
    const classified = classifySerpFormat(row);
    return {
      page_ref: row.id, url: row.url, final_url: null, title: row.title, rank: row.rank,
      format: classified.value, rules_hit: classified.rules_hit, basis: "serp_title_url",
      body_complete: null, omitted_segments: null, truncated_segments: null,
    };
  });
  return { ...formatDistribution(observations), method: "url_title_heuristic", read: { ...serp.read }, partial_page_count: null };
}

/** Descriptive source observations only: never a ranking target or model writing recommendation. */
export function buildBriefV2Observations(context: BriefV2Context): BriefV2Observations {
  const competitors = context.research.pages.filter((page) => page.role === "competitor");
  return {
    scope: context.serp === undefined ? "retained_competitor_pages" : "sampled_serp",
    question_coverage_denominator: new Set(competitors.map(pageKey)).size, quantile_method: "linear_interpolation_n_minus_1",
    lengths: observedLengths(competitors), formats: context.serp === undefined ? observedFormats(competitors) : sampledSerpFormats(context.serp),
  };
}
