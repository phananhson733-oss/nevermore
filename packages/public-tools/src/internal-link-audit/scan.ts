import {
  crawlPublicSitePreview,
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

export type InternalLinkAuditScanErrorCode =
  | "blocked"
  | "scan_failed"
  | "timeout"
  /** The site's robots.txt forbids this crawler. Not a failure, and not a finding. */
  | "robots_disallowed"
  /** robots.txt could not be read, so RFC 9309 §2.3.1.4 forbids crawling. */
  | "robots_unreachable";

export class InternalLinkAuditScanError extends Error {
  readonly code: InternalLinkAuditScanErrorCode;
  constructor(code: InternalLinkAuditScanErrorCode) {
    super(code);
    this.name = "InternalLinkAuditScanError";
    this.code = code;
  }
}

export type InternalLinkAuditCrawler = (
  url: string,
  signal?: AbortSignal,
) => Promise<CrawlRaw>;
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
    return (
      parsed.origin === origin && parsed.pathname === "/" && !parsed.search
    );
  } catch {
    return false;
  }
}

export function buildInternalLinkAuditPayload(
  raw: CrawlRaw,
): InternalLinkAuditPayload {
  const pages = raw.pages;
  const idByUrl = new Map(
    pages.map((page, index) => [page.subjectUrl, nodeId(index)]),
  );
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
      inbound.set(
        link.targetSubjectUrl,
        (inbound.get(link.targetSubjectUrl) ?? 0) + 1,
      );
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

  // A truncated crawl cannot tell an orphan from a page whose inbound links
  // live on a page we never reached, so the graph must not paint one as the
  // other. Kept in step with the finding built below.
  const orphanKind =
    raw.availability === "available"
      ? "orphan_candidate"
      : "orphan_undetermined";

  const nodes: InternalLinkAuditNode[] = pages.map((page, index) => {
    const inboundLinks = inbound.get(page.subjectUrl) ?? 0;
    const kind = isHome(page.subjectUrl, raw.origin)
      ? "home"
      : page.projection.sitemapMember && inboundLinks === 0
        ? orphanKind
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
    if (
      node.kind === "orphan_candidate" ||
      node.kind === "orphan_undetermined"
    ) {
      /**
       * A truncated crawl cannot support an orphan claim at all.
       *
       * "No crawled page links here" and "we ran out of budget before reaching
       * the pages that link here" produce identical evidence, and the crawler
       * stops at roughly 950 pages on every site — 240s of wall clock at the
       * 250ms host pacer — so any site larger than that truncates by default.
       *
       * This used to keep priority P1 and the assertive title, changing only
       * the `limitation` string, which the UI hides until the card is opened.
       * The reader saw a confident P1 orphan finding that the run could not
       * support. Title and detail are the always-visible fields, so the honest
       * answer has to live there.
       */
      const undetermined = raw.availability !== "available";
      findings.push(
        undetermined
          ? {
              id: `orphan-${node.id}`,
              priority: "P2",
              kind: "orphan_undetermined",
              title: `${pagePath(node.url)} could not be checked for inbound links`,
              detail:
                "The page is in the observed sitemap and no crawled page linked to it, but this crawl stopped early — the pages that link here may simply not have been reached. This is not evidence of an orphan.",
              evidence: `0 inbound HTML links among the ${pages.length} page(s) actually crawled; sitemap member: yes; crawl depth: ${node.depth}. Crawl stopped: ${raw.stopReason ?? "coverage incomplete"}.`,
              limitation:
                "Re-run against a smaller section of the site, or check this URL's inbound links directly, before treating it as an orphan.",
              ...common,
            }
          : {
              id: `orphan-${node.id}`,
              priority: "P1",
              kind: "orphan_candidate",
              title: `${pagePath(node.url)} is a sitemap-only orphan candidate`,
              detail:
                "The page was listed in the observed sitemap but no crawled HTML page linked to it.",
              evidence: `0 observed inbound HTML links; sitemap member: yes; crawl depth: ${node.depth}.`,
              limitation:
                "JavaScript-rendered links and links outside this synchronous crawl are not evaluated.",
              ...common,
            },
      );
    } else if (node.inboundLinks <= 1 && node.kind !== "home") {
      findings.push({
        id: `inbound-${node.id}`,
        priority: "P2",
        kind: "low_inbound",
        title: `${pagePath(node.url)} has limited observed internal support`,
        detail:
          "The page has one or fewer observed inbound HTML links in this synchronous crawl.",
        evidence: `${node.inboundLinks} observed inbound HTML link(s); depth: ${node.depth}.`,
        limitation:
          "Navigation, JavaScript-rendered links, and uncrawled pages can change this count.",
        ...common,
      });
    } else if (node.depth >= 3) {
      findings.push({
        id: `depth-${node.id}`,
        priority: "P2",
        kind: "deep_page",
        title: `${pagePath(node.url)} is at observed crawl depth ${node.depth}`,
        detail:
          "The synchronous crawler reached this page after at least three crawl traversals from an allowed seed.",
        evidence: `Observed crawl depth: ${node.depth}; inbound HTML links: ${node.inboundLinks}.`,
        limitation:
          "Sitemap entries can be crawl seeds, so this is not asserted as a homepage click count or ranking prediction.",
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
      detail: `The target ${pagePath(target)} was not collected in this synchronous crawl.`,
      evidence: `Observed source: ${pagePath(source.source)}; anchor: ${source.anchorText ?? "not provided"}.`,
      limitation:
        "This is not called a broken link: the target may be outside the collected static-HTML coverage, excluded by robots, or unavailable within this run's resource boundaries.",
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
      schemaVersion: "internal_link_audit.v2",
      scope: "bounded_same_origin_static_html_crawl",
      completedAt: raw.capturedAt,
    },
    report,
  );
}

export async function scanInternalLinkAuditSite(
  url: string,
  /**
   * Aborts the crawl when the client goes away. Without it an accepted POST
   * commits the full budget — up to 4,500 requests at the target — no matter
   * what the caller does next.
   */
  signal?: AbortSignal,
  /** Offline test seam. */
  crawl: InternalLinkAuditCrawler = crawlPublicSitePreview,
): Promise<CrawlRaw> {
  try {
    const raw = await crawl(url, signal);
    if (raw.availability === "unavailable") {
      // "The site told us not to crawl it" and "we could not reach the site"
      // are different answers, and neither is the generic failure the caller
      // used to receive.
      if (raw.stopReason === "robots_disallowed") {
        throw new InternalLinkAuditScanError("robots_disallowed");
      }
      if (raw.stopReason === "robots_unreachable") {
        throw new InternalLinkAuditScanError("robots_unreachable");
      }
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
