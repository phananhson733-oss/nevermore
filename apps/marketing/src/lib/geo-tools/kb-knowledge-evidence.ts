// @input -- bounded, customer-safe website and machine-readable evidence
// @output -- strict, deterministic GEO knowledge evidence suitable for persistence
// @pos -- collection never follows foreign links or stores fetched bodies
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { z } from "zod";

import { canonicalCrawlTargetKey } from "../tools/crawl-cache.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

export const GEO_KNOWLEDGE_EVIDENCE_LIMITS = {
  pageBytes: 512 * 1024, excerptCodePoints: 1_200, competitors: 5, ownPages: 8, competitorPagesPerIdentity: 2, maxPages: 18, maxSources: 32,
  maxBytes: 1024 * 1024, maxExcerpts: 8, jsonLdScriptBytes: 64 * 1024,
  jsonLdArrayWidth: 128, sitemapLocations: 1_000,
  /**
   * The largest `urlCount` this contract will carry, and deliberately not
   * `sitemapLocations`: the count is the DOCUMENT's size and the locations are
   * a bounded sample of it. 50 000 is the sitemap protocol's own per-file
   * ceiling, so a `<urlset>` above it is malformed and the ceiling is the most
   * this will claim about one rather than refusing the whole bundle over it.
   */
  sitemapUrlCount: 50_000,
} as const;

const INTENTS = ["about", "pricing", "product", "integrations", "docs", "faq", "changelog"] as const;
const SOURCE_KINDS = ["own_page", "competitor_page", "robots", "sitemap", "llms", "gsc", "accepted_fact"] as const;
const UNAVAILABLE_REASONS = ["not_collected", "not_published", "not_found", "fetch_failed", "blocked", "rate_limited", "timeout", "invalid_response", "partial_body", "unsupported_language", "generation_unavailable", "outcome_unknown", "insufficient_evidence", "not_applicable", "context_stale"] as const;
const MACHINE_STATUSES = ["present", "absent", "unreachable"] as const;
type Intent = typeof INTENTS[number];
type SourceKind = typeof SOURCE_KINDS[number];
type UnavailableReason = typeof UNAVAILABLE_REASONS[number];
type MachineStatus = typeof MACHINE_STATUSES[number];
type Competitor = { key: string; name: string; confirmed: true };

export type GeoKnowledgeResourceResult =
  | { kind: "ok"; url: string; body: string; contentType: string; observedAt: string }
  /**
   * `reached` says the request got to the site and this is the site's answer.
   *
   * It is absent when the reader gave up before sending anything -- our own
   * crawl gate refusing admission, or failing to be asked. Those refusals wear
   * the same `reason` values as real answers (`blocked`, `fetch_failed`,
   * `rate_limited`), so without this a caller cannot tell "the site says no"
   * from "we never asked", and a caller that files the first as an observation
   * files the second as one too: a row asserting something about a site nobody
   * contacted.
   */
  | { kind: "unavailable"; url: string; reason: UnavailableReason; reached?: true };
export type GeoKnowledgeEvidenceReadResource = (input: { url: string; expected?: "html" | "robots" | "sitemap" | "llms"; timeoutMs?: number }) => Promise<GeoKnowledgeResourceResult>;
export type GeoKnowledgeEvidenceSource = {
  id: string; kind: SourceKind; label: string; url: string | null; competitor: Competitor | null;
  availability: "available" | "partial" | "unavailable"; reason: UnavailableReason | null;
  observedAt: string | null; bodyHash: string | null; excerpts: readonly string[];
};
type Page = {
  url: string; canonicalUrl: string | null; title: string | null; description: string | null; lang: string | null;
  jsonLdTypes: string[]; hreflangLocales: string[]; hreflang: Array<{ locale: string; url: string }>;
  faq: Array<{ question: string; answer: string }>; links: Array<{ intent: Intent; url: string }>;
};
/** One page of the bundle, for callers that rebuild one from a stored row. */
export type GeoKnowledgeEvidencePage = Page;
type MachineObservation = { status: MachineStatus; sourceRefs: string[] };
type SitemapObservation = MachineObservation & { urlCount: number | null; knowledgePagesListed: boolean | null; locations?: string[]; truncated?: boolean };
export type GeoKnowledgeEvidenceV1 = {
  schemaVersion: "marketing-geo-knowledge-evidence.v1"; collectedAt: string; targetUrl: string; confirmedCompetitors: Competitor[];
  availability: "available" | "partial" | "unavailable"; limitation: string | null; pages: Page[];
  machine: { jsonLd: { status: "present" | "absent"; types: string[]; sourceRefs: string[] }; llms: MachineObservation; robots: MachineObservation; sitemap: SitemapObservation; hreflang: { status: "present" | "absent"; locales: string[]; sourceRefs: string[] } };
  sourceCatalogue: GeoKnowledgeEvidenceSource[]; contentHash: string;
};
type EvidenceBody = Omit<GeoKnowledgeEvidenceV1, "contentHash">;
type CollectionDependencies = {
  readResource: GeoKnowledgeEvidenceReadResource; now: () => Date; nowMs?: () => number;
  reusedSources?: readonly GeoKnowledgeEvidenceSource[]; reusedEvidence?: GeoKnowledgeEvidenceV1;
  /**
   * Pages a caller rebuilt from rows it credited in `reusedSources`.
   *
   * Without this, a credited own page contributes a SOURCE and no PAGE, and
   * `machine.jsonLd` / `machine.hreflang` -- which are derived from `pages`
   * alone -- collapse to `absent` while citing the very row that holds the
   * types. That is what production reported on 2026-09-09 about a home page
   * whose stored row carried six JSON-LD types.
   *
   * A page here is only kept when an available source in the catalogue
   * addresses it: the collector will not take a caller's word for a reading
   * whose receipt it cannot see.
   */
  reusedPages?: readonly Page[];
  /**
   * The reused sitemap row's own count of the document it read.
   *
   * The ledger keeps a bounded sample of `<loc>` values plus the total, so a
   * reused sitemap has eight locations and knows there were 558. Passing the
   * total lets the bundle say 558 with a sample of eight (`truncated: true`)
   * instead of publishing the sample size as the total.
   */
  reusedSitemapUrlCount?: number;
};

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u;
const canonicalTimestamp = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
// Preserve exact text while excluding controls JSON cannot represent safely.
// eslint-disable-next-line no-control-regex
const text = (maximum: number) => z.string().refine((value) => value.trim().length > 0 && Array.from(value).length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), `Expected text up to ${maximum} code points`);
const id = text(128).regex(ID);
const unique = (values: readonly string[]) => new Set(values).size === values.length;
function strictPublicUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" && url.hash === "" && url.toString() === value; } catch { return false; } }
const publicUrl = z.string().max(2_048).refine(strictPublicUrl, "Expected exact public HTTPS URL");
const nullablePublicUrl = publicUrl.nullable();

