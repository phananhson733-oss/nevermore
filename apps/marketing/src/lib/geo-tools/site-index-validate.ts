// @input -- untrusted site/T2 evidence plus a validated V2 observation report
// @output -- strict bounded source evidence, never an authenticity or ownership grant
// @pos -- client-pure evidence boundary shared by wire, store and importer
import { codePointLength, hasLoneSurrogate } from "../agents/geo-canonical.ts";
import { isNormalizedGeoCitationUrl, isNormalizedGeoHost, normalizeGeoHost } from "../agents/geo-url.ts";
import { WEBSITE_PROFILE_LIST_MAX_ITEMS } from "../account-websites/contracts.ts";
import { CITABILITY_RETRIEVAL_BOTS, CITABILITY_TRAINING_BOTS, CITABILITY_RULES_VERSION } from "./citability-contract.ts";
import { GEO_SITE_EVIDENCE_SCHEMA, type GeoReadPage, type VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
import { siteQuestionTerms } from "./site-index-text.ts";
import { classifyVisibilityGaps } from "./gap-classify.ts";
import { postgresJsonbTextBytes, VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES } from "./visibility-wire.ts";

type Row = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/u;
const PAGE_KEYS = ["id", "url", "finalUrl", "fetchedAt", "state", "reason", "httpStatus", "contentSha256", "contentMethod", "bodyComplete", "title", "headings", "pageType", "pageTypeBasis", "ownPresence", "ownPresenceBasis", "ownPresenceExcerpt", "matches"];
const INDEX_LIMITS = ["robots_blocked", "page_limit_or_deadline", "incomplete_inventory", "evidence_byte_limit"];
const RENDER_REASONS = ["not_configured", "timeout", "service_failed", "invalid_response", "blocked", "resource_limit", "truncated", "navigation"];
function requireValue(value: unknown): asserts value { if (!value) throw new Error("Invalid site evidence"); }
function exact(value: unknown, keys: readonly string[]): Row {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  const row = value as Row;
  requireValue(Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)));
  return row;
}
function object(value: unknown): Row {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Row;
}
function count(value: unknown, max: number, min = 0): value is number { return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max; }
function text(value: unknown, max: number, allowEmpty = false): value is string {
  // eslint-disable-next-line no-control-regex -- evidence labels must not carry hidden control characters.
  return typeof value === "string" && (allowEmpty || value.length > 0) && codePointLength(value) <= max && value.trim() === value && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f]/u.test(value) && !hasLoneSurrogate(value);
}
function instant(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function array(value: unknown, max: number): unknown[] { requireValue(Array.isArray(value) && value.length <= max); return value; }
function strings(value: unknown, maxItems: number, maxText: number, unique = true): string[] {
  const values = array(value, maxItems);
  requireValue(values.every((entry) => text(entry, maxText)) && (!unique || new Set(values).size === values.length));
  return values as string[];
}
function http(value: unknown): boolean { return value === null || count(value, 599, 100); }
function hash(value: unknown): value is string { return typeof value === "string" && HASH.test(value); }
function beforeCollection(value: unknown, collectedAt: string): value is string {
  // Renderer clocks may differ by the adapter's explicitly allowed 60 seconds.
  return instant(value) && Date.parse(value) <= Date.parse(collectedAt) + 60_000;
}
function pageFrom(value: unknown, report: VisibilityReportV2, collectedAt: string, reference: boolean, budgetTrimmed: boolean): GeoReadPage {
  const page = exact(value, reference ? [...PAGE_KEYS, "sampleSlots"] : PAGE_KEYS);
  requireValue(typeof page.id === "string" && /^page-[a-f0-9]{20}$/u.test(page.id) && isNormalizedGeoCitationUrl(page.url));
  requireValue(beforeCollection(page.fetchedAt, collectedAt) && http(page.httpStatus) && typeof page.bodyComplete === "boolean");
  if (!reference) requireValue(normalizeGeoHost(page.url) === report.context.targetHost);
  const headings = strings(page.headings, 20, 160, false);
  requireValue(page.title === null || text(page.title, 200));
  requireValue(page.ownPresenceExcerpt === null || text(page.ownPresenceExcerpt, 160));
  const matches = array(page.matches, report.questions.length), seenQuestions = new Set<string>();
  for (const value of matches) {
    const match = exact(value, ["questionId", "entities", "terms"]);
    const question = report.questions.find((q) => q.questionId === match.questionId);
    requireValue(question !== undefined && !seenQuestions.has(question.questionId)); seenQuestions.add(question.questionId);
    const allowed = siteQuestionTerms(question.definition, report.context);
    const entities = strings(match.entities, 8, 2000), terms = strings(match.terms, 16, 2000);
    requireValue(allowed.searchable && entities.every((term) => allowed.entities.includes(term)) && terms.every((term) => allowed.terms.includes(term)) && (entities.length > 0 || terms.length >= 2));
  }
  if (page.state === "unavailable") {
    requireValue(["blocked", "fetch_failed", "not_html", "truncated", "deadline", "limit"].includes(String(page.reason)) && typeof page.reason === "string");
    requireValue(page.finalUrl === null && page.contentSha256 === null && page.contentMethod === null && !page.bodyComplete && page.title === null && headings.length === 0 && page.pageType === "unavailable" && page.pageTypeBasis === null && page.ownPresence === null && page.ownPresenceBasis === null && page.ownPresenceExcerpt === null && matches.length === 0);
  } else {
    requireValue(page.state === "read" && isNormalizedGeoCitationUrl(page.finalUrl) && normalizeGeoHost(page.finalUrl) === normalizeGeoHost(page.url) && count(page.httpStatus, 299, 200) && hash(page.contentSha256));
    requireValue(page.contentMethod === "raw_html" || page.contentMethod === "rendered_visible_text");
    requireValue(page.reason === (page.bodyComplete ? null : "truncated"));
    requireValue(typeof page.pageType === "string" && ["listicle", "comparison", "product", "article", "documentation", "other"].includes(page.pageType) && (page.pageTypeBasis === "title_headings" || page.pageTypeBasis === "jsonld"));
    if (page.ownPresence === true) requireValue((page.ownPresenceBasis === "brand_text" && (page.ownPresenceExcerpt !== null || budgetTrimmed)) || (page.ownPresenceBasis === "site_link" && page.ownPresenceExcerpt === null));
    else if (page.ownPresence === false) requireValue(page.bodyComplete && page.ownPresenceBasis === "none" && page.ownPresenceExcerpt === null);
    else requireValue(page.ownPresence === null && !page.bodyComplete && page.ownPresenceBasis === null && page.ownPresenceExcerpt === null);
  }
  return page as unknown as GeoReadPage;
}
const RULES: Readonly<Record<string, readonly [string, string, string]>> = {
  ...Object.fromEntries(CITABILITY_RETRIEVAL_BOTS.map((bot) => [`robots.${bot.toLowerCase()}`, ["readable", "deterministic", "counted"]])),
  ...Object.fromEntries(CITABILITY_TRAINING_BOTS.map((bot) => [`robots.${bot.toLowerCase()}`, ["readable", "deterministic", "advisory"]])),
  ssr: ["readable", "deterministic", "counted"], canonical: ["readable", "deterministic", "counted"], llmsTxt: ["readable", "deterministic", "advisory"],
  leadAnswer: ["extractable", "heuristic", "counted"], qualifiers: ["extractable", "heuristic", "counted"], extractableStructure: ["extractable", "deterministic", "counted"], citedData: ["extractable", "deterministic", "counted"], faqSchema: ["extractable", "deterministic", "counted"],
};
function detailFrom(value: unknown): void {
  const detail = exact(value, ["key", ...(Object.hasOwn(object(value), "values") ? ["values"] : [])]);
  requireValue(typeof detail.key === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(detail.key));
  if (Object.hasOwn(detail, "values")) {
    const values = object(detail.values);
    requireValue(Object.keys(values).length <= 12);
    for (const [key, value] of Object.entries(values)) requireValue(/^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(key) && (typeof value === "number" && Number.isFinite(value) || text(value, 2048, true)));
  }
}
function checksFrom(value: unknown, renderStatus: unknown, rulesVersion: unknown): void {
  const checks = array(value, Object.keys(RULES).length), seen = new Set<string>();
  requireValue(checks.length === Object.keys(RULES).length);
  for (const value of checks) {
    const check = exact(value, ["ruleId", "section", "kind", "weight", "state", "measured", ...(Object.hasOwn(object(value), "fix") ? ["fix"] : [])]);
    requireValue(typeof check.ruleId === "string" && Object.hasOwn(RULES, check.ruleId) && !seen.has(check.ruleId)); seen.add(check.ruleId);
    const identity = RULES[check.ruleId]!;
    // Unversioned exact snapshots retain the original deterministic citedData
    // label. Only the explicitly versioned new inventory uses the corrected kind.
    const kind = check.ruleId === "citedData" && rulesVersion === CITABILITY_RULES_VERSION ? "heuristic" : identity[1];
    requireValue(check.section === identity[0] && check.kind === kind && check.weight === identity[2]);
    requireValue(typeof check.state === "string" && ["pass", "fail", "fetchError", "notApplicable"].includes(check.state));
    requireValue(Object.hasOwn(check, "fix") === (check.state === "fail"));
    detailFrom(check.measured); if (check.state === "fail") detailFrom(check.fix);
    if (check.ruleId === "ssr" && renderStatus !== "measured") requireValue(check.state === "fetchError");
  }
}

/** This verifies evidence consistency; private-store ownership is checked elsewhere. */
export function parseVisibilitySiteEvidence(value: unknown, report: VisibilityReportV2): VisibilitySiteEvidenceV1 | null {
  try {
    requireValue(postgresJsonbTextBytes(value) <= VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES);
    const root = exact(value, ["schemaVersion", "collectedAt", "index", "references", "referenceOmittedCount", "citability", "citabilityOmittedCount"]);
    requireValue(root.schemaVersion === GEO_SITE_EVIDENCE_SCHEMA && instant(root.collectedAt));
    const index = exact(root.index, ["scope", "status", "targetHost", "discoveredCount", "pages", "sitemapUrls", "inventorySources", "limits", ...(Object.hasOwn(object(root.index), "priority") ? ["priority"] : [])]);
    requireValue(index.scope === "declared_and_reachable_inventory" && index.targetHost === report.context.targetHost && isNormalizedGeoHost(index.targetHost) && ["complete", "partial", "unavailable"].includes(String(index.status)) && typeof index.status === "string");
    const limits = strings(index.limits, INDEX_LIMITS.length, 80); requireValue(limits.every((limit) => INDEX_LIMITS.includes(limit)));
    const budgetTrimmed = limits.includes("evidence_byte_limit");
    requireValue(!budgetTrimmed || index.status !== "complete" && limits.includes("incomplete_inventory"));
    const pages = array(index.pages, 24).map((page) => pageFrom(page, report, root.collectedAt as string, false, budgetTrimmed));
    if (Object.hasOwn(index, "priority")) {
      const priority = exact(index.priority, ["method", "snapshotId", "contextHash", "featureCount", "prioritizedUrls"]);
      requireValue(priority.snapshotId === report.manifest.snapshotId && count(priority.featureCount, WEBSITE_PROFILE_LIST_MAX_ITEMS));
      const prioritized = strings(priority.prioritizedUrls, 24, 2048);
      requireValue(prioritized.every((url) => pages.some((page) => page.url === url)));
      if (priority.method === "none") requireValue(priority.contextHash === null && priority.featureCount === 0 && prioritized.length === 0);
      else requireValue(priority.method === "frozen_profile_core_features.v1" && hash(priority.contextHash));
    }
    requireValue(new Set(pages.map((page) => page.id)).size === pages.length && new Set(pages.map((page) => page.url)).size === pages.length && count(index.discoveredCount, 2_000_000, pages.length));
    if (index.status === "unavailable") requireValue(pages.length === 0);
    const sitemapUrls = strings(index.sitemapUrls, 3, 2048); requireValue(sitemapUrls.every((url) => isNormalizedGeoCitationUrl(url) && normalizeGeoHost(url) === report.context.targetHost));
    const sources = array(index.inventorySources, 3).map((value) => {
      const source = exact(value, ["url", "fetchedAt", "httpStatus", "bodyComplete", "contentSha256"]);
      requireValue(isNormalizedGeoCitationUrl(source.url) && sitemapUrls.includes(source.url) && beforeCollection(source.fetchedAt, root.collectedAt as string) && http(source.httpStatus) && typeof source.bodyComplete === "boolean");
      requireValue(source.httpStatus === null ? source.contentSha256 === null && !source.bodyComplete : hash(source.contentSha256));
      return source;
    });
    requireValue(sources.length === sitemapUrls.length && new Set(sources.map((source) => source.url)).size === sources.length);
    if (index.status === "complete") requireValue(pages.length > 0 && sources.length > 0 && sources.every((source) => count(source.httpStatus, 299, 200) && source.bodyComplete && hash(source.contentSha256)) && pages.length === index.discoveredCount && pages.every((page) => page.state === "read" && page.bodyComplete) && limits.length === 0);
    const samples = report.questions.flatMap((q) => q.samples).filter((sample) => sample.status === "ok");
    const citedUrls = new Set(samples.flatMap((sample) => sample.citedUrls));
    const references = array(root.references, 12), referenceIds = new Set<string>(), referenceUrls = new Set<string>();
    const ids = new Map(pages.map((page) => [page.id, page.url]));
    for (const value of references) {
      const reference = pageFrom(value, report, root.collectedAt as string, true, budgetTrimmed);
      requireValue(!referenceIds.has(reference.id) && !referenceUrls.has(reference.url) && (!ids.has(reference.id) || ids.get(reference.id) === reference.url));
      referenceIds.add(reference.id); referenceUrls.add(reference.url);
      const slots = strings(object(value).sampleSlots, 1000, 160), expected = samples.filter((sample) => sample.citedUrls.includes(reference.url)).map((sample) => sample.slotId);
      requireValue(expected.length > 0 && slots.length === expected.length && slots.every((slot) => expected.includes(slot)));
    }
    requireValue(root.referenceOmittedCount === citedUrls.size - references.length);
    const candidates = pages.flatMap((page) => page.state === "read" && page.bodyComplete ? page.matches.map((match) => `${page.id}|${match.questionId}`) : []);
    const citability = array(root.citability, 3), checksSeen = new Set<string>();
    for (const value of citability) {
      const check = exact(value, ["id", "pageId", "questionId", "url", "checkedAt", "checks", "renderStatus", "renderReason", "rawToRenderedRatio", ...(Object.hasOwn(object(value), "rulesVersion") ? ["rulesVersion"] : [])]);
      if (Object.hasOwn(check, "rulesVersion")) requireValue(check.rulesVersion === CITABILITY_RULES_VERSION);
      const page = pages.find((page) => page.id === check.pageId && page.url === check.url);
      requireValue(page !== undefined && candidates.includes(`${page.id}|${String(check.questionId)}`) && check.id === `t2-${page.id}-${String(check.questionId)}` && !checksSeen.has(check.id)); checksSeen.add(check.id);
      requireValue(beforeCollection(check.checkedAt, root.collectedAt as string));
      requireValue(check.renderStatus === "measured" || check.renderStatus === "partial" || check.renderStatus === "unavailable");
      requireValue(check.rawToRenderedRatio === null || typeof check.rawToRenderedRatio === "number" && Number.isFinite(check.rawToRenderedRatio) && check.rawToRenderedRatio >= 0);
      requireValue(check.renderStatus === "measured" ? check.renderReason === null : check.rawToRenderedRatio === null && typeof check.renderReason === "string" && RENDER_REASONS.includes(check.renderReason));
      checksFrom(check.checks, check.renderStatus, check.rulesVersion);
    }
    const unretainedCandidates = candidates.length - citability.length;
    requireValue(budgetTrimmed ? count(root.citabilityOmittedCount, 24 * report.questions.length, unretainedCandidates) : root.citabilityOmittedCount === unretainedCandidates);
    const evidence = value as VisibilitySiteEvidenceV1;
    const gaps = classifyVisibilityGaps(report, evidence);
    requireValue(postgresJsonbTextBytes({ siteEvidence: evidence, gaps }) <= VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES);
    return evidence;
  } catch { return null; }
}
