// @input  -- a fake storage, a fixed clock, and the package's contract-valid brief fixture
// @output -- proof the brief → draft handoff is versioned, TTL-pinned, size-bounded,
//            consumed once, and parseable by the draft page's exact parser
// @pos    -- the write half of handoff §5.1's main path; the read half is parseContentBriefHandoff

import { describe, expect, it } from "vitest";
import {
  CONTENT_BRIEF_HANDOFF_KEY,
  CONTENT_BRIEF_HANDOFF_MAX_BYTES,
  CONTENT_BRIEF_HANDOFF_TTL_MS,
} from "@sf/public-tools/content-brief/contract";
import {
  contentBriefFixture,
  withFingerprint,
} from "@sf/public-tools/content-brief/fixtures";
import { parseContentBriefHandoff } from "@sf/public-tools/content-brief/parse-brief";

import {
  takeContentBriefHandoff,
  writeContentBriefHandoff,
} from "./content-brief-handoff.ts";

function fakeStorage(options: { readonly throwOnSet?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.throwOnSet) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

const NOW = Date.UTC(2026, 7, 29, 10, 0, 0);

describe("writeContentBriefHandoff", () => {
  it("stores a version-1 envelope whose expiry is exactly created_at + TTL", async () => {
    const storage = fakeStorage();
    const brief = await withFingerprint(contentBriefFixture());
    const written = writeContentBriefHandoff(storage, NOW, brief);
    expect(written.ok).toBe(true);
    const stored = JSON.parse(storage.map.get(CONTENT_BRIEF_HANDOFF_KEY) ?? "null") as {
      version: number;
      created_at: number;
      expires_at: number;
      brief: unknown;
    };
    expect(stored.version).toBe(1);
    expect(stored.created_at).toBe(NOW);
    expect(stored.expires_at).toBe(NOW + CONTENT_BRIEF_HANDOFF_TTL_MS);
    expect(stored.brief).toEqual(brief);
  });

  it("writes what the draft page's exact parser accepts", async () => {
    const storage = fakeStorage();
    const brief = await withFingerprint(contentBriefFixture());
    writeContentBriefHandoff(storage, NOW, brief);
    const raw = takeContentBriefHandoff(storage);
    const parsed = await parseContentBriefHandoff(JSON.parse(raw ?? "null"), {
      now: () => NOW + 1_000,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.brief.run.fingerprint).toBe(brief.run.fingerprint);
  });

  it("refuses a brief over the byte cap without touching storage", async () => {
    const storage = fakeStorage();
    const brief = await withFingerprint(contentBriefFixture());
    const padding = "x".repeat(CONTENT_BRIEF_HANDOFF_MAX_BYTES);
    const oversized = { ...brief, keyword: { ...brief.keyword, primary: padding } };
    const written = writeContentBriefHandoff(storage, NOW, oversized);
    expect(written).toMatchObject({ ok: false, reason: "too_large" });
    expect(storage.map.size).toBe(0);
  });

  it("reports a storage failure instead of throwing", async () => {
    const storage = fakeStorage({ throwOnSet: true });
    const brief = await withFingerprint(contentBriefFixture());
    expect(writeContentBriefHandoff(storage, NOW, brief)).toMatchObject({
      ok: false,
      reason: "storage",
    });
  });
});

describe("takeContentBriefHandoff", () => {
  it("returns the raw string once and removes it", () => {
    const storage = fakeStorage();
    storage.setItem(CONTENT_BRIEF_HANDOFF_KEY, "{}");
    expect(takeContentBriefHandoff(storage)).toBe("{}");
    expect(takeContentBriefHandoff(storage)).toBeNull();
  });

  it("returns null when storage itself is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(takeContentBriefHandoff(broken)).toBeNull();
  });
});