const sourceSchema = z.object({
  id, kind: z.enum(SOURCE_KINDS), label: text(120), url: nullablePublicUrl,
  competitor: z.object({ key: text(128), name: text(200), confirmed: z.literal(true) }).strict().nullable(),
  availability: z.enum(["available", "partial", "unavailable"]), reason: z.enum(UNAVAILABLE_REASONS).nullable(),
  observedAt: z.string().refine(canonicalTimestamp, "Expected canonical observation time").nullable(), bodyHash: z.string().regex(HASH).nullable(),
  excerpts: z.array(text(GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints)).max(GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxExcerpts),
}).strict().superRefine((source, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((source.kind === "competitor_page") !== (source.competitor !== null)) issue("Invalid competitor source scope");
  if (!["gsc", "accepted_fact"].includes(source.kind) && source.url === null) issue("Public source URL required");
  if (source.availability === "unavailable") { if (source.reason === null || source.observedAt !== null || source.bodyHash !== null || source.excerpts.length !== 0) issue("Unavailable source cannot carry observations"); return; }
  if (source.availability === "available" ? source.reason !== null : source.reason === null) issue("Source availability reason mismatch");
  if (source.bodyHash !== null && source.observedAt === null) issue("Body hash requires observation time");
  if (source.excerpts.length === 0) issue("Observed source requires excerpts");
  if (["own_page", "competitor_page", "robots", "sitemap", "llms"].includes(source.kind) && (source.observedAt === null || source.bodyHash === null)) issue("Crawled source requires observation receipt");
  if (source.kind === "gsc" && source.observedAt === null) issue("GSC source requires observation time");
});
const hreflangSchema = z.object({ locale: text(120), url: publicUrl }).strict();
const pageSchema = z.object({
  url: publicUrl, canonicalUrl: nullablePublicUrl, title: text(GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints).nullable(), description: text(GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints).nullable(), lang: text(120).nullable(),
  jsonLdTypes: z.array(text(120)).max(32).refine(unique, "Duplicate JSON-LD type"), hreflangLocales: z.array(text(120)).max(64).refine(unique, "Duplicate hreflang locale"), hreflang: z.array(hreflangSchema).max(64).refine((entries) => unique(entries.map(({ locale }) => locale)), "Duplicate hreflang locale"),
  faq: z.array(z.object({ question: text(GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints), answer: text(GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints) }).strict()).max(32),
  links: z.array(z.object({ intent: z.enum(INTENTS), url: publicUrl }).strict()).max(INTENTS.length).refine((entries) => unique(entries.map(({ intent }) => intent)), "Duplicate page intent"),
}).strict().superRefine((page, ctx) => {
  if (!unique(page.hreflang.map(({ url }) => url))) ctx.addIssue({ code: "custom", message: "Duplicate hreflang URL" });
  if (page.hreflangLocales.join("\u0000") !== page.hreflang.map(({ locale }) => locale).join("\u0000")) ctx.addIssue({ code: "custom", message: "Hreflang summary mismatch" });
});
const machineObservationSchema = z.object({ status: z.enum(MACHINE_STATUSES), sourceRefs: z.array(id).min(1).refine(unique, "Duplicate source reference") }).strict();
const machineSchema = z.object({
  jsonLd: z.object({ status: z.enum(["present", "absent"]), types: z.array(text(120)).max(32).refine(unique), sourceRefs: z.array(id).min(1).refine(unique) }).strict(), llms: machineObservationSchema, robots: machineObservationSchema,
  sitemap: machineObservationSchema.extend({ urlCount: z.number().int().min(0).max(GEO_KNOWLEDGE_EVIDENCE_LIMITS.sitemapUrlCount).nullable(), knowledgePagesListed: z.boolean().nullable(), locations: z.array(publicUrl).max(GEO_KNOWLEDGE_EVIDENCE_LIMITS.sitemapLocations).refine(unique).optional(), truncated: z.boolean().optional() }).strict(),
  hreflang: z.object({ status: z.enum(["present", "absent"]), locales: z.array(text(120)).max(64).refine(unique), sourceRefs: z.array(id).min(1).refine(unique) }).strict(),
}).strict().superRefine((machine, ctx) => {
  if ((machine.jsonLd.status === "present") !== (machine.jsonLd.types.length > 0)) ctx.addIssue({ code: "custom", message: "JSON-LD status mismatch" });
  if ((machine.hreflang.status === "present") !== (machine.hreflang.locales.length > 0)) ctx.addIssue({ code: "custom", message: "Hreflang status mismatch" });
  const present = machine.sitemap.status === "present";
  if (present !== (machine.sitemap.urlCount !== null && machine.sitemap.knowledgePagesListed !== null)) ctx.addIssue({ code: "custom", message: "Sitemap status mismatch" });
  if (!present && ((machine.sitemap.locations?.length ?? 0) !== 0 || machine.sitemap.truncated === true)) ctx.addIssue({ code: "custom", message: "Unobserved sitemap locations" });
  /*
   * `truncated` is what decouples the count from the sample.
   *
   * Untruncated, `locations` IS the document and the count must equal it --
   * the original rule, unchanged. Truncated, `locations` is a bounded sample
   * and `urlCount` is the document's own total, which is the only number worth
   * showing an owner: the alternative is publishing "your sitemap lists 8
   * URLs" about a sitemap listing 558, which is what production said on
   * 2026-09-09. A truncated count below the sample size is still a mismatch.
   */
  if (present && (machine.sitemap.locations === undefined || machine.sitemap.truncated === undefined
    || (machine.sitemap.truncated
      ? machine.sitemap.urlCount! < machine.sitemap.locations.length
      : machine.sitemap.urlCount !== machine.sitemap.locations.length))) ctx.addIssue({ code: "custom", message: "Sitemap count mismatch" });
});
const bodySchema = z.object({
  schemaVersion: z.literal("marketing-geo-knowledge-evidence.v1"), collectedAt: z.string().refine(canonicalTimestamp, "Expected canonical collection time"), targetUrl: publicUrl,
  confirmedCompetitors: z.array(z.object({ key: text(128), name: text(200), confirmed: z.literal(true) }).strict()).max(GEO_KNOWLEDGE_EVIDENCE_LIMITS.competitors).refine((entries) => unique(entries.map(({ key }) => key)), "Duplicate competitor"),
  availability: z.enum(["available", "partial", "unavailable"]), limitation: text(800).nullable(), pages: z.array(pageSchema).max(GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxPages).refine((pages) => unique(pages.map(({ url }) => url)), "Duplicate page URL"), machine: machineSchema, sourceCatalogue: z.array(sourceSchema).min(1).max(GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxSources),
}).strict();
const evidenceSchema = bodySchema.extend({ contentHash: z.string().regex(HASH) }).strict();

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sourceId(kind: SourceKind, url: string): string { return `${kind}-${sha256(`${kind}:${url}`).slice(0, 20)}`; }
function clean(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function bounded(value: string): string { return Array.from(clean(value)).slice(0, GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints).join(""); }
function boundedExact(value: string): string { return Array.from(value).slice(0, GEO_KNOWLEDGE_EVIDENCE_LIMITS.excerptCodePoints).join(""); }
function asPublicUrl(value: string, base: URL, permitFragment = false): string | null { try { const url = new URL(value, base); if (!permitFragment && url.hash !== "") return null; url.hash = ""; if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.host !== base.host) return null; return url.toString(); } catch { return null; } }
/**
 * One `<loc>` value, as this site's own address or not at all.
 *
 * The difference from `asPublicUrl` is the host test, and it is the whole
 * reason this exists: `asPublicUrl` demands `url.host === base.host`, so a
 * sitemap that lists `https://www.example.com/...` under a target spelled
 * `https://example.com/` has EVERY location discarded and the site is reported
 * as listing zero URLs. That is not a hypothetical -- it is what production
 * reported about a site publishing 558 of them on 2026-09-09.
 *
 * The two spellings are one site to everything else in this codebase: the
 * crawl gate budgets against the apex host (`canonicalCrawlTargetKey`), and
 * `machineResourceAnsweredRequest` above already accepts the sibling as an
 * answer to the request. Location extraction is the last place that did not.
 *
 * Page links, hreflang alternates and canonical URLs deliberately keep the
 * strict test: those are claims the PAGE makes about itself, and a page on one
 * host linking to the other is a fact worth not flattening. A sitemap entry is
 * an address, and the address is the same address.
 */
