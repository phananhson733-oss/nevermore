// @input -- a V2 source receipt, never model-authored authority
// @output -- the versioned bounded source contract
// @pos -- browser-safe shape validation; server verifies hashes and ownership
import { z } from "zod";
import { normalizeAccountWebsiteUrl, parseWebsiteProfileReference, type WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";
import { hasLoneSurrogate } from "../agents/geo-canonical.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

export const GEO_KB_SOURCE_SCHEMA = "marketing-geo-kb-enrichment.v2" as const;
export const GEO_KB_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export const GEO_KB_SOURCE_LIMITS = { queries: 1_000, queryChars: 512, competitors: 5, facts: 24, signals: 20, pageBytes: 512 * 1024, fetchMs: 8_000 } as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
// eslint-disable-next-line no-control-regex -- invalid provider controls are rejected, never repaired.
const text = (max: number) => z.string().max(max).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value) && !hasLoneSurrogate(value));
const nonempty = (max: number) => text(max).refine((value) => value.trim().length > 0);
const time = z.string().datetime().refine((value) => new Date(value).toISOString() === value);
const url = text(2_048).refine((value) => normalizeAccountWebsiteUrl(value) !== null);
const host = text(253).refine((value) => normalizeAccountWebsiteUrl(`https://${value}`)?.host === value);
const query = z.object({ id: z.string().regex(/^G[a-f0-9]{64}$/u), text: nonempty(GEO_KB_SOURCE_LIMITS.queryChars) }).strict();
const window = z.object({ startDate: z.string().date(), endDate: z.string().date() }).strict()
  .refine((value) => Date.parse(value.endDate) - Date.parse(value.startDate) === 89 * 86_400_000);
const gsc = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), reason: z.null(), property: nonempty(512), window,
    queryCount: z.number().int().min(0).max(GEO_KB_SOURCE_LIMITS.queries), truncated: z.boolean(), observedAt: time,
    queries: z.array(query).max(GEO_KB_SOURCE_LIMITS.queries) }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_connected", "property_not_granted", "grant_unavailable", "fetch_failed", "rate_limited", "invalid_response"]),
    property: nonempty(512).nullable(), window, queryCount: z.null(), truncated: z.null(), observedAt: z.null(), queries: z.array(query).max(0) }).strict(),
]);
const capture = { source: z.enum(["crawl"]).nullable(), sourceUrl: url.nullable(), observedAt: time.nullable(), bodyHash: hash.nullable() };
const fetchFailure = ["missing_url", "fetch_failed", "not_found", "target_redirected", "partial_body", "not_html", "invalid_response", "rate_limited"] as const;
const signal = z.object({ kind: z.enum(["json_ld_organization", "json_ld_website", "og_site_name", "title"]),
  name: nonempty(200), aliases: z.array(nonempty(200)).max(10), url: url.nullable(), hostMatched: z.boolean(),
  excludedReason: z.enum(["foreign_host", "unscoped_identity"]).nullable() }).strict();
const competitorCommon = { evidenceId: z.string().regex(/^C[1-9]\d{0,2}$/u), domain: z.union([host, z.literal("")]), confirmed: z.literal(false),
  ...capture, signals: z.array(signal).max(GEO_KB_SOURCE_LIMITS.signals), signalsTruncated: z.boolean() };
