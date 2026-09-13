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
  return { id, cat, statement, evidence: "", source: "", from: "aiDraft" };
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

describe("seedKb", () => {
  it("seeds only gaps for an empty profile and no document", () => {
    expect(seedKb(EMPTY, null)).toEqual([gap("kb-01", "definition"), gap("kb-02", "boundary"), gap("kb-03", "pricing")]);
  });

  it("derives manual entries from profile fields, gaps for rivals, AI drafts from facts", () => {
    const doc = docWith(["Widgets ships from Leeds", "Widgets has a public API"]);
    expect(seedKb(FULL, doc)).toEqual([
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

  it("uses the brand placeholder and keeps the raw positioning in the statement", () => {
    expect(seedKb(ONE, null)).toEqual([
      manual("kb-01", "definition", "[品牌] 是  a shelf planner "),
      manual("kb-02", "capability", "[品牌] 提供 shelf maps"),
      gap("kb-03", "boundary"),
      gap("kb-04", "pricing"),
      gap("kb-05", "comparison"),
    ]);
  });

  it("treats a whitespace-only positioning as a definition gap", () => {
    expect(seedKb({ ...FULL, positioning: "   " }, null)[0]).toEqual(gap("kb-01", "definition"));
  });

  it("opens a comparison gap for the first three real competitors only", () => {
    const count = (profile: SeedProfile): number =>
      seedKb(profile, null).filter((entry) => entry.cat === "comparison").length;
    expect(count(EMPTY)).toBe(0);
    expect(count({ ...EMPTY, competitors: " , ," })).toBe(0);
    expect(count({ ...EMPTY, competitors: "Sortly" })).toBe(1);
    expect(count(FOUR_RIVALS)).toBe(3);
    expect(count(FULL)).toBe(3);
    expect(count({ ...EMPTY, competitors: "Sortly, sortly, SORTLY, inFlow" })).toBe(2);
  });

  it("opens comparison gaps only for compared competitors, never the brand or the own site", () => {
    const tricky: SeedProfile = { ...EMPTY, url: "https://acme.io", competitors: "acme, ACME.io, www.acme.io, Rival" };
    const comparisons = (profile: SeedProfile): readonly KbEntry[] => seedKb(profile, null).filter((entry) => entry.cat === "comparison");
    expect(comparisons(tricky)).toEqual([gap("kb-04", "comparison")]);
    expect(seedKb(tricky, null)).toEqual(seedKb({ ...tricky, competitors: "Rival" }, null));
    for (const competitors of ["ACME", "acme.io", "ACME, www.acme.io"]) {
      expect(comparisons({ ...tricky, competitors }), competitors).toEqual([]);
    }
  });

  it("adds no data entries without facts, and skips blank facts", () => {
    const cats = (doc: ProfileDoc | null): readonly string[] => seedKb(FULL, doc).map((entry) => entry.cat);
    expect(cats(null)).not.toContain("data");
    expect(cats(docWith([]))).not.toContain("data");
    const data = seedKb(EMPTY, docWith(["", "  ", "Acme is open source"])).filter((entry) => entry.cat === "data");
    expect(data).toEqual([draft("kb-04", "data", "Acme is open source")]);
  });

  it("files the demo AI document's facts as AI drafts, never as manual", () => {
    const data = seedKb(FULL, demoDoc()).filter((entry) => entry.cat === "data");
    expect(data).toHaveLength(splitList(FULL.features).length);
    expect(data.every((entry) => entry.from === "aiDraft")).toBe(true);
  });

  it("holds the provenance invariants for every fixture", () => {
    for (const [profile, doc] of CASES) {
      const entries = seedKb(profile, doc);
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
        if (entry.from === "aiDraft") expect(doc?.ai.facts).toContain(entry.statement);
      }
    }
  });

  it("round-trips through the strict persisted-state schema", () => {
    for (const [profile, doc] of CASES) {
      const kb = { entries: seedKb(profile, doc), at: AT };
      const state = { ...populatedProjectState({ url: "acme.io", brand: profile.brand, market: "US" }), kb };
      const raw: unknown = JSON.parse(JSON.stringify({ v: PERSISTED_VERSION, state }));
      expect(parsePersistedState(raw)?.kb).toEqual(kb);
    }
  });
});

describe("fillFirstKbGap", () => {
  const PATCH = { statement: "[示例] 定价待补", evidence: "示例，未核对", source: "", from: "aiDraft" } as const;

  it("fills the first empty entry of the category in place of the gap, keeping its id", () => {
    const entries = deepFreeze(seedKb(FULL, null));
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
    const filled = fillFirstKbGap(deepFreeze(seedKb(EMPTY, null)), "pricing", PATCH, "kb-new");
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
    const entries = deepFreeze(seedKb(FULL, null));
    const filled = fillFirstKbGap(entries, "capability", PATCH, "kb-demo-capability");
    expect(filled.slice(0, entries.length)).toEqual(entries);
    expect(filled.at(-1)).toEqual({ id: "kb-demo-capability", cat: "capability", ...PATCH });
    expect(fillFirstKbGap(deepFreeze([]), "faq", PATCH, "kb-x")).toEqual([{ id: "kb-x", cat: "faq", ...PATCH }]);
  });

  it("copies only the entry fields from the patch", () => {
    const patch = { ...PATCH, extra: "leak", id: "kb-99", cat: "faq" };
    for (const entries of [deepFreeze(seedKb(EMPTY, null)), deepFreeze([])]) {
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

  it("counts entries whose statement is blank", () => {
    expect(kbGapCount({ entries: [], at: AT })).toBe(0);
    const entries = [gap("kb-01", "pricing"), { ...gap("kb-02", "faq"), statement: " " }, manual("kb-03", "definition", "x")];
    expect(kbGapCount({ entries, at: AT })).toBe(2);
    expect(kbGapCount({ entries: seedKb(FULL, null), at: AT })).toBe(5);
  });

  it("also counts pending placeholders (待补 / 需补) as gaps", () => {
    const entries = [
      draft("kb-01", "pricing", "[示例] Acme 的定价方式与各档分别包含什么（待补定价页原句）"),
      draft("kb-02", "data", "[示例事实：Acme 提供 x，需补证据与核对日期]"),
      manual("kb-03", "capability", "Acme 提供 待办清单"),
    ];
    expect(kbGapCount({ entries, at: AT })).toBe(2);
    // 5 blank seeds plus the three demo facts, each marked 需补.
    expect(kbGapCount({ entries: seedKb(FULL, demoDoc()), at: AT })).toBe(8);
  });
});