function sitemapLocation(value: string, base: URL): string | null {
  try {
    const url = new URL(value.trim(), base);
    // A `<loc>` carrying a fragment is not an address of a page the way this
    // contract means one, and `asPublicUrl` refused it before this helper
    // existed. Stripping it instead would quietly widen what counts as listed.
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "") return null;
    const key = canonicalCrawlTargetKey(url.href);
    const baseKey = canonicalCrawlTargetKey(base.href);
    if (key === null || key === "" || baseKey === null || key !== baseKey) return null;
    const href = url.toString();
    return strictPublicUrl(href) ? href : null;
  } catch { return null; }
}

/**
 * Whether a sitemap lists a page, comparing addresses rather than strings.
 *
 * Same reason as above: `https://example.com/pricing` and
 * `https://www.example.com/pricing` are one page, and answering "your sitemap
 * does not list your home page" because the two halves of the site spell the
 * host differently is a finding about our own string comparison.
 */
function addressKey(value: string): string {
  try { const url = new URL(value); return `${canonicalCrawlTargetKey(url.href) ?? url.host}${url.pathname}${url.search}`; } catch { return value; }
}
function listedPage(locations: readonly string[], pageUrl: string): boolean {
  const key = addressKey(pageUrl);
  return locations.some((location) => addressKey(location) === key);
}

function validTarget(value: string): URL { if (!strictPublicUrl(value)) throw new Error("Invalid target URL"); return new URL(value); }
function unavailableReason(value: unknown): UnavailableReason { return typeof value === "string" && (UNAVAILABLE_REASONS as readonly string[]).includes(value) ? value as UnavailableReason : "invalid_response"; }
function unavailableSource(kind: SourceKind, url: string, reason: UnavailableReason, competitor: Competitor | null = null): GeoKnowledgeEvidenceSource { return { id: sourceId(kind, url), kind, label: kind === "own_page" ? "Own site page" : kind === "competitor_page" ? "Competitor page" : kind, url, competitor, availability: "unavailable", reason, observedAt: null, bodyHash: null, excerpts: [] }; }
function intentFor(textValue: string, url: string): Intent | null { const candidate = `${textValue} ${new URL(url).pathname}`.toLocaleLowerCase("en"); if (/about|company|team/u.test(candidate)) return "about"; if (/pricing|plans|price/u.test(candidate)) return "pricing"; if (/feature|product/u.test(candidate)) return "product"; if (/integration/u.test(candidate)) return "integrations"; if (/docs?|help|guide/u.test(candidate)) return "docs"; if (/faq|question/u.test(candidate)) return "faq"; if (/changelog|release|news/u.test(candidate)) return "changelog"; return null; }

