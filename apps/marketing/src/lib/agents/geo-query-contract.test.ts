// @input  -- a generated core_8 set and hand-broken variants of it
// @output -- proof the guard refuses unmeasured, unbounded or misordered query sets
// @pos    -- focused tests for the versioned GEO query contract

import { describe, expect, it } from "vitest";

import { confirmGeoContext, type GeoContextInputV1 } from "./geo-context.ts";
import {
  geoPlannedCallCount,
  geoPromptByteLength,
  geoQuerySetContentHash,
  isGeoQuerySetConfirmed,
  isGeoQuerySetV1,
  isPayableGeoQueryText,
  GEO_CORE_QUERY_COUNT,
  GEO_CORE_SLOTS,
  GEO_MAX_QUERY_TEXT_LENGTH,
  type GeoQuerySetV1,
  type GeoQueryUnitV1,
} from "./geo-query-contract.ts";
import {
  buildGeoCoreQuerySet,
  confirmGeoQuerySet,
} from "./geo-questions.ts";

const CLOCK = (): Date => new Date("2026-08-18T09:00:00.000Z");

const CONTEXT_INPUT: GeoContextInputV1 = {
  targetUrl: "https://acme.test/",
  productName: "Acme Analytics",
  brandAliases: [
    { alias: "Acme Analytics", source: "profile_product_name", confirmed: true },
  ],
  category: "AI visibility tracking",
  categoryConfirmed: true,
  buyer: "SaaS marketing teams",
  user: "Growth leads",
  jtbd: "Know whether assistants cite the site.",
  useCases: ["Track assistant citations"],
  outcomes: ["Appear in assistant answers"],
  barriers: [],
  directCompetitors: ["Profound", "Peec AI"],
  indirectAlternatives: [],
  marketCode: "US",
  targetQueryLanguage: "en",
  sourceProfileVersion: "agent-profile.v3",
  sourceSummary: [
    { field: "category", source: "user_edit", limitationCode: null },
  ],
};

async function baseSet(): Promise<GeoQuerySetV1> {
  const context = await confirmGeoContext(CONTEXT_INPUT, CLOCK);
  if (!context.ok) throw new Error("context fixture did not confirm");
  const built = await buildGeoCoreQuerySet(context.snapshot, CLOCK);
  if (!built.ok) throw new Error("query set fixture did not build");
  return built.querySet;
}

function withQuery(
  set: GeoQuerySetV1,
  index: number,
  patch: Partial<GeoQueryUnitV1>,
): GeoQuerySetV1 {
  return {
    ...set,
    queries: set.queries.map((query, position) =>
      position === index ? { ...query, ...patch } : query,
    ),
  };
}

