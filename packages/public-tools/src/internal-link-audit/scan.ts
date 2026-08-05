import {
  crawlPublicSitePreview,
  type CrawlRaw,
} from "@sf/sources/crawl-public-preview";
import { subjectUrlOf } from "@sf/sources/canonical-url";
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

interface ClickPaths {
  readonly depthByUrl: ReadonlyMap<string, number>;
  readonly parentByUrl: ReadonlyMap<string, string>;
}

/**
 * Compute reachability after collection so sitemap seeds improve coverage
 * without pretending to be HTML links from the homepage. Traversal uses every
 * observed outlink; the bounded public edge projection is display-only.
 */
function buildClickPaths(
  pages: CrawlRaw["pages"],
  origin: string,
): ClickPaths {
  const pageByUrl = new Map(pages.map((page) => [page.subjectUrl, page]));
  const homeUrl = pages.find((page) => isHome(page.subjectUrl, origin))?.subjectUrl;
  if (!homeUrl) {
    return { depthByUrl: new Map(), parentByUrl: new Map() };
  }

  const depthByUrl = new Map<string, number>([[homeUrl, 0]]);
  const parentByUrl = new Map<string, string>();
  const queue = [homeUrl];
  for (let index = 0; index < queue.length; index += 1) {
    const sourceUrl = queue[index];
    if (!sourceUrl) continue;
    const source = pageByUrl.get(sourceUrl);
    const sourceDepth = depthByUrl.get(sourceUrl);
    if (!source || sourceDepth === undefined) continue;
    for (const link of source.projection.internalOutlinks) {
      const targetUrl = link.targetSubjectUrl;
      if (!pageByUrl.has(targetUrl) || depthByUrl.has(targetUrl)) continue;
      depthByUrl.set(targetUrl, sourceDepth + 1);
      parentByUrl.set(targetUrl, sourceUrl);
      queue.push(targetUrl);
    }
  }
  return { depthByUrl, parentByUrl };
}

function isActionableIndexPage(node: InternalLinkAuditNode): boolean {
  return (
    node.robotsIndexable &&
    (node.canonicalTarget === null ||
      subjectUrlOf(node.canonicalTarget) === node.url)
  );
}

/**
 * Exact projected-content fingerprint. The raw response body is deliberately
 * not retained, so this combines the bounded body facts that survive the
 * crawl. Requiring substantial text or link evidence avoids grouping thin
 * template-only pages on an empty signature.
 */
