import { describe, expect, it } from "vitest";
import { discoverGeoFactSourcesV2, geoFactCandidates } from "./kb-fact-discovery.ts";
import { parseGeoKbSourceReportV2 } from "./kb-source-contract.ts";
import { finalizeGeoKbSourceReportV2 } from "./kb-sources.ts";
import type { GeoEnrichmentPage } from "./kb-enrichment.ts";

const page = (body: string): GeoEnrichmentPage => ({ kind: "ok", url: "https://www.example.com/", body, observedAt: "2026-09-04T07:00:00.000Z" });
const faq = (entries: readonly { readonly q: string; readonly a: string }[]) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: entries.map(entry => ({ "@type": "Question", name: entry.q, acceptedAnswer: { "@type": "Answer", text: entry.a } })) })}</script></head><body></body></html>`;

describe("what a page publishes about itself", () => {
  it("takes a marked-up answer as the value for the question it answers", () => {
    const found = geoFactCandidates(page(faq([{ q: "Is it free?", a: "Yes. You can calculate a chart without an account." }])));
    expect(found).toEqual([{ key: "Is it free?", value: "Yes. You can calculate a chart without an account.", excerpt: "Yes. You can calculate a chart without an account." }]);
  });

  it("keeps whole sentences and never splits a decimal", () => {
    // "roughly every 29. 5 years" is not what the page says, and a value cut
    // mid-sentence is a claim the page never made.
    const answer = "A Saturn return occurs when transiting Saturn reaches the position it held at birth, roughly every 29.5 years. Astrologers read it as a threshold. The exact timing depends on the birth data you supply, which is why the calculator asks for it.";
    const [found] = geoFactCandidates(page(faq([{ q: "What is a Saturn return?", a: answer }])));
    expect(found?.value).toBe("A Saturn return occurs when transiting Saturn reaches the position it held at birth, roughly every 29.5 years. Astrologers read it as a threshold.");
    expect(found?.value.length).toBeLessThanOrEqual(200);
    // The whole answer stays as the evidence for the shortened value.
    expect(found?.excerpt).toBe(answer);
  });

  it("leaves out an answer whose first sentence alone will not fit, rather than trimming it", () => {
    const long = `${"word ".repeat(60)}end.`;
    expect(geoFactCandidates(page(faq([{ q: "Long?", a: long }])))).toEqual([]);
  });

  it("reads answers out of a @graph and skips a repeated question", () => {
    const body = `<html><head><script type="application/ld+json">${JSON.stringify({ "@graph": [
      { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Is it free?", acceptedAnswer: { "@type": "Answer", text: "Yes, the calculator is free." } }] },
      { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "IS IT FREE?", acceptedAnswer: { "@type": "Answer", text: "Yes, still free." } }] },
    ] })}</script></head><body></body></html>`;
    expect(geoFactCandidates(page(body)).map(candidate => candidate.value)).toEqual(["Yes, the calculator is free."]);
  });

  it("strips the markup a site puts inside its own answer", () => {
    const [found] = geoFactCandidates(page(faq([{ q: "Where?", a: "<p>Charts are computed <b>on our servers</b>, never shared.</p>" }])));
    expect(found?.value).toBe("Charts are computed on our servers, never shared.");
  });

  it("finds nothing in a page it could not fetch, in malformed markup, or where there is no FAQ", () => {
    expect(geoFactCandidates({ kind: "unavailable", reason: "fetch_failed", url: "https://www.example.com/" })).toEqual([]);
    expect(geoFactCandidates(page(`<script type="application/ld+json">{ not json }</script>`))).toEqual([]);
    expect(geoFactCandidates(page("<html><body><p>Prose the site never marked up as an answer.</p></body></html>"))).toEqual([]);
  });

  it("emits receipt evidence the contract accepts, numbered after the declared facts", () => {
    const found = discoverGeoFactSourcesV2(page(faq([{ q: "Is it free?", a: "Yes. No account is needed." }])), 3, 24);
    expect(found[0]).toMatchObject({ evidenceId: "F3", key: "Is it free?", value: "Yes. No account is needed.", status: "available", source: "crawl", sourceUrl: "https://www.example.com/", observedAt: "2026-09-04T07:00:00.000Z" });
    // The evidence has to survive the receipt's own validation, or the refresh
    // is refused for the one thing it just learned.
    const body = { schemaVersion: "marketing-geo-kb-enrichment.v2" as const, receiptId: "33333333-3333-4333-8333-333333333333",
      kbId: "44444444-4444-4444-8444-444444444444", targetHost: "example.com", draftVersion: 1, draftHash: "a".repeat(64), profileReference: null,
      createdAt: "2026-09-04T07:00:00.000Z", competitors: [], facts: found,
      gsc: { status: "unavailable" as const, reason: "not_connected" as const, property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } };
    const report = finalizeGeoKbSourceReportV2({ ...body, facts: [...found] });
    expect(parseGeoKbSourceReportV2(report).facts).toHaveLength(1);
    // And it is the discovered entry that survived, not an empty shell.
    expect(parseGeoKbSourceReportV2(report).facts[0]).toMatchObject({ evidenceId: "F3", excerpt: "Yes. No account is needed." });
  });

  it("takes no more than the room the receipt has left", () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({ q: `Question ${index}?`, a: `Answer number ${index} is here.` }));
    expect(discoverGeoFactSourcesV2(page(faq(entries)), 20, 5)).toHaveLength(5);
    expect(discoverGeoFactSourcesV2(page(faq(entries)), 20, 24).map(fact => fact.evidenceId)).toEqual(["F20", "F21", "F22", "F23", "F24"]);
  });
});
