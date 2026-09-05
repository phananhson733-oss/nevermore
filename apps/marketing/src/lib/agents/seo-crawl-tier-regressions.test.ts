// @input  -- real Agent requests and deterministic, offline public-site HTTP responses
// @output -- cross-layer regressions for crawl priority, manual identity and old browsers
// @pos    -- exercises the crawler, report producer and Agent projection together

import { describe, expect, it } from "vitest";
import { crawlPublicSitePreview } from "@sf/sources/crawl-public-preview";
import { buildSeoAuditPayload, normalizeSeoAuditUrl, scanSeoAuditSite } from "@sf/public-tools";
import type { SeoAuditCrawlTier, SeoAuditPayload } from "@sf/public-tools";
import { handleAgentAuditRequest } from "./audit-handler.ts";
import { isAgentAuditSuccessEnvelope } from "./audit-contract.ts";
import type { AgentAuditSuccessData } from "./audit-contract.ts";
import { supportsAgentDisplayVocabulary } from "../../components/agents/agent-display-contract.ts";

async function auditFixture({
  submitted = "https://acme.test/",
  resolved = submitted,
  manual,
  homeHtml = "<html><title>A complete homepage title</title><h1>Home</h1></html>",
  tier = "key-pages",
  legacy = false,
  unavailablePaths = [],
}: {
  submitted?: string;
  resolved?: string;
  manual?: readonly string[];
  homeHtml?: string;
  tier?: SeoAuditCrawlTier;
  legacy?: boolean;
  unavailablePaths?: readonly string[];
} = {}) {
  let clock = 0;
  let payload: SeoAuditPayload | undefined;
  let executedTier: SeoAuditCrawlTier | null = null;
  const requested: string[] = [];
  const response = await handleAgentAuditRequest(new Request("https://gengrowth.ai/api/agents/seo/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: submitted, ...(!legacy ? { tier } : {}), ...(manual ? { extraKeyPages: manual } : {}) }),
  }), "seo", {
    authenticate: async () => "authenticated",
    reportAs: "agent-audit",
    delegate: async (_request, input) => {
      const target = normalizeSeoAuditUrl(input.url);
      if (!target.ok) throw new Error("invalid_fixture_target");
      const raw = await scanSeoAuditSite(target.url, undefined, {
        tier: input.tier ?? "full-site",
        additionalSeedUrls: input.extraKeyPages,
        crawl: async (url, _signal, _progress, selectedTier, additionalSeedUrls = []) => {
          executedTier = selectedTier ?? "full-site";
          return crawlPublicSitePreview(url, undefined, {
            additionalSeedUrls,
            deferSitemapFrontier: selectedTier === "key-pages",
            budgetCeiling: { maxUrls: selectedTier === "key-pages" ? 80 : 2_000, maxDepth: selectedTier === "key-pages" ? 2 : 6, perHostConcurrency: 1 },
            entryResolver: async () => ({ kind: "ok", requestedUrl: url, finalUrl: resolved, firstStatus: url === resolved ? 200 : 307, finalStatus: 200, redirectChain: url === resolved ? [] : [resolved], contentType: "text/html", xRobotsTag: null, body: "<", bytes: 1, bodyComplete: false }),
            engineOptions: {
              guard: async (url) => ({ safe: true, normalizedUrl: url, pinnedIp: "93.184.216.34", reason: null }),
              now: () => clock,
              sleep: async (ms) => { clock += ms; },
            },
            fetcher: { fetch: async (url) => {
              requested.push(url);
              const pathname = new URL(url).pathname;
              if (pathname === "/robots.txt") return new Response("User-agent: *\n");
              if (pathname === "/sitemap.xml" || pathname === "/missing" || unavailablePaths.includes(pathname)) return new Response("Missing", { status: 404 });
              return new Response(pathname === "/" ? homeHtml : "<html><title>A complete manual page title</title><h1>Manual</h1></html>", { headers: { "content-type": "text/html" } });
            } },
          });
        },
      });
      payload = buildSeoAuditPayload(raw);
      return Response.json({ data: payload });
    },
  });
  const body = await response.json() as { data: AgentAuditSuccessData };
  return { response, body, payload: payload!, requested, executedTier };
}

