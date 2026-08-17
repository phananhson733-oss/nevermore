import { describe, expect, it } from "vitest";

import {
  appendOnPageHistory,
  clearOnPageStorage,
  ON_PAGE_DRAFT_KEY,
  ON_PAGE_DRAFT_TTL_MS,
  ON_PAGE_HISTORY_KEY,
  ON_PAGE_HISTORY_MAX_ENTRIES,
  readOnPageDraft,
  readOnPageHistory,
  storeOnPageDraft,
  type OnPageCheckerStorage,
  type OnPageHistoryEntry,
} from "./storage.ts";

class MemoryStorage implements OnPageCheckerStorage {
  private readonly map = new Map<string, string>();

  constructor(public failOnWrite = false) {}

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) {
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const draftInput = {
  url: "https://example.com/pricing",
  targetQueries: ["pricing", "plans"],
  country: "US",
  locale: "en",
  pageType: "product" as const,
};

function historyEntry(
  overrides: Partial<OnPageHistoryEntry> = {},
): OnPageHistoryEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: 1_000,
    url: "https://example.com/pricing",
    host: "example.com",
    targetQueries: ["pricing"],
    country: "US",
    locale: "en",
    pageType: "product",
    focus: { covered: 4, applicable: 6 },
    coverage: {
      pagesInspected: 12,
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsErrored: 0,
    },
    cacheStatus: "miss",
    ...overrides,
  };
}

describe("on-page draft slot", () => {
  it("stores and resumes what the visitor typed", () => {
    const storage = new MemoryStorage();
    const stored = storeOnPageDraft(storage, draftInput, 1_000);

    expect(stored?.expiresAt).toBe(1_000 + ON_PAGE_DRAFT_TTL_MS);
    expect(readOnPageDraft(storage, 1_001)).toEqual(stored);
  });

  it("forgets an expired draft and deletes it", () => {
    const storage = new MemoryStorage();
    storeOnPageDraft(storage, draftInput, 1_000);

    expect(readOnPageDraft(storage, 1_000 + ON_PAGE_DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.getItem(ON_PAGE_DRAFT_KEY)).toBeNull();
  });

  it("refuses a draft carrying a field it does not recognize", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      ON_PAGE_DRAFT_KEY,
      JSON.stringify({
        ...draftInput,
        createdAt: 1_000,
        expiresAt: 1_000 + ON_PAGE_DRAFT_TTL_MS,
        autoRun: true,
      }),
    );

    // Prefilling from a shape we do not recognize is how a visitor submits a
    // value they never typed.
    expect(readOnPageDraft(storage, 1_001)).toBeNull();
  });

  it.each([
    ["a sixth query", { targetQueries: ["a", "b", "c", "d", "e", "f"] }],
    ["no queries", { targetQueries: [] }],
    ["a lowercase market", { country: "us" }],
    ["an unknown page type", { pageType: "article" }],
    ["an empty url", { url: "   " }],
  ])("rejects %s", (_name, override) => {
    const storage = new MemoryStorage();
    expect(
      storeOnPageDraft(
        storage,
        { ...draftInput, ...override } as typeof draftInput,
        1_000,
      ),
    ).toBeNull();
    expect(storage.getItem(ON_PAGE_DRAFT_KEY)).toBeNull();
  });

  it("survives malformed stored text without throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem(ON_PAGE_DRAFT_KEY, "{not json");

    expect(readOnPageDraft(storage, 1_000)).toBeNull();
    expect(storage.getItem(ON_PAGE_DRAFT_KEY)).toBeNull();
  });

  it("drops a superseded draft slot when it writes", () => {
    const storage = new MemoryStorage();
    storage.setItem("gengrowth:onpage-draft:v0", JSON.stringify({ old: true }));

    storeOnPageDraft(storage, draftInput, 1_000);

    expect(storage.getItem("gengrowth:onpage-draft:v0")).toBeNull();
  });
});

