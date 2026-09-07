import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";
import { buildSeoAuditPayload } from "@sf/public-tools";
import type { SeoAuditRaw } from "@sf/public-tools";
import { handleAgentAuditRequest } from "./audit-handler";
import { allAgentAuditRecords, isAgentAuditSuccessEnvelope } from "./audit-contract";
import { buildAgentAuditViewModel } from "../../components/agents/agent-audit-model";
import { buildAgentIssueModel } from "../../components/agents/agent-issue-model";

const origin = "https://acme.test";
function page(path: string, noindex: boolean, sitemapMember: boolean, links: string[] = []): CrawlPageRecord {
  const url = origin + path;
  return { subjectUrl: url, depth: path === "/" ? 0 : 1, projection: {
    fetchUrl: url, status: 200, finalStatus: 200, redirectChain: [], canonicalTarget: url,
    robotsIndexable: !noindex, robotsDirectives: noindex ? ["noindex"] : [], title: path,
    metaDescription: path, h1: [path], headings: [path], wordCount: 300,
    internalOutlinks: links.map(target => ({ targetSubjectUrl: origin + target, rel: null, anchorText: target })),
    jsonLd: { types: ["WebPage"], errorCount: 0 }, sitemapMember, bodyExcerpt: "Body", paragraphs: ["Body"],
    responseMs: 42, contentType: "text/html",
  } };
}

async function run(incomplete: boolean, sitemapFetched = true) {
  const raw: SeoAuditRaw = { origin, host: "acme.test", requestedUrl: origin + "/", crawlTier: "full-site",
    pages: [page("/", false, true, ["/pricing", "/account", "/pricing"]),
      page("/pricing", true, true), page("/account", true, false), page("/orphan", false, false, ["/orphan"])],
    robots: { fetched: true, groups: [{ userAgent: "*", disallow: [], allow: ["/"] }], sitemaps: [] },
    sitemap: { fetched: sitemapFetched, urlCount: 2, subjectUrls: [origin + "/", origin + "/pricing"] },
    availability: "available", capturedAt: "2026-09-07T00:00:00.000Z",
    sourceWindow: { start: "2026-09-07T00:00:00.000Z", end: "2026-09-07T00:00:00.000Z" }, stopReason: null,
    providerUsage: { urlsSkipped: incomplete ? 1 : 0, urlsBlocked: 0, urlsDisallowed: 0, urlsErrored: 0 }, limitation: "Fixture",
  };
  const payload = buildSeoAuditPayload(raw);
  const response = await handleAgentAuditRequest(new Request("https://gengrowth.ai/api/agents/seo/audit", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: origin, tier: "full-site" }),
  }), "seo", { reportAs: "agent-audit", authenticate: async () => "authenticated", delegate: async () => Response.json({ data: payload }) });
  const envelope: unknown = await response.json();
  if (!isAgentAuditSuccessEnvelope(envelope)) throw new Error("Invalid live producer envelope");
  const data = envelope.data;
  const view = buildAgentAuditViewModel({ agent: "seo", locale: "en", data, coreFeatures: [], context: {
    reviewState: "confirmed", productName: "Acme", primaryIcp: "Teams", country: "US", locale: "en-US", device: "mobile",
    pageType: "homepage", targetQuery: "seo", auditScope: "site-first",
  } });
  const issues = buildAgentIssueModel({ agent: "seo", checks: view.evaluatedChecks, records: allAgentAuditRecords(data),
    targetUrl: data.result.targetUrl, inspectedTargetUrl: data.result.inspectedTargetUrl ?? undefined, keyPageReach: view.keyPageReach });
  return { payload, view, issues };
}

describe("SEO acceptance real producer to page verdict", () => {
  it.each([false, true])("preserves positive and unknown inbound evidence with incomplete=%s", async incomplete => {
    const { view, issues } = await run(incomplete);
    const outcomes = view.keyPageReach.get("6.1")!.outcomes;
    const result = (path: string) => outcomes.find(entry => entry.page.url === origin + path)?.result;
    expect(result("/pricing")).toBe("pass");
    expect(result("/account")).toBe("pass");
    expect(result("/")).toBe(incomplete ? "excluded" : "warning");
    expect(result("/orphan")).toBe(incomplete ? "excluded" : "warning");
    expect(issues.actionable.filter(issue => issue.check.check.id === "1.3").map(issue => issue.affected.urls)).toEqual([[origin + "/pricing"]]);
    expect(issues.observedOnly.filter(issue => issue.check.check.id === "1.3").map(issue => issue.affected.urls)).toEqual([[origin + "/account"]]);
  });

  it("does not use an unfetched sitemap as an index declaration", async () => {
    const { payload, issues } = await run(false, false);
    expect(payload.result.records.find(record => record.id === "noindex_directive")?.observations[0]?.values)
      .toContainEqual({ label: "sitemap_member", value: null });
    expect(issues.actionable.filter(issue => issue.check.check.id === "1.3")).toHaveLength(0);
    expect(issues.observedOnly.filter(issue => issue.check.check.id === "1.3")).toHaveLength(2);
  });
});
