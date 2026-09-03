import { describe, expect, it } from "vitest";
import { buildGeoV2FromProfile } from "./kb-v2-build-from-profile.ts";
import { completePayloadV2 } from "./kb-v2.test-fixtures.ts";
import type { MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import type { GeoKbPayloadV2 } from "./kb-v2-contract.ts";

const base = () => completePayloadV2();

function profileOf(overrides: Partial<MarketingWebsiteProfileV1> = {}): MarketingWebsiteProfileV1 {
  return { ...base().profileCopy.profile, ...overrides };
}

describe("buildGeoV2FromProfile", () => {
  it("writes the measurement fields the Profile can supply", () => {
    const payload: GeoKbPayloadV2 = { ...base(), officialName: "Stale", categoryTerms: [], market: { country: "XX", language: "xx" } };
    const profile = profileOf({ productName: "AstrologyWiki", categories: ["birth chart calculator", "natal chart"], country: "US", locale: "en" });

    const build = buildGeoV2FromProfile(profile, payload);

    expect(build.changed).toBe(true);
    expect([...build.fields]).toEqual(["officialName", "categoryTerms", "market"]);
    expect(build.payload.officialName).toBe("AstrologyWiki");
    expect([...build.payload.categoryTerms]).toEqual(["birth chart calculator", "natal chart"]);
    expect(build.payload.market).toEqual({ country: "US", language: "en" });
  });

  it("leaves a field the Profile agrees with alone rather than reporting it as written", () => {
    const profile = profileOf({ productName: "AstrologyWiki", categories: ["birth chart calculator"], country: "US", locale: "en" });
    const first = buildGeoV2FromProfile(profile, { ...base(), aliases: ["Held"], competitors: [] });

    const again = buildGeoV2FromProfile(profile, first.payload);

    expect([...again.fields]).toEqual([]);
    expect(again.changed).toBe(false);
    expect(again.payload).toBe(first.payload);
  });

  it("derives the alias table only when the draft has none", () => {
    const profile = profileOf({ productName: "AstrologyWiki" });
    const empty = buildGeoV2FromProfile(profile, { ...base(), officialName: "AstrologyWiki", aliases: [] });

    expect(empty.aliases).toBe("adopted");
    expect(empty.payload.aliases).toContain("AstrologyWiki");
    expect(empty.payload.aliases.length).toBeGreaterThan(1);

    const curated = buildGeoV2FromProfile(profile, { ...base(), officialName: "AstrologyWiki", aliases: ["Only this one"] });

    expect(curated.aliases).toBe("unchanged");
    expect([...curated.payload.aliases]).toEqual(["Only this one"]);
  });

  it("adopts the Profile competitors when nothing held would be discarded", () => {
    const profile = profileOf({ directCompetitors: ["cafeastrology.com", "astro.com"] });

    const build = buildGeoV2FromProfile(profile, { ...base(), competitors: [] });

    expect(build.competitors).toBe("adopted");
    expect(build.payload.competitors.map(row => row.domain)).toEqual(["cafeastrology.com", "astro.com"]);
  });

  it("refuses to replace a competitor set holding a row the Profile cannot reproduce", () => {
    const profile = profileOf({ directCompetitors: ["cafeastrology.com", "astro.com"] });
    const payload: GeoKbPayloadV2 = { ...base(), competitors: [{ domain: "handpicked.example", brandName: "Handpicked", confirmed: true, aliases: [] }] };

    const build = buildGeoV2FromProfile(profile, payload);

    expect(build.competitors).toBe("manual");
    expect(build.payload.competitors.map(row => row.domain)).toEqual(["handpicked.example"]);
  });

  it("keeps a confirmed competitor confirmed when the Profile still names it", () => {
    const profile = profileOf({ directCompetitors: ["cafeastrology.com", "astro.com"] });
    const payload: GeoKbPayloadV2 = { ...base(), competitors: [{ domain: "cafeastrology.com", brandName: "Cafe Astrology", confirmed: true, aliases: [] }] };

    const build = buildGeoV2FromProfile(profile, payload);

    expect(build.competitors).toBe("adopted");
    expect(build.payload.competitors).toContainEqual({ domain: "cafeastrology.com", brandName: "Cafe Astrology", confirmed: true, aliases: [] });
    expect(build.payload.competitors.map(row => row.domain)).toContain("astro.com");
  });

  it("returns the reviewed roles and facts untouched, and never derives its own", () => {
    // Handing in an already-empty set would be satisfied by a function that
    // clears them, which is the one failure that matters here.
    const profile = profileOf({ productName: "AstrologyWiki", buyer: "Beginner", primaryIcp: "Curious reader", categories: ["astrology"] });
    const payload: GeoKbPayloadV2 = { ...base(), aliases: [] };
    expect(payload.roles.length).toBeGreaterThan(0);
    expect(payload.facts.length).toBeGreaterThan(0);

    const build = buildGeoV2FromProfile(profile, payload);

    expect(build.payload.roles).toEqual(payload.roles);
    expect(build.payload.facts).toEqual(payload.facts);
  });

  it("does not call a full competitor set a match for a Profile it does not match", () => {
    const profile = profileOf({ directCompetitors: ["cafeastrology.com", "astro.com"] });
    const full = Array.from({ length: 5 }, (_row, index) => ({ domain: `hand${index}.example`, brandName: `Hand ${index}`, confirmed: true, aliases: [] }));

    const build = buildGeoV2FromProfile(profile, { ...base(), competitors: full });

    expect(build.competitors).toBe("manual");
    expect(build.payload.competitors).toEqual(full);
  });

  it("reports a field the Profile cannot supply as unavailable, not as agreement", () => {
    // A market GEO cannot read is not a market that already matches.
    const profile = profileOf({ productName: "AstrologyWiki", categories: [], country: "not-a-country", locale: "nonsense" });

    const build = buildGeoV2FromProfile(profile, { ...base(), aliases: ["Held"] });

    expect([...build.unavailable]).toContain("market");
    expect([...build.unavailable]).toContain("categoryTerms");
    expect([...build.fields]).not.toContain("market");
  });

  it("treats an alias box the visitor emptied as empty, not as a curated list", () => {
    // The editor splits a textarea on newlines, so a cleared box is [""].
    const profile = profileOf({ productName: "AstrologyWiki" });

    const build = buildGeoV2FromProfile(profile, { ...base(), officialName: "AstrologyWiki", aliases: [""] });

    expect(build.aliases).toBe("adopted");
    expect(build.payload.aliases).toContain("AstrologyWiki");
  });
});
