// @input -- one server-owned completed V2 run and bounded public fetch/render seams
// @output -- actual declared/reachable inventory, cited-page reads and relevant-page T2 evidence
// @pos -- non-paid evidence collection; all network uses the DNS/IP-pinned public transport
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { fetchPublicResource, type PublicResourceResult } from "@sf/sources/public-http";
import { isPathAllowed, parseRobots, robotsCrawlDelaySeconds, type RobotsGroup } from "@sf/sources/crawl-robots";
import { containsGeoAlias, findGeoAliasMatch, normalizeAliasForMatch } from "../agents/geo-alias-match.ts";
import { normalizeGeoCitationUrl, normalizeGeoHost } from "../agents/geo-url.ts";
import { WEBSITE_PROFILE_LIST_MAX_ITEMS } from "../account-websites/contracts.ts";
import { requestCitabilityRender } from "./citability-render.ts";
import { buildCitabilityReport } from "./citability-rules.ts";
import { CITABILITY_RENDER_TIMEOUT_MS, type CitabilityRenderEvidence, type CitabilityRenderRequest } from "./citability-render-contract.ts";
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
import { GEO_SITE_EVIDENCE_SCHEMA, type GeoReadPage, type GeoPageType, type GeoReferencePage, type GeoPageCitabilityEvidence, type GeoSiteIndex, type GeoSitePriorityHints, type VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
import { matchSiteQuestion } from "./site-index-text.ts";

export const GEO_SITE_INDEX_LIMITS = { pages: 24, sitemaps: 3, references: 12, citability: 3, milliseconds: 45_000, requestMilliseconds: 5_000, bodyBytes: 512_000 } as const;
const UA = "GenGrowth-Public-Tools";
const trim = (value: string, max: number): string => [...value.replace(/\s+/g, " ").trim().normalize("NFC")].slice(0, max).join("");
const pageId = (url: string): string => `page-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
const htmlType = (value: string | null): boolean => /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(value ?? "");
export interface GeoSiteEvidenceDependencies {
  readonly now: () => Date;
  readonly fetchResource: typeof fetchPublicResource;
  readonly renderPage: (request: CitabilityRenderRequest) => Promise<CitabilityRenderEvidence>;
}
const DEFAULTS: GeoSiteEvidenceDependencies = { now: () => new Date(), fetchResource: fetchPublicResource, renderPage: requestCitabilityRender };
function unavailable(url: string, time: string, reason: GeoReadPage["reason"], status: number | null = null): GeoReadPage {
  return { id: pageId(url), url, finalUrl: null, fetchedAt: time, state: "unavailable", reason, httpStatus: status, contentSha256: null, contentMethod: null, bodyComplete: false, title: null, headings: [], pageType: "unavailable", pageTypeBasis: null, ownPresence: null, ownPresenceBasis: null, ownPresenceExcerpt: null, matches: [] };
}
function pageType(title: string, headings: readonly string[], types: readonly string[], listItems: number): { readonly type: GeoPageType; readonly basis: "jsonld" | "title_headings" } {
  const heading = `${title} ${headings.join(" ")}`.toLowerCase();
  if (/\b(vs\.?|versus|comparison|compare)\b|对比|比较/u.test(heading)) return { type: "comparison", basis: "title_headings" };
  if ((/\b(best|top|alternatives)\b|最佳|排行|替代/u.test(heading)) && listItems >= 2) return { type: "listicle", basis: "title_headings" };
  if (types.some((x) => ["Product", "SoftwareApplication"].includes(x))) return { type: "product", basis: "jsonld" };
  if (types.some((x) => ["Article", "BlogPosting", "NewsArticle"].includes(x))) return { type: "article", basis: "jsonld" };
  if (/\b(documentation|docs|reference|api)\b|文档/u.test(heading)) return { type: "documentation", basis: "title_headings" };
  return { type: "other", basis: "title_headings" };
}
interface PageRead { readonly value: GeoReadPage; readonly html: string | null; readonly links: readonly string[]; readonly linkLabels?: readonly { readonly url: string; readonly label: string }[] }
export async function collectVisibilitySiteEvidence(report: VisibilityReportV2, dependencies: GeoSiteEvidenceDependencies = DEFAULTS, priorityHints: GeoSitePriorityHints | null = null): Promise<VisibilitySiteEvidenceV1> {
  if (priorityHints !== null && (priorityHints.snapshotId !== report.manifest.snapshotId || !/^[a-f0-9]{64}$/.test(priorityHints.contextHash) || priorityHints.coreFeatures.length > WEBSITE_PROFILE_LIST_MAX_ITEMS || priorityHints.coreFeatures.some((feature) => typeof feature !== "string" || feature.length > 2048))) throw new Error("Invalid frozen priority context");
  const deadline = Date.now() + GEO_SITE_INDEX_LIMITS.milliseconds;
  const ownHost = report.context.targetHost, base = `https://${ownHost}`;
  const featureHints = priorityHints?.coreFeatures.map((feature) => normalizeAliasForMatch(feature.replace(/([a-z])([A-Z])/g, "$1 $2"))) ?? [];
  const anchorLabels = new Map<string, readonly string[]>(), prioritizedUrls: string[] = [];
  function priorityScore(url: string): number {
    let path: string; try { path = decodeURIComponent(new URL(url).pathname); } catch { path = new URL(url).pathname; }
    const text = normalizeAliasForMatch(`${path.replace(/[-_/]/g, " ")} ${(anchorLabels.get(url) ?? []).join(" ")}`);
    return featureHints.reduce((score, feature) => score + (containsGeoAlias(text, [feature]) ? 1000 : feature.split(/\s+/).filter((term) => term.length >= 3 && containsGeoAlias(text, [term])).length), 0);
  }
  const robotsCache = new Map<string, { readonly groups: readonly RobotsGroup[]; readonly state: "ok" | "unknown"; readonly text: string; readonly sitemaps: readonly string[] }>();
  const rawPages = new Map<string, string>();
  const pageReads = new Map<string, PageRead>();
  const renderReads = new Map<string, CitabilityRenderEvidence | null>();
  async function render(url: string, rawHtml: string, bodyComplete: boolean): Promise<CitabilityRenderEvidence | null> {
    const captureKey = `${url}:${createHash("sha256").update(rawHtml).digest("hex")}`;
    if (renderReads.has(captureKey)) return renderReads.get(captureKey) ?? null;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const value = await new Promise<CitabilityRenderEvidence | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), Math.min(left, CITABILITY_RENDER_TIMEOUT_MS));
      void dependencies.renderPage({ url, rawHtml, bodyComplete }).then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
    });
    renderReads.set(captureKey, value); return value;
  }
  async function fetch(url: string, own = false): Promise<PublicResourceResult> {
    const left = deadline - Date.now();
    if (left <= 0) return { kind: "error", code: "timeout" };
    const timeout = Math.min(left, GEO_SITE_INDEX_LIMITS.requestMilliseconds);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ kind: "error", code: "timeout" }), timeout);
      void dependencies.fetchResource(url, { timeoutMs: timeout, maxBodyBytes: GEO_SITE_INDEX_LIMITS.bodyBytes, userAgent: UA, allowRedirect: (_from: string, to: string) => {
        const destination = new URL(to), origin = new URL(url);
        if (normalizeGeoHost(to) !== (own ? ownHost : normalizeGeoHost(url)) || (origin.protocol === "https:" && destination.protocol !== "https:")) return false;
        const rules = robotsCache.get(origin.origin);
        return rules === undefined ? destination.pathname === origin.pathname && destination.search === origin.search : rules.state === "ok" && isPathAllowed(rules.groups, UA, destination.pathname + destination.search);
      } }).then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve({ kind: "error", code: "network" }); });
    });
  }
  async function robots(origin: string) {
    const cached = robotsCache.get(origin); if (cached !== undefined) return cached;
    const result = await fetch(`${origin}/robots.txt`, normalizeGeoHost(origin) === ownHost);
    const absent = result.kind === "ok" && [404, 410].includes(result.finalStatus);
    const complete = result.kind === "ok" && result.finalStatus >= 200 && result.finalStatus < 300 && result.bodyComplete;
    const body = complete ? result.body : "";
    const parsed = parseRobots(body, origin, complete);
    const value = { groups: parsed.groups, state: absent || complete ? "ok" as const : "unknown" as const, text: body, sitemaps: parsed.projection.sitemaps };
    robotsCache.set(origin, value); return value;
  }
  async function readPageOnce(url: string, own = false): Promise<PageRead> {
    const timestamp = dependencies.now().toISOString();
    const robot = await robots(new URL(url).origin);
    if (robot.state === "unknown" || !isPathAllowed(robot.groups, UA, new URL(url).pathname + new URL(url).search) || robotsCrawlDelaySeconds(robot.groups, UA) > 0) return { value: unavailable(url, timestamp, "blocked"), html: null, links: [] };
    const result = await fetch(url, own);
    if (result.kind === "error") return { value: unavailable(url, timestamp, result.code === "blocked" ? "blocked" : result.code === "timeout" ? "deadline" : "fetch_failed"), html: null, links: [] };
    if (normalizeGeoHost(result.finalUrl) !== normalizeGeoHost(url)) return { value: unavailable(url, timestamp, "blocked"), html: null, links: [] };
    if (result.finalStatus < 200 || result.finalStatus >= 300) return { value: unavailable(url, timestamp, "fetch_failed", result.finalStatus), html: null, links: [] };
    if (!htmlType(result.contentType)) return { value: unavailable(url, timestamp, "not_html", result.finalStatus), html: null, links: [] };
    const $ = load(result.body), types: string[] = [];
    const charsetFrom = (value: string) => /charset\s*=\s*["']?([\w-]+)/i.exec(value)?.[1]?.toLowerCase();
    const declaredCharsets = [charsetFrom(result.contentType ?? ""), $('meta[charset]').first().attr('charset')?.toLowerCase(), ...$('meta[http-equiv]').toArray().flatMap((element) => ($(element).attr('http-equiv') ?? "").toLowerCase() === "content-type" ? [charsetFrom($(element).attr('content') ?? "")] : [])];
    if (declaredCharsets.some((charset) => charset !== undefined && !["utf-8", "utf8", "us-ascii", "ascii"].includes(charset)) || (result.body.length > 0 && (result.body.match(/\ufffd/gu)?.length ?? 0) / result.body.length > 0.02)) return { value: unavailable(url, timestamp, "fetch_failed", result.finalStatus), html: null, links: [] };
    for (const element of $('script[type="application/ld+json"]').slice(0, 10).toArray()) {
      try { const parsed: unknown = JSON.parse($(element).text()); const nodes = Array.isArray(parsed) ? parsed : [parsed]; for (const node of nodes.slice(0, 20)) if (typeof node === "object" && node !== null && typeof (node as Record<string, unknown>)["@type"] === "string") types.push(String((node as Record<string, unknown>)["@type"])); } catch { /* A malformed script provides no classification evidence. */ }
    }
    const title = trim($('title').first().text(), 200), headings = $('h1,h2,h3').slice(0, 20).toArray().map((element) => trim($(element).text(), 160)).filter(Boolean);
    const executable = $('script').toArray().some((element) => !["application/ld+json", "application/json"].includes(($(element).attr('type') ?? "").toLowerCase())) || $('[onclick],[onload]').length > 0;
    const rendered = executable && result.bodyComplete ? await render(result.finalUrl, result.body, true) : null;
    const renderComplete = rendered?.status === "measured" && rendered.rendered?.complete === true && normalizeGeoCitationUrl(rendered.finalUrl) === normalizeGeoCitationUrl(result.finalUrl);
    const contentComplete = result.bodyComplete && (!executable || renderComplete);
    $('script,style,noscript,template,svg,canvas,iframe').remove();
    const rawBody = $('body').text().replace(/\s+/g, " ").trim().normalize("NFC");
    const body = (rendered?.rendered?.text ?? rawBody).normalize("NFC");
    const linkLabels = $('a[href]').toArray().flatMap((element) => { try { const url = normalizeGeoCitationUrl(new URL($(element).attr('href') ?? "", result.finalUrl).href); return url === null ? [] : [{ url, label: trim($(element).text(), 200) }]; } catch { return []; } });
    const links = [...new Set(linkLabels.map((link) => link.url))];
    const names = [report.context.officialName, ...report.context.aliases];
    const brandPresent = containsGeoAlias(body, names), ownLink = links.some((link) => normalizeGeoHost(link) === ownHost);
    const match = findGeoAliasMatch(body, names);
    const classified = pageType(title, headings, types, $('ol li,ul li').length);
    const value: GeoReadPage = { id: pageId(url), url, finalUrl: normalizeGeoCitationUrl(result.finalUrl), fetchedAt: rendered?.rendered === null || rendered === null ? timestamp : rendered.measuredAt, state: "read", reason: contentComplete ? null : "truncated", httpStatus: result.finalStatus, contentSha256: createHash("sha256").update(rendered?.rendered === null || rendered === null ? result.body : body).digest("hex"), contentMethod: rendered?.rendered === null || rendered === null ? "raw_html" : "rendered_visible_text", bodyComplete: contentComplete, title: title || null, headings, pageType: classified.type, pageTypeBasis: classified.basis,
      ownPresence: brandPresent || ownLink ? true : contentComplete ? false : null,
      ownPresenceBasis: brandPresent ? "brand_text" : ownLink ? "site_link" : contentComplete ? "none" : null,
      ownPresenceExcerpt: match === null ? null : trim([...body.slice(0, match.startIndex)].slice(-40).join("") + body.slice(match.startIndex), 160),
      matches: report.questions.flatMap((question) => { const matched = matchSiteQuestion(question.definition, report.context, `${title} ${headings.join(" ")}`, body); return matched === null ? [] : [matched]; }),
    };
    return { value, html: result.bodyComplete ? result.body : null, links: contentComplete ? links : [], linkLabels: contentComplete ? linkLabels : [] };
  }
  async function readPage(url: string, own = false): Promise<PageRead> {
    const cached = pageReads.get(url);
    if (cached !== undefined) return cached;
    const read = await readPageOnce(url, own);
    pageReads.set(url, read); return read;
  }
  const limits: string[] = [], discovered = new Set<string>([`${base}/`]), sitemapUrls: string[] = [];
  const inventorySources: GeoSiteIndex["inventorySources"][number][] = [];
  const ownRobots = await robots(base);
  const ownAllowed = ownRobots.state === "ok" && isPathAllowed(ownRobots.groups, UA, "/") && robotsCrawlDelaySeconds(ownRobots.groups, UA) === 0;
  if (!ownAllowed) limits.push("robots_blocked");
  let inventoryComplete = ownAllowed;
  const declared = ownRobots.sitemaps.flatMap((url) => { const canonical = normalizeGeoCitationUrl(url); return canonical !== null && normalizeGeoHost(canonical) === ownHost ? [canonical] : []; });
  const sitemapQueue = ownAllowed ? declared.length > 0 ? [...declared] : [`${base}/sitemap.xml`] : [];
  while (sitemapQueue.length > 0 && sitemapUrls.length < GEO_SITE_INDEX_LIMITS.sitemaps) {
    const url = sitemapQueue.shift()!; if (sitemapUrls.includes(url)) continue; sitemapUrls.push(url);
    const fetched = await fetch(url, true);
    inventorySources.push({ url, fetchedAt: dependencies.now().toISOString(), httpStatus: fetched.kind === "ok" ? fetched.finalStatus : null, bodyComplete: fetched.kind === "ok" && fetched.bodyComplete, contentSha256: fetched.kind === "ok" ? createHash("sha256").update(fetched.body).digest("hex") : null });
    if (fetched.kind !== "ok" || fetched.finalStatus < 200 || fetched.finalStatus >= 300 || !fetched.bodyComplete) { inventoryComplete = false; continue; }
    const $ = load(fetched.body, { xmlMode: true });
    if (($('urlset').length === 0 || !/<\/urlset\s*>/i.test(fetched.body)) && ($('sitemapindex').length === 0 || !/<\/sitemapindex\s*>/i.test(fetched.body))) { inventoryComplete = false; continue; }
    const urls = $('loc').toArray().map((element) => normalizeGeoCitationUrl($(element).text().trim()));
    for (const loc of urls) {
      if (loc === null || normalizeGeoHost(loc) !== ownHost) { inventoryComplete = false; continue; }
      if ($('sitemapindex').length > 0) { if (!sitemapUrls.includes(loc)) sitemapQueue.push(loc); }
      else discovered.add(loc);
    }
  }
  if (sitemapQueue.length > 0) inventoryComplete = false;
  const pages: GeoReadPage[] = [], queue = ownAllowed ? [...discovered] : [];
  function sortQueue() { if (priorityHints !== null) queue.sort((a, b) => a === `${base}/` ? -1 : b === `${base}/` ? 1 : priorityScore(b) - priorityScore(a) || a.localeCompare(b, "en")); }
  sortQueue();
  while (queue.length > 0 && pages.length < GEO_SITE_INDEX_LIMITS.pages && Date.now() < deadline) {
    const url = queue.shift()!;
    if (priorityScore(url) > 0) prioritizedUrls.push(url);
    const read = await readPage(url, true); pages.push(read.value);
    if (read.html !== null) rawPages.set(read.value.id, read.html);
    if (read.value.state !== "read" || !read.value.bodyComplete) inventoryComplete = false;
    for (const { url, label } of read.linkLabels ?? []) if (normalizeGeoHost(url) === ownHost) anchorLabels.set(url, [...new Set([...(anchorLabels.get(url) ?? []), label])]);
    for (const link of read.links) if (normalizeGeoHost(link) === ownHost && !discovered.has(link) && !/\.(?:pdf|png|jpg|jpeg|svg|gif|webp|zip|mp4|css|js)(?:\?|$)/i.test(link)) { discovered.add(link); queue.push(link); }
    sortQueue();
  }
  if (queue.length > 0) { inventoryComplete = false; limits.push("page_limit_or_deadline"); }
  if (!inventoryComplete) limits.push("incomplete_inventory");
  const referenceSlots = new Map<string, string[]>();
  for (const question of report.questions) for (const sample of question.samples) if (sample.status === "ok") for (const url of sample.citedUrls) { const slots = referenceSlots.get(url) ?? []; if (!slots.includes(sample.slotId)) slots.push(sample.slotId); referenceSlots.set(url, slots); }
  const references: GeoReferencePage[] = [];
  for (const [url, sampleSlots] of [...referenceSlots].slice(0, GEO_SITE_INDEX_LIMITS.references)) { const read = await readPage(url, normalizeGeoHost(url) === ownHost); references.push({ ...read.value, sampleSlots }); }
  const candidates = pages.flatMap((page) => page.matches.map((match) => ({ page, question: report.questions.find((q) => q.questionId === match.questionId)! }))).filter(({ page }) => page.state === "read" && page.bodyComplete);
  const citability: GeoPageCitabilityEvidence[] = [];
  for (const { page, question } of candidates.slice(0, GEO_SITE_INDEX_LIMITS.citability)) {
    const rawHtml = rawPages.get(page.id); if (rawHtml === undefined || page.finalUrl === null) continue;
    try {
      const rendered = await render(page.finalUrl, rawHtml, true);
      if (rendered === null) continue;
      const robots = ownRobots.state === "ok" ? { status: "ok" as const, text: ownRobots.text } : { status: "unreachable" as const, httpStatus: null };
      const checked = buildCitabilityReport({ url: page.url, finalUrl: page.finalUrl, rawHtml, bodyComplete: true, targetQuestion: question.text, robots, llmsTxt: { status: "unreachable", httpStatus: null }, render: rendered }, dependencies.now().toISOString());
      citability.push({ id: `t2-${page.id}-${question.questionId}`, pageId: page.id, questionId: question.questionId, url: page.url, checkedAt: checked.fetchedAt, checks: checked.checks, renderStatus: checked.render.status, renderReason: checked.render.reason, rawToRenderedRatio: checked.render.rawToRenderedRatio });
    } catch { /* Missing T2 is absence of evidence, never a pass or a B gap. */ }
  }
  return { schemaVersion: GEO_SITE_EVIDENCE_SCHEMA, collectedAt: dependencies.now().toISOString(), index: { priority: { method: priorityHints === null ? "none" : "frozen_profile_core_features.v1", snapshotId: report.manifest.snapshotId, contextHash: priorityHints?.contextHash ?? null, featureCount: featureHints.length, prioritizedUrls }, scope: "declared_and_reachable_inventory", status: pages.length === 0 ? "unavailable" : inventoryComplete ? "complete" : "partial", targetHost: ownHost, discoveredCount: discovered.size, pages, sitemapUrls, inventorySources, limits }, references, referenceOmittedCount: Math.max(0, referenceSlots.size - references.length), citability, citabilityOmittedCount: Math.max(0, candidates.length - citability.length) };
}
