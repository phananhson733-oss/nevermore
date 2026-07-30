import {
  crawlPublicSitePreview,
  PUBLIC_PREVIEW_CRAWL_BUDGET,
  type CrawlRaw,
} from "@sf/sources/crawl-public-preview";
import { createPublicToolResult } from "../contract.ts";
import type {
  InternalLinkAuditEdge,
  InternalLinkAuditFinding,
  InternalLinkAuditNode,
  InternalLinkAuditPayload,
  InternalLinkAuditReport,
} from "./types.ts";

const MAX_EDGES = 80;
const MAX_FINDINGS = 12;

export type InternalLinkAuditScanErrorCode = "blocked" | "scan_failed" | "timeout";

export class InternalLinkAuditScanError extends Error {
  readonly code: InternalLinkAuditScanErrorCode;
  constructor(code: InternalLinkAuditScanErrorCode) {
    super(code);
    this.name = "InternalLinkAuditScanError";
    this.code = code;
  }
}

export type InternalLinkAuditCrawler = (url: string) => Promise<CrawlRaw>;
/** Opaque raw crawl shape passed only between public-tool orchestration and UI handlers. */
export type InternalLinkAuditRaw = CrawlRaw;

function nodeId(index: number): string {
  return `page-${String(index + 1).padStart(2, "0")}`;
}

function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

function isHome(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname === "/" && !parsed.search;
  } catch {
    return false;
  }
}