const competitor = z.discriminatedUnion("status", [
  z.object({ ...competitorCommon, status: z.literal("available"), reason: z.null(), brandName: nonempty(200), aliases: z.array(nonempty(200)).max(10),
    method: z.enum(["json_ld", "metadata_agreement", "og_site_name", "title"]) }).strict(),
  z.object({ ...competitorCommon, status: z.literal("conflict"), reason: z.literal("identity_conflict"), brandName: z.null(), aliases: z.array(text(200)).max(0), method: z.literal("conflicting_signals") }).strict(),
  z.object({ ...competitorCommon, status: z.literal("unavailable"), reason: z.enum([...fetchFailure, "insufficient_identity", "identity_overflow"]), brandName: z.null(), aliases: z.array(text(200)).max(0), method: z.null() }).strict(),
]);
/** Standalone frozen captures receive the same checks as receipt-owned captures. */
export const geoCompetitorSourceV2Schema = competitor.superRefine((item, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (item.source === "crawl" ? !item.sourceUrl || !item.observedAt || !item.bodyHash : item.observedAt !== null || item.bodyHash !== null) invalid("Invalid source capture");
  if (item.status !== "unavailable" && item.source !== "crawl") invalid("Missing source capture");
  if (item.source === "crawl" && normalizeAccountWebsiteUrl(item.sourceUrl!)?.host !== item.domain) invalid("Foreign competitor capture");
  for (const entry of item.signals) {
    const matched = entry.url !== null && normalizeAccountWebsiteUrl(entry.url)?.host === item.domain;
    const reason = entry.url === null ? "unscoped_identity" : matched ? null : "foreign_host";
    if (entry.hostMatched !== matched || entry.excludedReason !== reason) invalid("Invalid identity signal scope");
  }
  const retained = item.signals.filter(entry => entry.hostMatched).length;
  if (item.status === "available" && (retained < 1 || item.signalsTruncated) || item.status === "conflict" && retained < 2 || item.signalsTruncated !== (item.reason === "identity_overflow")) invalid("Invalid identity result");
  if (item.source === null && item.signals.length !== 0) invalid("Unobserved identity signals");
});
const factCommon = { evidenceId: z.string().regex(/^F[1-9]\d{0,2}$/u), key: nonempty(200), confirmed: z.literal(false), ...capture };
const fact = z.discriminatedUnion("status", [
  z.object({ ...factCommon, status: z.literal("available"), reason: z.null(), value: nonempty(200), excerpt: nonempty(1_000) }).strict(),
  z.object({ ...factCommon, status: z.literal("conflict"), reason: z.literal("conflicting"), value: z.null(), excerpt: nonempty(1_000) }).strict(),
  z.object({ ...factCommon, status: z.literal("unavailable"), reason: z.enum([...fetchFailure, "value_missing"]), value: z.null(), excerpt: z.null() }).strict(),
]);
const profileReference = z.custom<WebsiteProfileReferenceV1>((value) => {
  try { parseWebsiteProfileReference(value); return true; } catch { return false; }
});
const report = z.object({ schemaVersion: z.literal(GEO_KB_SOURCE_SCHEMA), receiptId: z.string().uuid(), kbId: z.string().uuid(), targetHost: host,
  draftVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), draftHash: hash, profileReference: profileReference.nullable(), createdAt: time,
  competitors: z.array(competitor).max(GEO_KB_SOURCE_LIMITS.competitors), facts: z.array(fact).max(GEO_KB_SOURCE_LIMITS.facts), gsc, contentHash: hash,
}).strict();

export type GeoKbSourceReportV2 = z.infer<typeof report>;
export type GeoKbSourceBodyV2 = Omit<GeoKbSourceReportV2, "contentHash">;
export type GeoGscSourceV2 = GeoKbSourceReportV2["gsc"];
export type GeoQueryEvidenceV2 = GeoGscSourceV2["queries"][number];
export type GeoCompetitorSourceV2 = GeoKbSourceReportV2["competitors"][number];
export type GeoIdentitySignalV2 = GeoCompetitorSourceV2["signals"][number];
export type GeoFactSourceV2 = GeoKbSourceReportV2["facts"][number];

function propertyMatches(property: string, targetHost: string): boolean {
  if (property === `sc-domain:${targetHost}`) return true;
  try { const parsed = new URL(property); return parsed.pathname === "/" && parsed.search === "" && parsed.hash === "" && normalizeAccountWebsiteUrl(property)?.host === targetHost; }
  catch { return false; }
}
export function parseGeoKbSourceReportV2(value: unknown): GeoKbSourceReportV2 {
  const parsed = report.parse(value);
  if (geoV2JsonbBytes(parsed) > GEO_KB_SOURCE_MAX_BYTES) throw new Error("Source receipt exceeds byte limit");
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  if (!unique([...parsed.competitors, ...parsed.facts].map((entry) => entry.evidenceId))) throw new Error("Duplicate evidence id");
  if (parsed.gsc.status === "available") {
    if (parsed.gsc.queries.length !== parsed.gsc.queryCount || !unique(parsed.gsc.queries.map((entry) => entry.id)) || !unique(parsed.gsc.queries.map((entry) => entry.text)) || !propertyMatches(parsed.gsc.property, parsed.targetHost) || parsed.gsc.observedAt > parsed.createdAt) throw new Error("Invalid query evidence");
  }
  for (const item of [...parsed.competitors, ...parsed.facts]) {
    if (item.source === "crawl" ? !item.sourceUrl || !item.observedAt || !item.bodyHash || item.observedAt > parsed.createdAt : item.observedAt !== null || item.bodyHash !== null) throw new Error("Invalid source capture");
    if (item.status !== "unavailable" && item.source !== "crawl") throw new Error("Missing source capture");
  }
  for (const item of parsed.competitors) {
    if (item.source === "crawl" && normalizeAccountWebsiteUrl(item.sourceUrl!)?.host !== item.domain) throw new Error("Foreign competitor capture");
    for (const entry of item.signals) {
      const matched = entry.url !== null && normalizeAccountWebsiteUrl(entry.url)?.host === item.domain;
      const reason = entry.url === null ? "unscoped_identity" : matched ? null : "foreign_host";
      if (entry.hostMatched !== matched || entry.excludedReason !== reason) throw new Error("Invalid identity signal scope");
    }
    const retained = item.signals.filter((entry) => entry.hostMatched).length;
    if (item.status === "available" && (retained < 1 || item.signalsTruncated) || item.status === "conflict" && retained < 2 || item.signalsTruncated !== (item.reason === "identity_overflow")) throw new Error("Invalid identity result");
    if (item.source === null && item.signals.length !== 0) throw new Error("Unobserved identity signals");
  }
  return parsed;
}
