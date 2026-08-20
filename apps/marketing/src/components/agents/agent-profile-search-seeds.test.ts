import { describe, expect, it } from "vitest";

import {
  createAgentProfileDraft,
  type AgentProfileDraft,
  type AgentProfileEditableField,
  type AgentProfileFieldSource,
} from "./agent-profile";
import {
  deriveSuggestedTargetQuery,
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
});

describe("productProfileSearchSeedsIdentity", () => {
  it("treats cosmetic case and whitespace changes as the same request identity", () => {
    expect(productProfileSearchSeedsIdentity([" GenGrowth   AI "])).toBe(
      productProfileSearchSeedsIdentity(["gengrowth ai"]),
    );
  });
});

describe("deriveSuggestedTargetQuery", () => {
  it("prefers an approved category or capability seed before the product name fallback", () => {
    const profile = profileWithSearchFields(
      {
        productName: "GenGrowth AI",
        categories: ["Birth chart calculator"],
        oneLinePositioning: "AI growth workspace",
        coreFeatures: ["Natal chart generator"],
      },
      {
        productName: "public_page",
        categories: "public_page",
        oneLinePositioning: "public_page",
        coreFeatures: "public_page",
      },
    );

    expect(deriveSuggestedTargetQuery(profile)).toBe(
      "Birth chart calculator",
    );
  });

  it("falls back to an approved product name only when no better seed exists", () => {
    const profile = profileWithSearchFields(
      { productName: "GenGrowth AI" },
      { productName: "user_edit" },
    );

    expect(deriveSuggestedTargetQuery(profile)).toBe("GenGrowth AI");
  });

  it("skips a brand duplicate and generic category labels for a specific non-brand capability", () => {
    const profile = profileWithSearchFields(
      {
        productName: "GenGrowth AI",
        categories: [" gengrowth ai ", "SEO platform"],
        coreFeatures: ["Technical SEO audit"],
      },
      {
        productName: "public_page",
        categories: "public_page",
        coreFeatures: "public_page",
      },
    );

    expect(deriveSuggestedTargetQuery(profile)).toBe("Technical SEO audit");
  });

  it("normalizes source-language Unicode and whitespace without translating it", () => {
    const profile = profileWithSearchFields(
      {
        categories: [" 出生　星盘\n计算器 "],
      },
      { categories: "user_edit" },
    );

    expect(deriveSuggestedTargetQuery(profile)).toBe("出生 星盘 计算器");
  });

  it("rejects an over-200-character value and uses the next credible seed", () => {
    const profile = profileWithSearchFields(
      {
        categories: ["x".repeat(201)],
        coreFeatures: ["Ｎａｔａｌ　chart\ncalculator"],
      },
      {
        categories: "public_page",
        coreFeatures: "public_page",
      },
    );

    expect(deriveSuggestedTargetQuery(profile)).toBe("Natal chart calculator");
  });

  it("returns null when no credible approved seed exists", () => {
    const profile = profileWithSearchFields(
      {
        productName: "Marketing-only product name",
        categories: ["Unknown — confirm the category."],
        oneLinePositioning:
          "Public website at example.com; its product and positioning are not yet confirmed.",
        coreFeatures: ["Unknown — confirm the feature."],
      },
      {
        productName: "supplied_marketing_strategy",
        categories: "user_edit",
        oneLinePositioning: "user_edit",
        coreFeatures: "public_page",
      },
    );

    expect(deriveSuggestedTargetQuery(profile)).toBeNull();
  });
});
