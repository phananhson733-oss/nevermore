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
  "coverage.scope",
  "coverage.requested",
  "coverage.failure",
  "coverage.detailsSummary",
  "boundaries.title",
  "boundaries.dfsEstimates",
  "boundaries.gscOwnSample",
  "boundaries.competitorOutcomesUnavailable",
  "boundaries.manualSnapshot",
  "gsc.observed_strong",
  "gsc.observed_weak",
  "gsc.not_observed_in_gsc_query_sample",
  "gsc.gsc_query_sample_not_read",
  "gsc.statusWithPosition",
  "gsc.positionTitle",
  "gsc.evidenceBasis.query",
  "gsc.evidenceBasis.query_page",
  "gsc.pageStatus.observed_sufficient",
  "gsc.pageStatus.observed_partial",
  "gsc.pageStatus.not_observed_in_gsc_query_page_sample",
  "gsc.pageStatus.gsc_query_page_sample_not_read",
  "gsc.impressionsLine",
  "gsc.pageMetricLine",
  "sort.impressions",
  "sort.position",
  "signals.bestRank",
  "signals.difficulty",
  "actions.optimizeObservedPage",
  "actions.reviewObservedPage",
  "actions.openCompetitorPageNamed",
  "actions.openOpportunityFinder",
  "actions.runWithoutGsc",
  "actions.focusProperty",
  "actions.handoffFailedOnPage",
  "actions.handoffFailedOpportunityFinder",
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
  // preScreen.band.*, preScreen.basis.* and preScreen.reason.* are derived
  // from the contract arrays below, not hand-listed here.
  "signals.aiOverviewSnapshot",
  "signals.aiOverviewSnapshotUndated",
  "signals.competitorTraffic",
  "actions.exportCsv",
  "actions.exportCsvBasisCapped",
  "actions.exportCsvBasisComplete",
  "actions.exportCsvPartial",
  "status.unavailableBody",
  // The count on the button says HOW MANY keywords the file holds; this says
  // WHICH ones and on what basis. A capped export that carries only the first
  // half is a lie without the second sentence.
  "sources.short.dfs",
  "sources.short.gsc",
  "legend.dfsMeans",
  "legend.gscMeans",
  "coverage.sampleRule",
  "coverage.rowsInRule",
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
  // Removed by decision, not by accident. The row-level "copy keyword" action
  // was replaced by the one-click full-CSV export, and the status pill now
  // carries the average position that `gsc.metricLine` used to repeat below it.
  // Restoring either key would put a second, quieter copy of something the
  // surface already says back on the page.
  "actions.copyKeyword",
  "gsc.metricLine",
  // Stripped from the results surface by decision. The source legend card, the
  // lane and band filter rows, the lane-note sentences, the two run-status
  // lines and the GSC observed-rows card were all removed together; every key
  // below was rendered by exactly one of them and by nothing else. Copy that
  // nothing renders cannot be reviewed, so it drifts into stating things the
  // surface no longer does -- restoring a key here without restoring the
  // surface that reads it puts an unreviewable sentence back in the catalog.
  "legend.ownState",
  "sources.dfs",
  "sources.gsc",
  "sources.status.available",
  "sources.status.partial",
  "sources.status.unavailable",
  "sources.status.not_requested",
  "status.complete",
  "status.completeBody",
  "status.partial",
  "status.partialBody.competitors",
  "status.partialBody.gscUnavailable",
  "status.partialBody.gscPartial",
  "status.partialBody.both",
  "status.partialBody.unspecified",
  "status.unavailable",
  "summary.competitors",
  "summary.unavailable",
  "overview.gscObservedRows",
  "overview.gscObservedRowsBody",
  "overview.gscQueryRows",
  "actions.copyPlan",
  "actions.copyPlanDone",
  "actions.copyPlanFailed",
  "filters.all",
  "filters.optimize_existing",
  "filters.review_existing_query",
  "filters.review_content_gap",
  "filters.verify_own_coverage",
  // The lane SENTENCES only. `gsc.nextStep` still decides each row's action
  // verb, which is rendered from `actions.*`; what went is the paragraph that
  // restated the lane above the table.
  "nextSteps.optimize_existing",
  "nextSteps.review_existing_query",
  "nextSteps.review_content_gap",
  "nextSteps.verify_own_coverage",
  "preScreen.filterAll",
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
      expect(copy.actions.exportCsv).toMatch(/\{count, plural,/);
    }
  });

  /**
   * The export is capped at the top rows by provider search volume, so the
   * button's own label must not claim the file carries the run. "All" is the
   * word that made the old label false the moment a run returned more rows
   * than the cap, and the sentence beside it has to name the basis of the cut
   * rather than leave the reader to guess which rows they got.
   */
  it("never claims the CSV holds every row, and names the basis of the cut", () => {
    expect(enMessages.tools.competitorKeywordGap.actions.exportCsv).not.toMatch(
      /\ball\b/i,
    );
    expect(zhMessages.tools.competitorKeywordGap.actions.exportCsv).not.toMatch(
      /全部/,
    );
    const en = enMessages.tools.competitorKeywordGap.actions;
    const zh = zhMessages.tools.competitorKeywordGap.actions;
    for (const sentence of [
      en.exportCsvBasisCapped,
      en.exportCsvBasisComplete,
      zh.exportCsvBasisCapped,
      zh.exportCsvBasisComplete,
    ]) {
      expect(sentence).toMatch(/DataForSEO/);
    }
    // Two sentences, because below the cap nothing was left out: only the
    // capped one may narrow what the file holds, and only the complete one may
    // say it holds everything. One string doing both was wrong in one case or
    // the other whichever way it was worded.
    expect(en.exportCsvBasisCapped).toMatch(/highest/i);
    expect(en.exportCsvBasisComplete).toMatch(/every/i);
    expect(zh.exportCsvBasisCapped).toMatch(/最高/);
    expect(zh.exportCsvBasisComplete).toMatch(/全部/);
    // The partial-run line has to say what a missing competitor does NOT mean,
    // since the nine columns cannot carry that themselves.
    expect(en.exportCsvPartial).toMatch(/unknown/i);
    expect(zh.exportCsvPartial).toMatch(/未知/);
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

  /**
   * Absence from the bounded Search Console sample is not absence from Search.
   * Anonymized queries never enter that sample at all, so "not covered" would
   * state a fact this tool cannot have -- and would contradict the evidence
   * boundary two cards below it on the same page, which says exactly that. The
   * reference report this surface follows uses the phrase; this catalog must
   * not, in either language.
   */
  it("never calls a row not covered in either language", () => {
    const en = Object.entries(
      leafMessages(enMessages.tools.competitorKeywordGap),
    ).filter(([, message]) => /not covered/i.test(message));
    const zh = Object.entries(
      leafMessages(zhMessages.tools.competitorKeywordGap),
    ).filter(([, message]) => message.includes("未覆盖"));

    expect(en).toEqual([]);
    expect(zh).toEqual([]);
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
