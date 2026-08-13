// @input  -- complete English and Chinese marketing message catalogs
// @output -- exact leaf-shape parity for the Agent-specific message tree
// @pos    -- locale guard for all three Agent routes and shared workbench

import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

function leafPaths(value: unknown, prefix = ""): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function messageAt(catalog: unknown, path: string): string {
  const value = path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, catalog);
  expect(value, `missing message: ${path}`).toBeTypeOf("string");
  expect(value, `empty message: ${path}`).not.toBe("");
  return value as string;
}

const PROFILE_PATHS = [
  "stage",
  "seo.title",
  "seo.body",
  "tech.title",
  "tech.body",
  "states.needs_confirmation",
  "states.confirmed",
  "fields.targetUrl",
  "fields.targetUrlPlaceholder",
  "fields.productName",
  "fields.oneLinePositioning",
  "fields.categories",
  "fields.businessModel",
  "fields.primaryCta",
  "fields.trustSignals",
  "fields.primaryIcp",
  "fields.buyer",
  "fields.user",
  "fields.triggerPain",
  "fields.icpInterests",
  "fields.icpPain",
  "fields.icpBehavior",
  "fields.icpPositioning",
  "fields.jtbd",
  "fields.firstOutcome",
  "fields.country",
  "fields.locale",
  "fields.device",
  "fields.pageType",
  "fields.targetQuery",
  "fields.auditScope",
  "fields.directCompetitors",
  "fields.indirectAlternatives",
  "fields.excludedAlternatives",
  "cards.product",
  "cards.icp",
  "cards.context",
  "cards.competitor",
  "facts.category",
  "facts.businessModel",
  "facts.primaryCta",
  "facts.trustSignals",
  "facts.interests",
  "facts.pain",
  "facts.positioning",
  "facts.buyer",
  "facts.user",
  "facts.triggerPain",
  "facts.directCompetitors",
  "facts.indirectAlternatives",
  "facts.excludedAlternatives",
  "sources.product_information_supplied",
  "sources.marketing_strategy_supplied",
  "sources.hostname_inference",
  "sources.confirmation_required",
  "sources.inferred_run_assumptions",
  "sources.locally_adjusted",
  "values.unavailable",
  "values.confirmationRequired",
  "options.device.mobile",
  "options.device.desktop",
  "options.pageType.homepage",
  "options.pageType.product",
  "options.pageType.tool",
  "options.pageType.guide",
  "options.auditScope.site-first",
  "options.auditScope.page-only",
  "boundary",
  "actions.review",
  "actions.confirmRun",
] as const;

const DIAGNOSIS_PATHS = [
  "eyebrow",
  "title.seo",
  "title.tech",
  "description.seo",
  "description.tech",
  "context.confirmed",
  "context.draft",
  "context.country",
  "context.locale",
  "context.device",
  "context.pageType",
  "context.targetQuery",
  "scopeLabel",
  "scopes.site",
  "scopes.page",
  "scopeSummary",
  "blockers",
  "blockersHint",
  "health",
  "healthUnavailable",
  "healthHint",
  "evaluatedTotal",
  "engineCoverage",
  "inventoryCoverage",
  "groupsLabel",
  "checksLabel",
  "selectCheck",
  "detailLabel",
  "detail.measuredValue",
  "detail.threshold",
  "detail.thresholdAuthority",
  "detail.impact",
  "detail.howToFix",
  "detail.dataSource",
  "detail.scoreContribution",
  "detail.boundary",
  "axes.result",
  "axes.engine",
  "axes.truth",
  "results.blocker",
  "results.warning",
  "results.tip",
  "results.pass",
  "results.excluded",
  "engines.ready",
  "engines.needsIntegration",
  "engines.needsSupplement",
  "engines.notIntegrated",
  "engines.accessRequired",
  "truth.observed",
  "truth.notObserved",
  "truth.documented",
  "truth.inferred",
  "truth.partial",
  "truth.sourceGated",
  "truth.unavailable",
  "truth.illustrative",
  "excludedBoundary",
  "headingPreset.label",
  "headingPreset.range",
  "headingPreset.softRule",
  "headingPreset.boundary",
  "noCheckSelected",
  "authorities.official",
  "authorities.industry",
  "authorities.sop",
  "authorities.judgment",
  "policy.title",
  "policy.officialLocked",
  "policy.adjustable",
  "policy.acceptedPreset",
  "policy.localOverride",
  "policy.threshold",
  "policy.weight",
  "policy.save",
  "policy.resetCheck",
  "policy.resetScope",
  "policy.scopeAtPreset",
  "policy.doesNotRejudge",
  "policy.rerunRequired",
] as const;

