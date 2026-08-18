// @input  -- confirmed and deliberately broken context inputs
// @output -- proof confirmation refuses unconfirmed facts and the hash is reproducible
// @pos    -- focused tests for the GEO context snapshot contract

import { describe, expect, it } from "vitest";

import {
  confirmGeoContext,
  deriveGeoBrandStance,
  deriveGeoMentionEligibility,
  geoAliasMatcherScope,
  geoContextHash,
  isGeoContextSnapshotV1,
  promptContainsTargetAlias,
  type GeoContextInputV1,
  type GeoContextSnapshotV1,
} from "./geo-context.ts";

const CLOCK = (): Date => new Date("2026-08-18T09:00:00.000Z");
const LATER = (): Date => new Date("2026-08-18T09:00:01.000Z");

const INPUT: GeoContextInputV1 = {
  targetUrl: "https://acme.test/",
  productName: "Acme Analytics",
  brandAliases: [
    { alias: "Acme Analytics", source: "profile_product_name", confirmed: true },
    { alias: "Acme", source: "host_label", confirmed: true },
  ],
  category: "AI visibility tracking",
  categoryConfirmed: true,
  buyer: "SaaS marketing teams",
  user: "Growth and content leads",
  jtbd: "Know whether assistants cite the site when buyers ask.",
  useCases: ["Track assistant citations", "Compare against rivals"],
  outcomes: ["Appear in assistant answers"],
  barriers: ["No visibility into assistant answers"],
  directCompetitors: ["Profound", "Peec AI"],
  indirectAlternatives: ["Manual spot checks"],
  marketCode: "US",
  targetQueryLanguage: "en",
  sourceProfileVersion: "agent-profile.v3",
  sourceSummary: [
    { field: "product_name", source: "supplied_product_information", limitationCode: null },
    { field: "category", source: "user_edit", limitationCode: null },
    { field: "buyer", source: "local_inference", limitationCode: "inferred_not_declared" },
  ],
};

async function confirmed(
  overrides: Partial<GeoContextInputV1> = {},
  clock: () => Date = CLOCK,
): Promise<GeoContextSnapshotV1> {
  const result = await confirmGeoContext({ ...INPUT, ...overrides }, clock);
  if (!result.ok) {
    throw new Error(`expected confirmation, got ${result.rejections.join(",")}`);
  }
  return result.snapshot;
}

