import { describe, expect, it, vi } from "vitest";
import {
  GEO_COMPETITOR_IDENTITY_CACHE_NAMESPACE,
  GEO_COMPETITOR_IDENTITY_TTL_SECONDS,
  normalizeCompetitorDomain,
  readCachedCompetitorIdentity,
  writeCachedCompetitorIdentity,
} from "./kb-competitor-identity-cache.ts";

const CAPTURED_AT = "2026-09-07T06:00:00.000Z";

function cachedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "geo-competitor-identity.v1",
    domain: "rival.test",
    brandName: "Rival",
    aliases: ["Rival Inc"],
    observedAt: "2026-09-07T05:00:00.000Z",
    ...overrides,
  };
}

describe("competitor domain identity", () => {
  it("accepts a bare host or a url and lowercases it", () => {
    expect(normalizeCompetitorDomain("Rival.Test")).toBe("rival.test");
    expect(normalizeCompetitorDomain(" https://Rival.Test/pricing?x=1 ")).toBe("rival.test");
    expect(normalizeCompetitorDomain("rival.test.")).toBe("rival.test");
  });

  it("keeps www apart from the apex, because their pages can differ", () => {
    expect(normalizeCompetitorDomain("www.rival.test")).toBe("www.rival.test");
  });

  it("rejects anything that is not a host", () => {
    expect(normalizeCompetitorDomain("")).toBeNull();
    expect(normalizeCompetitorDomain("localhost")).toBeNull();
    expect(normalizeCompetitorDomain("http://")).toBeNull();
  });
});

describe("reading a shared competitor identity", () => {
  it("reads the geo namespace with a 24h ceiling", async () => {
    const readCache = vi.fn(async () => ({ payload: cachedPayload(), capturedAt: CAPTURED_AT }));
    const identity = await readCachedCompetitorIdentity("https://rival.test/", {
      readCache,
      writeCache: vi.fn(),
    });
    expect(identity).toEqual({
      domain: "rival.test",
      brandName: "Rival",
      aliases: ["Rival Inc"],
      observedAt: "2026-09-07T05:00:00.000Z",
    });
    expect(readCache).toHaveBeenCalledWith(GEO_COMPETITOR_IDENTITY_CACHE_NAMESPACE, "rival.test", 24 * 60 * 60);
    expect(GEO_COMPETITOR_IDENTITY_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it("never hands one domain's identity back for another", async () => {
    const readCache = vi.fn(async () => ({ payload: cachedPayload({ domain: "other.test" }), capturedAt: CAPTURED_AT }));
    expect(await readCachedCompetitorIdentity("rival.test", { readCache, writeCache: vi.fn() })).toBeNull();
  });

  it("treats an unreadable or unrecognisable row as a miss, so the caller crawls", async () => {
    const missing = vi.fn(async () => null);
    expect(await readCachedCompetitorIdentity("rival.test", { readCache: missing, writeCache: vi.fn() })).toBeNull();

    const wrongShape = vi.fn(async () => ({ payload: { brandName: "Rival" }, capturedAt: CAPTURED_AT }));
    expect(await readCachedCompetitorIdentity("rival.test", { readCache: wrongShape, writeCache: vi.fn() })).toBeNull();

    const thrown = vi.fn(async () => {
      throw new Error("store down");
    });
    expect(await readCachedCompetitorIdentity("rival.test", { readCache: thrown, writeCache: vi.fn() })).toBeNull();
  });

  it("does not consult the store for a domain it cannot name", async () => {
    const readCache = vi.fn();
    expect(await readCachedCompetitorIdentity("localhost", { readCache, writeCache: vi.fn() })).toBeNull();
    expect(readCache).not.toHaveBeenCalled();
  });
});

describe("writing a shared competitor identity", () => {
  it("stores a self-describing payload under the exact host", async () => {
    const writeCache = vi.fn(async () => undefined);
    await writeCachedCompetitorIdentity(
      {
        domain: "https://Rival.Test/pricing",
        brandName: "Rival",
        aliases: ["Rival Inc", "Rival Inc", "Rival Software"],
        observedAt: "2026-09-07T05:00:00.000Z",
      },
      { readCache: vi.fn(), writeCache },
    );
    expect(writeCache).toHaveBeenCalledWith(GEO_COMPETITOR_IDENTITY_CACHE_NAMESPACE, "rival.test", {
      schemaVersion: "geo-competitor-identity.v1",
      domain: "rival.test",
      brandName: "Rival",
      aliases: ["Rival Inc", "Rival Software"],
      observedAt: "2026-09-07T05:00:00.000Z",
    });
  });

  it("writes nothing it could not read back", async () => {
    const writeCache = vi.fn();
    const base = { brandName: "Rival", aliases: [], observedAt: "2026-09-07T05:00:00.000Z" };
    await writeCachedCompetitorIdentity({ ...base, domain: "localhost" }, { readCache: vi.fn(), writeCache });
    await writeCachedCompetitorIdentity(
      { ...base, domain: "rival.test", observedAt: "whenever" },
      { readCache: vi.fn(), writeCache },
    );
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("does not turn a failed cache write into a failed run", async () => {
    const writeCache = vi.fn(async () => {
      throw new Error("store down");
    });
    await expect(
      writeCachedCompetitorIdentity(
        { domain: "rival.test", brandName: null, aliases: [], observedAt: "2026-09-07T05:00:00.000Z" },
        { readCache: vi.fn(), writeCache },
      ),
    ).resolves.toBeUndefined();
  });
});