describe("isGeoQuerySetV1", () => {
  it("accepts the generated core_8", async () => {
    expect(isGeoQuerySetV1(await baseSet())).toBe(true);
  });

  it("counts exactly eighteen planned provider calls", async () => {
    const set = await baseSet();

    expect(set.queries).toHaveLength(GEO_CORE_QUERY_COUNT);
    // Five retrieval probes at three samples plus three natural-demand
    // questions at one. The uniform policy is broken on purpose.
    expect(geoPlannedCallCount(set)).toBe(18);
    expect(
      set.queries.filter((query) => query.mode === "retrieval_probe"),
    ).toHaveLength(5);
    expect(
      set.queries.filter((query) => query.mode === "natural_demand"),
    ).toHaveLength(3);
  });

  it("covers every core slot exactly once, in declared order", async () => {
    const set = await baseSet();

    expect(set.queries.map((query) => query.slot)).toEqual([...GEO_CORE_SLOTS]);
  });

  it.each([
    ["an unknown extra key", (set: GeoQuerySetV1) => ({ ...set, extra: 1 })],
    [
      "a wrong schema version",
      (set: GeoQuerySetV1) => ({ ...set, schemaVersion: "geo_query_set.v2" }),
    ],
    [
      "a non-English query language",
      (set: GeoQuerySetV1) => ({ ...set, queryLanguageTag: "zh" }),
    ],
    [
      "an EU pseudo-market",
      (set: GeoQuerySetV1) => ({ ...set, marketCode: "EU" }),
    ],
    [
      "a non-digest context hash",
      (set: GeoQuerySetV1) => ({ ...set, contextHash: "abc" }),
    ],
    ["a zero version", (set: GeoQuerySetV1) => ({ ...set, version: 0 })],
    [
      "seven core queries",
      (set: GeoQuerySetV1) => ({ ...set, queries: set.queries.slice(1) }),
    ],
    [
      "a duplicated slot",
      (set: GeoQuerySetV1) => ({
        ...set,
        queries: [set.queries[0]!, ...set.queries.slice(2), set.queries[0]!],
      }),
    ],
    [
      "core queries out of slot order",
      (set: GeoQuerySetV1) => ({
        ...set,
        queries: [...set.queries].reverse(),
      }),
    ],
  ] as const)("refuses %s", async (_label, mutate) => {
    expect(isGeoQuerySetV1(mutate(await baseSet()))).toBe(false);
  });

  it("refuses a market that disagrees between set and query", async () => {
    const set = await baseSet();

    expect(isGeoQuerySetV1(withQuery(set, 0, { marketCode: "GB" }))).toBe(false);
  });

  it("refuses a retrieval probe with the wrong sample count", async () => {
    const set = await baseSet();
    const index = set.queries.findIndex((q) => q.mode === "retrieval_probe");

    expect(isGeoQuerySetV1(withQuery(set, index, { samplesPlanned: 1 }))).toBe(
      false,
    );
  });

  it("refuses a natural-demand question that claims three samples", async () => {
    const set = await baseSet();
    const index = set.queries.findIndex((q) => q.mode === "natural_demand");

    expect(isGeoQuerySetV1(withQuery(set, index, { samplesPlanned: 3 }))).toBe(
      false,
    );
  });

  it("refuses a retrieval probe with no registry link", async () => {
    const set = await baseSet();
    const index = set.queries.findIndex((q) => q.mode === "retrieval_probe");

    expect(
      isGeoQuerySetV1(
        withQuery(set, index, { templateId: null, templateVersion: null }),
      ),
    ).toBe(false);
  });

  it("refuses a retrieval probe pointing at an unknown template", async () => {
    const set = await baseSet();
    const index = set.queries.findIndex((q) => q.mode === "retrieval_probe");

    expect(
      isGeoQuerySetV1(withQuery(set, index, { templateId: "geo.made.up" })),
    ).toBe(false);
  });

  it("refuses a retrieval probe the visitor edited", async () => {
    // Editing voids the measurement. The question may still be asked, but not
    // as a retrieval probe whose citation counts claim to mean something.
    const set = await baseSet();
    const index = set.queries.findIndex((q) => q.mode === "retrieval_probe");

    expect(isGeoQuerySetV1(withQuery(set, index, { source: "user_edit" }))).toBe(
      false,
    );
  });

  it("refuses a trigger clause that is not in the sentence it describes", async () => {
    const set = await baseSet();

    expect(
      isGeoQuerySetV1(
        withQuery(set, 0, { retrievalTriggerClause: "not in this text" }),
      ),
    ).toBe(false);
  });

  it("refuses a trigger clause on a natural-demand question", async () => {
    const set = await baseSet();
    const index = set.queries.findIndex((q) => q.mode === "natural_demand");
    const query = set.queries[index]!;

    expect(
      isGeoQuerySetV1(
        withQuery(set, index, {
          retrievalTriggerClause: query.text.slice(0, 10),
        }),
      ),
    ).toBe(false);
  });

  it("requires an asOf anchor on a time-sensitive question", async () => {
    const set = await baseSet();
    const index = set.queries.findIndex((q) => q.timeSensitive);

    expect(index).toBeGreaterThanOrEqual(0);
    expect(isGeoQuerySetV1(withQuery(set, index, { asOf: null }))).toBe(false);
  });

  it("refuses an asOf anchor on a question that is not time-sensitive", async () => {
    const set = await baseSet();
    const index = set.queries.findIndex((q) => !q.timeSensitive);

    expect(index).toBeGreaterThanOrEqual(0);
    expect(
      isGeoQuerySetV1(
        withQuery(set, index, { asOf: "2026-08-18T09:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("refuses asset types out of canonical order", async () => {
    const set = await baseSet();
    const reversed = [...set.queries[0]!.expectedAssetTypes].reverse();

    expect(
      isGeoQuerySetV1(withQuery(set, 0, { expectedAssetTypes: reversed })),
    ).toBe(false);
  });
});

describe("payability", () => {
  it("counts both characters and UTF-8 bytes", () => {
    const ascii = "a".repeat(GEO_MAX_QUERY_TEXT_LENGTH);
    const accented = "é".repeat(GEO_MAX_QUERY_TEXT_LENGTH / 2 + 1);

    expect(isPayableGeoQueryText(ascii)).toBe(true);
    expect(isPayableGeoQueryText(`${ascii}a`)).toBe(false);
    // 251 accented characters are 502 UTF-8 bytes. The provider's counting unit
    // has never been verified, so the conservative reading wins.
    expect(accented.length).toBeLessThanOrEqual(GEO_MAX_QUERY_TEXT_LENGTH);
    expect(geoPromptByteLength(accented)).toBeGreaterThan(
      GEO_MAX_QUERY_TEXT_LENGTH,
    );
    expect(isPayableGeoQueryText(accented)).toBe(false);
  });

  it("refuses an over-long question in the guard too", async () => {
    const set = await baseSet();

    expect(
      isGeoQuerySetV1(
        withQuery(set, 0, { text: "a".repeat(GEO_MAX_QUERY_TEXT_LENGTH + 1) }),
      ),
    ).toBe(false);
  });
});

describe("the query-set content fingerprint", () => {
  it("is reproducible from the set alone", async () => {
    const set = await baseSet();

    await expect(geoQuerySetContentHash(set)).resolves.toBe(
      set.querySetContentHash,
    );
  });

  it("changes when a question's text changes", async () => {
    const set = await baseSet();
    const edited = withQuery(set, 0, { text: "What are the top tools today?" });

    await expect(geoQuerySetContentHash(edited)).resolves.not.toBe(
      set.querySetContentHash,
    );
  });

  it("does not change when the visitor ticks the confirmation box", async () => {
    // A confirmation checkbox is not content. If it moved the fingerprint, the
    // digest could no longer prove that the confirmed set and the reported set
    // are the same eight questions.
    const set = await baseSet();
    const confirmed = await confirmGeoQuerySet(set, CLOCK);

    expect(isGeoQuerySetConfirmed(set)).toBe(false);
    expect(isGeoQuerySetConfirmed(confirmed)).toBe(true);
    await expect(geoQuerySetContentHash(confirmed)).resolves.toBe(
      set.querySetContentHash,
    );
  });

  it("does not change with the display-only id or version", async () => {
    const set = await baseSet();

    await expect(
      geoQuerySetContentHash({ ...set, querySetId: "qs-other", version: 900 }),
    ).resolves.toBe(set.querySetContentHash);
  });
});
