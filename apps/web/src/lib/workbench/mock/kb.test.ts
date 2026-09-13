import { describe, expect, it } from "vitest";
import { PERSISTED_VERSION, parsePersistedState } from "../store/schema.ts";
import { populatedProjectState } from "../store/test-fixtures.ts";
import type { KbEntry, Profile, ProfileDoc } from "../types.ts";
import { fillFirstKbGap, kbGapCount, seedKb } from "./kb.ts";
import { demoAiDoc } from "./profile.ts";
import { splitList } from "./text.ts";

type SeedProfile = Pick<Profile, "url" | "brand" | "positioning" | "features" | "competitors">;

const AT = "2026-09-13 10:00";
const EVIDENCE = "来自站点档案字段";
/** Not the sample's "示例，未核对": a value only this test uses proves seedKb passes the caller's evidence through. */
const AI_EVIDENCE = "测试：AI 草稿证据";
const OPTIONS = { aiEvidence: AI_EVIDENCE } as const;
/** Not GenGrowth, so a borrowed prototype fact cannot hide behind the brand. */
const EMPTY: SeedProfile = { url: "acme.io", brand: "Acme", positioning: "", features: "", competitors: "" };
const FULL: SeedProfile = {
  url: "https://www.widgets.co.uk",
  brand: "Widgets",
  positioning: "inventory software for small warehouses",
  features: "barcode scanning, stock alerts, supplier portal",
  competitors: "Sortly, inFlow, Zoho Inventory, Fishbowl, Cin7",
};
const ONE: SeedProfile = { url: "", brand: "", positioning: "  a shelf planner ", features: "shelf maps", competitors: "Sortly" };
const FOUR_RIVALS: SeedProfile = { ...EMPTY, competitors: "Sortly, inFlow, Zoho Inventory, Fishbowl" };

function docWith(facts: readonly string[]): ProfileDoc {
  const ai = { ...demoAiDoc({ ...EMPTY, url: "", market: "" }), facts };
  return { crawl: null, gsc: null, third: null, ai, at: AT };
}

function demoDoc(): ProfileDoc {
  return { ...docWith([]), ai: demoAiDoc({ ...FULL, url: "widgets.co.uk", market: "GB" }) };
}

function gap(id: string, cat: KbEntry["cat"]): KbEntry {
  return { id, cat, statement: "", evidence: "", source: "", from: "gap" };
}

function manual(id: string, cat: KbEntry["cat"], statement: string): KbEntry {
  return { id, cat, statement, evidence: EVIDENCE, source: "", from: "manual" };
}

function draft(id: string, cat: KbEntry["cat"], statement: string): KbEntry {
  return { id, cat, statement, evidence: AI_EVIDENCE, source: "", from: "aiDraft" };
}

function deepFreeze(entries: readonly KbEntry[]): readonly KbEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

const CASES: readonly (readonly [SeedProfile, ProfileDoc | null])[] = [
  [EMPTY, null],
  [FULL, docWith(["Widgets ships from Leeds", "Widgets has a public API"])],
  [ONE, null],
  [FOUR_RIVALS, docWith([])],
  [FULL, demoDoc()],
];

/** Every pending placeholder shape this codebase generates: the demo site's KB fills (demo.ts) and demoAiDoc's facts. */
const GENERATED_PLACEHOLDERS: readonly (readonly [shape: string, entry: KbEntry])[] = [
  ["demo pricing fill", draft("kb-01", "pricing", "[示例] Acme 的定价方式与各档分别包含什么（待补定价页原句）")],
  ["demo boundary fill", draft("kb-02", "boundary", "[示例] 不适合 Acme 的团队或场景（待补）")],
  ["demo comparison fill", draft("kb-03", "comparison", "[示例] 与 Rival 相比，Acme 的差别（待补对比页原句）")],
  ["demo fill for a blank brand", draft("kb-04", "pricing", "[示例] [品牌] 的定价方式与各档分别包含什么（待补定价页原句）")],
  ["demoAiDoc fact for a feature", draft("kb-05", "data", "[示例事实：Acme 提供 x，需补证据与核对日期]")],
  ["demoAiDoc fact for a feature holding brackets", draft("kb-06", "data", "[示例事实：Acme 提供 a]b（c），需补证据与核对日期]")],
  ["demoAiDoc fact without features", draft("kb-07", "data", "[示例事实：Acme 的核心能力待补]")],
];

