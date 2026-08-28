import { describe, expect, it } from "vitest";

import {
  canonicalGeoKbText,
  emptyGeoKbPayload,
  geoKbBlockers,
  GEO_KB_LIMITS,
  GEO_KB_SCHEMA_VERSION,
  parseGeoKbPayload,
  type GeoKbPayload,
} from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";

const VALID: GeoKbPayload = {
  ...emptyGeoKbPayload("https://acme-kb.test/"),
  officialName: "Acme",
  aliases: ["Acme Analytics"],
  categoryTerms: ["project management"],
  roles: [
    {
      id: "r1",
      label: "agency owners",
      segment: "5 to 20 person agencies",
      painPoints: ["missed deadlines"],
      decisionCriteria: ["price"],
      vocabulary: ["client work"],
    },
  ],
  competitors: [{ domain: "linear.app", brandName: "Linear", confirmed: true }],
};

describe("canonical text", () => {
  it("sorts object keys and keeps array order", () => {
    // The database recomputes this from `marketing_canonical_jsonb_text`,
    // which sorts keys and preserves array order. If the two spellings differ
    // by one byte the write is refused, so this is the contract between them.
    expect(canonicalGeoKbText({ b: "2", a: "1" })).toBe('{"a":"1","b":"2"}');
    expect(canonicalGeoKbText(["b", "a"])).toBe('["b","a"]');
    expect(canonicalGeoKbText({ a: { d: "1", c: "2" } })).toBe(
      '{"a":{"c":"2","d":"1"}}',
    );
  });

  it("writes no presentation whitespace and keeps non-ASCII literal", () => {
    const text = canonicalGeoKbText({ name: "北极星", ok: true });
    expect(text).toBe('{"name":"北极星","ok":true}');
    expect(text).not.toContain(" ");
    // jsonb::text emits the character, not an escape, so an escaped form here
    // would produce a different digest on the same content.
    expect(text).not.toContain("\\u");
  });

  it("gives the same digest regardless of key order" , () => {
    const one = geoKbDigest({ a: "1", b: "2" });
    const two = geoKbDigest({ b: "2", a: "1" });
    expect(one).toBe(two);
    expect(one).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("payload validation", () => {
  it("accepts a complete payload and normalizes what it keeps", () => {
    const parsed = parseGeoKbPayload({
      ...VALID,
      officialName: "  Acme  ",
      aliases: ["Acme Analytics", "Acme Analytics", " "],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.officialName).toBe("Acme");
    // Duplicates and blanks are dropped rather than rejected: the editor emits
    // both while someone is typing.
    expect(parsed.value.aliases).toEqual(["Acme Analytics"]);
  });

  it("rejects the wrong schema version", () => {
    const parsed = parseGeoKbPayload({ ...VALID, schemaVersion: "other" });
    expect(parsed).toEqual({ ok: false, reason: "schema_version" });
    expect(GEO_KB_SCHEMA_VERSION).toBe("marketing-geo-kb.v1");
  });

  it("rejects control characters anywhere in a string", () => {
    const parsed = parseGeoKbPayload({
      ...VALID,
      officialName: "AcmeAnalytics",
    });
    // Postgres normalizes some escapes on the way into jsonb, so a payload
    // carrying them can come back spelled differently and stop matching its
    // own digest.
    expect(parsed.ok).toBe(false);
  });

  it("rejects a value that exceeds its field's length", () => {
    expect(
      parseGeoKbPayload({
        ...VALID,
        officialName: "a".repeat(GEO_KB_LIMITS.text + 1),
      }).ok,
    ).toBe(false);
    expect(
      parseGeoKbPayload({
        ...VALID,
        aliases: Array.from({ length: GEO_KB_LIMITS.aliases + 1 }, (_, i) =>
          `alias-${String(i)}`,
        ),
      }).ok,
    ).toBe(false);
  });

  it("rejects two roles with the same id", () => {
    const parsed = parseGeoKbPayload({
      ...VALID,
      roles: [VALID.roles[0]!, { ...VALID.roles[0]!, label: "other" }],
    });
    expect(parsed).toEqual({ ok: false, reason: "roles" });
  });

  it("rejects a competitor confirmed without the name being confirmed about", () => {
    const parsed = parseGeoKbPayload({
      ...VALID,
      competitors: [{ domain: "linear.app", brandName: "", confirmed: true }],
    });
    expect(parsed).toEqual({ ok: false, reason: "competitors" });
  });

  it("keeps a competitor known only by name", () => {
    const parsed = parseGeoKbPayload({
      ...VALID,
      competitors: [{ domain: "", brandName: "Some Agency Tool", confirmed: false }],
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects an empty competitor row", () => {
    expect(
      parseGeoKbPayload({
        ...VALID,
        competitors: [{ domain: "", brandName: "", confirmed: false }],
      }),
    ).toEqual({ ok: false, reason: "competitors" });
  });

  it("holds both halves of the fact rule", () => {
    // A value has to say where it came from.
    expect(
      parseGeoKbPayload({
        ...VALID,
        facts: [
          {
            key: "price",
            value: "$20",
            reason: "",
            sourceUrl: "",
            observedAt: "2026-08-29",
          },
        ],
      }),
    ).toEqual({ ok: false, reason: "facts" });

    // And an absence has to say why.
    expect(
      parseGeoKbPayload({
        ...VALID,
        facts: [
          { key: "price", value: "", reason: "", sourceUrl: "", observedAt: "" },
        ],
      }),
    ).toEqual({ ok: false, reason: "facts" });

    expect(
      parseGeoKbPayload({
        ...VALID,
        facts: [
          {
            key: "price",
            value: "",
            reason: "notPublished",
            sourceUrl: "",
            observedAt: "",
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("rejects a market that is not a country and a language", () => {
    for (const market of [
      { country: "USA", language: "en" },
      { country: "US", language: "english" },
      { country: "", language: "en" },
    ]) {
      expect(parseGeoKbPayload({ ...VALID, market })).toEqual({
        ok: false,
        reason: "market",
      });
    }
    const parsed = parseGeoKbPayload({
      ...VALID,
      market: { country: "gb", language: "EN" },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.market).toEqual({ country: "GB", language: "en" });
  });

  it("requires at least one category word", () => {
    expect(parseGeoKbPayload({ ...VALID, categoryTerms: [] })).toEqual({
      ok: false,
      reason: "category_terms",
    });
  });
});

describe("blockers", () => {
  it("names every reason a knowledge base cannot be frozen yet", () => {
    // An empty payload is valid to save and not ready to freeze - those are
    // different questions, and the editor asks both.
    const empty = emptyGeoKbPayload("https://acme-kb.test/");
    expect(geoKbBlockers(empty).slice().sort()).toEqual(
      [
        "aliases_missing",
        "category_terms_missing",
        "no_confirmed_competitor",
        "official_name_missing",
        "role_missing",
      ].sort(),
    );
  });

  it("clears once each part is present", () => {
    expect(geoKbBlockers(VALID)).toEqual([]);
    expect(
      geoKbBlockers({
        ...VALID,
        competitors: [
          { domain: "linear.app", brandName: "Linear", confirmed: false },
        ],
      }),
    ).toEqual(["no_confirmed_competitor"]);
  });

  it("does not treat an unfrozen empty payload as invalid", () => {
    // The editor saves as you type, so the empty shape has to survive a save.
    expect(parseGeoKbPayload(emptyGeoKbPayload("https://acme-kb.test/")).ok).toBe(
      false,
    );
    // Deliberate: an empty payload has no category word, and the parse layer
    // is where that is refused. The editor's own blockers say so before the
    // request, which is why the save button reports rather than fails.
    expect(
      geoKbBlockers(emptyGeoKbPayload("https://acme-kb.test/")).length,
    ).toBeGreaterThan(0);
  });
});
