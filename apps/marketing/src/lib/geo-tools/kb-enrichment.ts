// @input  -- real bounded homepage bodies and verified Search Console query strings
// @output -- reviewable candidates and an immutable, hash-bound receipt
// @pos    -- deterministic evidence extraction; no model/provider side effects

import { createHash } from "node:crypto";
import { load } from "cheerio";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import type { GeoKbFact } from "./kb-contract.ts";
import { GEO_KB_ENRICHMENT_LIMITS, parseGeoKbEnrichmentReport,
  type GeoCompetitorEvidence, type GeoFactEvidence, type GeoKbEnrichmentBody, type GeoKbEnrichmentReport, type GeoRoleCandidate,
} from "./kb-enrichment-contract.ts";

export type GeoEnrichmentPage =
  | { readonly kind: "ok"; readonly url: string; readonly body: string; readonly observedAt: string }
  | { readonly kind: "unavailable"; readonly reason: "missing_url" | "fetch_failed" | "target_redirected" | "partial_body" | "not_html" | "invalid_response" | "rate_limited"; readonly url: string | null };

export function canonicalGeoEnrichmentText(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalGeoEnrichmentText).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalGeoEnrichmentText(record[key])}`).join(",")}}`;
  }
  throw new Error("invalid canonical enrichment value");
}
export function enrichmentContentHash(body: GeoKbEnrichmentBody): string {
  return createHash("sha256").update(canonicalGeoEnrichmentText(body)).digest("hex");
}
export function finalizeGeoEnrichmentReport(body: GeoKbEnrichmentBody): GeoKbEnrichmentReport {
  return parseGeoKbEnrichmentReport({ ...body, contentHash: enrichmentContentHash(body) });
}
export function verifyGeoEnrichmentReport(value: unknown): GeoKbEnrichmentReport {
  const report = parseGeoKbEnrichmentReport(value);
  const { contentHash, ...body } = report;
  if (contentHash !== enrichmentContentHash(body)) throw new Error("enrichment hash mismatch");
  return report;
}
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/gu, " ").trim();
  // eslint-disable-next-line no-control-regex
  return text && text.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(text) ? text : null;
}
function identityJson(value: unknown, output: { name: string; aliases: string[] }[], depth = 0): void {
  if (depth > 5 || output.length >= 10) return;
  if (Array.isArray(value)) { value.slice(0, 30).forEach((entry) => identityJson(entry, output, depth + 1)); return; }
  if (value === null || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
  if (types.some((type) => type === "Organization" || type === "WebSite" || type === "Corporation")) {
    const name = clean(item["name"]);
    const names = Array.isArray(item["alternateName"]) ? item["alternateName"] : [item["alternateName"]];
    if (name !== null) output.push({ name, aliases: names.map(clean).filter((alias): alias is string => alias !== null && alias !== name) });
  }
  if (item["@graph"] !== undefined) identityJson(item["@graph"], output, depth + 1);
}
export function extractCompetitorIdentity(domain: string, page: GeoEnrichmentPage, evidenceId: string): GeoCompetitorEvidence {
  const unavailable = (reason: Extract<GeoCompetitorEvidence, { status: "unavailable" }>["reason"]): GeoCompetitorEvidence => ({
    evidenceId, domain, confirmed: false, status: "unavailable", reason, source: null, sourceUrl: page.url,
    observedAt: null, bodyHash: null, method: null, brandName: null, aliases: [],
  });
  if (page.kind !== "ok") return unavailable(page.reason);
  if (normalizeAccountWebsiteUrl(page.url)?.host !== normalizeAccountWebsiteUrl(`https://${domain}`)?.host) return unavailable("target_redirected");
  const $ = load(page.body);
  const identities: { name: string; aliases: string[] }[] = [];
  $("script[type='application/ld+json']").slice(0, 10).each((_index, node) => {
    try { identityJson(JSON.parse($(node).text()), identities); } catch { /* malformed JSON-LD is not identity */ }
  });
  const structured = identities[0];
  const og = clean($("meta[property='og:site_name']").first().attr("content"));
  const title = clean($("title").first().text());
  const brandName = structured?.name ?? og ?? title;
  if (brandName === null) return unavailable("not_found");
  return { evidenceId, domain, confirmed: false, status: "available", reason: null, source: "crawl", sourceUrl: page.url,
    observedAt: page.observedAt, bodyHash: createHash("sha256").update(page.body).digest("hex"),
    method: structured !== undefined ? "json_ld" : og !== null ? "og_site_name" : "title", brandName,
    aliases: [...new Set(structured?.aliases ?? [])].slice(0, 10),
  };
}
export function inspectGeoFact(fact: GeoKbFact, page: GeoEnrichmentPage, evidenceId: string): GeoFactEvidence {
  const unavailable = (reason: Extract<GeoFactEvidence, { status: "unavailable" }>["reason"]): GeoFactEvidence => ({
    evidenceId, key: fact.key, value: null, status: "unavailable", reason, source: null, sourceUrl: page.url,
    observedAt: null, bodyHash: null, excerpt: null,
  });
  if (page.kind !== "ok") return unavailable(page.reason);
  if (new URL(page.url).href !== new URL(fact.sourceUrl).href) return unavailable("target_redirected");
  const $ = load(page.body);
  $("script,style,noscript,template,svg,iframe,[hidden],[aria-hidden='true']").remove();
  const segments = $("p,li,dd,td,h1,h2,h3").map((_index, node) => $(node).text().replace(/\s+/gu, " ").trim()).get();
  const key = fact.key.toLocaleLowerCase("en");
  const value = fact.value.toLocaleLowerCase("en");
  const contains = (segment: string, needle: string): boolean => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(segment);
  };
  const excerpt = value === "" ? undefined : segments.find((segment) => segment.length <= 1_000 && contains(segment, key) && contains(segment, value));
  if (excerpt === undefined) return unavailable("not_found");
  return { evidenceId, key: fact.key, value: fact.value, status: "available", reason: null, source: "crawl", sourceUrl: page.url,
    observedAt: page.observedAt, bodyHash: createHash("sha256").update(page.body).digest("hex"), excerpt };
}

