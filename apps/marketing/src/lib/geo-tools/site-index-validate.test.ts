// @input -- real collector output built from injected public documents
// @output -- strict source identity/state checks and gap recomputation proof
// @pos -- offline site evidence contract, never a production crawl
import { describe, expect, it } from "vitest";
import type { PublicResourceResult } from "@sf/sources/public-http";
import { collectVisibilitySiteEvidence } from "./site-index.ts";
import { measureCitabilityRender } from "./citability-render.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { classifyVisibilityGaps } from "./gap-classify.ts";
import { parseVisibilityReportV2, exportVisibilityJson, parseVisibilityImport } from "./visibility-export.ts";
import { parseVisibilitySiteEvidence } from "./site-index-validate.ts";
import type { VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";

async function fixture() {
  const seed = visibilityReportFixtureV2();
  const report = visibilityReportFixtureV2({
    questions: [{ ...seed.questions[0]!.definition, text: "How can teams automate invoice reminders?", requiredEntities: ["invoice reminders"] }], samplesPerQuestion: 3,
    samples: Array.from({ length: 3 }, (_, i) => ({ ...seed.questions[0]!.samples[0]!, sampleIndex: i + 1, slotId: `chatgpt:q1:${i + 1}`, providerTaskId: `task-${i}`, citedDomains: ["publisher.test"], citedUrls: ["https://publisher.test/best"] })),
  });
  const pages: Record<string, { body: string; type: string }> = {
    "https://acme.test/robots.txt": { body: "User-agent: *\nAllow: /", type: "text/plain" },
    "https://publisher.test/robots.txt": { body: "User-agent: *\nAllow: /", type: "text/plain" },
    "https://acme.test/sitemap.xml": { body: "<urlset><url><loc>https://acme.test/</loc></url></urlset>", type: "application/xml" },
    "https://acme.test/": { body: "<html><title>Invoice reminder guide</title><body><h1>Invoice reminders</h1>Acme automates invoice reminders for teams.</body></html>", type: "text/html" },
    "https://publisher.test/best": { body: "<html><title>Best invoice reminder tools</title><body><ol><li>Rival</li><li>Other</li></ol></body></html>", type: "text/html" },
  };
  const now = () => new Date("2026-08-31T00:02:00.000Z");
  const evidence = await collectVisibilitySiteEvidence(report, { now, fetchResource: async (url): Promise<PublicResourceResult> => {
    const page = pages[url];
    if (!page) return { kind: "error", code: "network" };
    return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200, redirectChain: [], body: page.body, bodyComplete: true, bytes: new TextEncoder().encode(page.body).byteLength, contentType: page.type, xRobotsTag: null };
  }, renderPage: async (request) => measureCitabilityRender(request, request.rawHtml, { now }) });
  return { report, evidence };
}

