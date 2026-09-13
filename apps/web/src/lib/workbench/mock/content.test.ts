import { describe, expect, it } from "vitest";
import { CONTENT_ASSETS, type ContentAsset } from "../enums.ts";
import {
  assetNeedsOutline,
  fallbackOutline,
  PRODUCT_PLACEHOLDER,
  productName,
} from "./content.ts";

const NEEDS_OUTLINE: Readonly<Record<ContentAsset, boolean>> = {
  blog: true,
  landing: true,
  tool: true,
  comparison: true,
  image: false,
  video: false,
};

const SCHEMA_BY_ASSET: Readonly<Record<ContentAsset, string>> = {
  blog: "Article + FAQPage",
  landing: "Article + FAQPage",
  tool: "SoftwareApplication",
  comparison: "Article + FAQPage",
  image: "Article + FAQPage",
  video: "Article + FAQPage",
};

/** Third-party names, prices and percentages the outline must never assert. */
const INVENTED_FACTS =
  /GenGrowth|gengrowth|Ahrefs|Semrush|\$\d|¥\d|\d+(\.\d+)?%/;

describe("assetNeedsOutline", () => {
  it.each(CONTENT_ASSETS)("%s", (asset) => {
    expect(assetNeedsOutline(asset)).toBe(NEEDS_OUTLINE[asset]);
  });
});

describe("productName", () => {
  it("uses the brand when it has text", () => {
    expect(productName({ brand: "Acme" })).toBe("Acme");
    expect(productName({ brand: "  Acme  " })).toBe("Acme");
  });

  it.each(["", "   ", "\n\t"])(
    "falls back to the bracket placeholder for %j",
    (brand) => {
      expect(productName({ brand })).toBe("[产品]");
      expect(PRODUCT_PLACEHOLDER).toBe("[产品]");
    },
  );
});

describe("fallbackOutline", () => {
  it("builds the skeleton outline with camelCase fields", () => {
    expect(fallbackOutline("best crm", { brand: "Acme" }, "blog")).toEqual({
      h1: "best crm",
      angle: "先给结论再展开，第一段就把答案说完",
      sections: [
        {
          h2: "best crm 到底是什么？",
          keySentence: "[一句定义：best crm 是……]",
          mustInclude: ["定义句", "一个注明来源的数字事实"],
        },
        {
          h2: "什么情况下需要它？",
          keySentence: "[结论句：符合这三种情况才需要]",
          mustInclude: ["3 个判断条件", "反例"],
        },
        {
          h2: "怎么做，分几步？",
          keySentence: "[结论句：核心是 X，其余是执行细节]",
          mustInclude: ["步骤清单", "可截图的表格"],
        },
        {
          h2: "常见的坑有哪些？",
          keySentence: "[结论句：最常见的错误是……]",
          mustInclude: ["2 个真实误区", "怎么验证"],
        },
        {
          h2: "用 Acme 怎么做？",
          keySentence: "[结论句：Acme 在这一步实际能做什么；做不到就删掉本节]",
          mustInclude: ["功能对应关系", "不适合谁"],
        },
      ],
      faq: [
        "best crm 要多久见效？",
        "有免费的做法吗？",
        "需要技术背景吗？",
        "Acme 和同类产品的差别？",
      ],
      internalLinks: [
        "[定价页] → 本页",
        "本页 → [相关工具页]",
        "本页 → [对比页]",
      ],
      schema: "Article + FAQPage",
      wordCount: "1200-1600 字",
    });
  });

  it.each(CONTENT_ASSETS)("picks the schema for %s", (asset) => {
    expect(fallbackOutline("q", { brand: "Acme" }, asset).schema).toBe(
      SCHEMA_BY_ASSET[asset],
    );
  });

  it("puts the bracket placeholder in every brand slot when the brand is blank", () => {
    for (const brand of ["", "  "]) {
      const outline = fallbackOutline("best crm", { brand }, "blog");
      expect(outline.sections[4]?.h2).toBe("用 [产品] 怎么做？");
      expect(outline.sections[4]?.keySentence).toBe(
        "[结论句：[产品] 在这一步实际能做什么；做不到就删掉本节]",
      );
      expect(outline.faq[3]).toBe("[产品] 和同类产品的差别？");
      const text = JSON.stringify(outline);
      expect(text).not.toMatch(/用 +怎么做|：\s+在这一步|"\s+和同类/);
    }
  });

  it("asserts no third-party names, prices or percentages", () => {
    for (const asset of CONTENT_ASSETS) {
      expect(
        JSON.stringify(fallbackOutline("best crm", { brand: "" }, asset)),
      ).not.toMatch(INVENTED_FACTS);
    }
  });

  it("returns fresh arrays on every call", () => {
    const first = fallbackOutline("q", { brand: "Acme" }, "blog");
    const second = fallbackOutline("q", { brand: "Acme" }, "blog");
    expect(second).toEqual(first);
    expect(second.sections).not.toBe(first.sections);
    expect(second.faq).not.toBe(first.faq);
    expect(second.internalLinks).not.toBe(first.internalLinks);
  });
});
