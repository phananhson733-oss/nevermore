import { describe, expect, it } from "vitest";
import { PERSISTED_VERSION, parsePersistedState } from "../store/schema.ts";
import { populatedProjectState } from "../store/test-fixtures.ts";
import type { AiDoc, GscRow, Profile, ProfileDoc } from "../types.ts";
import { sitePages } from "./audit.ts";
import { marketLanguage } from "./market.ts";
import { crawlSignals, demoAiDoc, gscSignals } from "./profile.ts";
import { splitList } from "./text.ts";

const AT = "2026-09-13 10:00";
/** Brands are deliberately not GenGrowth: the leak scan below would pass vacuously on a GenGrowth fixture. */
const ACME: Profile = {
  url: "acme.io",
  brand: "Acme",
  positioning: "",
  features: "",
  competitors: "",
  market: "US",
};
const WIDGETS: Profile = {
  url: "https://www.widgets.co.uk",
  brand: "Widgets",
  positioning: "inventory software for small warehouses",
  features: "barcode scanning, stock alerts, supplier portal",
  competitors: "Sortly, inFlow, Zoho Inventory, Fishbowl, Cin7",
  market: "GB",
};
const NO_BRAND: Profile = { ...WIDGETS, brand: "", url: "", market: "cn" };
const PROFILES = [ACME, WIDGETS, NO_BRAND] as const;

/** The prototype's DEMO_AI vocabulary (GenGrowth's own facts). */
const LEAK =
  /GenGrowth|gengrowth|独立开发者|一人公司|solo founder|Ahrefs|Semrush|GSC 与 GA4|\$\d/;
const STACKS = ["Next.js", "Webflow", "Astro", "WordPress"];
const CRAWL_KEYS = [
  "dr",
  "h1",
  "hasBlog",
  "hasDocs",
  "hasPricing",
  "indexed",
  "lang",
  "pages",
  "refdomains",
  "stack",
  "traffic",
];

function row(
  query: string,
  clicks: number | null,
  position: number | null,
): GscRow {
  return { query, clicks, impressions: 100, ctr: 1, position };
}

/** Every AI field except the summary (profile values only) and the ICP (pinned exactly). */
function placeholderStrings(doc: AiDoc): readonly string[] {
  return [
    ...doc.value_props,
    ...doc.diff,
    ...doc.pillars,
    ...doc.facts,
    doc.tone,
  ];
}

