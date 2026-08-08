import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./_growth-map.tsx", import.meta.url),
  "utf8",
);

const en = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../../packages/i18n/src/messages/en.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { growthMap: Record<string, unknown> };

const zhCN = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../../packages/i18n/src/messages/zh-CN.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { growthMap: Record<string, unknown> };

describe("Growth Map URL portfolio wiring", () => {
  it("reads every headline count from the frozen-generation summary", () => {
    expect(source).toContain("const summary = response.meta.summary;");
    expect(source).toContain("<strong>{summary.urlCount}</strong>");
    expect(source).toContain("<strong>{summary.opportunityUrlCount}</strong>");
    expect(source).toContain("<strong>{summary.signalCount}</strong>");
    expect(source).toContain("summary.priorityCounts[priority]");
  });

  it("never re-derives the signal or opportunity totals from the loaded page", () => {
    expect(source).not.toContain("count + item.findingIds.length");
    expect(source).not.toContain(
      "const opportunityUrlCount = items.filter(",
    );
  });

  it("reads the complete frozen Opportunity projection instead of a paged URL table", () => {
    expect(source).toContain("readCompleteGrowthMapOpportunities(");
    expect(source).toContain("readCompleteGrowthMapUrls(");
    expect(source).not.toContain("growthMapPageWindow({");
    expect(source).not.toContain('"paginationStatus"');
    expect(source).not.toContain(
      '<span>{t("loadedCount", { count: items.length })}</span>',
    );
  });

  it("labels an unclassified page type instead of claiming it was not collected", () => {
    expect(source).not.toContain('{item.pageType ?? t("notCollected")}');
    expect(source).toContain("{pageTypeLabel(pageType)}");
    expect(source).toContain(
      '<span>{t("pageType", { value: pageTypeLabel(detail.pageType) })}</span>',
    );
  });

  it("navigates the primary opportunity to Execution when an Action exists", () => {
    expect(source).toContain(
      "const primaryOpportunity = growthMapPrimaryOpportunity(detail.findings);",
    );
    expect(source).not.toContain("const topFinding = detail.findings[0]");
    expect(source).toMatch(
      /primaryOpportunity\.kind === "execution" \? \(\s+<Link[\s\S]{0,200}executionHrefForRef\(/,
    );
    expect(source).toContain('t("primaryOpportunityReviewHint")');
  });

  it("keeps the priority filter in the more-filters drawer, not the main toolbar", () => {
    expect(source).toContain("styles.portfolioFilterDrawer");
    expect(source).toContain('t("portfolioFilters.more")');
    const drawerStart = source.indexOf("styles.portfolioFilterDrawer");
    const priorityFilterStart = source.indexOf(
      't("portfolioFilters.priority")',
    );
    expect(drawerStart).toBeGreaterThan(0);
    expect(priorityFilterStart).toBeGreaterThan(drawerStart);
  });

  it("counts only the object tab that has a generation-wide total", () => {
    expect(source).toContain(
      "const urlCount = generationQuery.data?.meta.summary.urlCount ?? null;",
    );
    expect(source).toContain('key === "pages" && urlCount !== null');
    expect(source).not.toContain("modeCount.keywords");
    expect(source).not.toContain("modeCount.competitors");
  });

  it("ships every page_type.v1 label in both locales", () => {
    const slugs = [
      "home",
      "product",
      "blog",
      "integration",
      "comparison",
      "commercial",
      "resource",
      "trust",
      "solution",
      "template",
      "documentation",
      "unclassified",
    ];
    expect(Object.keys(zhCN.growthMap["pageTypeLabel"] as object).sort()).toEqual(
      [...slugs].sort(),
    );
    expect(Object.keys(en.growthMap["pageTypeLabel"] as object).sort()).toEqual(
      [...slugs].sort(),
    );
    expect(
      (zhCN.growthMap["pageTypeLabel"] as Record<string, string>)[
        "unclassified"
      ],
    ).toBe("未分类");
    expect(
      (zhCN.growthMap["pageTypeLabel"] as Record<string, string>)[
        "documentation"
      ],
    ).toBe("文档页");
  });

  it("offers a Keyword import entry instead of an all-zero empty card", () => {
    expect(source).toContain('t("portfolioSummary.uncoveredEmpty")');
    expect(source).toContain(
      "<Link href={`/p/${projectId}/sources`}>",
    );
    expect(zhCN.growthMap["portfolioSummary"]).toMatchObject({
      loaded: "已收录页面",
      opportunityUrls: "有机会的 URLs",
      signals: "增长信号",
    });
  });
});

describe("Growth Map filter and review honesty wiring", () => {
  const locales = [zhCN, en];

  it("never renders fewer Opportunity targets than the section header claims", () => {
    // The targets header states the full count, so the list must either show
    // every target or expose an explicit expander for the remainder.
    expect(source).toContain('t("opportunity.targetsCount"');
    expect(source).toContain('t("opportunity.showAllTargets"');
    expect(source).toContain("targetsExpanded");
    expect(source).toContain("? item.targetPages\n");
    for (const messages of [zhCN, en]) {
      const pageViews = messages.growthMap["pageViews"] as {
        opportunity: Record<string, string>;
      };
      expect(pageViews.opportunity["showAllTargets"]).toContain("{count}");
      expect(pageViews.opportunity["collapseTargets"]).toBeTruthy();
    }
  });

  it("filters the complete Opportunity ledger without a pager or scope note", () => {
    expect(source).toContain("<div className={styles.workspace}>");
    expect(source).toContain('t("searchScope")');
    expect(source).not.toContain("styles.portfolioPagination");
    expect(source).not.toContain('t("portfolioFilters.clientScopeNote"');
  });

  it("degrades the primary opportunity honestly when every Finding is closed", () => {
    expect(source).toContain(
      'primaryOpportunity.reason === "no_findings" ? null : (',
    );
    expect(source).toContain('t("primaryOpportunityClosedAction")');
    expect(source).toContain("onClick={openClosedFindings}");
    for (const messages of locales) {
      expect(
        String(messages.growthMap["primaryOpportunityClosedHint"]),
      ).toContain("{count}");
      expect(messages.growthMap["primaryOpportunityClosedAction"]).toBeTruthy();
    }
  });

  it("never labels a machine-approved keyword with the human confirmation wording", () => {
    expect(source).toContain("growthMapKeywordReviewPresentation(item)");
    expect(source).not.toContain("<KeywordStatusPill status=");
    for (const messages of locales) {
      const library = messages.growthMap["keywordLibrary"] as Record<
        string,
        unknown
      >;
      const origin = library["reviewOrigin"] as Record<string, string>;
      const status = library["status"] as Record<string, string>;
      expect(Object.keys(origin).sort()).toEqual([
        "approvedByMigration",
        "approvedBySystem",
        "label",
        "migration_baseline",
        "pendingHumanReview",
        "pendingHumanReviewHint",
        "system_suggestion",
        "user",
      ]);
      expect(origin["approvedBySystem"]).not.toBe(status["approved"]);
      expect(origin["approvedByMigration"]).not.toBe(status["approved"]);
    }
  });
});
