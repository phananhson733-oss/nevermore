// @input -- real bounded source content, never model-authored provenance
// @output -- V2 source evidence and a stable immutable receipt
// @pos -- pure server-side extraction; no transport or persistence
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { hasLoneSurrogate } from "../agents/geo-canonical.ts";
import type { GeoKbFact } from "./kb-contract.ts";
import { canonicalGeoEnrichmentText, inspectGeoFact, type GeoEnrichmentPage } from "./kb-enrichment.ts";
import { GEO_KB_SOURCE_LIMITS, parseGeoKbSourceReportV2, type GeoKbSourceBodyV2, type GeoKbSourceReportV2, type GeoCompetitorSourceV2, type GeoFactSourceV2, type GeoIdentitySignalV2, type GeoQueryEvidenceV2 } from "./kb-source-contract.ts";

export function collectGeoQueryEvidenceV2(queries: readonly string[]): readonly GeoQueryEvidenceV2[] {
  // eslint-disable-next-line no-control-regex -- preserve valid text; never silently clean provider controls.
  if (queries.length > GEO_KB_SOURCE_LIMITS.queries || queries.some((query) => typeof query !== "string" || query.trim() === "" || query.length > GEO_KB_SOURCE_LIMITS.queryChars || /[\u0000-\u001f\u007f]/u.test(query) || hasLoneSurrogate(query))) throw new Error("Invalid source query inventory");
  return [...new Set(queries)].sort().map((text) => ({ id: `G${createHash("sha256").update(text).digest("hex")}`, text }));
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string" || hasLoneSurrogate(value)) return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  // eslint-disable-next-line no-control-regex -- reject source controls, not factual text.
  return cleaned.length > 0 && cleaned.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(cleaned) ? cleaned : null;
}
function sourceUrl(value: unknown, pageUrl: string): string | null {
  const raw = typeof value === "string" ? value : value !== null && typeof value === "object" && "@id" in value ? value["@id"] : null;
  if (typeof raw !== "string") return null;
  try { const resolved = new URL(raw, pageUrl).href; return normalizeAccountWebsiteUrl(resolved) !== null ? resolved : null; }
  catch { return null; }
}
function titleName(title: string): string {
  return title.split(/\s+[-–—|·]\s+|[:|]\s*/u)[0]!.trim();
}
const nameKey = (name: string): string => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function names(signal: GeoIdentitySignalV2): readonly string[] {
  return [signal.kind === "title" ? titleName(signal.name) : signal.name, ...signal.aliases].map(nameKey).filter(Boolean);
}
function plausibleTitle(name: string): boolean {
  return name.length <= 80 && name.split(/\s+/u).length <= 6 &&
    !/^(?:the best|best|welcome to|buy|discover|transform|free|get|unlock|#?1\b)/iu.test(name) &&
    !/\b(?:your business|all-in-one|sign up|start today)\b/iu.test(name);
}

/** Signals retain their actual declared URL; foreign/unscoped nodes are never votes. */
export function extractGeoCompetitorSourceV2(domain: string, page: GeoEnrichmentPage, evidenceId: string): GeoCompetitorSourceV2 {
  const empty = { evidenceId, domain, confirmed: false as const, sourceUrl: page.url, source: null, observedAt: null, bodyHash: null,
    signals: [] as GeoIdentitySignalV2[], signalsTruncated: false, brandName: null, aliases: [] as string[], method: null };
  const unavailable = (reason: Extract<GeoCompetitorSourceV2, { status: "unavailable" }>["reason"]): GeoCompetitorSourceV2 => ({ ...empty, status: "unavailable", reason });
  if (page.kind !== "ok") return unavailable(page.reason);
  if (normalizeAccountWebsiteUrl(page.url)?.host !== domain) return unavailable("target_redirected");
  if (Buffer.byteLength(page.body) > GEO_KB_SOURCE_LIMITS.pageBytes || !Number.isFinite(Date.parse(page.observedAt)) || new Date(page.observedAt).toISOString() !== page.observedAt) return unavailable("invalid_response");
  const $ = load(page.body);
  const signals: GeoIdentitySignalV2[] = [];
  let signalsTruncated = false;
  const add = (kind: GeoIdentitySignalV2["kind"], rawName: unknown, rawAliases: readonly unknown[], url: string | null): void => {
    if (typeof rawName === "string" && rawName.replace(/\s+/gu, " ").trim().length > 200 || rawAliases.some((alias) => typeof alias === "string" && alias.replace(/\s+/gu, " ").trim().length > 200)) signalsTruncated = true;
    const name = cleanName(rawName);
    if (name === null) return;
    const allAliases = [...new Set(rawAliases.map(cleanName).filter((alias): alias is string => alias !== null && alias !== name))];
    if (signals.length >= GEO_KB_SOURCE_LIMITS.signals) { signalsTruncated = true; return; }
    if (allAliases.length > 10) signalsTruncated = true;
    const hostMatched = url !== null && normalizeAccountWebsiteUrl(url)?.host === domain;
    signals.push({ kind, name, aliases: allAliases.slice(0, 10), url, hostMatched,
      excludedReason: url === null ? "unscoped_identity" : hostMatched ? null : "foreign_host" });
  };
  let visited = 0;
  const structured = (value: unknown, depth = 0): void => {
    if (depth > 5 || visited++ > 200) { signalsTruncated = true; return; }
    if (Array.isArray(value)) { for (const child of value.slice(0, 201)) structured(child, depth + 1); if (value.length > 201) signalsTruncated = true; return; }
    if (value === null || typeof value !== "object") return;
    const entry = value as Record<string, unknown>;
    const types = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]];
    const kind = types.includes("WebSite") ? "json_ld_website" : types.some((type) => type === "Organization" || type === "Corporation") ? "json_ld_organization" : null;
    if (kind !== null) {
      const aliases = Array.isArray(entry.alternateName) ? entry.alternateName : [entry.alternateName];
      add(kind, entry.name, aliases, sourceUrl(entry.url ?? entry["@id"], page.url));
    }
    // A nested publisher is not the subject. Top-level/@graph identities still
    // require a same-host URL before participating in agreement.
    if (entry["@graph"] !== undefined) structured(entry["@graph"], depth + 1);
  };
  const scripts = $("script[type='application/ld+json']");
  if (scripts.length > 10) signalsTruncated = true;
  scripts.slice(0, 10).each((_index, node) => {
    try { structured(JSON.parse($(node).text())); } catch { /* malformed JSON-LD is not a signal */ }
  });
  $("meta[property='og:site_name']").slice(0, 21).each((_index, node) => add("og_site_name", $(node).attr("content"), [], page.url));
  $("title").slice(0, 21).each((_index, node) => add("title", $(node).text(), [], page.url));
  const capture = { ...empty, source: "crawl" as const, observedAt: page.observedAt, bodyHash: createHash("sha256").update(page.body).digest("hex"), signals, signalsTruncated };
  if (signalsTruncated) return { ...capture, status: "unavailable", reason: "identity_overflow" };
  const local = signals.filter((signal) => signal.hostMatched);
  if (local.length === 0) return { ...capture, status: "unavailable", reason: "not_found" };
  const conflict = local.some((a, index) => local.slice(index + 1).some((b) => !names(a).some((name) => names(b).includes(name))));
  if (conflict) return { ...capture, status: "conflict", reason: "identity_conflict", method: "conflicting_signals" };
  const chosen = local.find((signal) => signal.kind.startsWith("json_ld")) ?? local.find((signal) => signal.kind === "og_site_name") ?? local[0]!;
  const brandName = chosen.kind === "title" ? titleName(chosen.name) : chosen.name;
  if (chosen.kind === "title" && !plausibleTitle(brandName)) return { ...capture, status: "unavailable", reason: "insufficient_identity" };
  const aliases = [...new Set(local.flatMap((signal) => [signal.kind === "title" ? titleName(signal.name) : signal.name, ...signal.aliases]))]
    .filter((alias) => alias.toLocaleLowerCase("en") !== brandName.toLocaleLowerCase("en")).slice(0, 10);
  const method = local.length > 1 ? "metadata_agreement" : chosen.kind.startsWith("json_ld") ? "json_ld" : chosen.kind === "og_site_name" ? "og_site_name" : "title";
  return { ...capture, status: "available", reason: null, brandName, aliases, method };
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
function factConflict(fact: GeoKbFact, body: string): string | undefined {
  const $ = load(body);
  $("script,style,noscript,template,svg,iframe,[hidden],[aria-hidden='true']").remove();
  const segments = $("p,li,dd,td,h1,h2,h3").map((_index, node) => $(node).text().replace(/\s+/gu, " ").trim()).get().filter((segment) => segment.length <= 1_000);
  const key = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(fact.key)}(?![\\p{L}\\p{N}])`, "iu");
  const labelled = new RegExp(`^${escapeRegex(fact.key)}\\s*[:：]\\s*(.+)$`, "iu");
  const numbers = (value: string): readonly number[] => [...value.matchAll(/(?<![\p{L}\p{N}])\d+(?:\.\d+)?(?![\p{L}\p{N}])/gu)].map((match) => Number(match[0]));
  const expected = numbers(fact.value);
  return segments.find((segment) => {
    if (!key.test(segment)) return false;
    const lower = segment.toLocaleLowerCase("en"), value = fact.value.toLocaleLowerCase("en");
    for (let offset = lower.indexOf(value); offset >= 0; offset = lower.indexOf(value, offset + Math.max(1, value.length))) {
      // Only direct denial of the same value, not a general semantic judgement.
      if (/(?:\b(?:not|never|no longer|isn't|isn’t)(?:\s+(?:cost|costs|be|equal to))?|不是|并非|不再)\s*$/iu.test(lower.slice(0, offset))) return true;
    }
    const tail = labelled.exec(segment)?.[1];
    if (tail === undefined || expected.length !== 1) return false;
    const actual = numbers(tail);
    // Restrict to an exact labelled single-number dimension. Other numbers,
    // units, qualifications or prose are not an independent contradiction.
    return actual.length === 1 && actual[0] !== expected[0];
  });
}
export function inspectGeoFactSourceV2(fact: GeoKbFact, page: GeoEnrichmentPage, evidenceId: string): GeoFactSourceV2 {
  if (fact.value.trim() === "") return { evidenceId, key: fact.key, value: null, status: "unavailable", reason: "value_missing", confirmed: false,
    source: null, sourceUrl: page.url, observedAt: null, bodyHash: null, excerpt: null };
  if (page.kind === "ok" && (Buffer.byteLength(page.body) > GEO_KB_SOURCE_LIMITS.pageBytes || !Number.isFinite(Date.parse(page.observedAt)) || new Date(page.observedAt).toISOString() !== page.observedAt)) {
    page = { kind: "unavailable", reason: "invalid_response", url: page.url };
  }
  const observed = inspectGeoFact(fact, page, evidenceId);
  if (page.kind === "ok" && observed.reason !== "target_redirected") {
    const excerpt = factConflict(fact, page.body);
    if (excerpt !== undefined) return { evidenceId, key: fact.key, value: null, status: "conflict", reason: "conflicting", confirmed: false,
      source: "crawl", sourceUrl: page.url, observedAt: page.observedAt, bodyHash: createHash("sha256").update(page.body).digest("hex"), excerpt };
  }
  return { ...observed, confirmed: false };
}
export function finalizeGeoKbSourceReportV2(body: GeoKbSourceBodyV2): GeoKbSourceReportV2 {
  const contentHash = createHash("sha256").update(canonicalGeoEnrichmentText(body)).digest("hex");
  return verifyGeoKbSourceReportV2({ ...body, contentHash });
}
/** Integrity only; callers must separately owner-read the persisted receipt. */
export function verifyGeoKbSourceReportV2(value: unknown): GeoKbSourceReportV2 {
  const parsed = parseGeoKbSourceReportV2(value);
  const { contentHash, ...body } = parsed;
  if (createHash("sha256").update(canonicalGeoEnrichmentText(body)).digest("hex") !== contentHash) throw new Error("Source receipt hash mismatch");
  for (const query of parsed.gsc.queries) {
    if (query.id !== `G${createHash("sha256").update(query.text).digest("hex")}`) throw new Error("Source query identity mismatch");
  }
  return parsed;
}
/** Complete source catalogue; a prompt consumer must disclose any later selection. */
export function geoKbSourceCatalogueV2(value: unknown): readonly { readonly id: string; readonly kind: "gsc" | "crawl"; readonly text: string }[] {
  const report = verifyGeoKbSourceReportV2(value);
  const id = (evidenceId: string) => `S:${report.receiptId}:${evidenceId}`;
  return [
    ...report.gsc.queries.map((query) => ({ id: id(query.id), kind: "gsc" as const, text: query.text })),
    // Identity has structured signals, not a captured prose excerpt. Preserve
    // that distinction instead of fabricating an HTML quote.
    ...report.competitors.flatMap((entry) => entry.status === "available" ? [{ id: id(entry.evidenceId), kind: "crawl" as const,
      text: JSON.stringify({ domain: entry.domain, brandName: entry.brandName, aliases: entry.aliases, sourceUrl: entry.sourceUrl, observedAt: entry.observedAt, method: entry.method }) }] : []),
    ...report.facts.flatMap((entry) => entry.status === "available" ? [{ id: id(entry.evidenceId), kind: "crawl" as const, text: entry.excerpt }] : []),
  ];
}