describe("seedKb", () => {
  it("seeds only gaps for an empty profile and no document", () => {
    expect(seedKb(EMPTY, null, OPTIONS)).toEqual([gap("kb-01", "definition"), gap("kb-02", "boundary"), gap("kb-03", "pricing")]);
  });

  it("derives manual entries from profile fields, gaps for rivals, AI drafts from facts", () => {
    const doc = docWith(["Widgets ships from Leeds", "Widgets has a public API"]);
    expect(seedKb(FULL, doc, OPTIONS)).toEqual([
      manual("kb-01", "definition", "Widgets 是inventory software for small warehouses"),
      manual("kb-02", "capability", "Widgets 提供 barcode scanning"),
      manual("kb-03", "capability", "Widgets 提供 stock alerts"),
      manual("kb-04", "capability", "Widgets 提供 supplier portal"),
      gap("kb-05", "boundary"),
      gap("kb-06", "pricing"),
      gap("kb-07", "comparison"),
      gap("kb-08", "comparison"),
      gap("kb-09", "comparison"),
      draft("kb-10", "data", "Widgets ships from Leeds"),
      draft("kb-11", "data", "Widgets has a public API"),
    ]);
  });

  it("stamps every AI draft with the evidence its caller passes, and no other entry", () => {
    const doc = docWith(["Widgets ships from Leeds", "Widgets has a public API"]);
    for (const aiEvidence of ["示例，未核对", "模型输出，未核对"]) {
      const entries = seedKb(FULL, doc, { aiEvidence });
      expect(entries.filter((entry) => entry.from === "aiDraft").map((entry) => entry.evidence)).toEqual([aiEvidence, aiEvidence]);
      expect(entries.filter((entry) => entry.from !== "aiDraft").map((entry) => entry.evidence)).not.toContain(aiEvidence);
    }
  });

  it("uses the brand placeholder and keeps the raw positioning in the statement", () => {
    expect(seedKb(ONE, null, OPTIONS)).toEqual([
      manual("kb-01", "definition", "[品牌] 是  a shelf planner "),
      manual("kb-02", "capability", "[品牌] 提供 shelf maps"),
      gap("kb-03", "boundary"),
      gap("kb-04", "pricing"),
      gap("kb-05", "comparison"),
    ]);
  });

  it("treats a whitespace-only positioning as a definition gap", () => {
    expect(seedKb({ ...FULL, positioning: "   " }, null, OPTIONS)[0]).toEqual(gap("kb-01", "definition"));
  });

  it("opens a comparison gap for the first three real competitors only", () => {
    const count = (profile: SeedProfile): number =>
      seedKb(profile, null, OPTIONS).filter((entry) => entry.cat === "comparison").length;
    expect(count(EMPTY)).toBe(0);
    expect(count({ ...EMPTY, competitors: " , ," })).toBe(0);
    expect(count({ ...EMPTY, competitors: "Sortly" })).toBe(1);
    expect(count(FOUR_RIVALS)).toBe(3);
    expect(count(FULL)).toBe(3);
    expect(count({ ...EMPTY, competitors: "Sortly, sortly, SORTLY, inFlow" })).toBe(2);
  });

  it("opens comparison gaps only for compared competitors, never the brand, the own site or a typed placeholder", () => {
    const tricky: SeedProfile = { ...EMPTY, url: "https://acme.io", competitors: "acme, ACME.io, www.acme.io, Rival" };
    const comparisons = (profile: SeedProfile): readonly KbEntry[] =>
      seedKb(profile, null, OPTIONS).filter((entry) => entry.cat === "comparison");
    expect(comparisons(tricky)).toEqual([gap("kb-04", "comparison")]);
    expect(seedKb(tricky, null, OPTIONS)).toEqual(seedKb({ ...tricky, competitors: "Rival" }, null, OPTIONS));
    expect(comparisons({ ...tricky, competitors: "[竞品 B], Rival" })).toEqual([gap("kb-04", "comparison")]);
    for (const competitors of ["ACME", "acme.io", "ACME, www.acme.io", "[竞品 A]", "[竞品 a], acme.io"]) {
      expect(comparisons({ ...tricky, competitors }), competitors).toEqual([]);
    }
  });

  it("adds no data entries without facts, and skips blank facts", () => {
    const cats = (doc: ProfileDoc | null): readonly string[] => seedKb(FULL, doc, OPTIONS).map((entry) => entry.cat);
    expect(cats(null)).not.toContain("data");
    expect(cats(docWith([]))).not.toContain("data");
    const data = seedKb(EMPTY, docWith(["", "  ", "Acme is open source"]), OPTIONS).filter((entry) => entry.cat === "data");
    expect(data).toEqual([draft("kb-04", "data", "Acme is open source")]);
  });

  it("files the demo AI document's facts as AI drafts, never as manual", () => {
    const data = seedKb(FULL, demoDoc(), OPTIONS).filter((entry) => entry.cat === "data");
    expect(data).toHaveLength(splitList(FULL.features).length);
    expect(data.every((entry) => entry.from === "aiDraft")).toBe(true);
  });

  it("holds the provenance invariants for every fixture", () => {
    for (const [profile, doc] of CASES) {
      const entries = seedKb(profile, doc, OPTIONS);
      const rawValues = [profile.positioning, ...splitList(profile.features)].filter((value) => value.trim() !== "");
      expect(entries.map((entry) => entry.id)).toEqual(
        entries.map((_, index) => `kb-${String(index + 1).padStart(2, "0")}`),
      );
      for (const entry of entries) {
        expect(entry.from).not.toBe("crawl");
        expect(Object.keys(entry).sort()).toEqual(["cat", "evidence", "from", "id", "source", "statement"]);
        if (entry.from === "manual") {
          expect(entry.source).toBe("");
          expect(entry.evidence).toBe(EVIDENCE);
          expect(rawValues.some((value) => entry.statement.includes(value))).toBe(true);
        }
        if (entry.from === "gap") expect(entry).toEqual(gap(entry.id, entry.cat));
        if (entry.from === "aiDraft") {
          expect(doc?.ai.facts).toContain(entry.statement);
          expect(entry.evidence).toBe(AI_EVIDENCE);
        }
      }
    }
  });

  it("round-trips through the strict persisted-state schema", () => {
    for (const [profile, doc] of CASES) {
      const kb = { entries: seedKb(profile, doc, OPTIONS), at: AT };
      const state = { ...populatedProjectState({ url: "acme.io", brand: profile.brand, market: "US" }), kb };
      const raw: unknown = JSON.parse(JSON.stringify({ v: PERSISTED_VERSION, state }));
      expect(parsePersistedState(raw)?.kb).toEqual(kb);
    }
  });
});