describe("confirmGeoContext", () => {
  it("produces a bounded, normalized snapshot", async () => {
    const snapshot = await confirmed();

    expect(snapshot.schemaVersion).toBe("geo_context.v1");
    expect(snapshot.targetHost).toBe("acme.test");
    expect(snapshot.marketCode).toBe("US");
    expect(snapshot.targetQueryLanguage).toBe("en");
    expect(snapshot.confirmedAt).toBe("2026-08-18T09:00:00.000Z");
    expect(snapshot.contextHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(isGeoContextSnapshotV1(snapshot)).toBe(true);
  });

  it("keeps only the aliases the visitor confirmed", async () => {
    const snapshot = await confirmed({
      brandAliases: [
        { alias: "Acme Analytics", source: "profile_product_name", confirmed: true },
        { alias: "Acme Corp", source: "user_edit", confirmed: false },
      ],
    });

    expect(snapshot.brandAliases).toEqual([
      { alias: "Acme Analytics", source: "profile_product_name" },
    ]);
  });

  it("keeps each alias's own provenance rather than a set-level source", async () => {
    const snapshot = await confirmed();

    expect(snapshot.brandAliases.map((entry) => entry.source)).toEqual([
      "profile_product_name",
      "host_label",
    ]);
  });

  it.each([
    ["an unconfirmed category", { categoryConfirmed: false }, "category_unconfirmed"],
    [
      "no confirmed alias",
      {
        brandAliases: [
          { alias: "Acme", source: "host_label" as const, confirmed: false },
        ],
      },
      "aliases_none_confirmed",
    ],
    ["a missing market", { marketCode: "" }, "market_missing"],
    ["the EU pseudo-code", { marketCode: "EU" }, "market_not_a_country"],
    ["UK, which is not the ISO code", { marketCode: "UK" }, "market_not_a_country"],
    [
      "a non-English target query language",
      { targetQueryLanguage: "zh" },
      "query_language_unsupported",
    ],
    ["a blank product name", { productName: "   " }, "product_name_invalid"],
    ["a blank buyer", { buyer: "" }, "buyer_invalid"],
    ["a non-http target", { targetUrl: "ftp://acme.test/" }, "target_url_invalid"],
    [
      "a target URL carrying credentials",
      { targetUrl: "https://user:pw@acme.test/" },
      "target_url_invalid",
    ],
  ] as const)("refuses %s", async (_label, overrides, code) => {
    const result = await confirmGeoContext({ ...INPUT, ...overrides }, CLOCK);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections).toContain(code);
  });

  it("never falls back to US when the market is missing", async () => {
    const result = await confirmGeoContext({ ...INPUT, marketCode: "" }, CLOCK);

    expect(result.ok).toBe(false);
    // Defaulting here would sell an uncalibrated market as a calibrated one.
    if (!result.ok) expect(result.rejections).not.toContain("market_not_a_country");
  });

  it("refuses a generic single-word alias", async () => {
    const result = await confirmGeoContext(
      {
        ...INPUT,
        brandAliases: [
          { alias: "growth", source: "user_edit", confirmed: true },
        ],
      },
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections).toContain("alias_generic");
  });

  it("refuses a duplicate alias that differs only in case or punctuation", async () => {
    const result = await confirmGeoContext(
      {
        ...INPUT,
        brandAliases: [
          { alias: "Acme Analytics", source: "profile_product_name", confirmed: true },
          { alias: "acme  analytics", source: "user_edit", confirmed: true },
        ],
      },
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections).toContain("alias_duplicate");
  });

  it("refuses a source code that would read as server verification", async () => {
    const result = await confirmGeoContext(
      {
        ...INPUT,
        sourceSummary: [
          { field: "product_name", source: "verified", limitationCode: null },
        ],
      },
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections).toContain("source_summary_invalid");
  });

  it("refuses localized prose where a stable code belongs", async () => {
    const result = await confirmGeoContext(
      {
        ...INPUT,
        sourceSummary: [
          { field: "product_name", source: "已确认", limitationCode: null },
        ],
      },
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections).toContain("source_summary_invalid");
  });

  it("reports every reason at once rather than the first", async () => {
    const result = await confirmGeoContext(
      { ...INPUT, marketCode: "", categoryConfirmed: false, buyer: "" },
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toEqual(
        expect.arrayContaining([
          "category_unconfirmed",
          "buyer_invalid",
          "market_missing",
        ]),
      );
    }
  });
});

describe("the context fingerprint", () => {
  it("is stable for the same confirmed content", async () => {
    const first = await confirmed();
    const second = await confirmed();

    expect(first.contextHash).toBe(second.contextHash);
  });

  it("ignores the confirmation time", async () => {
    const first = await confirmed({}, CLOCK);
    const second = await confirmed({}, LATER);

    expect(first.confirmedAt).not.toBe(second.confirmedAt);
    expect(first.contextHash).toBe(second.contextHash);
  });

  it("ignores key insertion order in the input", async () => {
    const reordered: GeoContextInputV1 = {
      sourceSummary: INPUT.sourceSummary,
      sourceProfileVersion: INPUT.sourceProfileVersion,
      targetQueryLanguage: INPUT.targetQueryLanguage,
      marketCode: INPUT.marketCode,
      indirectAlternatives: INPUT.indirectAlternatives,
      directCompetitors: INPUT.directCompetitors,
      barriers: INPUT.barriers,
      outcomes: INPUT.outcomes,
      useCases: INPUT.useCases,
      jtbd: INPUT.jtbd,
      user: INPUT.user,
      buyer: INPUT.buyer,
      categoryConfirmed: INPUT.categoryConfirmed,
      category: INPUT.category,
      brandAliases: INPUT.brandAliases,
      productName: INPUT.productName,
      targetUrl: INPUT.targetUrl,
    };
    const result = await confirmGeoContext(reordered, CLOCK);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.contextHash).toBe((await confirmed()).contextHash);
    }
  });

  it("treats NFC-equivalent input as the same content", async () => {
    const decomposed = await confirmed({ productName: "Cafe\u0301 Analytics" });
    const precomposed = await confirmed({ productName: "Caf\u00e9 Analytics" });

    expect(decomposed.contextHash).toBe(precomposed.contextHash);
  });

  it("changes when any confirmed fact changes", async () => {
    const base = await confirmed();

    for (const change of [
      { category: "AI visibility monitoring" },
      { marketCode: "GB" },
      { productName: "Acme Analytics Pro" },
      { directCompetitors: ["Profound"] },
    ] as const) {
      const changed = await confirmed(change);
      expect(changed.contextHash).not.toBe(base.contextHash);
    }
  });

  it("does not cover the fingerprint field itself", async () => {
    const snapshot = await confirmed();
    const tampered: GeoContextSnapshotV1 = {
      ...snapshot,
      contextHash: `sha256:${"0".repeat(64)}`,
    };

    await expect(geoContextHash(tampered)).resolves.toBe(snapshot.contextHash);
  });
});

