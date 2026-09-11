import { describe, expect, it } from "vitest";
import type { WorkbenchProjectState } from "../types.ts";
import { initialProjectState } from "./reducer.ts";
import { PERSISTED_VERSION } from "./schema.ts";
import { populatedProjectState } from "./test-fixtures.ts";
import {
  clearAllWorkbenchState,
  clearProjectState,
  readProjectState,
  storageKey,
  writeProjectState,
} from "./persistence.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };
const PID = "00000000-0000-4000-8000-000000000042";

function fakeStorage(initial: Record<string, string> = {}): Storage & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); },
  };
}

/**
 * A real `Storage` with some members replaced — no cast, so a wrong member
 * signature is a type error. Descriptors are copied rather than spread, or a
 * throwing `length` getter would fire here instead of inside the call under test.
 */
function withOverrides(overrides: Partial<Storage>): Storage {
  return Object.defineProperties(fakeStorage(), Object.getOwnPropertyDescriptors(overrides));
}

describe("persistence", () => {
  it("uses a versioned, project-scoped key", () => {
    expect(storageKey(PID)).toBe(`gg.workbench.v1.${PID}`);
    expect(storageKey(PID)).toContain(`.v${PERSISTED_VERSION}.`);
  });

  it("round-trips a state", () => {
    const storage = fakeStorage();
    const state = initialProjectState(seed);
    expect(writeProjectState(storage, PID, state)).toBe("ok");
    expect(readProjectState(storage, PID)).toEqual({ status: "ok", state });
  });

  it("round-trips a populated state through JSON", () => {
    const storage = fakeStorage();
    const state = populatedProjectState(seed);
    expect(writeProjectState(storage, PID, state)).toBe("ok");
    expect(readProjectState(storage, PID)).toEqual({ status: "ok", state });
  });

  it("reports empty when nothing is stored", () => {
    expect(readProjectState(fakeStorage(), PID)).toEqual({ status: "empty", state: null });
  });

  it("discards invalid JSON, wrong version and wrong shape", () => {
    const wrongVersion = JSON.stringify({ v: PERSISTED_VERSION + 1, state: initialProjectState(seed) });
    const wrongShape = JSON.stringify({ v: PERSISTED_VERSION, state: { demo: true } });
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: "{nope" }), PID).status).toBe("invalid");
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: wrongVersion }), PID).status).toBe("invalid");
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: wrongShape }), PID).status).toBe("invalid");
  });

  it("a non-finite number makes the write unreadable (JSON turns it into null)", () => {
    const storage = fakeStorage();
    const state: WorkbenchProjectState = {
      ...initialProjectState(seed),
      audit: {
        at: "t", score: Number.NaN, findings: [],
        crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "1", schema: 1, llmReadable: 1 },
        pageRows: [],
      },
    };
    expect(writeProjectState(storage, PID, state)).toBe("ok");
    expect(readProjectState(storage, PID).status).toBe("invalid");
  });

  it("reports unavailable when storage throws on read or write", () => {
    const throwing = withOverrides({
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    });
    expect(readProjectState(throwing, PID).status).toBe("unavailable");
    expect(writeProjectState(throwing, PID, initialProjectState(seed))).toBe("unavailable");
  });

  it("reports quota for every spelling browsers use", () => {
    const thrown = (error: unknown) =>
      writeProjectState(withOverrides({ setItem: () => { throw error; } }), PID, initialProjectState(seed));
    expect(thrown(new DOMException("full", "QuotaExceededError"))).toBe("quota");
    expect(thrown({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe("quota");
    expect(thrown({ code: 1014 })).toBe("quota");
    expect(thrown({ code: 22 })).toBe("quota");
  });

  it("reports unavailable for a failure that is not a quota error", () => {
    const boom = withOverrides({ setItem: () => { throw new Error("boom"); } });
    expect(writeProjectState(boom, PID, initialProjectState(seed))).toBe("unavailable");
  });

  it("clearProjectState removes one project and leaves its siblings", () => {
    const storage = fakeStorage({ other: "1" });
    writeProjectState(storage, PID, initialProjectState(seed));
    writeProjectState(storage, "p2", initialProjectState(seed));
    clearProjectState(storage, PID);
    expect(storage.map.has(storageKey(PID))).toBe(false);
    expect(storage.map.has(storageKey("p2"))).toBe(true);
    expect(storage.map.has("other")).toBe(true);
  });

  it("clearAllWorkbenchState sweeps every version and adjacent key, and nothing else", () => {
    const storage = fakeStorage({
      other: "1",
      [storageKey("a")]: "a",
      [storageKey("b")]: "b",
      [storageKey("c")]: "c",
      [`gg.workbench.v0.${PID}`]: "old",
      "gg.other.v1.x": "x",
    });
    clearAllWorkbenchState(storage);
    expect([...storage.map.keys()]).toEqual(["other", "gg.other.v1.x"]);
  });

  it("clearAllWorkbenchState removes the rest when one key refuses to go", () => {
    const stubborn = storageKey("b");
    const base = fakeStorage({
      [storageKey("a")]: "a",
      [stubborn]: "b",
      [storageKey("c")]: "c",
    });
    const storage = withOverrides({
      removeItem: (k) => {
        if (k === stubborn) throw new Error("locked");
        base.map.delete(k);
      },
      get length() { return base.length; },
      key: (i) => base.key(i),
    });
    expect(() => { clearAllWorkbenchState(storage); }).not.toThrow();
    expect([...base.map.keys()]).toEqual([stubborn]);
  });

  it("clearAllWorkbenchState does not throw when the length getter throws", () => {
    const storage = withOverrides({ get length(): number { throw new Error("SecurityError"); } });
    expect(() => { clearAllWorkbenchState(storage); }).not.toThrow();
  });

  it("clearProjectState does not throw when removeItem throws", () => {
    const storage = withOverrides({ removeItem: () => { throw new Error("SecurityError"); } });
    expect(() => { clearProjectState(storage, PID); }).not.toThrow();
  });
});