function walkJsonLd(value: unknown, types: Set<string>, faq: Array<{ question: string; answer: string }>, depth = 0): void {
  if (depth > 16 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) { if (value.length > GEO_KNOWLEDGE_EVIDENCE_LIMITS.jsonLdArrayWidth) return; for (const item of value) walkJsonLd(item, types, faq, depth + 1); return; }
  const object = value as Record<string, unknown>;
  const typeValues = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  for (const type of typeValues) if (typeof type === "string" && type.length <= 120 && type.trim() !== "") types.add(type);
  if (typeof object.name === "string" && object.acceptedAnswer && typeof object.acceptedAnswer === "object") { const answer = object.acceptedAnswer as Record<string, unknown>; if (typeof answer.text === "string") faq.push({ question: bounded(object.name), answer: bounded(answer.text.replace(/<[^>]*>/gu, " ")) }); }
  const isFaqPage = typeValues.includes("FAQPage");
  if (isFaqPage && Array.isArray(object.mainEntity)) for (const entity of object.mainEntity) {
    if (!entity || typeof entity !== "object") continue;
    const question = entity as Record<string, unknown>;
    const answer = question.acceptedAnswer;
    if (typeof question.name === "string" && answer && typeof answer === "object" && typeof (answer as Record<string, unknown>).text === "string") faq.push({ question: bounded(question.name), answer: bounded(((answer as Record<string, unknown>).text as string).replace(/<[^>]*>/gu, " ")) });
  }
  for (const [key, nested] of Object.entries(object)) if (!(isFaqPage && key === "mainEntity")) walkJsonLd(nested, types, faq, depth + 1);
}
/**
 * The one reading of "what does this page carry".
 *
 * Exported so the run collector can store the same structure it extracts --
 * `jsonLdTypes`, `hreflangLocales` and `faq` -- into the observation ledger
 * instead of parsing the body a second way. A second parser would be a second
 * answer to this question, and the owner's card and the assembled evidence
 * would disagree about the same bytes.
 */
/**
 * Whether a 200 answered the machine resource that was actually asked for.
 *
 * A machine resource is an address, not a document: `/robots.txt` means the
 * file at that path, and a 200 arriving from `/signup` is a site answering a
 * question nobody asked. Recording that as `robots` would tell the owner they
 * publish a file where they publish nothing -- the inverse of what these rows
 * exist to say. So path and query must survive the hop exactly.
 *
 * The host may move between an apex and its `www` sibling, and only there. That
 * hop is the one the transport is documented to permit and the one the crawl
 * quota already treats as a single target, so `canonicalCrawlTargetKey` is
 * asked rather than a second copy of the rule being written here. Comparing raw
 * hrefs instead is what made astrologywiki.com report `invalid_response` for a
 * robots.txt it serves correctly: the fetch followed the apex to `www`, and the
 * final URL no longer matched the string that had been requested.
 *
 * Everything else still fails: a different site, a different path, a query the
 * request did not carry, or a URL that does not parse.
 */
export function machineResourceAnsweredRequest(requestedUrl: string, finalUrl: string): boolean {
  let requested: URL, final: URL;
  try {
    requested = new URL(requestedUrl);
    final = new URL(finalUrl);
  } catch { return false; }
  const requestedKey = canonicalCrawlTargetKey(requested.href);
  return requestedKey !== null && requestedKey !== "" &&
    requestedKey === canonicalCrawlTargetKey(final.href) &&
    requested.pathname === final.pathname &&
    requested.search === final.search;
}

export function pageData(body: string, pageUrl: string): Page & { excerpts: string[] } {
  const page = new URL(pageUrl); const $ = cheerio.load(body); const candidates = new Map<Intent, string>();
  $("a[href]").each((_, element) => { const url = asPublicUrl($(element).attr("href") ?? "", page, true); if (url === null) return; const intent = intentFor(clean($(element).text()), url); if (intent !== null && (candidates.get(intent) === undefined || url < candidates.get(intent)!)) candidates.set(intent, url); });
  const links = INTENTS.flatMap((intent) => { const url = candidates.get(intent); return url === undefined ? [] : [{ intent, url }]; });
  const types = new Set<string>(); const faq: Array<{ question: string; answer: string }> = [];
  $("script[type='application/ld+json']").each((_, element) => { const script = $(element).html() ?? $(element).text(); if (Buffer.byteLength(script, "utf8") > GEO_KNOWLEDGE_EVIDENCE_LIMITS.jsonLdScriptBytes) return; try { walkJsonLd(JSON.parse(script) as unknown, types, faq); } catch { /* malformed JSON-LD is not evidence */ } });
  const hreflangByLocale = new Map<string, string>();
  $("link[rel='alternate'][hreflang][href]").each((_, element) => { const locale = clean($(element).attr("hreflang") ?? ""); const url = asPublicUrl($(element).attr("href") ?? "", page); if (locale !== "" && url !== null && !hreflangByLocale.has(locale)) hreflangByLocale.set(locale, url); });
  const hreflang = [...hreflangByLocale.entries()].map(([locale, url]) => ({ locale, url })).sort((left, right) => left.locale.localeCompare(right.locale));
  $("script,style,noscript,template,svg,iframe").remove(); $("[hidden], [aria-hidden='true']").remove();
  const semanticExcerpts = $("body h1, body h2, body h3, body h4, body h5, body h6, body p, body li").map((_, element) => bounded($(element).text())).get().filter(Boolean);
  const visibleBody = bounded($("body").text());
  const excerpts = semanticExcerpts.length > 0 ? semanticExcerpts : visibleBody === "" ? [] : [visibleBody];
  return { url: pageUrl, canonicalUrl: asPublicUrl($("link[rel='canonical']").attr("href") ?? "", page), title: bounded($("title").text()) || null, description: bounded($("meta[name='description']").attr("content") ?? "") || null, lang: clean($("html").attr("lang") ?? "") || null, jsonLdTypes: [...types].sort(), hreflangLocales: hreflang.map(({ locale }) => locale), hreflang, faq: faq.filter(({ question, answer }) => question !== "" && answer !== "").slice(0, 32), links, excerpts };
}

