// @input  -- Agent identity plus a visitor-entered public URL
// @output -- source-honest Product/ICP drafts and immutable local edits
// @pos    -- unit contract for the marketing-only Agent Profile gate

import { describe, expect, it } from "vitest";

import {
  confirmAgentProfile,
  createAgentProfileDraft,
  isConfirmedAgentProfile,
  isAgentProfileReady,
  redraftAgentProfileForUrl,
  updateAgentProfile,
} from "./agent-profile";

describe("Agent-local Product / ICP profiles", () => {
  it("seeds AstrologyWiki from the two supplied documents without calling it observed", () => {
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
      primaryIcp: "Mobile-first young adults, 22–38, female-skewed",
      buyer:
        "Inferred — the user and payer are likely the same self-serve individual; confirm.",
      user:
        "Documented — an astrology-interested young adult using the product for self-reflection.",
      triggerPain:
        "Documented — wants self-understanding, relationship insight, or emotional reflection without fatalistic prediction.",
      jtbd: "Understand themselves without deterministic fortune-telling.",
      firstOutcome:
        "Own the free birth-chart query and convert to chart generation",
      country: "CN",
      locale: "zh-CN",
      device: "mobile",
      pageType: "tool",
      targetQuery: "免费星盘计算",
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
      "Psychology",
      "Personal growth",
      "Mindfulness",
    ]);
    expect(profile.icpPain).toContain("rejects deterministic fortune-telling");
    expect(profile.icpPositioning).toBe("Self-reflection, not fate prediction");
    expect(profile.sources).toEqual({
      product: "product_information_supplied",
      icp: "marketing_strategy_supplied",
      competitor: "confirmation_required",
      run: "inferred_run_assumptions",
    });
    expect(profile.directCompetitors).toEqual([]);
    expect(profile.indirectAlternatives).toEqual([]);
    expect(profile.excludedAlternatives).toEqual([]);
  });

  it("maps the supplied documents into the key Product Profile and Core ICP fields", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");

    expect(profile.valueProposition).toBe(
      "Use astrology to know yourself, not predict fate.",
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
    expect(profile.barriers).toEqual([
      "Rejects superstitious or deterministic fate prediction",
    ]);
    expect(profile.qualificationSignals).toEqual([
      "Interested in astrology, psychology, personal growth, or mindfulness",
      "Uses a mobile device",
      "Values self-reflection and emotional health",
    ]);
    expect(profile.disqualifiers).toEqual([
      "Seeks deterministic fortune-telling",
    ]);
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
      source: "supplied_marketing_strategy",
      limitation: null,
      observedAt: null,
    });
    expect(byPath.get("/coreFeatures")).toMatchObject({
      derivation: "declared",
      source: "supplied_product_information",
    });
    expect(byPath.get("/buyer")).toMatchObject({
      derivation: "inferred",
      confidence: "low",
      source: "local_inference",
      observedAt: expect.any(String),
    });
    expect(byPath.get("/country")).toMatchObject({
      derivation: "inferred",
      confidence: "low",
      source: "local_inference",
      observedAt: expect.any(String),
    });
    expect(byPath.get("/locale")).toMatchObject({
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
      "Keep mobile anonymous chart generation crawlable and reliable",
    );
    expect(editedSeo.firstOutcome).toContain("free birth-chart query");
    expect(editedSeo.country).toBe("US");
    expect(tech.country).toBe("CN");
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
      locale: "en",
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
      locale: "zh-CN",
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
      primaryIcp: "以移动端为主、22–38 岁、女性偏多的年轻人",
      buyer: "推断——用户与付费者很可能是同一位自助型个人；需确认。",
      user: "文档事实——对占星感兴趣、用产品进行自我反思的年轻人。",
      jtbd: "在不接受宿命论式算命的前提下理解自己。",
      firstOutcome: "占领免费出生星盘查询并转化为星盘生成",
    });
    expect(profile.sources).toEqual({
      product: "product_information_supplied",
      icp: "marketing_strategy_supplied",
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
    });
  });

  it("accepts only an exact confirmed current-v3 local handoff", () => {
    const confirmed = confirmAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
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

  it("confirms only a minimally complete Product Profile and primary ICP", () => {
    const supplied = createAgentProfileDraft("seo", "astrologywiki.com");
    const generic = createAgentProfileDraft("seo", "example.com");

    expect(isAgentProfileReady(supplied)).toBe(true);
    expect(confirmAgentProfile(supplied).reviewState).toBe("confirmed");
    expect(isAgentProfileReady(generic)).toBe(false);
    expect(confirmAgentProfile(generic).reviewState).toBe(
      "needs_confirmation",
    );
    expect(
      isAgentProfileReady({ ...supplied, valueProposition: "" }),
    ).toBe(false);
    expect(isAgentProfileReady({ ...supplied, coreFeatures: [] })).toBe(false);
    expect(isAgentProfileReady({ ...supplied, useCases: [] })).toBe(false);
    expect(
      isAgentProfileReady({
        ...supplied,
        fieldProvenance: supplied.fieldProvenance.filter(
          (entry) => entry.path !== "/valueProposition",
        ),
      }),
    ).toBe(false);
    expect(
      isAgentProfileReady({
        ...supplied,
        fieldProvenance: supplied.fieldProvenance.map((entry) =>
          entry.path === "/valueProposition"
            ? {
                ...entry,
                derivation: "missing" as const,
                confidence: "unknown" as const,
                source: "not_available" as const,
                limitation: "No value proposition is available.",
                observedAt: null,
              }
            : entry,
        ),
      }),
    ).toBe(false);
    expect(
      isAgentProfileReady({
        ...supplied,
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
      country: "US",
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
