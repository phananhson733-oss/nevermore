import { describe, expect, it } from "vitest";

import {
  geoIsOfficialHost,
  geoOverlapTokens,
  geoShingleOverlap,
  judgeGeoOffsiteIndependence,
  readGeoOffsitePageSignals,
  verifyGeoEntityCrossReference,
  type GeoOffsitePageSignals,
} from "./kb-offsite-verification.ts";

const BRAND = ["Acme Analytics", "Acme"];
const OFFICIAL = ["acme.example"];

const words = (prefix: string, count: number) =>
  Array.from({ length: count }, (_index, index) => `${prefix}${index}`).join(" ");

const offsite = (options: {
  readonly body: string;
  readonly head?: string;
  readonly links?: readonly string[];
  readonly extra?: string;
}): GeoOffsitePageSignals => readGeoOffsitePageSignals(
  `<html><head>${options.head ?? ""}</head><body><p>${options.body}</p>${options.extra ?? ""}${
    (options.links ?? []).map((href) => `<a href="${href}">visit</a>`).join("")
  }</body></html>`,
  "https://press.example/story",
);

const own = [{ url: "https://acme.example/", text: words("own", 100) }];

describe("reading a fetched offsite page", () => {
  it("keeps semantic excerpts, resolves link hosts and leaves scripts out of the body", () => {
    const signals = readGeoOffsitePageSignals(
      `<html><head><script type="application/ld+json">{"@type":"Article","author":{"name":"Nora Editor"}}</script></head>`
      + `<body><h1>Acme Analytics reviewed</h1><p>It computes charts.</p>`
      + `<style>.a{color:red}</style><a href="/about">about</a><a href="https://acme.example/pricing">pricing</a></body></html>`,
      "https://press.example/story",
    );
    // Headings, paragraphs and list items only: a bare anchor is navigation,
    // and a source catalogue full of "about" and "pricing" is not evidence.
    expect(signals.excerpts).toEqual(["Acme Analytics reviewed", "It computes charts."]);
    expect(signals.bodyText).not.toContain("color:red");
    expect(signals.linkHosts).toEqual(["press.example", "acme.example"]);
    // The script block was removed from the body clone only; the author survives.
    expect(signals.byline.authors).toEqual(["Nora Editor"]);
  });

  it("matches owner-submission markers as phrases, case-insensitively", () => {
    expect(offsite({ body: "Sponsored Content. Acme Analytics is great." }).markers).toEqual(["sponsored content"]);
    // A bare ad-slot label is not a marker: it sits in the furniture of nearly
    // every publisher and would brand real editorial coverage as submitted.
    expect(offsite({ body: "Advertisement" }).markers).toEqual([]);
    // "Claim this profile" is what an UNclaimed listing says.
    expect(offsite({ body: "Claim this profile to respond to reviews." }).markers).toEqual([]);
  });
});

describe("entity cross-reference", () => {
  it("passes only when the fetched body both names the brand and links back", () => {
    const result = verifyGeoEntityCrossReference({
      brandNames: BRAND, officialHosts: OFFICIAL,
      page: offsite({ body: "Acme Analytics ships a chart calculator.", links: ["https://acme.example/pricing"] }),
    });
    expect(result).toMatchObject({ verdict: "passed", basis: "page_body", namesBrand: true, linksToOfficialDomain: true });
    expect(result.matchedAlias).toBe("Acme Analytics");
    expect(result.matchedOfficialHost).toBe("acme.example");
  });

  it("suspects a page that names the brand without linking to it", () => {
    expect(verifyGeoEntityCrossReference({
      brandNames: BRAND, officialHosts: OFFICIAL,
      page: offsite({ body: "Acme Analytics ships a chart calculator.", links: ["https://other.example/"] }),
    })).toMatchObject({ verdict: "suspected", namesBrand: true, linksToOfficialDomain: false });
  });

  it("suspects a page that links to the site without naming it", () => {
    expect(verifyGeoEntityCrossReference({
      brandNames: BRAND, officialHosts: OFFICIAL,
      page: offsite({ body: "A directory row with no product name in it.", links: ["https://blog.acme.example/post"] }),
    })).toMatchObject({ verdict: "suspected", namesBrand: false, linksToOfficialDomain: true });
  });

  it("fails a page that does neither", () => {
    expect(verifyGeoEntityCrossReference({
      brandNames: BRAND, officialHosts: OFFICIAL,
      page: offsite({ body: "An unrelated page.", links: ["https://elsewhere.example/"] }),
    })).toMatchObject({ verdict: "failed", basis: "page_body" });
  });

  it("never passes on a SERP summary alone, however well the snippet reads", () => {
    // The hard rule: a provider snippet carries no links we observed, so the
    // link half is false by construction and `passed` is unreachable here.
    const summary = verifyGeoEntityCrossReference({
      brandNames: BRAND, officialHosts: OFFICIAL, page: null,
      serpSummary: "Acme Analytics review - the official Acme Analytics site at acme.example",
    });
    expect(summary.verdict).toBe("suspected");
    expect(summary.basis).toBe("serp_summary");
    expect(summary.linksToOfficialDomain).toBe(false);
    expect(verifyGeoEntityCrossReference({ brandNames: BRAND, officialHosts: OFFICIAL, page: null }))
      .toMatchObject({ verdict: "failed", basis: "serp_summary" });
  });

  it("treats subdomains of the official host as the official host, and lookalikes as not", () => {
    expect(geoIsOfficialHost("blog.acme.example", OFFICIAL)).toBe(true);
    expect(geoIsOfficialHost("www.acme.example", OFFICIAL)).toBe(true);
    expect(geoIsOfficialHost("notacme.example", OFFICIAL)).toBe(false);
  });
});

