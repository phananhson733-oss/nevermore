import { describe, expect, it } from "vitest";
import {
  COMPETITOR_KEYWORD_GAP_ERROR_CODES,
  COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS,
  COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BASES,
  COMPETITOR_KEYWORD_GAP_PRE_SCREEN_REASONS,
} from "@sf/public-tools/competitor-keyword-gap";
import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

const SEO_AUDIT_EVIDENCE_KEYS = [
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
] as const;

const COMPETITOR_GAP_RESULT_REQUIRED_PATHS = [
  "summary.eyebrow",
  "summary.versus",
  "overview.returnedGapRows",
  "overview.returnedGapRowsBody",
  "overview.completedCompetitors",
  "overview.completedCompetitorsBody",
  "overview.gscObservedRows",
  "overview.gscObservedRowsBody",
  "legend.ownState",
  "coverage.scope",
  "coverage.requested",
  "coverage.failure",
  "coverage.detailsSummary",
  "metrics.cpc",
  "metrics.difficulty",
  "boundaries.title",
  "boundaries.dfsEstimates",
  "boundaries.gscOwnSample",
  "boundaries.competitorOutcomesUnavailable",
  "boundaries.manualSnapshot",
  "gsc.evidenceBasis.query",
  "gsc.evidenceBasis.query_page",
  "gsc.pageStatus.observed_sufficient",
  "gsc.pageStatus.observed_partial",
  "gsc.pageStatus.not_observed_in_gsc_query_page_sample",
  "gsc.pageStatus.gsc_query_page_sample_not_read",
  "gsc.metricLine",
  "gsc.pageMetricLine",
  "filters.all",
  "filters.optimize_existing",
  "filters.review_existing_query",
  "filters.review_content_gap",
  "filters.verify_own_coverage",
  "signals.bestRank",
  "signals.difficulty",
  "actions.copyKeyword",
  "actions.optimizeObservedPage",
  "actions.reviewObservedPage",
  "actions.openCompetitorPageNamed",
  "actions.runWithoutGsc",
  "actions.focusProperty",
  "actions.copyFailed",
  "actions.handoffFailed",
  "actions.remaining",
  "actions.showingAll",
  "actions.showAll",
  "actions.showLess",
  "table.title",
  "table.subtitle",
  "table.keyword",
  "table.monthlySearchVolume",
  "table.competitorCoverage",
  "table.yourStatus",
  "table.opportunitySignals",
  "table.nextAction",
  "nextSteps.review_existing_query",
  "nextSteps.review_content_gap",
  "nextSteps.verify_own_coverage",
  // preScreen.band.*, preScreen.basis.* and preScreen.reason.* are derived
  // from the contract arrays below, not hand-listed here.
  "preScreen.title",
  "preScreen.filterAll",
  "signals.aiOverviewSnapshot",
  "signals.aiOverviewSnapshotUndated",
  "signals.competitorTraffic",
  "actions.copyPlan",
  "actions.copyPlanDone",
  "actions.copyPlanFailed",
  "sources.short.dfs",
  "sources.short.gsc",
  "legend.dfsMeans",
  "legend.gscMeans",
  "status.partialBody.competitors",
  "status.partialBody.gscUnavailable",
  "status.partialBody.gscPartial",
  "status.partialBody.both",
  "status.partialBody.unspecified",
  "coverage.sampleRule",
  "coverage.rowsInRule",
  "overview.gscQueryRows",
  "limitations.gscNoRows",
  "boundaries.dfsSnapshot",
  "boundaries.preScreen",
] as const;

const COMPETITOR_GAP_UNUSED_SHAPE_PATHS = [
  "overview.optimizeExisting",
  "overview.optimizeExistingBody",
  "overview.reviewContentGap",
  "overview.reviewContentGapBody",
  "table.searchSnapshot",
  "table.yourSite",
  "table.action",
  "competitors.snapshot",
  "metrics.searchVolume",
  "metrics.intent",
  "table.dfsEstimates",
  "table.competitorRanks",
  "table.ownSiteGsc",
  // Banned because it named a DIFFERENT column in a discarded shape. The live
  // key for today's action column is `table.nextAction`, listed as required
  // above; the two must not be collapsed just because the words are close.
  "table.recommendation",
] as const;

function leafPaths(value: unknown, prefix = ""): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(value: string): readonly string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)(?:,|\})/g)]
    .map((match) => match[1] ?? "")
    .sort();
}

function leafMessages(
  value: unknown,
  prefix = "",
): Readonly<Record<string, string>> {
  if (typeof value === "string") return { [prefix]: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      Object.entries(leafMessages(child, prefix ? `${prefix}.${key}` : key)),
    ),
  );
}

describe("message catalogs", () => {
  /**
   * next-intl renders the key path instead of throwing when a key is missing,
   * so an untranslated key ships as the literal text `prompts.detail.copy` on a
   * production page. Nothing else catches that: type-checking does not see
   * message keys, and a test asserting a translated string "appears on the
   * page" passes just as happily against the key path.
   *
   * Checked across the whole catalog rather than per namespace, so a new
   * namespace is covered the day it is added.
   */
  it("keeps every key present in both locales", () => {
    const en = [...leafPaths(enMessages)].sort();
    const zh = [...leafPaths(zhMessages)].sort();

    expect(en.filter((key) => !zh.includes(key))).toEqual([]);
    expect(zh.filter((key) => !en.includes(key))).toEqual([]);
  });
});

