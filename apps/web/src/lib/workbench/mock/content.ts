/**
 * Skeleton content outline (jsx:1957-1974). With no model in the mock layer this
 * is the only outline the content view gets, so every slot the writer has to
 * fill is a bracket placeholder and nothing here reads as an observed fact.
 */
import type { ContentAsset } from "../enums.ts";
import type { Profile } from "../types.ts";

export const PRODUCT_PLACEHOLDER = "[产品]";

export interface ContentOutlineSection {
  readonly h2: string;
  readonly keySentence: string;
  readonly mustInclude: readonly string[];
}

export interface ContentOutline {
  readonly h1: string;
  readonly angle: string;
  readonly sections: readonly ContentOutlineSection[];
  readonly faq: readonly string[];
  readonly internalLinks: readonly string[];
  readonly schema: string;
  readonly wordCount: string;
}

/** Images and short videos skip the outline and go straight to a brief (jsx:1987). */
export function assetNeedsOutline(asset: ContentAsset): boolean {
  return asset !== "image" && asset !== "video";
}

/** The brand as written, or `[产品]` when it is blank, so no sentence is left with a hole. */
export function productName(profile: Pick<Profile, "brand">): string {
  const brand = profile.brand.trim();
  return brand === "" ? PRODUCT_PLACEHOLDER : brand;
}

function outlineSections(
  target: string,
  product: string,
): readonly ContentOutlineSection[] {
  return [
    {
      h2: `${target} 到底是什么？`,
      keySentence: `[一句定义：${target} 是……]`,
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
      h2: `用 ${product} 怎么做？`,
      keySentence: `[结论句：${product} 在这一步实际能做什么；做不到就删掉本节]`,
      mustInclude: ["功能对应关系", "不适合谁"],
    },
  ];
}

export function fallbackOutline(
  target: string,
  profile: Pick<Profile, "brand">,
  asset: ContentAsset,
): ContentOutline {
  const product = productName(profile);
  return {
    h1: target,
    angle: "先给结论再展开，第一段就把答案说完",
    sections: outlineSections(target, product),
    faq: [
      `${target} 要多久见效？`,
      "有免费的做法吗？",
      "需要技术背景吗？",
      `${product} 和同类产品的差别？`,
    ],
    internalLinks: [
      "[定价页] → 本页",
      "本页 → [相关工具页]",
      "本页 → [对比页]",
    ],
    schema: asset === "tool" ? "SoftwareApplication" : "Article + FAQPage",
    wordCount: "1200-1600 字",
  };
}
