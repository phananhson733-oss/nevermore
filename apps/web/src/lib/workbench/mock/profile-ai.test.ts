import { describe, expect, it } from "vitest";
import type { AiDoc, Profile } from "../types.ts";
import { DEMO_AI_LEAK_PHRASES } from "./demo-ai-leak-phrases.ts";
import { demoAiDoc } from "./profile.ts";
import { splitList } from "./text.ts";

/** Brands are deliberately not GenGrowth: the leak scans would pass vacuously on a GenGrowth fixture. */
const ACME: Profile = { url: "acme.io", brand: "Acme", positioning: "", features: "", competitors: "", market: "US" };
const WIDGETS: Profile = {
  url: "https://www.widgets.co.uk",
  brand: "Widgets",
  positioning: "inventory software for small warehouses",
  features: "barcode scanning, stock alerts, supplier portal",
  competitors: "Sortly, inFlow, Zoho Inventory, Fishbowl, Cin7",
  market: "GB",
};
const NO_BRAND: Profile = { ...WIDGETS, brand: "", url: "", market: "cn" };
const FIVE_FEATURES: Profile = { ...WIDGETS, features: "a, b, c, d, e" };
const PROFILES = [ACME, WIDGETS, NO_BRAND, FIVE_FEATURES] as const;

/** The prototype's DEMO_AI vocabulary that a regex can name; the phrase list covers the rest. */
const LEAK = /GenGrowth|gengrowth|独立开发者|一人公司|solo founder|Ahrefs|Semrush|GSC 与 GA4|\$\d/;

/** Every AI field except the summary (profile values only) and the ICP (pinned exactly). */
function placeholderStrings(doc: AiDoc): readonly string[] {
  return [...doc.value_props, ...doc.diff, ...doc.pillars, ...doc.facts, doc.tone];
}

describe("demoAiDoc", () => {
  it("never borrows GenGrowth's own facts (R8)", () => {
    expect(LEAK.test("Pro 版 $29/月支持 5 个站点")).toBe(true);
    for (const profile of PROFILES) {
      const json = JSON.stringify(demoAiDoc(profile));
      expect(json).not.toMatch(LEAK);
      expect(DEMO_AI_LEAK_PHRASES.filter((phrase) => json.includes(phrase))).toEqual([]);
    }
  });

  it("builds the summary only from profile fields", () => {
    expect(demoAiDoc(ACME).summary).toBe("[示例] Acme：[一句话定位待补]");
    expect(demoAiDoc(WIDGETS).summary).toBe("[示例] Widgets：inventory software for small warehouses");
    expect(demoAiDoc(NO_BRAND).summary).toBe("[示例] [品牌]：inventory software for small warehouses");
  });

  it("leaves the ICP as three unfilled segments", () => {
    for (const profile of PROFILES) {
      expect(demoAiDoc(profile).icp).toEqual(
        [1, 2, 3].map((n) => ({
          seg: `[目标人群 ${n}]`,
          role: "[角色待补]",
          pain: "[痛点待补]",
          trigger: "[触发搜索的查询待补]",
          objection: "[常见顾虑待补]",
        })),
      );
    }
  });

  it("makes every other field a pending bracket placeholder", () => {
    for (const profile of PROFILES) {
      const doc = demoAiDoc(profile);
      for (const field of [doc.value_props, doc.diff, doc.pillars]) {
        expect(field.length).toBeGreaterThanOrEqual(2);
        expect(field.length).toBeLessThanOrEqual(3);
      }
      expect(doc.facts.length).toBeGreaterThanOrEqual(1);
      expect(doc.tone).toBe("[语气待定：先给结论再给理由]");
      for (const text of placeholderStrings(doc)) {
        expect(text).toMatch(/^\[.*\]$/u);
        expect(text).toMatch(/待|需补/u);
        expect(text).not.toMatch(/实测|已核实|已修复/u);
      }
    }
  });

  it("pins the value propositions and differentiators", () => {
    expect(demoAiDoc(ACME).value_props).toEqual([
      "[价值主张 1：Acme 帮目标人群解决的核心问题（待补）]",
      "[价值主张 2：Acme 用 核心功能 带来的具体结果（待补）]",
    ]);
    expect(demoAiDoc(WIDGETS).value_props).toEqual([
      "[价值主张 1：Widgets 帮目标人群解决的核心问题（待补）]",
      "[价值主张 2：Widgets 用 barcode scanning 带来的具体结果（待补）]",
    ]);
    expect(demoAiDoc(ACME).diff).toEqual([
      "[差异点 1：Acme 与 同类产品 相比的不同（待补对比依据）]",
      "[差异点 2：Acme 明确不做的事（待补产品边界）]",
    ]);
    expect(demoAiDoc(WIDGETS).diff).toEqual([
      "[差异点 1：Widgets 与 Sortly 相比的不同（待补对比依据）]",
      "[差异点 2：Widgets 明确不做的事（待补产品边界）]",
    ]);
  });

  it("builds pillars from the features first, then the brand", () => {
    expect(demoAiDoc(WIDGETS).pillars).toEqual([
      "[内容支柱 1：围绕 barcode scanning 的主题（待补）]",
      "[内容支柱 2：围绕 stock alerts 的主题（待补）]",
      "[内容支柱 3：围绕 supplier portal 的主题（待补）]",
    ]);
    expect(demoAiDoc({ ...ACME, features: "rank tracking" }).pillars).toEqual([
      "[内容支柱 1：围绕 rank tracking 的主题（待补）]",
      "[内容支柱 2：Acme 的核心主题（待补）]",
    ]);
    expect(demoAiDoc(ACME).pillars).toEqual([
      "[内容支柱 1：Acme 的核心主题（待补）]",
      "[内容支柱 2：Acme 的目标人群最常问的问题（待补）]",
    ]);
  });

  it("gives every proposition, differentiator and pillar the brand or a feature as its subject", () => {
    for (const profile of PROFILES) {
      const doc = demoAiDoc(profile);
      const subjects = [profile.brand.trim() === "" ? "[品牌]" : profile.brand, ...splitList(profile.features)];
      for (const text of [...doc.value_props, ...doc.diff, ...doc.pillars]) {
        expect(subjects.some((subject) => text.includes(subject))).toBe(true);
      }
    }
  });

  it("writes one fact per feature, however many, or one pending capability fact", () => {
    expect(demoAiDoc(ACME).facts).toEqual(["[示例事实：Acme 的核心能力待补]"]);
    for (const profile of [WIDGETS, FIVE_FEATURES]) {
      expect(demoAiDoc(profile).facts).toEqual(
        splitList(profile.features).map((feature) => `[示例事实：Widgets 提供 ${feature}，需补证据与核对日期]`),
      );
    }
    expect(demoAiDoc(FIVE_FEATURES).facts).toHaveLength(5);
  });

  it("returns fresh objects on every call", () => {
    const first = demoAiDoc(WIDGETS);
    const second = demoAiDoc(WIDGETS);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.icp).not.toBe(second.icp);
    expect(first.icp[0]).not.toBe(second.icp[0]);
    expect(first.facts).not.toBe(second.facts);
    expect(first.value_props).not.toBe(second.value_props);
  });
});
