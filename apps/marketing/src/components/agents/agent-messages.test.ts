// @input  -- complete English and Chinese marketing message catalogs
// @output -- exact leaf-shape parity for the Agent-specific message tree
// @pos    -- locale guard for all three Agent routes and shared workbench

import { describe, expect, it } from "vitest";
import {
  AGENT_AUDIT_COVERAGE,
  PAGE_AUDIT_GROUPS,
  SITE_AUDIT_GROUPS,
} from "@sf/public-tools/agent-audit";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

/** Every leaf with its path, so a failure names the string that broke. */
function leafEntries(
  value: unknown,
  prefix = "",
): readonly (readonly [string, string])[] {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leafEntries(child, prefix ? `${prefix}.${key}` : key),
  );
}

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

it("keeps the visible profile stage focused on Product Profile", () => {
  expect(en.agents.workbench.profile.stage).toBe("Stage 01 · Product Profile");
  expect(zh.agents.workbench.profile.stage).toBe("阶段 01 · Product Profile");
  expect(en.agents.workbench.profile.fields.primaryIcp).not.toBe("");
  expect(zh.agents.workbench.profile.fields.primaryIcp).not.toBe("");
});

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
  "fields.valueProposition",
  "fields.coreFeatures",
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
  "fields.useCases",
  "fields.outcomes",
  "fields.barriers",
  "fields.qualificationSignals",
  "fields.disqualifiers",
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
  "cards.context",
  "cards.competitor",
  "facts.category",
  "facts.valueProposition",
  "facts.coreFeatures",
  "facts.businessModel",
  "facts.primaryCta",
  "facts.trustSignals",
  "facts.directCompetitors",
  "facts.indirectAlternatives",
  "facts.excludedAlternatives",
  "sources.product_information_supplied",
  "sources.marketing_strategy_supplied",
  "sources.hostname_inference",
  "sources.public_page_refresh",
  "sources.confirmation_required",
  "sources.inferred_run_assumptions",
  "sources.mixed_sources",
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
  "readiness.missing",
  "provenance.derivations.declared",
  "provenance.derivations.observed",
  "provenance.derivations.inferred",
  "provenance.derivations.missing",
  "provenance.confidence.high",
  "provenance.confidence.medium",
  "provenance.confidence.low",
  "provenance.confidence.unknown",
  "provenance.sourceClasses.supplied",
  "provenance.sourceClasses.manual",
  "provenance.sourceClasses.live_public_page",
  "provenance.sourceClasses.inferred",
  "provenance.sourceClasses.missing",
  "refresh.counts.found",
  "refresh.counts.applied",
  "refresh.counts.retained",
  "refresh.counts.unavailable",
  "refresh.proposals.eyebrow",
  "refresh.proposals.title",
  "refresh.proposals.description",
  "refresh.proposals.current",
  "refresh.proposals.live",
  "refresh.proposals.evidence",
  "refresh.proposals.use",
  "refresh.proposals.useLabel",
  "refresh.proposals.applyAll",
  "refresh.proposals.manualRetained",
  "refresh.sources.total",
  "refresh.sources.expand",
  "refresh.diagnostics.unavailableFields",
  "search.eyebrow",
  "search.title",
  "search.description",
  "search.action",
  "search.loadingAction",
  "search.missingPrerequisite",
  "search.organicBoundary",
  "search.serpBoundary",
  "search.noData",
  "search.marketUnsupported",
  "search.sourceUnavailable",
  "search.errors.authRequired",
  "search.errors.authUnavailable",
  "search.errors.requestFailed",
  "search.domainLabel",
  "search.intersectionsLabel",
  "search.averagePositionLabel",
  "search.trafficLabel",
  "search.rankLabel",
  "search.observedAtLabel",
  "search.review.suggestedDirect",
  "search.review.suggestedIndirect",
  "search.review.currentDirect",
  "search.review.currentIndirect",
  "search.review.currentExcluded",
  "search.review.systemSuggestionSource",
  "search.review.systemSuggestionProvenance",
  "search.review.mixedSuggestionProvenance",
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

