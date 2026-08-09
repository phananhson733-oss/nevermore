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

  it("builds all three Pages views from complete pinned inventories and one exact confirmed Topic revision", () => {
    expect(source).toContain("readCompleteGrowthMapKeywords(");
    expect(source).toContain("getGrowthMapKeywords(projectId, {");
    expect(source).toContain("diagnosticRunId,");
    expect(source).toContain("useGrowthMapTopicModelWorkspace(projectId)");
    expect(source).toContain("useGrowthMapTopicModelInsights(projectId)");
    expect(source).toContain("buildGrowthMapTopicClusterView({");
    expect(source).toContain('pageView === "url"');
    expect(source).toContain('pageView === "cluster"');
    expect(source).toContain("<UrlPageView");
    expect(source).toContain("<TopicClusterPageView");
    expect(source).toContain("<OpportunityPageView");
  });

  it("reads the complete artifact inventory before projecting Keyword delivery output", () => {
    expect(source).toContain("useProjectArtifacts(projectId)");
    expect(source).toContain("uniqueCursorItems(artifactsQuery.data)");
    expect(source).toContain("artifactsQuery.hasNextPage");
    expect(source).toContain("artifactsQuery.fetchNextPage()");
    expect(source).toContain("const completeArtifacts =");
    expect(source).toContain("artifactsQuery.isSuccess &&");
    expect(source).toContain("!artifactsQuery.hasNextPage &&");
    expect(source).toContain("!artifactsQuery.isFetchingNextPage");
    expect(source).toContain("buildGrowthMapKeywordDeliveryProjection({");
    expect(source).toContain(
      "publishedDiagnosticRunId: publishedDiagnosticRunId",
    );
    expect(source).toContain("artifacts: completeArtifacts");
  });

  it("keeps the live Keyword read separate from the published delivery run", () => {
    expect(source).toContain("publishedDiagnosticRunId={diagnosticRunId!}");
    expect(source).toContain("diagnosticRunId={null}");
    const paneStart = source.indexOf("function KeywordLibraryPane(");
    const paneSource = source.slice(
      paneStart,
      source.indexOf("type ProductProfileCompetitorOrigin", paneStart),
    );
    expect(paneSource).toContain("publishedDiagnosticRunId,");
    expect(paneSource).toContain(
      "readCompleteGrowthMapUrls(projectId, publishedDiagnosticRunId)",
    );
    expect(paneSource).toMatch(
      /readCompleteGrowthMapOpportunities\(\s*projectId,\s*publishedDiagnosticRunId/,
    );
  });

  it("rejects every pinned Keyword cursor page that does not echo the requested Diagnostic Run", () => {
    const collectorStart = source.indexOf(
      "async function readCompleteGrowthMapKeywords(",
    );
    const collectorSource = source.slice(
      collectorStart,
      source.indexOf(
        "function useCompleteGrowthMapKeywordRelations(",
        collectorStart,
      ),
    );
    expect(collectorSource).toContain(
      "response.diagnosticRunId !== diagnosticRunId",
    );
    expect(collectorSource).toContain(
      "Growth Map Keyword generation changed while grouping views.",
    );
  });

  it("marks a truncated Uncovered Keyword headline as a lower bound", () => {
    expect(source).toContain("growthMapUncoveredKeywordCountPresentation(");
    for (const messages of [zhCN, en]) {
      const summary = messages.growthMap["portfolioSummary"] as Record<
        string,
        string
      >;
      expect(summary["uncoveredLowerBound"]).toContain("≥");
      expect(summary["uncoveredNoteTruncated"]).toBeTruthy();
    }
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
    expect(source).toContain(
      "className={cx(styles.workspace, styles.opportunityWorkspace)}",
    );
    expect(source).toContain("data-growth-map-opportunity-workspace");
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

describe("Growth Map Keyword Artifact wiring", () => {
  const locales = [zhCN, en];

  it("uses Content output as the final Keyword column while keeping governance secondary", () => {
    const rowStart = source.indexOf("function KeywordRow(");
    const rowSource = source.slice(
      rowStart,
      source.indexOf("function KeywordList(", rowStart),
    );
    const identityStart = rowSource.indexOf("styles.keywordIdentityCell");
    const topicStart = rowSource.indexOf("styles.keywordTopicCell");
    expect(identityStart).toBeGreaterThan(0);
    expect(rowSource.indexOf("<KeywordStatusPill", identityStart)).toBeLessThan(
      topicStart,
    );
    expect(rowSource).toContain("<KeywordDeliveryBadge");
    expect(rowSource).toContain('data-column={t("columns.delivery")}');
    expect(rowSource).not.toMatch(
      /<KeywordDeliveryBadge[\s\S]*?projection=\{deliveryProjection\}[\s\S]*?compact[\s\S]*?\/>/,
    );
    expect(source).toContain(
      '<small className={styles.keywordOutputStatus}>{description.secondary}</small>',
    );

    const listStart = source.indexOf("function KeywordList(");
    const listSource = source.slice(
      listStart,
      source.indexOf("function growthMapDialogInClosedDisclosure", listStart),
    );
    expect(listSource).toContain('t("columns.delivery")');
    expect(listSource).not.toContain('t("columns.status")');
    for (const messages of locales) {
      const library = messages.growthMap["keywordLibrary"] as Record<
        string,
        unknown
      >;
      const columns = library["columns"] as Record<string, string>;
      expect(columns["delivery"]).toBeTruthy();
    }
  });

  it("labels delivery as published Growth Map lineage plus current Artifact state", () => {
    const detailStart = source.indexOf("function KeywordDetailPanel(");
    const detailSource = source.slice(
      detailStart,
      source.indexOf("function KeywordDetailState(", detailStart),
    );
    expect(detailSource).toContain('t("delivery.title")');
    expect(detailSource).toContain('t("delivery.provenance")');
    expect(detailSource).toContain(
      "deliveryProjection.mappedPage.normalizedUrl",
    );
    expect(detailSource).toContain(
      "pageTypeLabel(deliveryProjection.mappedPage.pageType)",
    );
    expect(detailSource).toContain("artifact.artifactType");
    expect(detailSource).toContain("artifact.status");
    expect(detailSource).toContain("artifact.currentRevision");
    expect(detailSource).toContain(
      "executionHrefForRef(projectId, opportunity.executionRef)",
    );
    expect(detailSource).toContain(
      'aria-label={t("delivery.openExecutionFor", {',
    );
    expect(detailSource).toContain("title: opportunity.opportunity.title");
    expect(detailSource).not.toContain("/artifacts/");
    expect(detailSource).toContain('t("intake.ctaUnavailable")');
    for (const messages of locales) {
      const library = messages.growthMap["keywordLibrary"] as Record<
        string,
        unknown
      >;
      const delivery = library["delivery"] as Record<string, string>;
      expect(delivery["provenance"]).toBeTruthy();
      expect(delivery["pageCarrier"]).toContain("{type}");
      expect(delivery["openExecution"]).toBeTruthy();
      expect(delivery["openExecutionFor"]).toContain("{title}");
      expect(delivery["awaitingGeneration"]).toBeTruthy();
      expect(delivery["reviewRequired"]).toBeTruthy();
    }
  });

  it("puts the confirmed Topic gateway before the Keyword workspace", () => {
    const paneStart = source.indexOf("function KeywordLibraryPane(");
    const paneSource = source.slice(paneStart, source.indexOf("type ProductProfileCompetitorOrigin"));
    const gateway = paneSource.indexOf("<TopicMapGateway");
    const workspace = paneSource.indexOf("styles.keywordWorkspace");
    expect(gateway).toBeGreaterThan(0);
    expect(workspace).toBeGreaterThan(0);
    expect(gateway).toBeLessThan(workspace);
  });

  it("shows exact Topic, search-intent authority, and recollection facts", () => {
    expect(source).toContain("item.searchIntent.value");
    expect(source).toContain("item.searchIntent.authority");
    expect(source).toContain("detail.recollection");
    expect(source).toContain('href="#growth-map-run-diagnosis"');
    expect(source).toContain('id="growth-map-run-diagnosis"');
    expect(source).toContain("latestConfirmed.confirmationMode");
    expect(source).toContain("latestConfirmed.generationSummary");
    for (const messages of locales) {
      const library = messages.growthMap["keywordLibrary"] as Record<
        string,
        unknown
      >;
      expect(library["searchIntentAuthority"]).toBeTruthy();
      expect(library["recollection"]).toBeTruthy();
    }
  });

  it("exposes an unavailable search-intent limitation to pointer and keyboard users", () => {
    const intentStart = source.indexOf("function KeywordSearchIntentValue(");
    const intentSource = source.slice(
      intentStart,
      source.indexOf("function KeywordRow(", intentStart),
    );
    expect(intentSource).toContain('authority === "unavailable"');
    expect(intentSource).toContain("<LimitationHint");
    expect(intentSource).toContain("item.searchIntent.limitation");
    for (const messages of locales) {
      const library = messages.growthMap["keywordLibrary"] as Record<
        string,
        unknown
      >;
      expect(library["searchIntentUnavailableHint"]).toBeTruthy();
    }
  });

  it("keeps the conversion rail Topic to page to explicit CTA unavailability", () => {
    const detailStart = source.indexOf("function KeywordDetailPanel(");
    const detailSource = source.slice(
      detailStart,
      source.indexOf("function KeywordDetailState("),
    );
    expect(detailSource).toContain('t("intake.pathStepCta")');
    expect(detailSource).toContain('t("intake.ctaUnavailable")');
    expect(detailSource).not.toContain('t("intake.pathStepBuyerStage")');
  });

  it("does not infer a failed Topic generation and routes an unavailable gateway to Run Diagnosis", () => {
    const gatewayStart = source.indexOf("function TopicMapGateway(");
    const gatewaySource = source.slice(
      gatewayStart,
      source.indexOf("function TopicMapDialog(", gatewayStart),
    );
    expect(gatewaySource).not.toContain("generation_failed");
    expect(gatewaySource).toContain('status === "unavailable"');
    expect(gatewaySource).toContain('href="#growth-map-run-diagnosis"');
    for (const messages of locales) {
      const library = messages.growthMap["keywordLibrary"] as Record<
        string,
        unknown
      >;
      const topicMap = library["topicMap"] as Record<string, unknown>;
      expect(topicMap["gatewayUnavailableHint"]).toBeTruthy();
      expect(topicMap["gatewayRunDiagnosis"]).toBeTruthy();
    }
  });
});