describe("isGeoContextSnapshotV1", () => {
  it("refuses a snapshot whose host disagrees with its URL", async () => {
    const snapshot = await confirmed();

    expect(
      isGeoContextSnapshotV1({ ...snapshot, targetHost: "evil.test" }),
    ).toBe(false);
  });

  it("refuses an unknown extra key", async () => {
    const snapshot = await confirmed();

    expect(isGeoContextSnapshotV1({ ...snapshot, extra: 1 })).toBe(false);
  });

  it("refuses a non-country market", async () => {
    const snapshot = await confirmed();

    expect(isGeoContextSnapshotV1({ ...snapshot, marketCode: "EU" })).toBe(false);
  });

  it("refuses a snapshot with no confirmed alias", async () => {
    const snapshot = await confirmed();

    expect(isGeoContextSnapshotV1({ ...snapshot, brandAliases: [] })).toBe(false);
  });
});

describe("alias matcher scope", () => {
  it("calls an ASCII product name supported", async () => {
    const snapshot = await confirmed();

    expect(geoAliasMatcherScope(snapshot.brandAliases)).toBe("supported");
  });

  it.each([
    ["a CJK name", "占星百科"],
    ["a punctuation-led name", ".NET Monitor"],
    ["a punctuation-tailed name", "Yahoo!"],
  ] as const)("calls %s out of scope", (_label, alias) => {
    expect(
      geoAliasMatcherScope([{ alias, source: "user_edit" }]),
    ).toBe("out_of_scope");
  });
});

describe("prompt conditioning", () => {
  const aliases = [
    { alias: "Acme Analytics", source: "profile_product_name" as const },
  ];

  it("detects the customer's own name in a rendered prompt", () => {
    expect(
      promptContainsTargetAlias("How does Acme Analytics compare?", aliases),
    ).toBe(true);
    expect(
      promptContainsTargetAlias("What are the top seo tools right now?", aliases),
    ).toBe(false);
  });

  it("derives the stance from the text rather than trusting a label", () => {
    expect(
      deriveGeoBrandStance("What are the top seo tools right now?", aliases, [
        "Semrush",
      ]),
    ).toBe("unbranded");
    expect(
      deriveGeoBrandStance("How does Acme Analytics compare?", aliases, [
        "Semrush",
      ]),
    ).toBe("brand");
    expect(
      deriveGeoBrandStance("Best alternatives to Semrush for seo", aliases, [
        "Semrush",
      ]),
    ).toBe("mixed");
  });
});