describe("SEO crawl-tier cross-layer regressions", () => {
  it.each([
    ["apex to www", "https://acme.test/", "https://www.acme.test/", "https://acme.test/manual", "https://www.acme.test/manual"],
    ["www to apex", "https://www.acme.test/", "https://acme.test/", "https://www.acme.test/manual", "https://acme.test/manual"],
    ["HTTPS upgrade", "http://acme.test/", "https://acme.test/", "http://acme.test/manual", "https://acme.test/manual"],
    ["tracking parameters", "https://acme.test/", "https://acme.test/", "https://acme.test/manual?utm_source=nav", "https://acme.test/manual"],
    ["query ordering", "https://acme.test/", "https://acme.test/", "https://acme.test/manual?z=2&a=1", "https://acme.test/manual?a=1&z=2"],
  ])("evaluates the fetched manual page after %s", async (_label, submitted, resolved, manual, expected) => {
    const run = await auditFixture({ submitted, resolved, manual: [manual] });
    expect(run.response.status).toBe(200);
    expect(run.requested).toContain(expected);
    expect(run.body.data.result.keyPages).toContainEqual(expect.objectContaining({ url: expected, reason: "manual" }));
    expect(run.body.data.result.keyPageSelection?.manualUnavailableUrls).toEqual([]);
    expect(isAgentAuditSuccessEnvelope(run.body)).toBe(true);
  });

  it("reports an unavailable manual page under the final origin", async () => {
    const run = await auditFixture({ resolved: "https://www.acme.test/", manual: ["https://acme.test/missing?utm_source=nav"] });
    expect(run.body.data.result.keyPageSelection?.manualUnavailableUrls).toEqual(["https://www.acme.test/missing"]);
    expect(isAgentAuditSuccessEnvelope(run.body)).toBe(true);
  });

  it("keeps the exact successful manual slash variant when another row shares its subject", async () => {
    const run = await auditFixture({ homeHtml: '<a href="/pricing">Pricing</a>', manual: ["https://acme.test/pricing/"] });
    expect(run.requested).toEqual(expect.arrayContaining(["https://acme.test/pricing", "https://acme.test/pricing/"]));
    expect(run.body.data.result.keyPages).toContainEqual(expect.objectContaining({ url: "https://acme.test/pricing/", reason: "manual" }));
    expect(run.body.data.result.keyPageSelection?.manualUnavailableUrls).toEqual([]);
  });

  it("does not use a successful slash sibling as proof the requested manual URL succeeded", async () => {
    const run = await auditFixture({ homeHtml: '<a href="/pricing/">Pricing</a>', manual: ["https://acme.test/pricing"], unavailablePaths: ["/pricing"] });
    expect(run.body.data.result.keyPageSelection?.manualUnavailableUrls).toEqual(["https://acme.test/pricing"]);
    expect(run.body.data.result.keyPages?.some((p) => p.reason === "manual")).toBe(false);
  });

  const navigation = Array.from({ length: 30 }, (_, i) => `/z-tool-${String(i).padStart(2, "0")}`);
  const crowdedHome = `<html><nav>${navigation.map((p) => `<a href="${p}">Tool</a>`).join("")}</nav><main>${Array.from({ length: 100 }, (_, i) => `<a href="/a-article-${i}">Article</a>`).join("")}</main></html>`;

  it("collects every navigation page before ordinary homepage links spend the shallow budget", async () => {
    const run = await auditFixture({ homeHtml: crowdedHome });
    expect(run.payload.result.coverage.pagesInspected).toBeLessThanOrEqual(80);
    expect(run.payload.result.siteResources.navigationUrls).toHaveLength(30);
    expect(run.body.data.result.keyPages?.filter((p) => p.reason === "navigation")).toHaveLength(30);
  });

  it("keeps the pre-tier browser's five-field bounded response and known limitation vocabulary", async () => {
    const run = await auditFixture({ legacy: true, homeHtml: `<html><nav>${navigation.map((p) => `<a href="${p}">Tool</a>`).join("")}</nav></html>` });
    expect(run.response.status).toBe(200);
    expect(run.executedTier).toBe("key-pages");
    const pages = run.body.data.result.keyPages ?? [];
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThanOrEqual(24);
    for (const page of pages) expect(Object.keys(page).sort()).toEqual(["depth", "inboundLinks", "metaDescription", "title", "url"]);
    expect(run.body.data.result.records.some((r) => r.limitation === "full_site_only")).toBe(false);
    expect(run.payload.result.records.some((r) => r.limitation === "full_site_only")).toBe(true);
  });

  it("keeps every selected page and the current vocabulary for explicit-tier clients", async () => {
    const run = await auditFixture({ homeHtml: `<html><nav>${navigation.map((p) => `<a href="${p}">Tool</a>`).join("")}</nav></html>` });
    expect(run.body.data.result.keyPages).toHaveLength(31);
    expect(isAgentAuditSuccessEnvelope(run.body)).toBe(true);
    expect(supportsAgentDisplayVocabulary(run.body.data, "seo")).toBe(true);
    expect(run.body.data.result.records.filter((r) => r.limitation === "full_site_only")).toHaveLength(3);
  });
});
