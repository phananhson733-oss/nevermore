import { describe, expect, it, vi } from "vitest";
import type { PublicResourceResult } from "@sf/sources/public-http";
import { collectVisibilitySiteEvidence, type GeoSiteEvidenceDependencies } from "./site-index.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";

function response(url: string, body: string, contentType = "text/html", complete = true): PublicResourceResult { return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200, redirectChain: [], body, bodyComplete: complete, bytes: new TextEncoder().encode(body).byteLength, contentType, xRobotsTag: null }; }
function deps(pages: Readonly<Record<string, PublicResourceResult>>, calls: string[]): GeoSiteEvidenceDependencies { return { now: () => new Date("2026-08-31T00:02:00.000Z"), fetchResource: async (url) => { calls.push(url); return pages[url] ?? { kind: "error", code: "network" }; }, renderPage: async () => { throw new Error("not expected"); } }; }
const robots = (url: string, text = "User-agent: *\nAllow: /") => response(url, text, "text/plain");
describe("actual bounded site/reference reads", () => {
  it("reads the declared/reachable inventory and classifies cited pages from actual HTML", async () => {
    const calls: string[] = [];
    const value = visibilityReportFixtureV2();
    const sample = value.questions[0]!.samples[0]!;
    const report = visibilityReportFixtureV2({ samples: [{ ...sample, citedUrls: ["https://publisher.test/tools"], citedDomains: ["publisher.test"] }] });
    const evidence = await collectVisibilitySiteEvidence(report, deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt"),
      "https://acme.test/sitemap.xml": response("https://acme.test/sitemap.xml", '<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/pricing</loc></url></urlset>', "application/xml"),
      "https://acme.test/": response("https://acme.test/", '<html><title>Acme homepage</title><body><h1>Acme</h1><a href="/pricing">Pricing</a><a href="https://outside.test/">External</a></body></html>'),
      "https://acme.test/pricing": response("https://acme.test/pricing", '<html><title>Pricing</title><body><h1>Plans</h1>Monthly plan details.</body></html>'),
      "https://publisher.test/robots.txt": robots("https://publisher.test/robots.txt"),
      "https://publisher.test/tools": response("https://publisher.test/tools", '<html><title>Best analytics tools</title><body><h1>Best analytics tools</h1><ol><li>Rival</li><li>Other</li></ol></body></html>'),
    }, calls));
    expect(evidence.index).toMatchObject({ status: "complete", discoveredCount: 2, scope: "declared_and_reachable_inventory" });
    expect(evidence.index.pages).toHaveLength(2);
    expect(evidence.references[0]).toMatchObject({ state: "read", pageType: "listicle", ownPresence: false, bodyComplete: true, sampleSlots: [sample.slotId] });
    expect(evidence.references[0]?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).not.toContain("https://outside.test/");
  });
  it("never turns incomplete inventory or failed reference reads into absence", async () => {
    const calls: string[] = [];
    const sample = visibilityReportFixtureV2().questions[0]!.samples[0]!;
    const report = visibilityReportFixtureV2({ samples: [{ ...sample, citedUrls: ["https://publisher.test/tools"], citedDomains: ["publisher.test"] }] });
    const evidence = await collectVisibilitySiteEvidence(report, deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt"),
      "https://acme.test/sitemap.xml": response("https://acme.test/sitemap.xml", '<urlset><url><loc>https://acme.test/</loc></url>', "application/xml", false),
      "https://acme.test/": response("https://acme.test/", '<html><body>Partial homepage</body></html>', "text/html", false),
      "https://publisher.test/robots.txt": robots("https://publisher.test/robots.txt"),
    }, calls));
    expect(evidence.index.status).toBe("partial");
    expect(evidence.index.limits).toContain("incomplete_inventory");
    expect(evidence.references[0]).toMatchObject({ state: "unavailable", ownPresence: null, pageType: "unavailable" });
  });
  it("obeys robots and does not fetch blocked pages", async () => {
    const calls: string[] = [];
    const evidence = await collectVisibilitySiteEvidence(visibilityReportFixtureV2(), deps({ "https://acme.test/robots.txt": robots("https://acme.test/robots.txt", "User-agent: *\nDisallow: /") }, calls));
    expect(calls).toEqual(["https://acme.test/robots.txt"]);
    expect(evidence.index.status).toBe("unavailable");
    expect(evidence.index.limits).toContain("robots_blocked");
  });
  it("keeps an actual presence excerpt at the matched text offset", async () => {
    const calls: string[] = [];
    const sample = visibilityReportFixtureV2().questions[0]!.samples[0]!;
    const report = visibilityReportFixtureV2({ samples: [{ ...sample, citedUrls: ["https://publisher.test/tools"], citedDomains: ["publisher.test"] }] });
    const evidence = await collectVisibilitySiteEvidence(report, deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt", "User-agent: *\nDisallow: /"),
      "https://publisher.test/robots.txt": robots("https://publisher.test/robots.txt"),
      "https://publisher.test/tools": response("https://publisher.test/tools", `<html><body>${"Intro content. ".repeat(50)}Acme is listed here.</body></html>`),
    }, calls));
    expect(evidence.references[0]?.ownPresenceExcerpt).toContain("Acme");
  });
  it("does not split an emoji when keeping the presence context window", async () => {
    const sample = visibilityReportFixtureV2().questions[0]!.samples[0]!;
    const report = visibilityReportFixtureV2({ samples: [{ ...sample, citedUrls: ["https://publisher.test/tools"], citedDomains: ["publisher.test"] }] });
    const text = "😀" + "a".repeat(38) + " Acme is listed.";
    const evidence = await collectVisibilitySiteEvidence(report, deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt", "User-agent: *\nDisallow: /"),
      "https://publisher.test/robots.txt": robots("https://publisher.test/robots.txt"),
      "https://publisher.test/tools": response("https://publisher.test/tools", `<html><body>${text}</body></html>`),
    }, []));
    expect(evidence.references[0]?.ownPresenceExcerpt).toBe(text);
  });
  it("normalizes read headings without accepting unsupported text decoding as complete", async () => {
    const common = {
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt"),
      "https://acme.test/sitemap.xml": response("https://acme.test/sitemap.xml", "<urlset><url><loc>https://acme.test/</loc></url></urlset>", "application/xml"),
    };
    const normalized = await collectVisibilitySiteEvidence(visibilityReportFixtureV2(), deps({ ...common, "https://acme.test/": response("https://acme.test/", "<html><title>Cafe\u0301</title><body><h1>Cafe\u0301</h1></body></html>") }, []));
    expect(normalized.index.pages[0]?.title).toBe("Café");
    const encoded = await collectVisibilitySiteEvidence(visibilityReportFixtureV2(), deps({ ...common, "https://acme.test/": response("https://acme.test/", "<html><body>text bytes</body></html>", "text/html; charset=gb2312") }, []));
    expect(encoded.index.status).toBe("partial");
    expect(encoded.index.pages[0]?.state).toBe("unavailable");
  });
  it("uses the robots-declared sitemap and records its read provenance", async () => {
    const calls: string[] = [];
    const evidence = await collectVisibilitySiteEvidence(visibilityReportFixtureV2(), deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt", "User-agent: *\nAllow: /\nSitemap: https://acme.test/custom.xml"),
      "https://acme.test/custom.xml": response("https://acme.test/custom.xml", "<urlset><url><loc>https://acme.test/</loc></url></urlset>", "application/xml"),
      "https://acme.test/": response("https://acme.test/", "<html><body>Homepage</body></html>"),
    }, calls));
    expect(evidence.index.status).toBe("complete");
    expect(evidence.index.inventorySources[0]).toMatchObject({ url: "https://acme.test/custom.xml", httpStatus: 200, bodyComplete: true });
    expect(evidence.index.inventorySources[0]?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).not.toContain("https://acme.test/sitemap.xml");
  });
  it("prioritizes only discovered feature-tool URLs and real anchor labels from the exact frozen Profile hints", async () => {
    const calls: string[] = [], report = visibilityReportFixtureV2();
    const evidence = await collectVisibilitySiteEvidence(report, deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt"),
      "https://acme.test/sitemap.xml": response("https://acme.test/sitemap.xml", "<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/info-first</loc></url><url><loc>https://acme.test/tools/invoice-reminder</loc></url></urlset>", "application/xml"),
      "https://acme.test/": response("https://acme.test/", '<html><body><a href="/opaque">Invoice reminder</a></body></html>'),
      "https://acme.test/info-first": response("https://acme.test/info-first", "<html><body>About the company</body></html>"),
      "https://acme.test/tools/invoice-reminder": response("https://acme.test/tools/invoice-reminder", "<html><body>Tool page</body></html>"),
      "https://acme.test/opaque": response("https://acme.test/opaque", "<html><body>Tool page</body></html>"),
    }, calls), { snapshotId: report.manifest.snapshotId, contextHash: "b".repeat(64), coreFeatures: ["Invoice reminder"] });
    expect(evidence.index.pages.map((page) => page.url)).toEqual(["https://acme.test/", "https://acme.test/opaque", "https://acme.test/tools/invoice-reminder", "https://acme.test/info-first"]);
    expect(evidence.index.priority).toMatchObject({ method: "frozen_profile_core_features.v1", snapshotId: report.manifest.snapshotId, contextHash: "b".repeat(64), featureCount: 1 });
    expect(calls).not.toContain("https://acme.test/invoice-reminder");
  });
  it("has an outer deadline even if an injected transport never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = collectVisibilitySiteEvidence(visibilityReportFixtureV2(), { now: () => new Date(), fetchResource: async () => new Promise(() => undefined), renderPage: async () => { throw new Error("unused"); } });
      await vi.advanceTimersByTimeAsync(5_001);
      const evidence = await pending;
      expect(evidence.index.status).toBe("unavailable");
    } finally { vi.useRealTimers(); }
  });
  it("does not label an own-site redirect as a missing third-party listing", async () => {
    const calls: string[] = [];
    const sample = visibilityReportFixtureV2().questions[0]!.samples[0]!;
    const report = visibilityReportFixtureV2({ samples: [{ ...sample, citedUrls: ["https://publisher.test/tools"], citedDomains: ["publisher.test"] }] });
    const redirected = response("https://publisher.test/tools", "<html><title>Best tools</title><body><ol><li>Other</li><li>Rival</li></ol></body></html>");
    if (redirected.kind !== "ok") throw new Error("fixture");
    const evidence = await collectVisibilitySiteEvidence(report, deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt", "User-agent: *\nDisallow: /"),
      "https://publisher.test/robots.txt": robots("https://publisher.test/robots.txt"),
      "https://publisher.test/tools": { ...redirected, finalUrl: "https://acme.test/guide" },
    }, calls));
    expect(evidence.references[0]).toMatchObject({ state: "unavailable", reason: "blocked", ownPresence: null, pageType: "unavailable" });
  });
  it("does not declare missing content from an unread client-rendered shell", async () => {
    const calls: string[] = [];
    const evidence = await collectVisibilitySiteEvidence(visibilityReportFixtureV2(), deps({
      "https://acme.test/robots.txt": robots("https://acme.test/robots.txt"),
      "https://acme.test/sitemap.xml": response("https://acme.test/sitemap.xml", "<urlset><url><loc>https://acme.test/</loc></url></urlset>", "application/xml"),
      "https://acme.test/": response("https://acme.test/", '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'),
    }, calls));
    expect(evidence.index.status).toBe("partial");
    expect(evidence.index.pages[0]?.bodyComplete).toBe(false);
    expect(evidence.index.pages[0]?.ownPresence).toBeNull();
  });
  it("bounds a stalled renderer and records its missing content as incomplete", async () => {
    vi.useFakeTimers();
    try {
      const input = deps({
        "https://acme.test/robots.txt": robots("https://acme.test/robots.txt"),
        "https://acme.test/sitemap.xml": response("https://acme.test/sitemap.xml", "<urlset><url><loc>https://acme.test/</loc></url></urlset>", "application/xml"),
        "https://acme.test/": response("https://acme.test/", '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'),
      }, []);
      const pending = collectVisibilitySiteEvidence(visibilityReportFixtureV2(), { ...input, renderPage: async () => new Promise(() => undefined) });
      await vi.advanceTimersByTimeAsync(12_001);
      expect((await pending).index.status).toBe("partial");
    } finally { vi.useRealTimers(); }
  });
});