describe("SEO Audit message catalogs", () => {
  it("keeps the complete English and Chinese SEO Audit key shapes aligned", () => {
    expect([...leafPaths(enMessages.tools.seoAudit)].sort()).toEqual(
      [...leafPaths(zhMessages.tools.seoAudit)].sort(),
    );
  });

  it.each([
    ["en", enMessages],
    ["zh", zhMessages],
  ] as const)("contains every audit evidence label in %s", (_, messages) => {
    const evidence = messages.tools.seoAudit.evidence as Record<
      string,
      unknown
    >;

    for (const key of SEO_AUDIT_EVIDENCE_KEYS) {
      expect(evidence[key]).toEqual(expect.any(String));
    }
  });

  it("removes the legacy score, priority, diagnosis, and recommendation keys", () => {
    const keys = Object.keys(enMessages.tools.seoAudit);
    for (const removed of [
      "scoreLabel",
      "moduleScoreLabel",
      "priorities",
      "priorityListTitle",
      "diagnosisLabel",
      "recommendationLabel",
      "verificationLabel",
      "severities",
    ]) {
      expect(keys).not.toContain(removed);
    }
  });
});

describe("competitor keyword gap message catalogs", () => {
  it("keeps the full EN/ZH key shape and placeholders aligned", () => {
    const en = leafMessages(enMessages.tools.competitorKeywordGap);
    const zh = leafMessages(zhMessages.tools.competitorKeywordGap);

    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const [key, message] of Object.entries(en)) {
      expect(placeholders(message), key).toEqual(placeholders(zh[key] ?? ""));
    }
  });

  it("localizes every public error and the four canonical provider intents", () => {
    for (const messages of [enMessages, zhMessages]) {
      const copy = messages.tools.competitorKeywordGap;
      expect(Object.keys(copy.errors).sort()).toEqual(
        [...COMPETITOR_KEYWORD_GAP_ERROR_CODES, "unknown"].sort(),
      );
      expect(Object.keys(copy.intent).sort()).toEqual([
        "commercial",
        "informational",
        "navigational",
        "transactional",
        "unknown",
      ]);
      expect(copy.summary.unavailable).toMatch(/\{count(?:,|\})/);
    }
  });

  // The only recovery from a stale bundle is a page reload; both catalogs
  // must actually say so, not merely have some string under the key.
  it("tells a stale client to refresh the page in both catalogs", () => {
    expect(
      enMessages.tools.competitorKeywordGap.errors.client_out_of_date,
    ).toMatch(/Refresh the page/);
    expect(
      zhMessages.tools.competitorKeywordGap.errors.client_out_of_date,
    ).toMatch(/刷新页面/);
  });

  /**
   * The engine exports the band, basis and reason arrays so a value cannot be
   * added or renamed without a place in the surface. Keyed against those
   * arrays, not a hand-typed list: a hand-typed list passes an engine rename
   * and ships the literal key path on the page.
   */
  it("localizes exactly the contract's pre-screen bands, bases and reasons", () => {
    for (const messages of [enMessages, zhMessages]) {
      const copy = messages.tools.competitorKeywordGap.preScreen;
      expect(Object.keys(copy.band).sort()).toEqual(
        [...COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS].sort(),
      );
      expect(Object.keys(copy.basis).sort()).toEqual(
        [...COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BASES].sort(),
      );
      // The short form is rendered on every band chip, so a basis without one
      // would show the reader a raw key.
      expect(Object.keys(copy.basisShort).sort()).toEqual(
        [...COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BASES].sort(),
      );
      expect(Object.keys(copy.reason).sort()).toEqual(
        [...COMPETITOR_KEYWORD_GAP_PRE_SCREEN_REASONS].sort(),
      );
    }
  });

  it("pluralizes the row-count messages", () => {
    for (const messages of [enMessages, zhMessages]) {
      const copy = messages.tools.competitorKeywordGap;
      expect(copy.actions.copyPlan).toMatch(/\{count, plural,/);
      expect(copy.actions.copyPlanDone).toMatch(/\{count, plural,/);
      expect(copy.overview.gscQueryRows).toMatch(/\{count, plural,/);
    }
  });

  // signals.competitorTraffic renders a DataForSEO traffic estimate in the
  // same report; the outcomes boundary must name that estimate, or the two
  // contradict on screen.
  it("names the DataForSEO estimate in the outcomes boundary", () => {
    for (const messages of [enMessages, zhMessages]) {
      const copy = messages.tools.competitorKeywordGap.boundaries;
      expect(copy.competitorOutcomesUnavailable).toMatch(
        /DataForSEO (?:estimate|估算)/,
      );
    }
  });

  it.each([
    ["en", enMessages],
    ["zh", zhMessages],
  ] as const)(
    "contains the exact production result paths and no unused shape keys in %s",
    (_, messages) => {
      const leaves = leafMessages(messages.tools.competitorKeywordGap);

      expect(
        COMPETITOR_GAP_RESULT_REQUIRED_PATHS.filter(
          (path) => typeof leaves[path] !== "string",
        ),
      ).toEqual([]);
      expect(
        COMPETITOR_GAP_UNUSED_SHAPE_PATHS.filter((path) => path in leaves),
      ).toEqual([]);
    },
  );
});
