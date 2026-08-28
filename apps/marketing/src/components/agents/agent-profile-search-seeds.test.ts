import { describe, expect, it } from "vitest";

import {
  createAgentProfileDraft,
  type AgentProfileDraft,
  type AgentProfileEditableField,
  type AgentProfileFieldSource,
} from "./agent-profile";
import {
  deriveProfileSearchSeeds,
  deriveProductProfileSearchSeeds,
  productProfileSearchSeedsIdentity,
} from "./agent-profile-search-seeds";

function profileWithSearchFields(
  values: Partial<
    Pick<
      AgentProfileDraft,
      "productName" | "categories" | "oneLinePositioning" | "coreFeatures"
    >
  >,
  sources: Partial<
    Record<
      "productName" | "categories" | "oneLinePositioning" | "coreFeatures",
      AgentProfileFieldSource
    >
  >,
): AgentProfileDraft {
  const draft = createAgentProfileDraft("seo", "example.com");
  const sourceByPath = new Map(
    Object.entries(sources).map(([field, source]) => [
      `/${field as AgentProfileEditableField}`,
      source,
    ]),
  );
  return {
    ...draft,
    ...values,
    fieldProvenance: draft.fieldProvenance.map((entry) => ({
      ...entry,
      source: sourceByPath.get(entry.path) ?? entry.source,
    })),
  };
}

describe("deriveProductProfileSearchSeeds", () => {
  it("derives approved seeds from a website-shaped profile", () => {
    const websiteProfile = {
      productName: "Astrology Wiki",
      categories: ["Astrology reference"],
      oneLinePositioning: "Evidence-led astrology explanations",
      coreFeatures: ["Natal chart guides"],
      fieldProvenance: [
        { path: "/productName", source: "public_page" },
        { path: "/categories", source: "user_edit" },
        { path: "/oneLinePositioning", source: "public_page" },
        { path: "/coreFeatures", source: "not_available" },
      ],
    };

    expect(deriveProfileSearchSeeds(websiteProfile)).toEqual([
      "Astrology Wiki",
      "Astrology reference",
      "Evidence-led astrology explanations",
    ]);
  });

  it("returns no hostname or placeholder seed for an unrefreshed generic profile", () => {
    expect(
      deriveProductProfileSearchSeeds(
        createAgentProfileDraft("seo", "gengrowth.ai"),
      ),
    ).toEqual([]);
  });

  it("uses only approved Product Profile sources in priority order and caps at five", () => {
    const profile = profileWithSearchFields(
      {
        productName: "  GenGrowth\u00a0AI  ",
        categories: ["SEO   software", "Growth platform", "Ignored third"],
        oneLinePositioning: "AI growth workspace",
        coreFeatures: ["SEO audit", "Content briefs", "Sixth seed"],
      },
      {
        productName: "public_page",
        categories: "supplied_product_information",
        oneLinePositioning: "user_edit",
        coreFeatures: "public_page",
      },
    );

    expect(deriveProductProfileSearchSeeds(profile)).toEqual([
      "GenGrowth AI",
      "SEO software",
      "Growth platform",
      "AI growth workspace",
      "SEO audit",
    ]);
  });

  it("rejects Marketing Strategy, visitor URL, missing, and generic placeholder copy", () => {
    const profile = profileWithSearchFields(
      {
        productName: "Marketing-only product name",
        categories: ["Unknown — confirm the category."],
        oneLinePositioning:
          "Public website at example.com; its product and positioning are not yet confirmed.",
        coreFeatures: ["Public crawl", "未知——请确认产品类别。"],
      },
      {
        productName: "supplied_marketing_strategy",
        categories: "user_edit",
        oneLinePositioning: "user_edit",
        coreFeatures: "public_page",
      },
    );

    expect(deriveProductProfileSearchSeeds(profile)).toEqual(["Public crawl"]);
  });

  it("normalizes NFKC and whitespace, then deduplicates case-insensitively", () => {
    const profile = profileWithSearchFields(
      {
        productName: "ＧｅｎＧｒｏｗｔｈ",
        categories: [" gengrowth ", "SEO\n platform"],
        oneLinePositioning: "seo platform",
        coreFeatures: ["Technical SEO"],
      },
      {
        productName: "public_page",
        categories: "public_page",
        oneLinePositioning: "public_page",
        coreFeatures: "user_edit",
      },
    );

    expect(deriveProductProfileSearchSeeds(profile)).toEqual([
      "GenGrowth",
      "SEO platform",
      "Technical SEO",
    ]);
  });

  it("keeps the Agent compatibility export identical to the generic projection", () => {
    const profile = profileWithSearchFields(
      {
        productName: "GenGrowth",
        categories: ["SEO platform"],
        oneLinePositioning: "Evidence-led growth workspace",
        coreFeatures: ["Technical SEO"],
      },
      {
        productName: "public_page",
        categories: "supplied_product_information",
        oneLinePositioning: "user_edit",
        coreFeatures: "public_page",
      },
    );

    expect(deriveProfileSearchSeeds(profile)).toEqual(
      deriveProductProfileSearchSeeds(profile),
    );
  });
});

describe("productProfileSearchSeedsIdentity", () => {
  it("treats cosmetic case and whitespace changes as the same request identity", () => {
    expect(productProfileSearchSeedsIdentity([" GenGrowth   AI "])).toBe(
      productProfileSearchSeedsIdentity(["gengrowth ai"]),
    );
  });
});
