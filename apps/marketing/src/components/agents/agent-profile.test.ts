// @input  -- Agent identity plus a visitor-entered public URL
// @output -- source-honest Product/ICP drafts and immutable local edits
// @pos    -- unit contract for the marketing-only Agent Profile gate

import { describe, expect, it } from "vitest";

import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  type AgentProfileRefreshField,
  type AgentProfileRefreshFieldPath,
  type AgentProfileRefreshResult,
} from "../../lib/agents/profile-refresh-contract";
import {
  acceptAgentProfileRefreshFields,
  applyAgentProfileRefresh,
  confirmAgentProfile,
  createAgentProfileDraft,
  isAgentProfileDraft,
  isConfirmedAgentProfile,
  isAgentProfileReady,
  listAgentProfileRefreshProposals,
  redraftAgentProfileForUrl,
  summarizeAgentProfileRefresh,
  updateAgentProfile,
} from "./agent-profile";

function profileRefreshResult(
  available: Partial<
    Record<AgentProfileRefreshFieldPath, string | readonly string[]>
  >,
  overrides: Partial<AgentProfileRefreshResult> = {},
): AgentProfileRefreshResult {
  const sourceUrl = "https://www.acme.com/";
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) => {
    const value = available[path];
    if (value !== undefined) {
      return {
        path,
        state: "available",
        value,
        derivation: "inferred",
        confidence: "medium",
        source: "public_page",
        limitation: "Inferred only from the bounded public-page crawl.",
        evidenceUrls: [sourceUrl],
      } as AgentProfileRefreshField;
    }
    return {
      path,
      state: "unavailable",
      value: null,
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation: "The bounded public pages do not establish this field.",
      evidenceUrls: [],
    } as const;
  });
  const fieldsAvailable = Object.keys(available).length;
  return {
    schemaVersion: "agent_profile_refresh.v1",
    agent: "seo",
    request: {
      submittedUrl: "https://www.acme.com/pricing",
      normalizedUrl: "https://www.acme.com/pricing",
      targetHost: "www.acme.com",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    },
    availability:
      fieldsAvailable === 0
        ? "no_data"
        : fieldsAvailable === AGENT_PROFILE_REFRESH_FIELD_PATHS.length
          ? "available"
          : "partial",
    observedAt: "2026-08-13T10:00:00.000Z",
    cache: {
      status: "fresh",
      capturedAt: "2026-08-13T10:00:00.000Z",
    },
    diagnostics: {
      resolvedOrigin: "https://www.acme.com",
      pagesFetched: 2,
      productPagesFetched: 1,
      stopReason: null,
      contextSufficient: true,
      sourceUrls: [sourceUrl],
      fieldsAvailable,
      fieldsMissing: AGENT_PROFILE_REFRESH_FIELD_PATHS.length - fieldsAvailable,
    },
    fields,
    ...overrides,
  };
}

function fullAstrologyRefreshResult(): AgentProfileRefreshResult {
  const listFields = new Set<AgentProfileRefreshFieldPath>([
    "coreFeatures",
    "categories",
    "trustSignals",
    "icpInterests",
    "useCases",
    "outcomes",
    "barriers",
    "qualificationSignals",
    "disqualifiers",
  ]);
  const available = Object.fromEntries(
    AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) => [
      path,
      listFields.has(path) ? [`Live ${path}`] : `Live ${path}`,
    ]),
  ) as Record<AgentProfileRefreshFieldPath, string | readonly string[]>;
  return profileRefreshResult(available, {
    request: {
      submittedUrl: "https://www.astrologywiki.com/birth-chart",
      normalizedUrl: "https://www.astrologywiki.com/birth-chart",
      targetHost: "www.astrologywiki.com",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    },
  });
}