function validateReusedSources(sources: readonly GeoKnowledgeEvidenceSource[], target: URL, competitors: readonly Competitor[]): GeoKnowledgeEvidenceSource[] {
  const seenIds = new Set<string>(); const seenUrls = new Set<string>(); const confirmed = new Map(competitors.map((competitor) => [competitor.key, competitor])); const validated: GeoKnowledgeEvidenceSource[] = [];
  for (const raw of sources) { const source = sourceSchema.parse(raw); if (seenIds.has(source.id) || source.url !== null && seenUrls.has(source.url)) continue; seenIds.add(source.id); if (source.url !== null) seenUrls.add(source.url); if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null && new URL(source.url).host !== target.host) throw new Error("Foreign own-site source"); if (source.kind === "competitor_page") { const competitor = source.competitor!; if (confirmed.get(competitor.key)?.name !== competitor.name || source.url === null || new URL(source.url).host !== competitor.key) throw new Error("Unconfirmed or foreign competitor source"); } validated.push(source); }
  return validated;
}
function responseIsValid(result: unknown): result is Extract<GeoKnowledgeResourceResult, { kind: "ok" }> { if (!result || typeof result !== "object") return false; const value = result as Record<string, unknown>; return value.kind === "ok" && typeof value.url === "string" && typeof value.body === "string" && typeof value.contentType === "string" && typeof value.observedAt === "string" && canonicalTimestamp(value.observedAt); }
function expectedContentType(expected: "html" | "robots" | "sitemap" | "llms", contentType: string): boolean { const type = contentType.toLocaleLowerCase("en").split(";", 1)[0]?.trim(); if (expected === "html") return type === "text/html"; if (expected === "robots") return type === "text/plain"; if (expected === "sitemap") return type === "application/xml" || type === "text/xml"; return type === "text/plain" || type === "text/markdown"; }
function machineStatus(source: GeoKnowledgeEvidenceSource): MachineStatus { return source.availability !== "unavailable" ? "present" : source.reason === "not_found" || source.reason === "not_published" ? "absent" : "unreachable"; }
function addUnavailableMachineSources(sources: GeoKnowledgeEvidenceSource[], target: URL, reason: UnavailableReason): void { for (const [path, kind] of [["robots.txt", "robots"], ["sitemap.xml", "sitemap"], ["llms.txt", "llms"]] as const) { const url = new URL(path, target).toString(); if (!sources.some((source) => source.kind === kind)) sources.push(unavailableSource(kind, url, reason)); } }
function sourceForMachine(kind: "robots" | "sitemap" | "llms", sources: readonly GeoKnowledgeEvidenceSource[]): GeoKnowledgeEvidenceSource { const source = sources.find((candidate) => candidate.kind === kind); if (!source) throw new Error(`Missing ${kind} source`); return source; }

function finalize(target: URL, competitors: Competitor[], pages: Page[], sources: GeoKnowledgeEvidenceSource[], now: Date, reusedSitemap?: SitemapObservation, reusedSitemapUrlCount?: number): GeoKnowledgeEvidenceV1 {
  const robots = sourceForMachine("robots", sources); const sitemap = sourceForMachine("sitemap", sources); const llms = sourceForMachine("llms", sources); const ownRefs = sources.filter(({ kind }) => kind === "own_page").map(({ id: source }) => source);
  const sitemapSource = sitemap as GeoKnowledgeEvidenceSource & { locations?: string[]; truncated?: boolean; total?: number };
  const reusedSitemapMatches = reusedSitemap?.sourceRefs.includes(sitemap.id) ?? false;
  /*
   * A source read in THIS collection carries its locations out of band (the
   * non-enumerable properties set below); a source credited from a stored row
   * carries the same addresses as excerpts, because that is all the ledger
   * keeps. `sitemapLocation` reads either, and accepts the site's other
   * spelling of its own host -- see the helper.
   */
  const locations = sitemap.availability === "unavailable" ? [] : reusedSitemapMatches ? reusedSitemap!.locations ?? [] : sitemapSource.locations ?? sitemap.excerpts.flatMap((value) => { const location = sitemapLocation(value, target); return location === null ? [] : [location]; });
  /*
   * How many URLs the DOCUMENT holds, which is not how many this bundle
   * carries. The reader that took the sample is the only thing that ever saw
   * the whole file, so the total arrives from it (`reusedSitemapUrlCount` for
   * a credited row, `total` for one read here) and is never inferred from the
   * sample. Absent a total, the sample is all that was measured and it is both.
   */
  const total = sitemap.availability === "unavailable" ? null
    : reusedSitemapMatches ? reusedSitemap!.urlCount ?? locations.length
      : sitemapSource.total ?? (sitemapSource.locations === undefined && reusedSitemapUrlCount !== undefined ? reusedSitemapUrlCount : locations.length);
  const urlCount = total === null ? null : Math.min(Math.max(total, locations.length), GEO_KNOWLEDGE_EVIDENCE_LIMITS.sitemapUrlCount);
  const truncated = sitemap.availability === "unavailable" ? false : reusedSitemapMatches ? reusedSitemap!.truncated ?? false : urlCount !== null && urlCount > locations.length;
  const hasOwnEvidence = sources.some((source) => source.kind === "own_page" && source.availability !== "unavailable"); const unavailable = sources.some((source) => source.availability === "unavailable"); const availability: GeoKnowledgeEvidenceV1["availability"] = !hasOwnEvidence ? "unavailable" : unavailable ? "partial" : "available";
  return buildGeoKnowledgeEvidenceV1({ schemaVersion: "marketing-geo-knowledge-evidence.v1", collectedAt: now.toISOString(), targetUrl: target.toString(), confirmedCompetitors: competitors, availability, limitation: availability === "available" ? null : "Some evidence sources were unavailable.", pages, machine: { jsonLd: { status: pages.some((page) => page.jsonLdTypes.length > 0) ? "present" as const : "absent" as const, types: [...new Set(pages.flatMap((page) => page.jsonLdTypes))].sort(), sourceRefs: ownRefs }, robots: { status: machineStatus(robots), sourceRefs: [robots.id] }, sitemap: { status: machineStatus(sitemap), sourceRefs: [sitemap.id], urlCount, knowledgePagesListed: sitemap.availability === "unavailable" ? null : pages.some((page) => listedPage(locations, page.url)), ...(sitemap.availability === "unavailable" ? {} : { locations, truncated }) }, llms: { status: machineStatus(llms), sourceRefs: [llms.id] }, hreflang: { status: pages.some((page) => page.hreflangLocales.length > 0) ? "present" as const : "absent" as const, locales: [...new Set(pages.flatMap((page) => page.hreflangLocales))].sort(), sourceRefs: ownRefs } }, sourceCatalogue: sources });
}