const RECOMMENDATION_PATHS = [
  "stage3",
  "stage3Title",
  "stage3Body",
  "stage4",
  "stage4Title",
  "stage4Body",
  "selected",
  "priority",
  "reach",
  "evidenceAvailable",
  "evidenceUnavailable",
  "sourceGatedBoundary",
  "unavailableInvestigation",
  "previewOnly",
  "issueLabel",
  "whyLabel",
  "evidenceLabel",
  "fixLabel",
  "contextLabel",
  "validationLabel",
  "impactLabel",
  "risksLabel",
  "limitsLabel",
  "measuredLabel",
  "sourceLabel",
  "statesLabel",
  "productLabel",
  "ctaLabel",
  "queryLabel",
  "audienceLabel",
  "outcomeLabel",
  "targetLabel",
  "pageContextLabel",
  "unconfirmedValue",
  "noRecommendationsTitle",
  "noRecommendationsBody",
  "previewBoundary",
] as const;

const AGENT_RECOMMENDATION_PATHS = [
  "recommendation",
  "applicableContext",
  "validation1",
  "validation2",
  "validation3",
  "impactSurface",
  "risks",
  "limits",
] as const;

const SITE_CHECK_IDS = [
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
  "D6",
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
] as const;

const PAGE_CHECK_IDS = [
  ...Array.from({ length: 8 }, (_, index) => `1_${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `2_${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `3_${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `4_${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `5_${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `6_${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `7_${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `8_${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `9_${index + 1}`),
] as const;

describe("Agent message catalogs", () => {
  it("keeps every English and Chinese Agent leaf aligned", () => {
    expect([...leafPaths(en.agents)].sort()).toEqual(
      [...leafPaths(zh.agents)].sort(),
    );
  });

  it("keeps implementation previews free of ICU and rich-text control syntax", () => {
    for (const messages of [en, zh]) {
      for (const category of [
        "metadata",
        "structure",
        "structured_data",
        "crawl",
        "indexability",
        "links",
      ] as const) {
        const template = messages.agents.workbench.categories[category].implementation;
        expect(template).not.toMatch(/[{}<]/);
      }
    }
  });

  it("defines every four-stage workbench message in both locales", () => {
    for (const messages of [en, zh]) {
      for (const path of PROFILE_PATHS) {
        messageAt(messages, `agents.workbench.profile.${path}`);
      }
      for (const path of DIAGNOSIS_PATHS) {
        messageAt(messages, `agents.workbench.diagnosis.${path}`);
      }
      for (const path of RECOMMENDATION_PATHS) {
        messageAt(messages, `agents.workbench.recommendations.${path}`);
      }
      for (const agent of ["seo", "tech"] as const) {
        for (const path of AGENT_RECOMMENDATION_PATHS) {
          messageAt(
            messages,
            `agents.workbench.recommendations.${agent}.${path}`,
          );
        }
      }
    }
  });

  it("names all 5/27 site and 9/50 page catalog entries bilingually", () => {
    expect(SITE_CHECK_IDS).toHaveLength(27);
    expect(PAGE_CHECK_IDS).toHaveLength(50);

    for (const messages of [en, zh]) {
      for (const group of ["A", "B", "C", "D", "E"]) {
        messageAt(messages, `agents.workbench.auditCatalog.site.groups.${group}`);
      }
      for (const id of SITE_CHECK_IDS) {
        messageAt(messages, `agents.workbench.auditCatalog.site.checks.${id}`);
      }
      for (const group of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
        messageAt(messages, `agents.workbench.auditCatalog.page.groups.${group}`);
      }
      for (const id of PAGE_CHECK_IDS) {
        messageAt(messages, `agents.workbench.auditCatalog.page.checks.${id}`);
      }
    }
  });

  it("keeps Profile inputs reviewable and distinguishes supplied facts from inference", () => {
    const english = JSON.stringify(en.agents.workbench.profile);
    const chinese = JSON.stringify(zh.agents.workbench.profile);

    expect(english).toMatch(/Product|Positioning|Business model|Primary CTA/);
    expect(english).toMatch(/ICP/);
    expect(english).toMatch(/JTBD/);
    expect(english).toMatch(/Country|Locale|Device|Page type|Target query|Audit scope/);
    expect(english).toMatch(/Source-backed|Supplied/);
    expect(english).toMatch(/Inferred|Confirm before use/);
    expect(english).toMatch(/Review & adjust/);
    expect(english).toMatch(/Confirm profile & run/);

    expect(chinese).toMatch(/产品|定位|商业模式|主要 CTA/);
    expect(chinese).toMatch(/ICP/);
    expect(chinese).toMatch(/JTBD/);
    expect(chinese).toMatch(/国家|语言|设备|页面类型|目标查询|审计范围/);
    expect(chinese).toMatch(/来源支持|已提供/);
    expect(chinese).toMatch(/推断|使用前确认/);
    expect(chinese).toMatch(/检查并调整/);
    expect(chinese).toMatch(/确认画像并运行/);
  });

  it("states the three diagnosis axes and null-safe excluded boundaries", () => {
    const english = JSON.stringify(en.agents.workbench.diagnosis);
    const chinese = JSON.stringify(zh.agents.workbench.diagnosis);

    expect(english).toMatch(/5 groups|27 checks/);
    expect(english).toMatch(/9 groups|50 checks/);
    expect(english).toMatch(/Blocker|Health|Result|Engine|Truth/);
    expect(english).toMatch(/Excluded|Not integrated|Source gated/);
    expect(english).toMatch(/not zero|never zero|not a pass/);

    expect(chinese).toMatch(/5 组|27 项/);
    expect(chinese).toMatch(/9 组|50 项/);
    expect(chinese).toMatch(/阻断|健康度|结果|引擎|真实性/);
    expect(chinese).toMatch(/排除|未接入|来源受限/);
    expect(chinese).toMatch(/不.*零|不等于通过/);
  });

  it("locks Official thresholds and describes local policy as non-rerun state", () => {
    const english = JSON.stringify(en.agents.workbench.diagnosis.policy);
    const chinese = JSON.stringify(zh.agents.workbench.diagnosis.policy);

    expect(english).toMatch(/Official threshold is locked/);
    expect(english).toMatch(/local.*(?:Agent|scope)/i);
    expect(english).toMatch(/does not rejudge|new real run is required/i);
    expect(english).toMatch(/Reset check|Reset scope/);
    expect(chinese).toMatch(/官方阈值已锁定/);
    expect(chinese).toMatch(/当前 Agent|本地/);
    expect(chinese).toMatch(/不会重新判定|真实运行/);
    expect(chinese).toMatch(/重置此项|重置本范围/);
  });

  it("gives SEO and Tech distinct, evidence-honest recommendation contracts", () => {
    const englishSeo = JSON.stringify(en.agents.workbench.recommendations.seo);
    const englishTech = JSON.stringify(en.agents.workbench.recommendations.tech);
    const chineseSeo = JSON.stringify(zh.agents.workbench.recommendations.seo);
    const chineseTech = JSON.stringify(zh.agents.workbench.recommendations.tech);

    expect(englishSeo).not.toBe(englishTech);
    expect(englishSeo).toMatch(/search intent|title|heading|internal link|schema/i);
    expect(englishSeo).toMatch(/does not (?:infer|invent|measure).*(?:demand|ranking)/i);
    expect(englishTech).toMatch(/code|configuration|framework|owner/i);
    expect(englishTech).toMatch(/no (?:site edit|apply|pull request|PR|deploy)/i);
    expect(chineseSeo).toMatch(/搜索意图|标题|内链|结构化数据/);
    expect(chineseSeo).toMatch(/不.*(?:需求|排名)/);
    expect(chineseTech).toMatch(/代码|配置|框架|负责人/);
    expect(chineseTech).toMatch(/不会.*(?:编辑|应用|PR|部署)/);
  });

  it("does not claim that Agent runs ignore their reviewable Profile", () => {
    expect(en.agents.seo.dataBoundaryBody).not.toMatch(
      /does not use an? (?:ICP|profile)/i,
    );
    expect(zh.agents.seo.dataBoundaryBody).not.toMatch(
      /不使用.*(?:ICP|画像)/,
    );
  });

  it("keeps previews and run context free of unsupported product promises", () => {
    for (const messages of [en, zh]) {
      const copy = JSON.stringify({
        profile: messages.agents.workbench.profile,
        diagnosis: messages.agents.workbench.diagnosis,
        recommendations: messages.agents.workbench.recommendations,
      });
      expect(copy).not.toMatch(
        /anonymous audit|free audit|automatically (?:edit|apply|publish|deploy)|will (?:edit|apply|publish|deploy)|real (?:traffic|ranking)|匿名审计|免费审计|自动(?:编辑|应用|发布|部署)|将(?:编辑|应用|发布|部署)|真实(?:流量|排名)/i,
      );
    }
  });
});