describe("sentence overlap", () => {
  it("tokenizes dense scripts one character at a time and Latin runs as words", () => {
    expect(geoOverlapTokens("Acme 星盘 tool")).toEqual(["acme", "星", "盘", "tool"]);
  });

  it("measures containment, and reports the Jaccard value that would have hidden it", () => {
    const page = `${words("own", 40)} ${words("extra", 20)}`;
    const overlap = geoShingleOverlap(page, [{ url: "https://acme.example/", text: words("own", 200) }]);
    // 56 shingles in the page, 36 of them lifted from the own page.
    expect(overlap.pageShingles).toBe(56);
    expect(overlap.ratio).toBeCloseTo(36 / 56, 10);
    // Jaccard against a long own page would have read as 17% and let a verbatim
    // republication through as independent.
    expect(overlap.jaccard).toBeCloseTo(36 / 216, 10);
    expect(overlap.matchedUrl).toBe("https://acme.example/");
  });

  it("refuses to measure a text too short to mean anything, in either corpus", () => {
    expect(geoShingleOverlap("one two three", own)).toMatchObject({ ratio: null, unmeasurable: "page_too_short" });
    expect(geoShingleOverlap(words("news", 60), [{ url: "https://acme.example/", text: "one two three" }]))
      .toMatchObject({ ratio: null, unmeasurable: "own_corpus_too_short" });
  });

  it("reports zero, not null, when there is nothing in common", () => {
    expect(geoShingleOverlap(words("news", 60), own)).toMatchObject({ ratio: 0, matchedUrl: null, unmeasurable: null });
  });
});

const byline = `<div class="author">Nora Editor</div>`;

describe("independence", () => {
  it("calls a page independent only with a distinct identity and measured low overlap", () => {
    const judgement = judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: own,
      page: offsite({ body: words("news", 60), extra: byline }),
    });
    expect(judgement.independence).toBe("independent");
    expect(judgement.basis).toBe("distinct_identity_and_low_overlap");
    expect(judgement.distinctIdentities).toEqual(["Nora Editor"]);
  });

  it("calls a fetched page with no byline at all undetermined, never independent", () => {
    // The rule this module exists for: finding no counter-evidence is not
    // evidence. This page fetched fine, has no markers and no overlap -- and
    // still supports no independence claim.
    const judgement = judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: own,
      page: offsite({ body: words("news", 60) }),
    });
    expect(judgement.independence).toBe("undetermined");
    expect(judgement.independence).not.toBe("independent");
    expect(judgement.basis).toBe("no_identity_distinct_from_brand");
  });

  it("does not count the brand's own name as a distinct identity", () => {
    expect(judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: own,
      page: offsite({ body: words("news", 60), extra: `<div class="author">Acme Analytics Team</div>` }),
    })).toMatchObject({ independence: "undetermined", basis: "no_identity_distinct_from_brand", distinctIdentities: [] });
  });

  it("calls an owner-submission marker self-submitted, ahead of any measurement", () => {
    expect(judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: own,
      page: offsite({ body: `Sponsored post. ${words("news", 60)}`, extra: byline }),
    })).toMatchObject({ independence: "self_submitted", basis: "owner_submitted_marker", markers: ["sponsored post"] });
  });

  it("calls a venue that publishes on the subject's behalf self-submitted", () => {
    expect(judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: own, venueIsOwnerPublished: true,
      page: offsite({ body: words("news", 60), extra: byline }),
    })).toMatchObject({ independence: "self_submitted", basis: "owner_published_venue" });
  });

  it("calls a copy of an own page syndicated even when it carries a byline", () => {
    expect(judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: own,
      page: offsite({ body: words("own", 100), extra: byline }),
    })).toMatchObject({ independence: "syndicated", basis: "overlap_at_or_above_threshold" });
  });

  it("prefers the stated marker over the measured overlap when both fire", () => {
    expect(judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: own,
      page: offsite({ body: `Advertorial. ${words("own", 100)}` }),
    })).toMatchObject({ independence: "self_submitted", basis: "owner_submitted_marker" });
  });

  it("falls back to undetermined when the overlap cannot be measured", () => {
    // "distinct identity AND overlap below the threshold" -- an unmeasurable
    // overlap cannot satisfy the second half, so it fails closed.
    expect(judgeGeoOffsiteIndependence({
      brandNames: BRAND, ownTexts: [{ url: "https://acme.example/", text: "one two three" }],
      page: offsite({ body: words("news", 60), extra: byline }),
    })).toMatchObject({ independence: "undetermined", basis: "overlap_not_measurable" });
  });

  it("returns undetermined, with nothing measured, when no body was fetched", () => {
    expect(judgeGeoOffsiteIndependence({ brandNames: BRAND, ownTexts: own, page: null })).toEqual({
      independence: "undetermined", basis: "body_not_observed",
      distinctIdentities: [], markers: [], overlap: null,
    });
  });
});