describe("fillFirstKbGap", () => {
  const PATCH = { statement: "[示例] 定价待补", evidence: "示例，未核对", source: "", from: "aiDraft" } as const;

  it("fills the first empty entry of the category in place of the gap, keeping its id", () => {
    const entries = deepFreeze(seedKb(FULL, null, OPTIONS));
    const snapshot = structuredClone(entries);
    const filled = fillFirstKbGap(entries, "comparison", PATCH, "kb-new");
    expect(filled).not.toBe(entries);
    expect(filled).toHaveLength(entries.length);
    expect(filled[6]).toEqual({ id: "kb-07", cat: "comparison", ...PATCH });
    expect(filled[7]).toEqual(gap("kb-08", "comparison"));
    expect(filled.filter((_, index) => index !== 6)).toEqual(entries.filter((_, index) => index !== 6));
    expect(filled[0]).toBe(entries[0]);
    expect(entries).toEqual(snapshot);
  });

  it("keeps the patch's origin instead of stamping the fill as manual", () => {
    const filled = fillFirstKbGap(deepFreeze(seedKb(EMPTY, null, OPTIONS)), "pricing", PATCH, "kb-new");
    expect(filled.find((entry) => entry.cat === "pricing")?.from).toBe("aiDraft");
    expect(filled.some((entry) => entry.from === "manual")).toBe(false);
  });

  it("treats a whitespace-only statement as a gap", () => {
    const entries = deepFreeze([{ ...gap("kb-01", "boundary"), statement: "  \n" }]);
    expect(fillFirstKbGap(entries, "boundary", PATCH, "kb-new")).toEqual([{ id: "kb-01", cat: "boundary", ...PATCH }]);
  });

  it("fills a blank entry of any origin before a later gap of the same category", () => {
    const entries = deepFreeze([manual("kb-01", "capability", ""), gap("kb-02", "capability")]);
    expect(fillFirstKbGap(entries, "capability", PATCH, "kb-new")).toEqual([
      { id: "kb-01", cat: "capability", ...PATCH },
      gap("kb-02", "capability"),
    ]);
  });

  it("does not overwrite a pending placeholder: only blank statements are filled", () => {
    const pending = draft("kb-01", "pricing", "[示例] Acme 的定价方式与各档分别包含什么（待补定价页原句）");
    const entries = deepFreeze([pending, gap("kb-02", "pricing")]);
    expect(fillFirstKbGap(entries, "pricing", PATCH, "kb-new")).toEqual([pending, { id: "kb-02", cat: "pricing", ...PATCH }]);
  });

  it("appends a new entry when the category has no gap left", () => {
    const entries = deepFreeze(seedKb(FULL, null, OPTIONS));
    const filled = fillFirstKbGap(entries, "capability", PATCH, "kb-demo-capability");
    expect(filled.slice(0, entries.length)).toEqual(entries);
    expect(filled.at(-1)).toEqual({ id: "kb-demo-capability", cat: "capability", ...PATCH });
    expect(fillFirstKbGap(deepFreeze([]), "faq", PATCH, "kb-x")).toEqual([{ id: "kb-x", cat: "faq", ...PATCH }]);
  });

  it("copies only the entry fields from the patch", () => {
    const patch = { ...PATCH, extra: "leak", id: "kb-99", cat: "faq" };
    for (const entries of [deepFreeze(seedKb(EMPTY, null, OPTIONS)), deepFreeze([])]) {
      const filled = fillFirstKbGap(entries, "definition", patch, "kb-new");
      const entry = filled.find((candidate) => candidate.statement === PATCH.statement);
      expect(Object.keys(entry ?? {}).sort()).toEqual(["cat", "evidence", "from", "id", "source", "statement"]);
      expect(entry?.cat).toBe("definition");
      expect(entry?.id).not.toBe("kb-99");
    }
  });
});