describe("crawlSignals", () => {
  it("takes the language from the market code (R16), not from a label", () => {
    expect(crawlSignals({ ...ACME, market: "CN" }, "crawl").lang).toBe("zh-CN");
    expect(crawlSignals({ ...ACME, market: "jp" }, "third").lang).toBe("ja-JP");
    expect(crawlSignals({ ...ACME, market: "中文" }, "crawl").lang).toBe(
      "en-US",
    );
    for (const profile of PROFILES) {
      expect(crawlSignals(profile, "crawl").lang).toBe(
        marketLanguage(profile.market),
      );
    }
  });

  it("marks the H1 as a placeholder that was never crawled (R10)", () => {
    expect(crawlSignals(ACME, "crawl").h1).toBe(
      "[示例] Acme 的首页 H1（未抓取）",
    );
    expect(crawlSignals(NO_BRAND, "third").h1).toBe(
      "[示例] [品牌] 的首页 H1（未抓取）",
    );
    expect(crawlSignals({ ...ACME, brand: "   " }, "crawl").h1).toBe(
      "[示例] [品牌] 的首页 H1（未抓取）",
    );
    // The prototype put the positioning into the H1, which reads as observed page copy.
    expect(crawlSignals(WIDGETS, "crawl").h1).not.toContain(
      WIDGETS.positioning,
    );
  });

  it("draws the crawl and the third-party variants from different seeds", () => {
    for (const profile of PROFILES) {
      expect(crawlSignals(profile, "crawl")).not.toEqual(
        crawlSignals(profile, "third"),
      );
    }
  });

  it("is deterministic per variant and keyed on the normalized domain", () => {
    expect(crawlSignals(WIDGETS, "crawl")).toEqual(
      crawlSignals(WIDGETS, "crawl"),
    );
    expect(
      crawlSignals({ ...ACME, url: "https://www.ACME.io/pricing" }, "third"),
    ).toEqual(crawlSignals(ACME, "third"));
  });

  it("stays inside the prototype's ranges and never reports more indexed pages than crawled ones", () => {
    for (const profile of PROFILES) {
      for (const variant of ["crawl", "third"] as const) {
        const signals = crawlSignals(profile, variant);
        const floor = sitePages(profile).length;
        expect(Object.keys(signals).sort()).toEqual(CRAWL_KEYS);
        expect(STACKS).toContain(signals.stack);
        expect(signals.pages).toBeGreaterThanOrEqual(floor);
        expect(signals.pages).toBeLessThan(floor + 40);
        expect(signals.indexed).toBeGreaterThanOrEqual(1);
        expect(signals.indexed).toBeLessThanOrEqual(signals.pages);
        expect(signals.traffic % 10).toBe(0);
        expect(signals.traffic).toBeGreaterThanOrEqual(300);
        expect(signals.traffic).toBeLessThanOrEqual(5500);
        expect(signals.dr).toBeGreaterThanOrEqual(8);
        expect(signals.dr).toBeLessThan(53);
        expect(signals.refdomains).toBeGreaterThanOrEqual(15);
        expect(signals.refdomains).toBeLessThan(275);
        for (const value of [
          signals.pages,
          signals.indexed,
          signals.traffic,
          signals.dr,
          signals.refdomains,
        ]) {
          expect(Number.isInteger(value)).toBe(true);
        }
        for (const flag of [
          signals.hasPricing,
          signals.hasDocs,
          signals.hasBlog,
        ]) {
          expect(typeof flag).toBe("boolean");
        }
      }
    }
  });
});

describe("gscSignals", () => {
  const ROWS: readonly GscRow[] = Object.freeze(
    [
      row("gen pricing", 10, 2),
      row("genre music", 7, 15),
      row("Gen login", null, 12),
      row("best tools", 30, 31),
      row("gen vs rival", 5, 30),
      row("x", 1, null),
      row("y", 2, 10.01),
    ].map((entry) => Object.freeze(entry)),
  );

  it("matches the brand as a whole word: Gen is not genre", () => {
    const signals = gscSignals({ brand: "Gen" }, ROWS);
    expect(signals.total).toBe(7);
    expect(signals.brandQueries).toBe(3);
    expect(signals.brandClicks).toBe(15);
    expect(signals.nonBrandClicks).toBe(40);
  });

  it("counts borderline rows (10 < position <= 30) as near", () => {
    expect(gscSignals({ brand: "Gen" }, ROWS).near).toBe(4);
  });

  it("lists the top five by clicks, null clicks as 0, without reordering the input", () => {
    const before = ROWS.map((entry) => entry.query);
    const { top } = gscSignals({ brand: "Gen" }, ROWS);
    expect(top.map((entry) => entry.query)).toEqual([
      "best tools",
      "gen pricing",
      "genre music",
      "gen vs rival",
      "y",
    ]);
    expect(ROWS.map((entry) => entry.query)).toEqual(before);
    const tail = gscSignals({ brand: "Gen" }, [
      row("a", null, 1),
      row("b", 0, 1),
      row("c", 1, 1),
    ]).top;
    expect(tail.map((entry) => entry.query)).toEqual(["c", "a", "b"]);
  });

  it("counts every click as non-brand when there is no brand", () => {
    const signals = gscSignals({ brand: "" }, ROWS);
    expect(signals.brandQueries).toBe(0);
    expect(signals.brandClicks).toBe(0);
    expect(signals.nonBrandClicks).toBe(55);
  });

  it("reports nothing it was not given", () => {
    expect(gscSignals({ brand: "Gen" }, [])).toEqual({
      total: 0,
      brandQueries: 0,
      brandClicks: 0,
      nonBrandClicks: 0,
      top: [],
      near: 0,
    });
  });
});