export async function collectGeoKnowledgeEvidenceV1(input: { targetUrl: string; competitors: Array<{ key: string; name: string; confirmed: boolean }> }, dependencies: CollectionDependencies): Promise<GeoKnowledgeEvidenceV1> {
  const target = validTarget(input.targetUrl);
  const confirmedCompetitors = input.competitors.filter((competitor) => competitor.confirmed).map((competitor) => ({ key: competitor.key, name: competitor.name, confirmed: true as const }));
  if (confirmedCompetitors.length > GEO_KNOWLEDGE_EVIDENCE_LIMITS.competitors || !unique(confirmedCompetitors.map(({ key }) => key)) || confirmedCompetitors.some(({ key }) => { try { return new URL(`https://${key}/`).hostname !== key; } catch { return true; } })) throw new Error("Invalid or duplicate competitor");
  const reusedEvidence = dependencies.reusedEvidence === undefined ? undefined : parseGeoKnowledgeEvidenceV1(dependencies.reusedEvidence);
  if (reusedEvidence !== undefined && (reusedEvidence.targetUrl !== target.toString() || JSON.stringify(reusedEvidence.confirmedCompetitors) !== JSON.stringify(confirmedCompetitors))) throw new Error("Reused evidence target or competitor scope mismatch");
  const sourceCandidates = [...(reusedEvidence?.sourceCatalogue ?? []), ...validateReusedSources(dependencies.reusedSources ?? [], target, confirmedCompetitors)];
  const unavailablePublicUrls = new Set(sourceCandidates.flatMap((source) => source.availability === "unavailable" && ["own_page", "competitor_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null ? [source.url] : []));
  const reusableCandidates = sourceCandidates.filter((source) => !(source.availability === "unavailable" && ["own_page", "competitor_page", "robots", "sitemap", "llms"].includes(source.kind)));
  const sources = reusableCandidates.filter((source, index) => reusableCandidates.findIndex((candidate) => candidate.id === source.id || source.url !== null && candidate.url === source.url) === index);
  const reusedUrls = new Set(sources.flatMap(({ url }) => url === null ? [] : [url]));
  /*
   * Pages this collection did not read, contributed by a caller that credited
   * the rows they came from.
   *
   * Every one is checked against the catalogue that was just built rather than
   * taken on trust: a page with no available source addressing it would be a
   * reading with no receipt, and `assertEvidenceIntegrity` refuses those at the
   * end anyway -- failing here says which page instead of failing there saying
   * "Invalid or duplicate page URL". `pageSchema` runs for the same reason the
   * reused sources are parsed: a caller assembles these from stored rows.
   */
  const contributed: Page[] = (dependencies.reusedPages ?? []).map((page) => pageSchema.parse(page) as Page).filter((page) => {
    if (!sources.some((source) => source.kind === "own_page" && source.availability !== "unavailable" && source.url === page.url)) throw new Error("Contributed page without an own-site source");
    return true;
  });
  const pages: Page[] = [...(reusedEvidence?.pages ?? []), ...contributed].filter((page) => !unavailablePublicUrls.has(page.url))
    .filter((page, index, all) => all.findIndex((candidate) => candidate.url === page.url) === index); const seenPageUrls = new Set(pages.map(({ url }) => url)); const seenCanonicalUrls = new Set(pages.flatMap(({ canonicalUrl }) => canonicalUrl === null ? [] : [canonicalUrl])); const startedAt = dependencies.nowMs?.() ?? Date.now(); const nowMs = dependencies.nowMs ?? Date.now; const deadline = startedAt + 70_000;
  const canRead = () => nowMs() < deadline; const timeout = () => Math.min(8_000, Math.max(0, deadline - nowMs()));
  const addSource = (source: GeoKnowledgeEvidenceSource) => { if (!sources.some(({ id: existing }) => existing === source.id) && !(source.url !== null && sources.some(({ url }) => url === source.url))) sources.push(source); };
  const readPage = async (requestUrl: string, kind: "own_page" | "competitor_page", competitor: Competitor | null = null): Promise<Page | null> => {
    if (reusedUrls.has(requestUrl) || !canRead()) return null;
    const result = await dependencies.readResource({ url: requestUrl, expected: "html", timeoutMs: timeout() });
    if (!responseIsValid(result)) { const reason = result && typeof result === "object" && (result as { kind?: unknown }).kind === "unavailable" ? unavailableReason((result as { reason?: unknown }).reason) : "invalid_response"; addSource(unavailableSource(kind, requestUrl, reason, competitor)); return null; }
    const finalUrl = asPublicUrl(result.url, new URL(requestUrl));
    if (finalUrl === null || !expectedContentType("html", result.contentType) || Buffer.byteLength(result.body, "utf8") > GEO_KNOWLEDGE_EVIDENCE_LIMITS.pageBytes) { addSource(unavailableSource(kind, requestUrl, "invalid_response", competitor)); return null; }
    const parsed = pageData(result.body, finalUrl); if (parsed.excerpts.length === 0) { addSource(unavailableSource(kind, finalUrl, "insufficient_evidence", competitor)); return null; } if (seenPageUrls.has(finalUrl) || parsed.canonicalUrl !== null && seenCanonicalUrls.has(parsed.canonicalUrl)) return null; seenPageUrls.add(finalUrl); if (parsed.canonicalUrl !== null) seenCanonicalUrls.add(parsed.canonicalUrl);
    addSource({ id: sourceId(kind, finalUrl), kind, label: kind === "own_page" ? "Own site page" : "Competitor page", url: finalUrl, competitor, availability: "available", reason: null, observedAt: result.observedAt, bodyHash: sha256(result.body), excerpts: parsed.excerpts.slice(0, GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxExcerpts) });
    const { excerpts: _excerpts, ...page } = parsed;
    pages.push(page);
    return page;
  };
  const reusedHome = pages.find((page) => page.url === target.toString() || page.canonicalUrl === target.toString());
  const existingHome = sources.find((source) => source.kind === "own_page" && (source.url === target.toString() || source.url === reusedHome?.url) && source.availability !== "unavailable");
  const home = existingHome ? reusedHome ?? null : await readPage(target.toString(), "own_page"); const hasOwnEvidence = existingHome !== undefined || home !== null;
  if (home !== null) for (const { url } of home.links) { if (sources.filter(({ kind }) => kind === "own_page").length >= GEO_KNOWLEDGE_EVIDENCE_LIMITS.ownPages) break; await readPage(url, "own_page"); }
  for (const [path, kind] of [["robots.txt", "robots"], ["sitemap.xml", "sitemap"], ["llms.txt", "llms"]] as const) {
    const url = new URL(path, target).toString(); if (sources.some((source) => source.kind === kind && source.url === url && source.availability !== "unavailable")) continue; if (!canRead()) { addSource(unavailableSource(kind, url, "timeout")); continue; }
    const result = await dependencies.readResource({ url, expected: kind, timeoutMs: timeout() });
    if (!responseIsValid(result) || !machineResourceAnsweredRequest(url, result.url) || !expectedContentType(kind, responseIsValid(result) ? result.contentType : "") || responseIsValid(result) && Buffer.byteLength(result.body, "utf8") > GEO_KNOWLEDGE_EVIDENCE_LIMITS.pageBytes) { const reason = result && typeof result === "object" && (result as { kind?: unknown }).kind === "unavailable" ? unavailableReason((result as { reason?: unknown }).reason) : "invalid_response"; addSource(unavailableSource(kind, url, reason)); continue; }
    const lines = result.body.split(/\r?\n/u).map(clean).filter(Boolean);
    if ((kind === "robots" || kind === "llms") && lines.length === 0 || kind === "sitemap" && result.body.trim() === "") { addSource(unavailableSource(kind, url, "not_published")); continue; }
    const validLocations = kind === "sitemap" ? [...new Set([...result.body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/giu)].map((match) => sitemapLocation(match[1]!, target)).filter((location): location is string => location !== null))] : []; const locations = validLocations.slice(0, GEO_KNOWLEDGE_EVIDENCE_LIMITS.sitemapLocations);
    const source = { id: sourceId(kind, url), kind, label: kind, url, competitor: null, availability: "available" as const, reason: null, observedAt: result.observedAt, bodyHash: sha256(result.body), excerpts: kind === "sitemap" ? locations.length > 0 ? locations.slice(0, GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxExcerpts) : [boundedExact(result.body)] : lines.slice(0, GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxExcerpts) } as GeoKnowledgeEvidenceSource & { locations?: string[]; truncated?: boolean };
    // `total` is the document's own count, kept beside the bounded sample so a
    // sitemap over `sitemapLocations` publishes its real size rather than the cap.
    if (kind === "sitemap") Object.defineProperties(source, { locations: { value: locations, enumerable: false }, truncated: { value: validLocations.length > locations.length, enumerable: false }, total: { value: validLocations.length, enumerable: false } });
    addSource(source);
  }
  if (hasOwnEvidence) for (const competitor of confirmedCompetitors) { if (sources.filter((source) => source.kind === "competitor_page" && source.competitor?.key === competitor.key).length >= GEO_KNOWLEDGE_EVIDENCE_LIMITS.competitorPagesPerIdentity) continue; let base: URL; try { base = validTarget(`https://${competitor.key}/`); } catch { continue; } const reusedCompetitorHome = pages.find((page) => page.url === base.toString() || page.canonicalUrl === base.toString()); const competitorHome = reusedCompetitorHome ?? await readPage(base.toString(), "competitor_page", competitor); const candidate = competitorHome?.links.find(({ intent }) => intent === "pricing" || intent === "product"); if (candidate && sources.filter((source) => source.kind === "competitor_page" && source.competitor?.key === competitor.key).length < GEO_KNOWLEDGE_EVIDENCE_LIMITS.competitorPagesPerIdentity) await readPage(candidate.url, "competitor_page", competitor); }
  if (!hasOwnEvidence) addUnavailableMachineSources(sources, target, "invalid_response");
  return finalize(target, confirmedCompetitors, pages, sources, dependencies.now(), reusedEvidence?.machine.sitemap, dependencies.reusedSitemapUrlCount);
}

function assertEvidenceIntegrity(body: EvidenceBody): void {
  const sourceById = new Map(body.sourceCatalogue.map((source) => [source.id, source])); if (sourceById.size !== body.sourceCatalogue.length) throw new Error("Duplicate source id"); const urls = body.sourceCatalogue.flatMap((source) => source.url === null ? [] : [source.url]); if (!unique(urls)) throw new Error("Duplicate source URL");
  const target = new URL(body.targetUrl); const competitors = new Map(body.confirmedCompetitors.map((competitor) => [competitor.key, competitor]));
  if (body.confirmedCompetitors.some(({ key }) => { try { return new URL(`https://${key}/`).hostname !== key; } catch { return true; } })) throw new Error("Invalid competitor");
  const ownSources = body.sourceCatalogue.filter(({ kind }) => kind === "own_page");
  if (ownSources.length > GEO_KNOWLEDGE_EVIDENCE_LIMITS.ownPages) throw new Error("Own-page source limit exceeded");
  const competitorSources = body.sourceCatalogue.filter(({ kind }) => kind === "competitor_page");
  const competitorKeys = new Set(competitorSources.map((source) => source.competitor!.key));
  if (competitorKeys.size > GEO_KNOWLEDGE_EVIDENCE_LIMITS.competitors) throw new Error("Competitor source limit exceeded");
  for (const competitorKey of competitorKeys) if (competitorSources.filter((source) => source.competitor!.key === competitorKey).length > GEO_KNOWLEDGE_EVIDENCE_LIMITS.competitorPagesPerIdentity) throw new Error("Competitor page limit exceeded");
  for (const kind of ["robots", "sitemap", "llms"] as const) if (body.sourceCatalogue.filter((source) => source.kind === kind).length > 1) throw new Error("Machine source limit exceeded");
  for (const source of body.sourceCatalogue) {
    if (source.observedAt !== null && source.observedAt > body.collectedAt) throw new Error("Source observation exceeds collection time");
    if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null && new URL(source.url).host !== target.host) throw new Error("Foreign own-site source");
    if (source.kind === "competitor_page" && (source.url === null || source.competitor === null || competitors.get(source.competitor.key)?.name !== source.competitor.name || new URL(source.url).host !== source.competitor.key)) throw new Error("Invalid competitor source");
    if (source.url !== null) { const url = new URL(source.url); if (source.kind === "robots" && (url.pathname !== "/robots.txt" || url.search !== "")) throw new Error("Invalid robots source URL"); if (source.kind === "llms" && (url.pathname !== "/llms.txt" || url.search !== "")) throw new Error("Invalid llms source URL"); if (source.kind === "sitemap" && (url.search !== "" || !url.pathname.toLocaleLowerCase("en").includes("sitemap") || !url.pathname.toLocaleLowerCase("en").endsWith(".xml"))) throw new Error("Invalid sitemap source URL"); }
  }
  const pageUrls = new Set<string>(); const canonicalUrls = new Set<string>();
  for (const page of body.pages) { const pageHost = new URL(page.url).host; if (pageUrls.has(page.url) || !body.sourceCatalogue.some((source) => (source.kind === "own_page" || source.kind === "competitor_page") && source.url === page.url)) throw new Error("Invalid or duplicate page URL"); pageUrls.add(page.url); if (page.canonicalUrl !== null) { if (new URL(page.canonicalUrl).host !== pageHost || canonicalUrls.has(page.canonicalUrl)) throw new Error("Invalid or duplicate canonical URL"); canonicalUrls.add(page.canonicalUrl); } if (page.links.some(({ url }) => new URL(url).host !== pageHost)) throw new Error("Foreign page link"); if (page.hreflang.some(({ url }) => new URL(url).host !== pageHost)) throw new Error("Foreign hreflang link"); }
  const expectedKinds: Record<keyof EvidenceBody["machine"], SourceKind> = { jsonLd: "own_page", llms: "llms", robots: "robots", sitemap: "sitemap", hreflang: "own_page" };
  for (const key of Object.keys(expectedKinds) as Array<keyof typeof expectedKinds>) if (body.machine[key].sourceRefs.some((reference) => sourceById.get(reference)?.kind !== expectedKinds[key])) throw new Error("Machine source kind mismatch");
  const same = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((value, index) => value === right[index]);
  const ownRefs = body.sourceCatalogue.filter(({ kind }) => kind === "own_page").map(({ id: sourceId }) => sourceId);
  const jsonLdTypes = [...new Set(body.pages.flatMap((page) => page.jsonLdTypes))].sort();
  const hreflangLocales = [...new Set(body.pages.flatMap((page) => page.hreflangLocales))].sort();
  if (!same(body.machine.jsonLd.sourceRefs, ownRefs) || !same(body.machine.jsonLd.types, jsonLdTypes) || body.machine.jsonLd.status !== (jsonLdTypes.length > 0 ? "present" : "absent")) throw new Error("JSON-LD machine summary mismatch");
  if (!same(body.machine.hreflang.sourceRefs, ownRefs) || !same(body.machine.hreflang.locales, hreflangLocales) || body.machine.hreflang.status !== (hreflangLocales.length > 0 ? "present" : "absent")) throw new Error("Hreflang machine summary mismatch");
  for (const key of ["robots", "sitemap", "llms"] as const) {
    const references = body.machine[key].sourceRefs;
    if (references.length !== 1) throw new Error("Machine endpoint requires one source");
    const source = sourceById.get(references[0]!);
    if (source === undefined || body.machine[key].status !== machineStatus(source)) throw new Error("Machine availability mismatch");
  }
  const sitemapLocations = body.machine.sitemap.locations ?? [];
  const sitemapCounted = body.machine.sitemap.truncated === true
    ? (body.machine.sitemap.urlCount ?? -1) >= sitemapLocations.length
    : body.machine.sitemap.urlCount === sitemapLocations.length;
  if (body.machine.sitemap.status === "present" && (!sitemapCounted || body.machine.sitemap.knowledgePagesListed !== body.pages.some((page) => listedPage(sitemapLocations, page.url)))) throw new Error("Sitemap machine summary mismatch");
  if (body.availability === "available" && body.limitation !== null || body.availability !== "available" && body.limitation === null) throw new Error("Evidence availability mismatch"); if (body.availability !== "unavailable" && !body.sourceCatalogue.some((source) => source.kind === "own_page" && source.availability !== "unavailable")) throw new Error("Missing own-site evidence");
}
export function geoKnowledgeEvidenceDigest(body: EvidenceBody): string { return geoV2Digest(body); }
export function buildGeoKnowledgeEvidenceV1(value: unknown): GeoKnowledgeEvidenceV1 { const body = bodySchema.parse(value); assertEvidenceIntegrity(body); const evidence = evidenceSchema.parse({ ...body, contentHash: geoKnowledgeEvidenceDigest(body) }); if (geoV2JsonbBytes(evidence) > GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxBytes) throw new Error("Evidence exceeds byte limit"); return evidence; }
export function parseGeoKnowledgeEvidenceV1(value: unknown): GeoKnowledgeEvidenceV1 { const parsed = evidenceSchema.safeParse(value); if (!parsed.success) throw new Error(`Invalid evidence: ${parsed.error.message}`); const evidence = parsed.data; const { contentHash, ...body } = evidence; if (geoKnowledgeEvidenceDigest(body) !== contentHash) throw new Error("Evidence hash mismatch"); assertEvidenceIntegrity(body); if (geoV2JsonbBytes(evidence) > GEO_KNOWLEDGE_EVIDENCE_LIMITS.maxBytes) throw new Error("Evidence exceeds byte limit"); return evidence; }