describe("strict site evidence", () => {
  it("accepts the actual collector and T2 rule output, then round-trips recomputed gaps", async () => {
    const { report, evidence } = await fixture();
    expect(evidence.index.status).toBe("complete");
    expect(evidence.citability[0]?.checks).toHaveLength(14);
    expect(parseVisibilitySiteEvidence(evidence, report) !== null).toBe(true);
    const attached = { ...report, siteEvidence: evidence, gaps: classifyVisibilityGaps(report, evidence) };
    expect(parseVisibilityReportV2(attached) !== null).toBe(true);
    expect(parseVisibilityImport(exportVisibilityJson(attached))).toMatchObject({ ok: true, provenance: "imported_untrusted" });
  });

  it("refuses impossible complete inventories and wrong host/hash/duplicate identity", async () => {
    const { report, evidence } = await fixture();
    for (const index of [
      { ...evidence.index, inventorySources: [] },
      { ...evidence.index, discoveredCount: 2 },
      { ...evidence.index, targetHost: "other.test" },
      { ...evidence.index, pages: [...evidence.index.pages, ...evidence.index.pages], discoveredCount: 2 },
      { ...evidence.index, pages: evidence.index.pages.map((p) => ({ ...p, contentSha256: "not-a-hash" })) },
      { ...evidence.index, pages: evidence.index.pages.map((p) => ({ ...p, bodyComplete: false, reason: "truncated" })) },
    ]) expect(parseVisibilitySiteEvidence({ ...evidence, index }, report)).toBeNull();
  });

  it("requires retained citation URL and complete observations for negative third-party evidence", async () => {
    const { report, evidence } = await fixture();
    const reference = evidence.references[0]!;
    for (const invalid of [
      { ...reference, sampleSlots: ["chatgpt:q1:999"] },
      { ...reference, sampleSlots: [reference.sampleSlots[0], reference.sampleSlots[0]] },
      { ...reference, url: "https://publisher.test/not-cited", finalUrl: "https://publisher.test/not-cited" },
      { ...reference, finalUrl: "https://acme.test/" },
      { ...reference, bodyComplete: false, reason: "truncated" },
      { ...reference, ownPresenceBasis: "brand_text" },
      { ...reference, extra: true },
    ]) expect(parseVisibilitySiteEvidence({ ...evidence, references: [invalid] }, report)).toBeNull();
  });

  it("rejects fabricated relevance and T2 rules or mismatched page/question binding", async () => {
    const { report, evidence } = await fixture();
    const check = evidence.citability[0]!;
    for (const changed of [
      { ...check, questionId: "unknown" },
      { ...check, url: "https://acme.test/not-read" },
      { ...check, checks: [{ ...check.checks[0]!, ruleId: "invented-rule" }, ...check.checks.slice(1)] },
      { ...check, checks: check.checks.map((row) => ({ ...row, state: ["pass"] })) },
      { ...check, renderStatus: "unavailable", renderReason: null },
    ]) expect(parseVisibilitySiteEvidence({ ...evidence, citability: [changed] }, report)).toBeNull();
    const page = evidence.index.pages[0]!;
    expect(parseVisibilitySiteEvidence({ ...evidence, index: { ...evidence.index, pages: [{ ...page, matches: [{ questionId: "q1", entities: ["made up"], terms: [] }] }] } }, report)).toBeNull();
  });

  it("refuses tampered gaps, unknown keys, and oversized evidence without silently slicing", async () => {
    const { report, evidence } = await fixture();
    const attached = { ...report, siteEvidence: evidence, gaps: classifyVisibilityGaps(report, evidence) };
    expect(parseVisibilityReportV2({ ...attached, gaps: [] })).toBeNull();
    expect(parseVisibilitySiteEvidence({ ...evidence, trusted: true }, report)).toBeNull();
    const large = { ...evidence, references: Array.from({ length: 13 }, () => evidence.references[0]!) };
    expect(parseVisibilitySiteEvidence(large, report)).toBeNull();
    expect(parseVisibilitySiteEvidence({ ...evidence, index: { ...evidence.index, limits: ["x".repeat(128 * 1024)] } } as VisibilitySiteEvidenceV1, report)).toBeNull();
  });

  it("preserves explicit byte-budget omission counts without claiming retained matching evidence", async () => {
    const { report, evidence } = await fixture();
    const trimmed: VisibilitySiteEvidenceV1 = {
      ...evidence,
      index: { ...evidence.index, status: "partial", limits: ["evidence_byte_limit", "incomplete_inventory"], pages: evidence.index.pages.map((page) => ({ ...page, headings: [], matches: [], ownPresenceExcerpt: null })) },
      references: [], referenceOmittedCount: evidence.referenceOmittedCount + evidence.references.length,
      citability: [], citabilityOmittedCount: evidence.citabilityOmittedCount + evidence.citability.length,
    };
    expect(parseVisibilitySiteEvidence(trimmed, report) !== null).toBe(true);
    expect(classifyVisibilityGaps(report, trimmed)[0]).toMatchObject({ kind: "unattributed", reason: "inventory_incomplete" });
    expect(parseVisibilitySiteEvidence({ ...trimmed, citabilityOmittedCount: 9999 }, report)).toBeNull();
    expect(parseVisibilitySiteEvidence({ ...trimmed, index: { ...trimmed.index, limits: ["incomplete_inventory"] } }, report)).toBeNull();
  });
});
