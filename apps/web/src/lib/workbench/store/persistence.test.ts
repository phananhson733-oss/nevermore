import { describe, expect, it } from "vitest";
import { initialProjectState } from "./reducer.ts";
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

describe("persistence", () => {
  it("uses a versioned, project-scoped key", () => {
    expect(storageKey(PID)).toBe(`gg.workbench.v1.${PID}`);
  });

  it("round-trips a state", () => {
    const storage = fakeStorage();
    const state = initialProjectState(seed);
    expect(writeProjectState(storage, PID, state)).toBe("ok");
    expect(readProjectState(storage, PID)).toEqual({ status: "ok", state });
  });

  it("reports empty when nothing is stored", () => {
    expect(readProjectState(fakeStorage(), PID)).toEqual({ status: "empty", state: null });
  });

  it("discards invalid JSON, wrong version and wrong shape", () => {
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: "{nope" }), PID).status).toBe("invalid");
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: JSON.stringify({ v: 9, state: {} }) }), PID).status).toBe("invalid");
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: JSON.stringify({ v: 1, state: { demo: true } }) }), PID).status).toBe("invalid");
  });

  it("reports unavailable when storage throws on read or write", () => {
    const throwing = {
      ...fakeStorage(),
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    } as unknown as Storage;
    expect(readProjectState(throwing, PID).status).toBe("unavailable");
    expect(writeProjectState(throwing, PID, initialProjectState(seed))).toBe("unavailable");
  });

  it("reports quota when setItem throws a QuotaExceededError", () => {
    const quota = {
      ...fakeStorage(),
      setItem: () => { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; },
    } as unknown as Storage;
    expect(writeProjectState(quota, PID, initialProjectState(seed))).toBe("quota");
  });

  it("clears one project or every workbench key, leaving other keys alone", () => {
    const storage = fakeStorage({ other: "1" });
    writeProjectState(storage, PID, initialProjectState(seed));
    writeProjectState(storage, "p2", initialProjectState(seed));
    clearProjectState(storage, PID);
    expect(storage.map.has(storageKey(PID))).toBe(false);
    expect(storage.map.has(storageKey("p2"))).toBe(true);
    clearAllWorkbenchState(storage);
    expect([...storage.map.keys()]).toEqual(["other"]);
  });
});