export function buildInternalLinkAuditPayload(
  raw: CrawlRaw,
): InternalLinkAuditPayload {
  const pages = raw.pages.slice(0, PUBLIC_PREVIEW_CRAWL_BUDGET.maxUrls);
  const idByUrl = new Map(pages.map((page, index) => [page.subjectUrl, nodeId(index)]));
  const inbound = new Map<string, number>();
  const firstInbound = new Map<
    string,
    { readonly source: string; readonly anchorText: string | null }
  >();
  const unresolved = new Map<
    string,
    { readonly source: string; readonly anchorText: string | null }
  >();
  const edges: InternalLinkAuditEdge[] = [];

  for (const page of pages) {
    for (const link of page.projection.internalOutlinks) {
      const targetId = idByUrl.get(link.targetSubjectUrl);
      if (!targetId) {
        if (!unresolved.has(link.targetSubjectUrl)) {
          unresolved.set(link.targetSubjectUrl, {
            source: page.subjectUrl,
            anchorText: link.anchorText,
          });
        }
        continue;
      }
      inbound.set(link.targetSubjectUrl, (inbound.get(link.targetSubjectUrl) ?? 0) + 1);
      if (!firstInbound.has(link.targetSubjectUrl)) {
        firstInbound.set(link.targetSubjectUrl, {
          source: page.subjectUrl,
          anchorText: link.anchorText,
        });
      }
      if (edges.length < MAX_EDGES) {
        edges.push({
          from: idByUrl.get(page.subjectUrl) ?? "",
          to: targetId,
          anchorText: link.anchorText,
        });
      }
    }
  }

  const nodes: InternalLinkAuditNode[] = pages.map((page, index) => {
    const inboundLinks = inbound.get(page.subjectUrl) ?? 0;
    const kind = isHome(page.subjectUrl, raw.origin)
      ? "home"
      : page.projection.sitemapMember && inboundLinks === 0
        ? "orphan_candidate"
        : page.depth >= 3
          ? "deep"
          : "page";
    return {
      id: nodeId(index),
      url: page.subjectUrl,
      title: page.projection.title,
      depth: page.depth,
      inboundLinks,
      outboundLinks: page.projection.internalOutlinks.length,
      statusCode: page.projection.finalStatus,
      sitemapMember: page.projection.sitemapMember,
      kind,
    };
  });

  const findings: InternalLinkAuditFinding[] = [];
  for (const node of nodes) {
    const inboundSource = firstInbound.get(node.url);
    const common = {
      nodeId: node.id,
      suggestedSourceUrl: inboundSource?.source ?? null,
      observedAnchorText: inboundSource?.anchorText ?? null,
    };
    if (node.kind === "orphan_candidate") {
      findings.push({
        id: `orphan-${node.id}`,
        priority: "P1",
        kind: "orphan_candidate",
        title: `${pagePath(node.url)} is a sitemap-only orphan candidate`,
        detail: "The page was listed in the observed sitemap but no crawled HTML page linked to it.",
        evidence: `0 observed inbound HTML links; sitemap member: yes; crawl depth: ${node.depth}.`,
        limitation:
          raw.availability === "partial"
            ? "Coverage is partial, so this is a candidate rather than a definitive orphan."
            : "JavaScript-rendered links and links outside the bounded crawl are not evaluated.",
        ...common,
      });
    } else if (node.inboundLinks <= 1 && node.kind !== "home") {
      findings.push({
        id: `inbound-${node.id}`,
        priority: "P2",
        kind: "low_inbound",
        title: `${pagePath(node.url)} has limited observed internal support`,
        detail: "The page has one or fewer observed inbound HTML links in this bounded crawl.",
        evidence: `${node.inboundLinks} observed inbound HTML link(s); depth: ${node.depth}.`,
        limitation: "Navigation, JavaScript-rendered links, and uncrawled pages can change this count.",
        ...common,
      });
    } else if (node.depth >= 3) {
      findings.push({
        id: `depth-${node.id}`,
        priority: "P2",
        kind: "deep_page",
        title: `${pagePath(node.url)} is at observed crawl depth ${node.depth}`,
        detail: "The bounded crawler reached this page after at least three crawl traversals from an allowed seed.",
        evidence: `Observed crawl depth: ${node.depth}; inbound HTML links: ${node.inboundLinks}.`,
        limitation: "Sitemap entries can be crawl seeds, so this is not asserted as a homepage click count or ranking prediction.",
        ...common,
      });
    }
  }
  for (const [target, source] of unresolved) {
    const sourceId = idByUrl.get(source.source);
    if (!sourceId) continue;
    findings.push({
      id: `unresolved-${findings.length + 1}`,
      priority: "P2",
      kind: "unresolved_target",
      nodeId: sourceId,
      title: `${pagePath(source.source)} links to an unverified target`,
      detail: `The target ${pagePath(target)} was not collected in this bounded crawl.`,
      evidence: `Observed source: ${pagePath(source.source)}; anchor: ${source.anchorText ?? "not provided"}.`,
      limitation:
        "This is not called a broken link: the target may be outside the page/depth/time budget or excluded by robots.",
      suggestedSourceUrl: source.source,
      observedAnchorText: source.anchorText,
    });
  }

  const report: InternalLinkAuditReport = {
    targetUrl: `${raw.origin}/`,
    availability: raw.availability,
    stopReason: raw.stopReason,
    limitation: raw.limitation,
    pagesCrawled: pages.length,
    maxPages: PUBLIC_PREVIEW_CRAWL_BUDGET.maxUrls,
    linksObserved: pages.reduce(
      (total, page) => total + page.projection.internalOutlinks.length,
      0,
    ),
    sitemapFetched: raw.sitemap.fetched,
    sitemapUrlsObserved: raw.sitemap.urlCount,
    nodes,
    edges,
    findings: findings.slice(0, MAX_FINDINGS),
  };
  return createPublicToolResult(
    {
      tool: "internal_link_audit",
      schemaVersion: "internal_link_audit.v1",
      scope: "bounded_same_origin_static_html_crawl",
      completedAt: raw.capturedAt,
    },
    report,
  );
}

export async function scanInternalLinkAuditSite(
  url: string,
  crawl: InternalLinkAuditCrawler = crawlPublicSitePreview,
): Promise<CrawlRaw> {
  try {
    const raw = await crawl(url);
    if (raw.availability === "unavailable") {
      throw new InternalLinkAuditScanError("scan_failed");
    }
    return raw;
  } catch (error) {
    if (error instanceof InternalLinkAuditScanError) throw error;
    if (error instanceof Error && /max_duration|aborted/i.test(error.message)) {
      throw new InternalLinkAuditScanError("timeout");
    }
    throw new InternalLinkAuditScanError("scan_failed");
  }
}