describe("on-page recent checks", () => {
  it("appends a finished check", () => {
    const storage = new MemoryStorage();
    expect(appendOnPageHistory(storage, historyEntry())).toHaveLength(1);
    expect(readOnPageHistory(storage)).toHaveLength(1);
  });

  it("keeps repeats of the same page so a trend is visible", () => {
    const storage = new MemoryStorage();
    appendOnPageHistory(storage, historyEntry({ id: "a", createdAt: 1 }));
    appendOnPageHistory(storage, historyEntry({ id: "b", createdAt: 2 }));

    expect(readOnPageHistory(storage).map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops the oldest past the entry limit", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < ON_PAGE_HISTORY_MAX_ENTRIES + 3; index += 1) {
      appendOnPageHistory(
        storage,
        historyEntry({ id: `entry-${index}`, createdAt: index + 1 }),
      );
    }

    const entries = readOnPageHistory(storage);
    expect(entries).toHaveLength(ON_PAGE_HISTORY_MAX_ENTRIES);
    expect(entries[0]?.id).toBe("entry-3");
    expect(entries.at(-1)?.id).toBe(`entry-${ON_PAGE_HISTORY_MAX_ENTRIES + 2}`);
  });

  it("refuses an entry that is not the shape it claims", () => {
    const storage = new MemoryStorage();
    const broken = { ...historyEntry(), focus: { covered: 1 } };

    expect(
      appendOnPageHistory(storage, broken as unknown as OnPageHistoryEntry),
    ).toEqual([]);
  });

  it("filters bad stored entries without rewriting the list", () => {
    const storage = new MemoryStorage();
    const stored = JSON.stringify([historyEntry(), { id: "broken" }]);
    storage.setItem(ON_PAGE_HISTORY_KEY, stored);

    expect(readOnPageHistory(storage)).toHaveLength(1);
    // A read that repaired storage would let one corrupt entry delete the rest
    // on a page the visitor only opened.
    expect(storage.getItem(ON_PAGE_HISTORY_KEY)).toBe(stored);
  });

  it("treats unreadable storage as no history rather than failing", () => {
    const storage = new MemoryStorage();
    storage.setItem(ON_PAGE_HISTORY_KEY, "[[[");

    expect(readOnPageHistory(storage)).toEqual([]);
  });

  it("keeps the run alive when the quota refuses the write", () => {
    const storage = new MemoryStorage();
    appendOnPageHistory(storage, historyEntry({ id: "kept", createdAt: 1 }));
    storage.failOnWrite = true;

    // The list is a convenience; the answer the visitor asked for is not.
    expect(() =>
      appendOnPageHistory(storage, historyEntry({ id: "new", createdAt: 2 })),
    ).not.toThrow();
    expect(readOnPageHistory(storage).map((entry) => entry.id)).toEqual([
      "kept",
    ]);
  });
});

describe("clearOnPageStorage", () => {
  it("removes every owned key from both storages", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    appendOnPageHistory(local, historyEntry());
    storeOnPageDraft(session, draftInput, 1_000);
    local.setItem("gg-theme", "dark");

    clearOnPageStorage(local, session);

    expect(local.getItem(ON_PAGE_HISTORY_KEY)).toBeNull();
    expect(session.getItem(ON_PAGE_DRAFT_KEY)).toBeNull();
    // Someone else's key is not ours to delete.
    expect(local.getItem("gg-theme")).toBe("dark");
  });

  it("removes a slot added after this clear was written", () => {
    const local = new MemoryStorage();
    local.setItem("gengrowth:onpage-something-new:v9", "value");

    clearOnPageStorage(local);

    expect(local.getItem("gengrowth:onpage-something-new:v9")).toBeNull();
  });

  it("tolerates a missing storage", () => {
    expect(() => clearOnPageStorage(null, undefined)).not.toThrow();
  });
});