describe("Agent-local Product / ICP profiles", () => {
  it("seeds AstrologyWiki from Product Information without calling it observed", () => {
    const profile = createAgentProfileDraft(
      "seo",
      "https://www.astrologywiki.com/birth-chart",
    );

    expect(profile).toMatchObject({
      schemaVersion: "agent-profile.v3",
      agent: "seo",
      host: "astrologywiki.com",
      productName: "AstrologyWiki",
      oneLinePositioning:
        "A free birth-chart and self-exploration web app combining astrology with modern psychology.",
      categories: ["Astrology tool", "Self-discovery platform", "Birth-chart calculator"],
      businessModel: "Freemium · subscription · credits",
      primaryCta: "Generate Free Birth Chart",
      primaryIcp:
        "People interested in astrology who use birth charts for self-understanding and psychological exploration",
      buyer:
        "Inferred — a self-serve consumer is likely both user and buyer; confirm.",
      user:
        "People focused on personal growth, relationship analysis, or emotional insight.",
      triggerPain:
        "Wants to use astrology for self-understanding and psychological reflection rather than fate prediction.",
      jtbd:
        "Use a birth chart for self-understanding and psychological exploration.",
      firstOutcome:
        "Evaluate birth-chart search opportunities that lead to chart generation",
      country: "",
      locale: "",
      device: "mobile",
      pageType: "tool",
      targetQuery: "",
      auditScope: "site-first",
      reviewState: "needs_confirmation",
    });
    expect(profile.trustSignals).toEqual(
      expect.arrayContaining([
        "Anonymous calculation",
        "Real astronomical data",
        "Multilingual web app",
      ]),
    );
    expect(profile.icpInterests).toEqual([
      "Astrology",
      "Personal growth",
      "Relationship analysis",
      "Emotional insight",
    ]);
    expect(profile.icpPain).toBe(
      "Inferred — the target customer seeks personal growth, relationship analysis, or emotional insight; confirm.",
    );
    expect(profile.icpPositioning).toBe(
      "Self-understanding and psychological reflection, not fate prediction",
    );
    expect(profile.sources).toEqual({
      product: "product_information_supplied",
      icp: "product_information_supplied",
      competitor: "confirmation_required",
      run: "inferred_run_assumptions",
    });
    expect(profile.directCompetitors).toEqual([]);
    expect(profile.indirectAlternatives).toEqual([]);
    expect(profile.excludedAlternatives).toEqual([]);
  });

  it("keeps unsupported search context empty and infers the homepage only from a root URL", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");

    expect(profile).toMatchObject({
      country: "",
      locale: "",
      device: "mobile",
      pageType: "homepage",
      targetQuery: "",
      auditScope: "site-first",
      reviewState: "needs_confirmation",
    });
    expect(isAgentProfileReady(profile)).toBe(false);
    expect(confirmAgentProfile(profile).reviewState).toBe(
      "needs_confirmation",
    );
  });

  it("maps Product Information into Product Profile facts and reviewable ICP interpretations", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");

    expect(profile.valueProposition).toBe(
      "Use astrological symbols for self-understanding and psychological reflection, not fate prediction.",
    );
    expect(profile.coreFeatures).toEqual([
      "Free natal chart calculator",
      "Planetary transit insights",
      "Synastry analysis",
      "Astrology timeline",
      "Weekly AI oracle",
      "CBT astrology journal",
      "Astrology encyclopedia and tools",
    ]);
    expect(profile.useCases).toEqual([
      "Generate and explore an accurate natal chart",
      "Reflect on emotions and personal growth",
      "Explore relationship dynamics with synastry",
      "Learn astrology through the encyclopedia and tools",
    ]);
    expect(profile.outcomes).toEqual([
      "Generate an accurate birth chart in 30 seconds",
      "Understand personal and emotional patterns",
      "Explore relationship compatibility and tension",
    ]);
    expect(profile.barriers).toEqual([]);
    expect(profile.qualificationSignals).toEqual([
      "Interested in astrology as a self-understanding or psychological exploration tool",
      "Focused on personal growth, relationships, or emotional insight",
    ]);
    expect(profile.disqualifiers).toEqual([]);
  });

  it("labels every editable field with local field-level provenance", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");
    const byPath = new Map(
      profile.fieldProvenance.map((entry) => [entry.path, entry]),
    );

    expect(byPath.get("/valueProposition")).toEqual({
      path: "/valueProposition",
      derivation: "declared",
      confidence: "high",
      source: "supplied_product_information",
      limitation: null,
      observedAt: null,
      evidenceUrls: [],
    });
    expect(byPath.get("/icpBehavior")).toMatchObject({
      derivation: "missing",
      source: "not_available",
      confidence: "unknown",
    });
    expect(
      profile.fieldProvenance.some(
        (entry) => entry.source === "supplied_marketing_strategy",
      ),
    ).toBe(false);
    expect(byPath.get("/coreFeatures")).toMatchObject({
      derivation: "declared",
      source: "supplied_product_information",
    });
    for (const path of [
      "/triggerPain",
      "/icpPositioning",
      "/jtbd",
      "/useCases",
      "/outcomes",
      "/qualificationSignals",
    ] as const) {
      expect(byPath.get(path)).toMatchObject({
        derivation: "inferred",
        confidence: "low",
        source: "local_inference",
        limitation:
          "Normalized from the supplied Product Information for this local Agent run; confirm before use.",
        observedAt: expect.any(String),
      });
    }
    expect(byPath.get("/buyer")).toMatchObject({
      derivation: "inferred",
      confidence: "low",
      source: "local_inference",
      observedAt: expect.any(String),
    });
    expect(byPath.get("/country")).toEqual({
      path: "/country",
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation:
        "No primary search market was supplied; select one before running the audit.",
      observedAt: null,
      evidenceUrls: [],
    });
    expect(byPath.get("/locale")).toEqual({
      path: "/locale",
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation:
        "The product supports multiple languages, but no primary audit locale was supplied; select one before running the audit.",
      observedAt: null,
      evidenceUrls: [],
    });
    expect(byPath.get("/device")).toMatchObject({
      derivation: "inferred",
      confidence: "low",
      source: "local_inference",
      observedAt: expect.any(String),
    });
    expect(byPath.get("/pageType")).toMatchObject({
      derivation: "inferred",
      confidence: "low",
      source: "visitor_url",
      observedAt: expect.any(String),
    });
    expect(byPath.get("/targetQuery")).toEqual({
      path: "/targetQuery",
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation:
        "The supplied Product Information does not specify a target query for this run.",
      observedAt: null,
      evidenceUrls: [],
    });
    expect(byPath.get("/auditScope")).toMatchObject({
      derivation: "inferred",
      confidence: "low",
      source: "local_inference",
      observedAt: expect.any(String),
    });
    expect(byPath.get("/directCompetitors")).toMatchObject({
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      observedAt: null,
    });
    expect([...byPath.keys()].sort()).toEqual(
      [
        "/auditScope",
        "/barriers",
        "/businessModel",
        "/buyer",
        "/categories",
        "/coreFeatures",
        "/country",
        "/device",
        "/directCompetitors",
        "/disqualifiers",
        "/excludedAlternatives",
        "/firstOutcome",
        "/icpBehavior",
        "/icpInterests",
        "/icpPain",
        "/icpPositioning",
        "/indirectAlternatives",
        "/jtbd",
        "/locale",
        "/oneLinePositioning",
        "/outcomes",
        "/pageType",
        "/primaryCta",
        "/primaryIcp",
        "/productName",
        "/qualificationSignals",
        "/targetQuery",
        "/triggerPain",
        "/trustSignals",
        "/useCases",
        "/user",
        "/valueProposition",
      ].sort(),
    );
  });

  it("keeps SEO and Tech drafts independent and gives each Agent its own first outcome", () => {
    const seo = createAgentProfileDraft("seo", "astrologywiki.com");
    const tech = createAgentProfileDraft("tech", "astrologywiki.com");
    const editedSeo = updateAgentProfile(seo, {
      country: "US",
      locale: "en",
      targetQuery: "free birth chart",
    });

    expect(tech.agent).toBe("tech");
    expect(tech.firstOutcome).toBe(
      "Evaluate crawlability and reliability of the public birth-chart experience",
    );
    expect(editedSeo.firstOutcome).toContain("birth-chart search opportunities");
    expect(editedSeo.country).toBe("US");
    expect(tech.country).toBe("");
    expect(editedSeo.categories).not.toBe(tech.categories);
    expect(editedSeo.editedFields).toEqual([
      "country",
      "locale",
      "targetQuery",
    ]);
  });

  it("creates a conservative hostname draft for every other site", () => {
    const profile = createAgentProfileDraft("seo", "https://docs.acme.test/start");

    expect(profile).toMatchObject({
      host: "docs.acme.test",
      productName: "docs.acme.test",
      primaryIcp: "Unknown — confirm the primary audience.",
      businessModel: "Unknown — confirm the business model.",
      country: "",
      locale: "",
      targetQuery: "",
      auditScope: "site-first",
      reviewState: "needs_confirmation",
      sources: {
        product: "hostname_inference",
        icp: "confirmation_required",
        competitor: "confirmation_required",
        run: "inferred_run_assumptions",
      },
    });
    expect(profile.oneLinePositioning).toContain("docs.acme.test");
    expect(profile.oneLinePositioning).toContain("not yet confirmed");
    expect(profile.categories).toEqual(["Unknown — confirm the category."]);
    expect(profile.trustSignals).toEqual([]);
    expect(profile.directCompetitors).toEqual([]);
    const provenance = new Map(
      profile.fieldProvenance.map((entry) => [entry.path, entry]),
    );
    expect(provenance.get("/country")).toMatchObject({
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      observedAt: null,
    });
    expect(provenance.get("/locale")).toMatchObject({
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      observedAt: null,
    });
  });

  it("localizes unconfirmed Profile values for a Chinese Agent route", () => {
    const initial = createAgentProfileDraft("tech", "", "zh");
    const redrafted = redraftAgentProfileForUrl(
      initial,
      "https://example.com",
      "zh",
    );

    expect(initial).toMatchObject({
      productName: "未知网站",
      primaryIcp: "未知——请确认主要受众。",
      buyer: "未知——请确认购买者角色。",
      firstOutcome: "确认首个技术可靠性目标。",
      country: "",
      locale: "",
    });
    expect(redrafted).toMatchObject({
      host: "example.com",
      productName: "example.com",
      oneLinePositioning:
        "example.com 上的公开网站；其产品与定位尚未确认。",
      businessModel: "未知——请确认商业模式。",
      jtbd: "未知——请确认需要完成的任务。",
    });
  });

  it("presents the supplied AstrologyWiki Product and ICP facts in Chinese", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com", "zh");

    expect(profile).toMatchObject({
      productName: "AstrologyWiki",
      oneLinePositioning:
        "融合占星学与现代心理学的免费出生星盘与自我探索 Web 应用。",
      categories: ["占星工具", "自我探索平台", "出生星盘计算器"],
      businessModel: "免费增值 · 订阅 · 点数",
      primaryCta: "生成免费出生星盘",
      primaryIcp: "对占星感兴趣、将星盘用于自我认知与心理探索的普通用户",
      buyer: "推断——自助型普通用户很可能同时是使用者与购买者；需确认。",
      user: "关注个人成长、关系分析或情绪洞察的人群。",
      jtbd: "借助星盘进行自我认知与心理探索。",
      firstOutcome: "评估与出生星盘生成相关的搜索机会",
    });
    expect(profile.sources).toEqual({
      product: "product_information_supplied",
      icp: "product_information_supplied",
      competitor: "confirmation_required",
      run: "inferred_run_assumptions",
    });
  });

  it("returns to a fresh unconfirmed draft when the URL changes", () => {
    const confirmed = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", targetQuery: "free astrology chart" },
      ),
    );

    const redrafted = redraftAgentProfileForUrl(
      confirmed,
      "https://example.com/pricing",
    );

    expect(redrafted).toMatchObject({
      agent: "seo",
      host: "example.com",
      productName: "example.com",
      country: "",
      targetQuery: "",
      reviewState: "needs_confirmation",
      editedFields: [],
    });
    expect(redrafted.primaryIcp).not.toContain("22–38");
  });

  it("edits every explicit run assumption and confirmation remains local data", () => {
    const draft = createAgentProfileDraft("tech", "astrologywiki.com");
    const edited = updateAgentProfile(draft, {
      country: "CA",
      locale: "en-CA",
      device: "desktop",
      pageType: "guide",
      targetQuery: "technical seo guide",
      auditScope: "page-only",
    });
    const confirmed = confirmAgentProfile(edited);

    expect(confirmed).toMatchObject({
      country: "CA",
      locale: "en-CA",
      device: "desktop",
      pageType: "guide",
      targetQuery: "technical seo guide",
      auditScope: "page-only",
      reviewState: "confirmed",
    });
    expect(confirmed).not.toHaveProperty("projectId");
    expect(confirmed).not.toHaveProperty("profileVersion");
  });

  it("allows the supplied Product and ICP facts to be accepted or manually adjusted", () => {
    const edited = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      {
        valueProposition: "Private self-reflection grounded in real astronomy",
        coreFeatures: ["Private natal chart", "CBT journal"],
        categories: ["Astrology SaaS", "Reflection tool"],
        businessModel: "Free core with optional subscription",
        primaryCta: "Create my free chart",
        trustSignals: ["Swiss Ephemeris", "Private birth data"],
        primaryIcp: "Curious mobile-first adults",
        icpInterests: ["Astrology", "Self-reflection"],
        icpPain: "Rejects fatalistic readings",
        icpBehavior: "Compares and shares chart insights",
        icpPositioning: "Reflection without prediction",
        buyer: "Self-serve consumer",
        user: "Mobile astrology learner",
        triggerPain: "Needs rapid, private self-reflection",
        useCases: ["Private self-reflection"],
        outcomes: ["Understand emotional patterns"],
        barriers: ["Distrusts fatalistic predictions"],
        qualificationSignals: ["Values psychology-informed reflection"],
        disqualifiers: ["Wants a deterministic prediction"],
        directCompetitors: ["Confirm direct competitors"],
        indirectAlternatives: ["Journaling apps"],
        excludedAlternatives: ["Traditional fortune-telling sites"],
      },
    );

    expect(edited).toMatchObject({
      valueProposition: "Private self-reflection grounded in real astronomy",
      coreFeatures: ["Private natal chart", "CBT journal"],
      categories: ["Astrology SaaS", "Reflection tool"],
      businessModel: "Free core with optional subscription",
      primaryCta: "Create my free chart",
      trustSignals: ["Swiss Ephemeris", "Private birth data"],
      primaryIcp: "Curious mobile-first adults",
      icpInterests: ["Astrology", "Self-reflection"],
      icpPain: "Rejects fatalistic readings",
      icpBehavior: "Compares and shares chart insights",
      icpPositioning: "Reflection without prediction",
      buyer: "Self-serve consumer",
      user: "Mobile astrology learner",
      triggerPain: "Needs rapid, private self-reflection",
      useCases: ["Private self-reflection"],
      outcomes: ["Understand emotional patterns"],
      barriers: ["Distrusts fatalistic predictions"],
      qualificationSignals: ["Values psychology-informed reflection"],
      disqualifiers: ["Wants a deterministic prediction"],
      directCompetitors: ["Confirm direct competitors"],
      indirectAlternatives: ["Journaling apps"],
      excludedAlternatives: ["Traditional fortune-telling sites"],
      reviewState: "needs_confirmation",
    });
    expect(edited.editedFields).toEqual(
      expect.arrayContaining([
        "valueProposition",
        "coreFeatures",
        "categories",
        "businessModel",
        "primaryCta",
        "trustSignals",
        "primaryIcp",
        "icpInterests",
        "icpPain",
        "icpBehavior",
        "icpPositioning",
        "buyer",
        "user",
        "triggerPain",
        "useCases",
        "outcomes",
        "barriers",
        "qualificationSignals",
        "disqualifiers",
        "directCompetitors",
        "indirectAlternatives",
        "excludedAlternatives",
      ]),
    );
    expect(
      edited.fieldProvenance.find(
        (entry) => entry.path === "/valueProposition",
      ),
    ).toEqual({
      path: "/valueProposition",
      derivation: "declared",
      confidence: "high",
      source: "user_edit",
      limitation: null,
      observedAt: null,
      evidenceUrls: [],
    });
  });

  it("applies source-backed live Product and ICP fields without changing the run identity", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://www.acme.com/pricing"),
      {
        country: "US",
        locale: "en-US",
        device: "desktop",
        pageType: "product",
        targetQuery: "acme pricing",
        auditScope: "page-only",
        firstOutcome: "Review the pricing journey",
      },
    );
    const refreshed = applyAgentProfileRefresh(
      profile,
      profileRefreshResult({
        productName: "Acme",
        coreFeatures: ["Shared workspace", "Automated reporting"],
        primaryIcp: "Operations leaders at growing SaaS companies",
        useCases: ["Coordinate recurring growth work"],
      }),
    );

    expect(refreshed).toMatchObject({
      targetUrl: "https://www.acme.com/pricing",
      host: "acme.com",
      productName: "Acme",
      coreFeatures: ["Shared workspace", "Automated reporting"],
      primaryIcp: "Operations leaders at growing SaaS companies",
      useCases: ["Coordinate recurring growth work"],
      country: "US",
      locale: "en-US",
      device: "desktop",
      pageType: "product",
      targetQuery: "acme pricing",
      auditScope: "page-only",
      firstOutcome: "Review the pricing journey",
      sources: {
        product: "public_page_refresh",
        icp: "public_page_refresh",
        competitor: "confirmation_required",
        run: "inferred_run_assumptions",
      },
      reviewState: "needs_confirmation",
    });
    expect(
      refreshed.fieldProvenance.find(
        (entry) => entry.path === "/productName",
      ),
    ).toEqual({
      path: "/productName",
      derivation: "inferred",
      confidence: "medium",
      source: "public_page",
      limitation: "Inferred only from the bounded public-page crawl.",
      observedAt: "2026-08-13T10:00:00.000Z",
      evidenceUrls: ["https://www.acme.com/"],
    });
    expect(refreshed.coreFeatures).not.toBe(profile.coreFeatures);
  });

  it("never overwrites supplied documents or manual edits with public-page inference", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft(
        "seo",
        "https://www.astrologywiki.com/birth-chart",
      ),
      {
        country: "US",
        locale: "en-US",
        valueProposition: "Manually reviewed positioning",
      },
    );
    const refreshed = applyAgentProfileRefresh(
      profile,
      profileRefreshResult(
        {
          productName: "Untrusted replacement",
          valueProposition: "Untrusted replacement",
          user: "Untrusted replacement",
          buyer: "Observed self-serve buyer",
        },
        {
          request: {
            submittedUrl: "https://www.astrologywiki.com/birth-chart",
            normalizedUrl: "https://www.astrologywiki.com/birth-chart",
            targetHost: "www.astrologywiki.com",
            marketCode: "US",
            languageTag: "en-US",
            outputLocale: "en",
          },
        },
      ),
    );

    expect(refreshed.productName).toBe("AstrologyWiki");
    expect(refreshed.valueProposition).toBe("Manually reviewed positioning");
    expect(refreshed.user).toContain("People focused on personal growth");
    expect(refreshed.buyer).toBe("Observed self-serve buyer");
    expect(refreshed.sources).toEqual(profile.sources);
    expect(refreshed.editedFields).toEqual(profile.editedFields);
    expect(
      refreshed.fieldProvenance.find(
        (entry) => entry.path === "/valueProposition",
      )?.source,
    ).toBe("user_edit");
    expect(
      refreshed.fieldProvenance.find((entry) => entry.path === "/buyer")
        ?.source,
    ).toBe("public_page");
  });

  it("summarizes the full AstrologyWiki refresh by what was actually applied", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft(
        "seo",
        "https://www.astrologywiki.com/birth-chart",
      ),
      { country: "US", locale: "en-US" },
    );
    const refresh = fullAstrologyRefreshResult();
    const refreshed = applyAgentProfileRefresh(profile, refresh);

    expect(summarizeAgentProfileRefresh(refreshed, refresh)).toEqual({
      found: 22,
      applied: 11,
      retained: 11,
      unavailable: 0,
    });
  });

  it("lists only differing retained live fields with both source classes", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft(
        "seo",
        "https://www.astrologywiki.com/birth-chart",
      ),
      {
        country: "US",
        locale: "en-US",
        valueProposition: "Manually reviewed positioning",
      },
    );
    const refresh = fullAstrologyRefreshResult();
    const refreshed = applyAgentProfileRefresh(profile, refresh);
    const proposals = listAgentProfileRefreshProposals(refreshed, refresh);

    expect(proposals).toHaveLength(11);
    expect(proposals).toContainEqual({
      path: "productName",
      currentValue: "AstrologyWiki",
      liveValue: "Live productName",
      evidenceUrls: ["https://www.acme.com/"],
      currentSource: "supplied_product_information",
      liveSource: "public_page",
    });
    expect(proposals).toContainEqual({
      path: "valueProposition",
      currentValue: "Manually reviewed positioning",
      liveValue: "Live valueProposition",
      evidenceUrls: ["https://www.acme.com/"],
      currentSource: "user_edit",
      liveSource: "public_page",
    });
    expect(proposals.map((proposal) => proposal.path)).not.toContain("buyer");
    expect(proposals.map((proposal) => proposal.path)).not.toContain(
      "disqualifiers",
    );
  });

  it("accepts selected supplied fields while protecting manual edits and run context", () => {
    const initial = updateAgentProfile(
      createAgentProfileDraft(
        "seo",
        "https://www.astrologywiki.com/birth-chart",
      ),
      {
        country: "US",
        locale: "en-US",
        targetQuery: "free birth chart",
        valueProposition: "Manually reviewed positioning",
      },
    );
    const refresh = fullAstrologyRefreshResult();
    const refreshed = applyAgentProfileRefresh(initial, refresh);
    const confirmed = confirmAgentProfile(refreshed);
    const accepted = acceptAgentProfileRefreshFields(confirmed, refresh, [
      "productName",
      "valueProposition",
    ]);

    expect(confirmed.reviewState).toBe("confirmed");
    expect(accepted).toMatchObject({
      productName: "Live productName",
      valueProposition: "Manually reviewed positioning",
      country: "US",
      locale: "en-US",
      targetQuery: "free birth chart",
      reviewState: "needs_confirmation",
      editedFields: initial.editedFields,
    });
    expect(accepted.user).toBe(refreshed.user);
    expect(accepted.sources).toEqual(refreshed.sources);
    expect(
      accepted.fieldProvenance.find(
        (entry) => entry.path === "/productName",
      ),
    ).toEqual({
      path: "/productName",
      derivation: "inferred",
      confidence: "medium",
      source: "public_page",
      limitation: "Inferred only from the bounded public-page crawl.",
      observedAt: "2026-08-13T10:00:00.000Z",
      evidenceUrls: ["https://www.acme.com/"],
    });
    expect(
      accepted.fieldProvenance.find(
        (entry) => entry.path === "/valueProposition",
      )?.source,
    ).toBe("user_edit");
    expect(summarizeAgentProfileRefresh(accepted, refresh)).toEqual({
      found: 22,
      applied: 12,
      retained: 10,
      unavailable: 0,
    });
  });

  it("fails closed across all proposal helpers when refresh identity differs", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft(
        "seo",
        "https://www.astrologywiki.com/birth-chart",
      ),
      { country: "US", locale: "en-US" },
    );
    const refresh = fullAstrologyRefreshResult();
    const mismatch = {
      ...refresh,
      request: { ...refresh.request, marketCode: "CA" },
    };

    expect(summarizeAgentProfileRefresh(profile, mismatch)).toEqual({
      found: 0,
      applied: 0,
      retained: 0,
      unavailable: 0,
    });
    expect(listAgentProfileRefreshProposals(profile, mismatch)).toEqual([]);
    expect(
      acceptAgentProfileRefreshFields(profile, mismatch, ["productName"]),
    ).toBe(profile);
  });

  it("replaces a prior public-page inference but never blanks it with unavailable data", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://www.acme.com/pricing"),
      { country: "US", locale: "en-US" },
    );
    const first = applyAgentProfileRefresh(
      profile,
      profileRefreshResult({
        productName: "Acme v1",
        valueProposition: "One shared operating view",
      }),
    );
    const second = applyAgentProfileRefresh(
      first,
      profileRefreshResult(
        { productName: "Acme v2" },
        {
          observedAt: "2026-08-13T11:00:00.000Z",
          cache: {
            status: "refreshed",
            capturedAt: "2026-08-13T11:00:00.000Z",
          },
        },
      ),
    );

    expect(second.productName).toBe("Acme v2");
    expect(second.valueProposition).toBe("One shared operating view");
    expect(
      second.fieldProvenance.find(
        (entry) => entry.path === "/productName",
      )?.observedAt,
    ).toBe("2026-08-13T11:00:00.000Z");
    expect(
      second.fieldProvenance.find(
        (entry) => entry.path === "/valueProposition",
      )?.derivation,
    ).toBe("inferred");
  });

  it("ignores refreshes whose Agent, URL, host, market, or language identity differs", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://www.acme.com/pricing"),
      { country: "US", locale: "en-US" },
    );
    const matching = profileRefreshResult({ productName: "Acme" });
    const mismatches: AgentProfileRefreshResult[] = [
      { ...matching, agent: "tech" },
      {
        ...matching,
        request: {
          ...matching.request,
          submittedUrl: "https://www.acme.com/about",
          normalizedUrl: "https://www.acme.com/about",
        },
      },
      {
        ...matching,
        request: {
          ...matching.request,
          normalizedUrl: "https://www.acme.com/about",
        },
      },
      {
        ...matching,
        request: { ...matching.request, targetHost: "other.example" },
      },
      {
        ...matching,
        request: { ...matching.request, marketCode: "CA" },
      },
      {
        ...matching,
        request: { ...matching.request, languageTag: "fr-CA" },
      },
    ];

    for (const mismatch of mismatches) {
      expect(applyAgentProfileRefresh(profile, mismatch)).toBe(profile);
    }
  });

  it("returns a matching confirmed snapshot to review even when no field was available", () => {
    const profile = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft(
          "seo",
          "https://www.astrologywiki.com/birth-chart",
        ),
        { country: "US", locale: "en-US" },
      ),
    );
    const refreshed = applyAgentProfileRefresh(
      profile,
      profileRefreshResult(
        {},
        {
          request: {
            submittedUrl: "https://www.astrologywiki.com/birth-chart",
            normalizedUrl: "https://www.astrologywiki.com/birth-chart",
            targetHost: "www.astrologywiki.com",
            marketCode: "US",
            languageTag: "en-US",
            outputLocale: "en",
          },
        },
      ),
    );

    expect(profile.reviewState).toBe("confirmed");
    expect(refreshed.reviewState).toBe("needs_confirmation");
    expect(refreshed.productName).toBe(profile.productName);
    expect(refreshed.fieldProvenance).toEqual(profile.fieldProvenance);
  });

  it("accepts only an exact confirmed current-v3 local handoff", () => {
    const confirmed = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
    );

    expect(
      isConfirmedAgentProfile(confirmed, "seo", "astrologywiki.com"),
    ).toBe(true);
    expect(
      isConfirmedAgentProfile({
        ...confirmed,
        schemaVersion: "agent-profile.v1",
      }),
    ).toBe(false);
    expect(
      isConfirmedAgentProfile({
        ...confirmed,
        schemaVersion: "agent-profile.v2",
      }),
    ).toBe(false);

    const withoutNewField = { ...confirmed } as Record<string, unknown>;
    delete withoutNewField.coreFeatures;
    expect(isConfirmedAgentProfile(withoutNewField)).toBe(false);

    expect(
      isConfirmedAgentProfile({
        ...confirmed,
        fieldProvenance: confirmed.fieldProvenance.map((entry, index) =>
          index === 0
            ? { ...entry, derivation: "missing", source: "user_edit" }
            : entry,
        ),
      }),
    ).toBe(false);
    expect(
      isConfirmedAgentProfile({ ...confirmed, unexpected: "reject me" }),
    ).toBe(false);
  });

  it("strictly accepts a complete unconfirmed v3 draft without requiring readiness", () => {
    const draft = createAgentProfileDraft("seo", "astrologywiki.com");

    expect(draft.reviewState).toBe("needs_confirmation");
    expect(isAgentProfileReady(draft)).toBe(false);
    expect(isAgentProfileDraft(draft)).toBe(true);
    expect(isAgentProfileDraft(draft, "seo", "astrologywiki.com")).toBe(true);
    expect(isAgentProfileDraft(draft, "tech")).toBe(false);
    expect(isAgentProfileDraft(draft, "seo", "other.example")).toBe(false);
  });

  it("rejects hostile or malformed stored draft shapes before refresh code can use them", () => {
    const draft = createAgentProfileDraft("tech", "https://acme.test/start");
    const withoutField = structuredClone(draft) as unknown as Record<
      string,
      unknown
    >;
    delete withoutField.primaryIcp;
    const editedMismatch = {
      ...draft,
      editedFields: ["productName"],
    };
    const malformedProvenance = {
      ...draft,
      fieldProvenance: draft.fieldProvenance.map((entry, index) =>
        index === 0 ? { ...entry, injected: true } : entry,
      ),
    };

    expect(isAgentProfileDraft({ ...draft, injected: true })).toBe(false);
    expect(isAgentProfileDraft(withoutField)).toBe(false);
    expect(
      isAgentProfileDraft({
        ...draft,
        sources: { ...draft.sources, product: "unknown_source" },
      }),
    ).toBe(false);
    expect(
      isAgentProfileDraft({
        ...draft,
        categories: ["Duplicate", "Duplicate"],
      }),
    ).toBe(false);
    expect(isAgentProfileDraft(editedMismatch)).toBe(false);
    expect(isAgentProfileDraft(malformedProvenance)).toBe(false);
    expect(
      isAgentProfileDraft({ ...draft, reviewState: "persisted" }),
    ).toBe(false);
    expect(isAgentProfileDraft({ ...draft, host: "other.test" })).toBe(false);
    expect(
      isAgentProfileDraft({ ...draft, targetUrl: ` ${draft.targetUrl}` }),
    ).toBe(false);
  });

  it("confirms only a minimally complete Product Profile and primary ICP", () => {
    const supplied = createAgentProfileDraft("seo", "astrologywiki.com");
    const generic = createAgentProfileDraft("seo", "example.com");

    expect(isAgentProfileReady(supplied)).toBe(false);
    expect(confirmAgentProfile(supplied).reviewState).toBe(
      "needs_confirmation",
    );
    const suppliedWithRunMarket = updateAgentProfile(supplied, {
      country: "US",
      locale: "en-US",
    });
    expect(isAgentProfileReady(suppliedWithRunMarket)).toBe(true);
    expect(confirmAgentProfile(suppliedWithRunMarket).reviewState).toBe(
      "confirmed",
    );
    expect(isAgentProfileReady(generic)).toBe(false);
    expect(confirmAgentProfile(generic).reviewState).toBe(
      "needs_confirmation",
    );
    // Positioning detail enriches the record but does not decide the audit, so
    // it no longer stands between a visitor and their own site's evidence.
    expect(
      isAgentProfileReady({ ...suppliedWithRunMarket, valueProposition: "" }),
    ).toBe(true);
    expect(
      isAgentProfileReady({ ...suppliedWithRunMarket, coreFeatures: [] }),
    ).toBe(true);
    expect(
      isAgentProfileReady({ ...suppliedWithRunMarket, useCases: [] }),
    ).toBe(true);
    // The context the run reads back still has to be there.
    expect(
      isAgentProfileReady({ ...suppliedWithRunMarket, productName: "" }),
    ).toBe(false);
    expect(
      isAgentProfileReady({ ...suppliedWithRunMarket, primaryIcp: "" }),
    ).toBe(false);
    expect(
      isAgentProfileReady({ ...suppliedWithRunMarket, primaryCta: "" }),
    ).toBe(false);
    expect(
      isAgentProfileReady({ ...suppliedWithRunMarket, firstOutcome: "" }),
    ).toBe(false);
    expect(
      isAgentProfileReady({
        ...suppliedWithRunMarket,
        fieldProvenance: suppliedWithRunMarket.fieldProvenance.filter(
          (entry) => entry.path !== "/primaryIcp",
        ),
      }),
    ).toBe(false);
    expect(
      isAgentProfileReady({
        ...suppliedWithRunMarket,
        fieldProvenance: suppliedWithRunMarket.fieldProvenance.map((entry) =>
          entry.path === "/primaryIcp"
            ? {
                ...entry,
                derivation: "missing" as const,
                confidence: "unknown" as const,
                source: "not_available" as const,
                limitation: "No primary ICP is available.",
                observedAt: null,
              }
            : entry,
        ),
      }),
    ).toBe(false);
    expect(
      isAgentProfileReady({
        ...suppliedWithRunMarket,
        directCompetitors: [],
        indirectAlternatives: [],
        excludedAlternatives: [],
      }),
    ).toBe(true);

    const manuallyCompleted = updateAgentProfile(generic, {
      productName: "Example",
      oneLinePositioning: "An example product for product teams.",
      valueProposition: "Help product teams ship clearer examples.",
      coreFeatures: ["Example workspace"],
      categories: ["Productivity"],
      businessModel: "Subscription",
      primaryCta: "Start free",
      primaryIcp: "Product teams",
      buyer: "Product leader",
      user: "Product manager",
      triggerPain: "Needs a shared example workspace",
      icpPain: "Examples are scattered",
      jtbd: "Align a team around clear examples",
      useCases: ["Create and share product examples"],
      firstOutcome: "First 20 examples published",
      country: "US",
      locale: "en-US",
    });

    expect(isAgentProfileReady(manuallyCompleted)).toBe(true);
    expect(confirmAgentProfile(manuallyCompleted).reviewState).toBe("confirmed");

    const missingPrimaryMarket = updateAgentProfile(manuallyCompleted, {
      country: "",
    });
    expect(isAgentProfileReady(missingPrimaryMarket)).toBe(false);
    expect(confirmAgentProfile(missingPrimaryMarket).reviewState).toBe(
      "needs_confirmation",
    );

    const missingAuditLocale = updateAgentProfile(manuallyCompleted, {
      locale: "",
    });
    expect(isAgentProfileReady(missingAuditLocale)).toBe(false);
    expect(confirmAgentProfile(missingAuditLocale).reviewState).toBe(
      "needs_confirmation",
    );
  });
});