describe("demoAiDoc", () => {
  it("has a scan that would catch the prototype's DEMO_AI text", () => {
    expect(LEAK.test("GenGrowth 是给独立开发者用的 AI 增长工作台")).toBe(true);
    expect(LEAK.test("Pro 版 $29/月支持 5 个站点")).toBe(true);
    expect(LEAK.test("只接 GSC 与 GA4，不囤过期第三方数据")).toBe(true);
  });

  it("never borrows GenGrowth's own facts (R8)", () => {
    for (const profile of PROFILES) {
      expect(JSON.stringify(demoAiDoc(profile))).not.toMatch(LEAK);
    }
  });

  it("builds the summary only from profile fields", () => {
    expect(demoAiDoc(ACME).summary).toBe("[示例] Acme：[一句话定位待补]");
    expect(demoAiDoc(WIDGETS).summary).toBe(
      "[示例] Widgets：inventory software for small warehouses",
    );
    expect(demoAiDoc(NO_BRAND).summary).toBe(
      "[示例] [品牌]：inventory software for small warehouses",
    );
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
      for (const field of [doc.value_props, doc.diff, doc.pillars, doc.facts]) {
        expect(field.length).toBeGreaterThanOrEqual(1);
        expect(field.length).toBeLessThanOrEqual(3);
      }
      expect(doc.value_props.length).toBeGreaterThanOrEqual(2);
      expect(doc.diff.length).toBeGreaterThanOrEqual(2);
      expect(doc.pillars.length).toBeGreaterThanOrEqual(2);
      expect(doc.tone).toBe("[语气待定：先给结论再给理由]");
      for (const text of placeholderStrings(doc)) {
        expect(text).toMatch(/^\[.*\]$/u);
        expect(text).toMatch(/待|需补/u);
        expect(text).not.toMatch(/实测|已核实|已修复/u);
      }
    }
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
      "[内容支柱 2：目标人群的常见问题（待补）]",
    ]);
  });

  it("names a real competitor in the comparison placeholder, never a borrowed one", () => {
    expect(demoAiDoc(WIDGETS).diff[0]).toBe(
      "[差异点 1：Widgets 与 Sortly 相比的不同（待补对比依据）]",
    );
    expect(demoAiDoc(ACME).diff[0]).toBe(
      "[差异点 1：Acme 与 同类产品 相比的不同（待补对比依据）]",
    );
  });

  it("writes one fact per feature, or one pending capability fact", () => {
    expect(demoAiDoc(ACME).facts).toEqual(["[示例事实：Acme 的核心能力待补]"]);
    const facts = demoAiDoc(WIDGETS).facts;
    expect(facts).toEqual(
      splitList(WIDGETS.features).map(
        (feature) => `[示例事实：Widgets 提供 ${feature}，需补证据与核对日期]`,
      ),
    );
  });

  it("uses the brand as the subject when there is one", () => {
    for (const text of [
      ...demoAiDoc(WIDGETS).value_props,
      ...demoAiDoc(WIDGETS).diff,
    ]) {
      expect(text).toContain("Widgets");
    }
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

describe("profile document round-trip", () => {
  it("survives JSON and the strict persisted-state schema", () => {
    for (const profile of PROFILES) {
      const profileDoc: ProfileDoc = {
        crawl: crawlSignals(profile, "crawl"),
        gsc: gscSignals(profile, [
          row("acme pricing", 3, 4),
          row("other", null, null),
        ]),
        third: crawlSignals(profile, "third"),
        ai: demoAiDoc(profile),
        at: AT,
      };
      const state = {
        ...populatedProjectState({
          url: profile.url,
          brand: profile.brand,
          market: profile.market,
        }),
        profile,
        profileDoc,
      };
      const raw: unknown = JSON.parse(
        JSON.stringify({ v: PERSISTED_VERSION, state }),
      );
      expect(parsePersistedState(raw)?.profileDoc).toEqual(profileDoc);
    }
  });
});