// Derived from the catalogue, which is the authority for what exists. The two
// hand-kept lists this replaces had already drifted — the site one named 27 of
// 31 checks, silently exempting A7, A8, C6 and D7 from the copy check — and the
// page one assumed contiguous numbering, so removing 9.2 broke it rather than
// narrowing it.
const SITE_CHECK_IDS = SITE_AUDIT_GROUPS.flatMap((group) =>
  group.checks.map((check) => check.id),
);
const PAGE_CHECK_IDS = PAGE_AUDIT_GROUPS.flatMap((group) =>
  group.checks.map((check) => check.id.replace(".", "_")),
);

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
        const template =
          messages.agents.workbench.categories[category].implementation;
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

  it("names all 5/31 site and 9/58 page catalog entries bilingually", () => {
    expect(SITE_CHECK_IDS).toHaveLength(31);
    expect(PAGE_CHECK_IDS).toHaveLength(58);

    for (const messages of [en, zh]) {
      for (const group of ["A", "B", "C", "D", "E"]) {
        messageAt(
          messages,
          `agents.workbench.auditCatalog.site.groups.${group}`,
        );
      }
      for (const id of SITE_CHECK_IDS) {
        messageAt(messages, `agents.workbench.auditCatalog.site.checks.${id}`);
      }
      for (const group of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
        messageAt(
          messages,
          `agents.workbench.auditCatalog.page.groups.${group}`,
        );
      }
      for (const id of PAGE_CHECK_IDS) {
        messageAt(messages, `agents.workbench.auditCatalog.page.checks.${id}`);
      }
    }
  });

  it("keeps Profile inputs reviewable and distinguishes supplied facts from inference", () => {
    const english = JSON.stringify(en.agents.workbench.profile);
    const chinese = JSON.stringify(zh.agents.workbench.profile);

    expect(english).toMatch(
      /Product|Positioning|Value proposition|Core features/,
    );
    expect(english).toMatch(/Business model|Primary CTA/);
    expect(english).toMatch(/ICP|Use cases|Desired outcomes|Barriers/);
    expect(english).toMatch(/JTBD/);
    expect(english).toMatch(
      /Country|Locale|Device|Page type|Target query|Audit scope/,
    );
    expect(english).toMatch(/Source-backed|Supplied/);
    expect(english).toMatch(/Inferred|Confirm before use/);
    expect(english).toMatch(/Review & adjust/);
    expect(english).toMatch(/Accept context & run/);
    expect(english).toMatch(/not a confirmed business fact/);
    expect(english).toMatch(/not configured|temporarily unavailable/);
    expect(english).toMatch(/does not write an app Product Profile/);

    expect(chinese).toMatch(/产品|定位|价值主张|核心功能/);
    expect(chinese).toMatch(/商业模式|主要 CTA/);
    expect(chinese).toMatch(/ICP|使用场景|期望结果|采用阻碍/);
    expect(chinese).toMatch(/JTBD/);
    expect(chinese).toMatch(/国家|语言|设备|页面类型|目标查询|审计范围/);
    expect(chinese).toMatch(/来源支持|已提供/);
    expect(chinese).toMatch(/推断|使用前确认/);
    expect(chinese).toMatch(/检查并调整/);
    expect(chinese).toMatch(/接受上下文并运行/);
    expect(chinese).toMatch(/不等于已确认的商业关系/);
    expect(chinese).toMatch(/尚未配置|暂时不可用/);
    expect(chinese).toMatch(/不会写入 app 的 Product Profile/);
  });

  it("states the three diagnosis axes and null-safe excluded boundaries", () => {
    const english = JSON.stringify(en.agents.workbench.diagnosis);
    const chinese = JSON.stringify(zh.agents.workbench.diagnosis);

    // Scope labels take live counts so the copy can never contradict the
    // catalogue it describes.
    expect(en.agents.workbench.diagnosis.scopes.site).toContain("{groups}");
    expect(en.agents.workbench.diagnosis.scopes.site).toContain("{checks}");
    expect(zh.agents.workbench.diagnosis.scopes.page).toContain("{groups}");
    expect(zh.agents.workbench.diagnosis.scopes.page).toContain("{checks}");
    expect(english).toMatch(/Blocker|Health|Result|Engine|Truth/);
    expect(english).toMatch(/Excluded|Not integrated|Source gated/);
    expect(english).toMatch(/not zero|never zero|not a pass/);

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
    const englishTech = JSON.stringify(
      en.agents.workbench.recommendations.tech,
    );
    const chineseSeo = JSON.stringify(zh.agents.workbench.recommendations.seo);
    const chineseTech = JSON.stringify(
      zh.agents.workbench.recommendations.tech,
    );

    expect(englishSeo).not.toBe(englishTech);
    expect(englishSeo).toMatch(
      /search intent|title|heading|internal link|schema/i,
    );
    expect(englishSeo).toMatch(
      /does not (?:infer|invent|measure).*(?:demand|ranking)/i,
    );
    expect(englishTech).toMatch(/code|configuration|framework|owner/i);
    expect(englishTech).toMatch(
      /no (?:site edit|apply|pull request|PR|deploy)/i,
    );
    expect(chineseSeo).toMatch(/搜索意图|标题|内链|结构化数据/);
    expect(chineseSeo).toMatch(/不.*(?:需求|排名)/);
    expect(chineseTech).toMatch(/代码|配置|框架|负责人/);
    expect(chineseTech).toMatch(/不会.*(?:编辑|应用|PR|部署)/);
  });

  it("does not claim that Agent runs ignore their reviewable Profile", () => {
    expect(en.agents.seo.dataBoundaryBody).not.toMatch(
      /does not use an? (?:ICP|profile)/i,
    );
    expect(zh.agents.seo.dataBoundaryBody).not.toMatch(/不使用.*(?:ICP|画像)/);
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

  it("never writes a catalogue count down in the copy", () => {
    // The shipped string said "24 of the 81 catalogue checks" long after the
    // code decided 33 of 80. Nobody noticed because nothing tied the sentence
    // to the catalogue, and every batch of work moves both numbers at once.
    for (const messages of [en, zh]) {
      for (const [path, text] of leafEntries(messages.agents)) {
        expect(
          text,
          `${path} states a catalogue count as a literal`,
        ).not.toMatch(/\d+\s*(?:项)?目录|\d+\s+(?:of the\s+)?\d*\s*catalogue/i);
      }
    }
  });

  it("states the coverage from the catalogue, in both locales", () => {
    for (const messages of [en, zh]) {
      for (const agent of ["seo", "tech"] as const) {
        const body = messages.agents[agent].step3Body;
        for (const name of ["total", "decided", "sourceGated"] as const) {
          expect(body, `${agent}.step3Body`).toContain(`{${name}}`);
        }
        // Every placeholder must be one the render actually hands over.
        // next-intl throws on a missing value, so a renamed field would take
        // the whole Agent page down rather than degrade a sentence — and no
        // unit test that only reads the message file would see it.
        for (const [, name] of body.matchAll(/\{(\w+)\}/g)) {
          expect(
            Object.keys(AGENT_AUDIT_COVERAGE),
            `${agent}.step3Body references {${name}}`,
          ).toContain(name);
        }
      }
    }
    // And the values it will be handed are the catalogue's own, not a second
    // opinion computed beside it.
    expect(AGENT_AUDIT_COVERAGE.total).toBe(
      SITE_CHECK_IDS.length + PAGE_CHECK_IDS.length,
    );
    expect(AGENT_AUDIT_COVERAGE.decided).toBeGreaterThan(0);
    expect(AGENT_AUDIT_COVERAGE.decided).toBeLessThanOrEqual(
      AGENT_AUDIT_COVERAGE.total,
    );
    expect(AGENT_AUDIT_COVERAGE.sourceGated).toBeLessThanOrEqual(
      AGENT_AUDIT_COVERAGE.decided,
    );
  });
});
