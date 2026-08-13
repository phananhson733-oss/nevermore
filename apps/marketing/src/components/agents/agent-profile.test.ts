// @input  -- Agent identity plus a visitor-entered public URL
// @output -- source-honest Product/ICP drafts and immutable local edits
// @pos    -- unit contract for the marketing-only Agent Profile gate

import { describe, expect, it } from "vitest";

import {
  confirmAgentProfile,
  createAgentProfileDraft,
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
      schemaVersion: "agent-profile.v1",
      agent: "seo",
      host: "astrologywiki.com",
      productName: "AstrologyWiki",
      oneLinePositioning:
        "A free birth-chart and self-exploration web app combining astrology with modern psychology.",
      categories: ["Astrology tool", "Self-discovery platform", "Birth-chart calculator"],
      businessModel: "Freemium · subscription · credits",
      primaryCta: "Generate Free Birth Chart",
      primaryIcp: "Mobile-first young adults, 22–38, female-skewed",
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
      run: "inferred_run_assumptions",
    });
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
      country: "GLOBAL",
      locale: "en",
      targetQuery: "",
      auditScope: "site-first",
      reviewState: "needs_confirmation",
      sources: {
        product: "hostname_inference",
        icp: "confirmation_required",
        run: "inferred_run_assumptions",
      },
    });
    expect(profile.oneLinePositioning).toContain("docs.acme.test");
    expect(profile.oneLinePositioning).toContain("not yet confirmed");
    expect(profile.categories).toEqual(["Unknown — confirm the category."]);
    expect(profile.trustSignals).toEqual([]);
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
      country: "GLOBAL",
      targetQuery: "",
      reviewState: "needs_confirmation",
      editedFields: [],
    });
    expect(redrafted.primaryIcp).not.toContain("22–38");
  });

  it("edits every explicit run assumption and confirmation remains local data", () => {
    const draft = createAgentProfileDraft("tech", "example.com");
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
        categories: ["Astrology SaaS", "Reflection tool"],
        businessModel: "Free core with optional subscription",
        primaryCta: "Create my free chart",
        trustSignals: ["Swiss Ephemeris", "Private birth data"],
        primaryIcp: "Curious mobile-first adults",
        icpInterests: ["Astrology", "Self-reflection"],
        icpPain: "Rejects fatalistic readings",
        icpBehavior: "Compares and shares chart insights",
        icpPositioning: "Reflection without prediction",
      },
    );

    expect(edited).toMatchObject({
      categories: ["Astrology SaaS", "Reflection tool"],
      businessModel: "Free core with optional subscription",
      primaryCta: "Create my free chart",
      trustSignals: ["Swiss Ephemeris", "Private birth data"],
      primaryIcp: "Curious mobile-first adults",
      icpInterests: ["Astrology", "Self-reflection"],
      icpPain: "Rejects fatalistic readings",
      icpBehavior: "Compares and shares chart insights",
      icpPositioning: "Reflection without prediction",
      reviewState: "needs_confirmation",
    });
    expect(edited.editedFields).toEqual(
      expect.arrayContaining([
        "categories",
        "businessModel",
        "primaryCta",
        "trustSignals",
        "primaryIcp",
        "icpInterests",
        "icpPain",
        "icpBehavior",
        "icpPositioning",
      ]),
    );
  });
});