function contentFingerprint(page: CrawlRaw["pages"][number]): string | null {
  const projection = page.projection;
  if (
    (projection.wordCount ?? 0) < 50 &&
    projection.paragraphs.length < 2 &&
    projection.internalOutlinks.length < 5
  ) {
    return null;
  }
  return JSON.stringify([
    projection.title,
    projection.metaDescription,
    projection.h1,
    projection.headings,
    projection.wordCount,
    projection.bodyExcerpt,
    projection.paragraphs,
    projection.internalOutlinks
      .map((link) => link.targetSubjectUrl)
      .sort(),
  ]);
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
  const clickPaths = buildClickPaths(pages, raw.origin);

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
    const clickDepth = clickPaths.depthByUrl.get(page.subjectUrl) ?? null;
    const parentUrl = clickPaths.parentByUrl.get(page.subjectUrl);
    const canonicalTarget = page.projection.canonicalTarget;
    const indexableCanonical =
      page.projection.robotsIndexable &&
      (canonicalTarget === null ||
        subjectUrlOf(canonicalTarget) === page.subjectUrl);
    const kind = isHome(page.subjectUrl, raw.origin)
      ? "home"
      : indexableCanonical && page.projection.sitemapMember && inboundLinks === 0
        ? orphanKind
        : indexableCanonical && clickDepth === null
          ? "unreachable"
          : indexableCanonical && clickDepth !== null && clickDepth >= 4
            ? "deep"
            : "page";
    return {
      id: nodeId(index),
      url: page.subjectUrl,
      title: page.projection.title,
      crawlDepth: page.depth,
      clickDepth,
      primaryParentId: parentUrl ? (idByUrl.get(parentUrl) ?? null) : null,
      inboundLinks,
      outboundLinks: page.projection.internalOutlinks.length,
      statusCode: page.projection.finalStatus,
      sitemapMember: page.projection.sitemapMember,
      robotsIndexable: page.projection.robotsIndexable,
      canonicalTarget,
      kind,
    };
  });

  const findings: InternalLinkAuditFinding[] = [];
  const eligibleNodes = nodes.filter(
    (node) => node.kind !== "home" && isActionableIndexPage(node),
  );
  const orphanNodes = eligibleNodes.filter(
    (node) =>
      node.kind === "orphan_candidate" || node.kind === "orphan_undetermined",
  );
  const unreachableNodes = eligibleNodes.filter(
    (node) => node.kind === "unreachable",
  );
  const deepNodes = eligibleNodes.filter((node) => node.kind === "deep");
  const eligibleNodeByUrl = new Map(
    eligibleNodes.map((node) => [node.url, node]),
  );
  const nodesByFingerprint = new Map<string, InternalLinkAuditNode[]>();
  for (const page of pages) {
    const node = eligibleNodeByUrl.get(page.subjectUrl);
    const fingerprint = node ? contentFingerprint(page) : null;
    if (!node || !fingerprint) continue;
    const group = nodesByFingerprint.get(fingerprint) ?? [];
    group.push(node);
    nodesByFingerprint.set(fingerprint, group);
  }
  const duplicateGroups = [...nodesByFingerprint.values()].filter(
    (group) => group.length > 1,
  );
  const duplicateNodes = duplicateGroups.flat();
  const claimedNodeIds = new Set(
    [...orphanNodes, ...unreachableNodes, ...deepNodes, ...duplicateNodes].map(
      (node) => node.id,
    ),
  );
  const lowInboundNodes = eligibleNodes.filter(
    (node) => !claimedNodeIds.has(node.id) && node.inboundLinks <= 1,
  );

  function commonFor(group: readonly InternalLinkAuditNode[]) {
    const first = group[0];
    if (!first) return null;
    const inboundSource = firstInbound.get(first.url);
    return {
      nodeId: first.id,
      nodeIds: group.map((node) => node.id),
      affectedUrls: group.map((node) => node.url),
      suggestedSourceUrl: inboundSource?.source ?? null,
      observedAnchorText: inboundSource?.anchorText ?? null,
    };
  }

  const orphanCommon = commonFor(orphanNodes);
  if (orphanCommon) {
    const undetermined = raw.availability !== "available";
    findings.push({
      id: "orphan-pages",
      priority: undetermined ? "P2" : "P1",
      confidence: undetermined ? "low" : "high",
      impact: "high",
      kind: undetermined ? "orphan_undetermined" : "orphan_candidate",
      title: undetermined
        ? `${orphanNodes.length} sitemap page(s) could not be checked for inbound links`
        : `${orphanNodes.length} sitemap-only orphan candidate(s) need review`,
      detail: undetermined
        ? "No crawled page linked to these sitemap pages, but this crawl stopped early. This is not evidence of an orphan."
        : "These pages were listed in the observed sitemap but no collected HTML page linked to them.",
      evidence: `0 observed inbound HTML links for ${orphanNodes.length} sitemap page(s) among ${pages.length} collected page(s).${undetermined ? ` Crawl stopped: ${raw.stopReason ?? "coverage incomplete"}.` : ""}`,
      limitation: undetermined
        ? "Complete the crawl or inspect inbound links directly before treating these pages as orphans."
        : "JavaScript-rendered links and links outside this static-HTML crawl are not evaluated.",
      ...orphanCommon,
    });
  }

  const unreachableCommon = commonFor(unreachableNodes);
  if (unreachableCommon) {
    findings.push({
      id: "unreachable-pages",
      priority: raw.availability === "available" ? "P1" : "P2",
      confidence: raw.availability === "available" ? "high" : "low",
      impact: "high",
      kind: "unreachable_page",
      title: `${unreachableNodes.length} indexable page(s) are not reachable from the homepage`,
      detail:
        "These pages were collected through coverage seeds, but no observed HTML-link path from the homepage reaches them.",
      evidence: `${unreachableNodes.length} page(s) have homepage click depth unavailable despite being collected.`,
      limitation:
        raw.availability === "available"
          ? "JavaScript-rendered links are outside this static-HTML graph."
          : "The crawl stopped early, so an uncollected page may still link to these URLs.",
      ...unreachableCommon,
    });
  }

  const deepCommon = commonFor(deepNodes);
  if (deepCommon) {
    findings.push({
      id: "deep-pages",
      priority: "P1",
      confidence: raw.availability === "available" ? "high" : "medium",
      impact: "high",
      kind: "deep_page",
      title: `${deepNodes.length} indexable page(s) need four or more clicks from the homepage`,
      detail:
        "These pages sit beyond three observed HTML-link hops, where readers and crawlers have a weaker path to reach them.",
      evidence: `${deepNodes.length} page(s) have observed homepage click depth of 4 or more.`,
      limitation:
        "Click depth describes observed static HTML links; it is not a ranking prediction.",
      ...deepCommon,
    });
  }

  const duplicateCommon = commonFor(duplicateNodes);
  if (duplicateCommon) {
    findings.push({
      id: "duplicate-content-pages",
      priority: "P1",
      confidence: "high",
      impact: "medium",
      kind: "duplicate_content",
      title: `${duplicateNodes.length} indexable URL(s) share an exact projected-content fingerprint`,
      detail: `${duplicateGroups.length} duplicate group(s) have the same observed title, headings, body projection, and internal-link targets.`,
      evidence: `Matched ${duplicateNodes.length} URL(s) across ${duplicateGroups.length} exact projected-content group(s).`,
      limitation:
        "The fingerprint uses bounded static-HTML projections rather than rendered page pixels; review each group before changing canonicals or content.",
      ...duplicateCommon,
    });
  }

  const lowInboundCommon = commonFor(lowInboundNodes);
  if (lowInboundCommon) {
    findings.push({
      id: "low-inbound-pages",
      priority: "P2",
      confidence: raw.availability === "available" ? "high" : "medium",
      impact: "medium",
      kind: "low_inbound",
      title: `${lowInboundNodes.length} indexable page(s) have limited observed internal support`,
      detail:
        "Each page has one or fewer observed inbound HTML links in this crawl.",
      evidence: `${lowInboundNodes.length} page(s) have at most one observed inbound HTML link.`,
      limitation:
        "Navigation rendered only by JavaScript and uncrawled pages can change inbound counts.",
      ...lowInboundCommon,
    });
  }

  const unresolvedEntries = [...unresolved.entries()].flatMap(
    ([target, source]) => {
      const sourceId = idByUrl.get(source.source);
      return sourceId ? [{ target, source, sourceId }] : [];
    },
  );
  const firstUnresolved = unresolvedEntries[0];
  if (firstUnresolved) {
    findings.push({
      id: "unresolved-targets",
      priority: "P2",
      confidence: "low",
      impact: "medium",
      kind: "unresolved_target",
      nodeId: firstUnresolved.sourceId,
      nodeIds: [...new Set(unresolvedEntries.map((entry) => entry.sourceId))],
      affectedUrls: unresolvedEntries.map((entry) => entry.target),
      title: `${unresolvedEntries.length} internal target(s) could not be verified`,
      detail:
        "The targets were linked from collected pages but were not collected in this synchronous crawl.",
      evidence: `Observed ${unresolvedEntries.length} uncollected target(s) from ${new Set(unresolvedEntries.map((entry) => entry.sourceId)).size} source page(s).`,
      limitation:
        "These are not called broken links: a target may be outside collected static-HTML coverage, excluded by robots, or unavailable within this run's resource boundaries.",
      suggestedSourceUrl: firstUnresolved.source.source,
      observedAnchorText: firstUnresolved.source.anchorText,
    });
  }

  const actionableNodeIds = new Set(
    findings
      .filter((finding) => finding.kind !== "unresolved_target")
      .flatMap((finding) => finding.nodeIds),
  );
  const nonHomeNodes = nodes.filter((node) => node.kind !== "home");

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
    actionablePages: actionableNodeIds.size,
    clickDepthDistribution: {
      oneClick: nonHomeNodes.filter((node) => node.clickDepth === 1).length,
      twoClicks: nonHomeNodes.filter((node) => node.clickDepth === 2).length,
      threeClicks: nonHomeNodes.filter((node) => node.clickDepth === 3).length,
      fourPlusClicks: nonHomeNodes.filter(
        (node) => node.clickDepth !== null && node.clickDepth >= 4,
      ).length,
      unreachable: nonHomeNodes.filter((node) => node.clickDepth === null).length,
    },
    nodes,
    edges,
    findings: findings.slice(0, MAX_FINDINGS),
  };
  return createPublicToolResult(
    {
      tool: "internal_link_audit",
      schemaVersion: "internal_link_audit.v3",
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
