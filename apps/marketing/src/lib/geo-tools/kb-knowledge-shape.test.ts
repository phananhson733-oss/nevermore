import { describe, expect, it } from "vitest";
import {
  GEO_ENTITY_CORRECTABLE_PATHS,
  GEO_ENTITY_FIELD_PATHS,
  geoCount,
  geoEntityFieldClaim,
  geoLiteralsSupported,
  geoPlainString,
} from "./kb-knowledge-shape.ts";

describe("strings PostgreSQL JSONB can store", () => {
  const field = geoPlainString(20);

  it("refuses a lone surrogate", () => {
    // A lone surrogate has no valid `jsonb::text` form at all, so a row built
    // from it cannot be written however small it measures. This is checked at
    // the field, not only at the serializer, so the error names the field.
    expect(field.safeParse("\ud800").success).toBe(false);
    expect(field.safeParse("\udc00 tail").success).toBe(false);
    expect(field.safeParse("\ud83d\ude00").success).toBe(true);
  });

  it("refuses a NUL and respects its bounds", () => {
    expect(field.safeParse("a\u0000b").success).toBe(false);
    expect(field.safeParse("x".repeat(21)).success).toBe(false);
    expect(geoPlainString(20, 1).safeParse("").success).toBe(false);
  });
});

describe("counts carried as text", () => {
  const count = geoCount(1_000);

  it("takes a canonical decimal string and nothing else", () => {
    // The v3 payload has no JSON number type; a count still has to be a count.
    expect(count.safeParse("0").success).toBe(true);
    expect(count.safeParse("1000").success).toBe(true);
    expect(count.safeParse("1001").success).toBe(false);
    expect(count.safeParse("007").success).toBe(false);
    expect(count.safeParse("-1").success).toBe(false);
    expect(count.safeParse("1e3").success).toBe(false);
  });
});

describe("what a checked citation proves", () => {
  it("requires every number in the claim to occur in an excerpt", () => {
    expect(geoLiteralsSupported("The Pro plan costs 9 per month.", ["Pro costs 9 per month"])).toBe(true);
    expect(geoLiteralsSupported("The Pro plan costs 99 per month.", ["Pro costs 9 per month"])).toBe(false);
  });

  it("says nothing about a claim with no numbers", () => {
    // Deliberately: this check is about literals, not about truth. A claim with
    // no numbers is supported by any excerpt, and the item-level rule that at
    // least one cited source was actually read is what carries the weight there.
    expect(geoLiteralsSupported("Acme does not run on Android.", ["unrelated text"])).toBe(true);
    expect(geoLiteralsSupported("Acme costs 9.", [])).toBe(false);
  });

  /**
   * A price is a number *and* a unit. Reading the unit off the claim but not
   * comparing it is how "₩9,900" comes to be satisfied by a "₹9,900" excerpt:
   * the digits are identical and the sign was thrown away. The table walks the
   * whole currency range rather than the four signs an ASCII-shaped guard would
   * happen to know, because "which signs did someone remember to list" is not a
   * property of the claim being checked.
   */
  const CURRENCY_SIGNS = ["$", "€", "£", "¥", "₩", "₹", "₽", "₺", "₪", "฿", "₫", "₴"] as const;

  it.each(CURRENCY_SIGNS.map((sign, index) => [sign, CURRENCY_SIGNS[(index + 1) % CURRENCY_SIGNS.length]!]))(
    "refuses a %s price cited against a %s excerpt of the same digits",
    (claimed, cited) => {
      expect(geoLiteralsSupported(`Pro costs ${claimed}9,900.`, [`Growth is ${cited}9,900 per month`])).toBe(false);
      expect(geoLiteralsSupported(`Pro costs ${claimed}9,900.`, [`Pro is ${claimed}9,900 per month`])).toBe(true);
    },
  );

  it("reads a price the page wrote in fullwidth form", () => {
    // A Japanese or Chinese page writes the same price as ￥ (U+FFE5) and may
    // write the digits fullwidth too. Both are the compatibility forms of what
    // the claim says, so refusing them drops a correctly sourced price.
    expect(geoLiteralsSupported("Pro costs ¥9,900.", ["Proプランは月額￥9,900です"])).toBe(true);
    expect(geoLiteralsSupported("Pro costs ¥9,900.", ["月額￥９，９００です"])).toBe(true);
    expect(geoLiteralsSupported("Growth is up 50%.", ["traffic rose 50％"])).toBe(true);
  });

  it("refuses a unit that appears on only one side, in either direction", () => {
    // A claim may not invent a unit the page never showed, and may not drop one
    // the page did show: "3 seats" is not what a page reading "$3 seats" said,
    // and "₩2 per team" is not what a page reading "teams of 2" said. Both are
    // already how the four hard-coded signs behaved; this is the same rule with
    // no list to fall off.
    expect(geoLiteralsSupported("3 seats are available.", ["$3 seats are available."])).toBe(false);
    expect(geoLiteralsSupported("Pro costs ₩2 per team.", ["It supports teams of 2."])).toBe(false);
    expect(geoLiteralsSupported("Pro costs 9,900 per month.", ["Pro is ₩9,900 per month"])).toBe(false);
    expect(geoLiteralsSupported("It supports teams of 2.", ["It supports teams of 2."])).toBe(true);
  });

  it("refuses a signless price whose excerpt spells the unit as a word", () => {
    // Documented cost of the rule above, not an oversight: "9,900원" carries no
    // currency *sign*, so a ₩ claim about it reads as unsupported. It fails the
    // safe way -- the item is dropped rather than published as citation-checked
    // -- and English has the same shape ("9,900 dollars").
    expect(geoLiteralsSupported("Pro costs ₩9,900.", ["Pro는 월 9,900원입니다"])).toBe(false);
    expect(geoLiteralsSupported("Pro costs 9,900 won.", ["Pro는 월 9,900원입니다"])).toBe(true);
  });
});

describe("resolving an entity field to the claim behind it", () => {
  const entity = {
    name: "Acme",
    aliases: ["Acme Inc", "Acme Analytics"],
    categories: { primary: "astrology software", secondary: [] },
    founded: { year: "2019", team: null, location: null },
  };

  it("reads a scalar, joins a list, and returns nothing for an absent value", () => {
    expect(geoEntityFieldClaim(entity, "name")).toBe("Acme");
    expect(geoEntityFieldClaim(entity, "categories.primary")).toBe("astrology software");
    expect(geoEntityFieldClaim(entity, "aliases")).toBe("Acme Inc Acme Analytics");
    expect(geoEntityFieldClaim(entity, "founded.year")).toBe("2019");
    expect(geoEntityFieldClaim(entity, "founded.team")).toBe("");
    expect(geoEntityFieldClaim(entity, "disambiguation")).toBe("");
  });

  it("offers a correction only for fields one short string can replace", () => {
    // Every path can be keyed and excluded; a list, a URL or a sameAs set needs
    // its own gesture, so it is deliberately absent from the correctable set.
    for (const path of GEO_ENTITY_CORRECTABLE_PATHS) {
      expect(GEO_ENTITY_FIELD_PATHS).toContain(path);
    }
    const correctable: readonly string[] = GEO_ENTITY_CORRECTABLE_PATHS;
    expect(correctable).not.toContain("aliases");
    expect(correctable).not.toContain("sameAs");
    expect(correctable).not.toContain("links.home");
  });
});