export function selectGeoGscProperty(targetHost: string, properties: readonly string[]): string | null {
  if (properties.includes(`sc-domain:${targetHost}`)) return `sc-domain:${targetHost}`;
  return [...properties].sort().find((property) => {
    try { const url = new URL(property); return url.pathname === "/" && url.search === "" && url.hash === "" && normalizeAccountWebsiteUrl(property)?.host === targetHost; }
    catch { return false; }
  }) ?? null;
}
const STOP = new Set(["a", "an", "and", "are", "as", "at", "best", "by", "can", "compare", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "tool", "tools", "what", "which", "with"]);
function tokens(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase("en").match(/[\p{L}][\p{L}\p{N}-]{2,}/gu) ?? [])].filter((word) => word.length <= 70 && !STOP.has(word));
}
export function clusterGeoQueries(input: readonly string[]): GeoRoleCandidate[] {
  const remaining = new Set([...new Set(input)].sort());
  const roles: GeoRoleCandidate[] = [];
  while (roles.length < GEO_KB_ENRICHMENT_LIMITS.roles) {
    const buckets = new Map<string, string[]>();
    for (const query of remaining) for (const word of tokens(query)) buckets.set(word, [...(buckets.get(word) ?? []), query]);
    const next = [...buckets].filter(([, queries]) => queries.length >= 2).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "en"))[0];
    if (next === undefined) break;
    const [topic, allQueries] = next;
    allQueries.forEach((query) => remaining.delete(query));
    const queries = allQueries.slice(0, GEO_KB_ENRICHMENT_LIMITS.roleQueries);
    const number = roles.length + 1;
    roles.push({ evidenceId: `R${number}`, source: "gsc", queryCount: allQueries.length, queries, queriesTruncated: allQueries.length > queries.length,
      role: { id: `gsc-${createHash("sha256").update(topic).digest("hex").slice(0, 10)}`, label: `Queries about ${topic}`,
        segment: "Observed search-query cluster; review the audience description.",
        painPoints: queries.filter((query) => /\b(how|help|problem|fix)\b/iu.test(query)).slice(0, 3).map((query) => query.slice(0, 80)),
        decisionCriteria: queries.filter((query) => /\b(best|compare|vs|review|pricing|price)\b/iu.test(query)).slice(0, 3).map((query) => query.slice(0, 80)), vocabulary: [topic] },
    });
  }
  return roles;
}