describe("kbGapCount", () => {
  it("is null without a knowledge base", () => {
    expect(kbGapCount(null)).toBeNull();
  });

  it("counts entries whose statement is blank, whatever their origin", () => {
    expect(kbGapCount({ entries: [], at: AT })).toBe(0);
    const entries = [
      gap("kb-01", "pricing"),
      { ...gap("kb-02", "faq"), statement: " " },
      manual("kb-03", "definition", "x"),
      manual("kb-04", "faq", "  \n"),
    ];
    expect(kbGapCount({ entries, at: AT })).toBe(3);
    expect(kbGapCount({ entries: seedKb(FULL, null, OPTIONS), at: AT })).toBe(5);
  });

  it("counts every generated placeholder shape as a gap", () => {
    for (const [shape, entry] of GENERATED_PLACEHOLDERS) {
      expect(kbGapCount({ entries: [entry], at: AT }), shape).toBe(1);
    }
    // 5 blank seeds plus the three demo facts.
    expect(kbGapCount({ entries: seedKb(FULL, demoDoc(), OPTIONS), at: AT })).toBe(8);
  });

  it("counts the facts demoAiDoc really generates as gaps, whatever the features say", () => {
    for (const features of ["", "x", "待补货提醒, 无需补充配置, a]b"]) {
      const facts = demoAiDoc({ ...EMPTY, features, market: "US" }).facts;
      const drafts = seedKb(EMPTY, docWith(facts), OPTIONS).filter((entry) => entry.from === "aiDraft");
      expect(drafts.length, features).toBeGreaterThan(0);
      expect(kbGapCount({ entries: drafts, at: AT }), features).toBe(drafts.length);
    }
  });

  it("never counts written text as a gap because it contains 待补 or 需补", () => {
    const entries = [
      manual("kb-01", "definition", "Acme 是无需补充配置的邮件工具"),
      manual("kb-02", "capability", "Acme 提供 待补货提醒"),
      draft("kb-03", "data", "Acme 的待补货提醒无需补充配置"),
      { ...draft("kb-04", "faq", "Acme 需补货时会提醒"), from: "crawl" as const },
    ];
    expect(kbGapCount({ entries, at: AT })).toBe(0);
    const positioned = seedKb({ ...EMPTY, positioning: "无需补充配置的邮件工具" }, null, OPTIONS);
    expect(kbGapCount({ entries: positioned, at: AT })).toBe(2);
  });

  it("never counts a written manual entry as a gap, even one worded like a generated placeholder", () => {
    const entries = GENERATED_PLACEHOLDERS.map(([, entry]) => manual(entry.id, entry.cat, entry.statement));
    expect(kbGapCount({ entries, at: AT })).toBe(0);
  });
});