describe("the wire guard applies the producer's own alias rule", () => {
  it("refuses a generic alias the producer would have refused", async () => {
    // The fingerprint proves content identity, not that `confirmGeoContext`
    // produced the content. A guard looser than the producer lets a
    // hand-built payload buy eighteen answers scored against "growth".
    const snapshot = await confirmed();

    expect(
      isGeoContextSnapshotV1({
        ...snapshot,
        brandAliases: [{ alias: "growth", source: "user_edit" }],
      }),
    ).toBe(false);
  });

  it("refuses an alias whose every token is generic", async () => {
    const snapshot = await confirmed();

    expect(
      isGeoContextSnapshotV1({
        ...snapshot,
        brandAliases: [{ alias: "SEO Tool", source: "user_edit" }],
      }),
    ).toBe(false);
  });

  it("refuses two aliases that normalize to the same name", async () => {
    const snapshot = await confirmed();

    expect(
      isGeoContextSnapshotV1({
        ...snapshot,
        brandAliases: [
          { alias: "Acme Analytics", source: "profile_product_name" },
          { alias: "acme  analytics", source: "user_edit" },
        ],
      }),
    ).toBe(false);
  });

  it("answers false for a malformed timestamp instead of throwing", async () => {
    // `new Date(NaN).toISOString()` throws. A malformed pre-billing request must
    // make the guard say no, not turn validation into a 500.
    const snapshot = await confirmed();

    expect(() =>
      isGeoContextSnapshotV1({ ...snapshot, confirmedAt: "not-a-date" }),
    ).not.toThrow();
    expect(
      isGeoContextSnapshotV1({ ...snapshot, confirmedAt: "not-a-date" }),
    ).toBe(false);
  });

  it("refuses an empty provenance record", async () => {
    const snapshot = await confirmed();

    expect(isGeoContextSnapshotV1({ ...snapshot, sourceSummary: [] })).toBe(
      false,
    );
  });

  it("refuses any source code that reads as verification", async () => {
    for (const source of ["verified", "server_verified", "verified_by_server"]) {
      const result = await confirmGeoContext(
        {
          ...INPUT,
          sourceSummary: [{ field: "product_name", source, limitationCode: null }],
        },
        CLOCK,
      );

      expect(result.ok).toBe(false);
    }
  });
});

describe("multiword generic aliases", () => {
  it("refuses one at confirmation as well", async () => {
    const result = await confirmGeoContext(
      {
        ...INPUT,
        brandAliases: [
          { alias: "SEO Tool", source: "user_edit", confirmed: true },
        ],
      },
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections).toContain("alias_generic");
  });

  it("keeps a real name that merely contains a generic word", async () => {
    const snapshot = await confirmed({
      brandAliases: [
        { alias: "Acme Analytics", source: "user_edit", confirmed: true },
      ],
    });

    expect(snapshot.brandAliases).toHaveLength(1);
  });
});

describe("mention eligibility", () => {
  const aliases = [
    { alias: "Acme Analytics", source: "profile_product_name" as const },
  ];

  it("calls an unbranded prompt unprompted", () => {
    expect(
      deriveGeoMentionEligibility("What are the top seo tools?", aliases, "supported"),
    ).toBe("unprompted");
  });

  it("calls a brand-containing prompt prompted", () => {
    expect(
      deriveGeoMentionEligibility(
        "How does Acme Analytics compare?",
        aliases,
        "supported",
      ),
    ).toBe("prompted");
  });

  it("falls back to prompted when the matcher cannot speak", () => {
    // The conservative direction: `prompted` keeps the observation out of the
    // discovery denominator, while `unprompted` would let a mention the matcher
    // may have hallucinated count as the customer being found on their own.
    expect(
      deriveGeoMentionEligibility(
        "What are the top seo tools?",
        aliases,
        "out_of_scope",
      ),
    ).toBe("prompted");
  });
});

describe("brand stance with both names present", () => {
  const aliases = [{ alias: "Acme", source: "profile_product_name" as const }];

  it("reports the customer's own name rather than the competitor's", () => {
    // "Acme vs Semrush" and "alternatives to Semrush" are different questions,
    // and only the first makes a mention in the answer tautological.
    expect(deriveGeoBrandStance("Acme vs Semrush?", aliases, ["Semrush"])).toBe(
      "brand",
    );
    expect(
      deriveGeoBrandStance("Alternatives to Semrush?", aliases, ["Semrush"]),
    ).toBe("mixed");
  });
});
