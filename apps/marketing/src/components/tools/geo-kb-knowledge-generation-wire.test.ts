import { describe, expect, it } from "vitest";

import { collectGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceReadResource } from "../../lib/geo-tools/kb-knowledge-evidence.ts";
import { buildGeoKnowledgeSynthesisInputV1 } from "../../lib/geo-tools/kb-knowledge-synthesis-contract.ts";
import { buildGeoKnowledgeGenerationResultV1 } from "../../lib/geo-tools/kb-knowledge-generation-contract.ts";
import { buildGeoKnowledgeGenerationInputManifest } from "../../lib/geo-tools/kb-prepared-contract.ts";
import { geoGenerationInputHash, type GeoGenerationValue } from "../../lib/geo-tools/kb-generation.ts";
import { parseGeoKbGenerationWire } from "./geo-kb-v2-wire.ts";

const USER_RESULT_ID = "33333333-3333-4333-8333-333333333333";
const KB_ID = "22222222-2222-4222-8222-222222222222";
const RECEIPT_A = { receiptId: "11111111-1111-4111-8111-111111111111", contentHash: "a".repeat(64) };
const RECEIPT_B = { receiptId: "22222222-2222-4222-8222-222222222222", contentHash: "b".repeat(64) };
const ATTEMPT = { attemptedCalls: 1 as const, delivery: "response_received" as const, modelRequested: "fixture-model", inputTokens: 10, outputTokens: 20, requestCount: 1 };

async function fixture(excerpt = "Pine Cloud is project software for teams.") {
  const observedAt = "2026-09-04T07:11:15.461Z";
  const readResource: GeoKnowledgeEvidenceReadResource = async ({ url }) => {
    if (url === "https://product.example/") return { kind: "ok", url, contentType: "text/html", observedAt, body: `<html><body><h1>Pine Cloud</h1><p>${excerpt}</p></body></html>` };
    if (url.endsWith("/robots.txt")) return { kind: "ok", url, contentType: "text/plain", observedAt, body: "User-agent: *\nAllow: /" };
    if (url.endsWith("/sitemap.xml")) return { kind: "ok", url, contentType: "application/xml", observedAt, body: "<urlset><url><loc>https://product.example/</loc></url></urlset>" };
    return { kind: "unavailable", url, reason: "not_found" };
  };
  const evidence = await collectGeoKnowledgeEvidenceV1({ targetUrl: "https://product.example/", competitors: [] }, { readResource, now: () => new Date("2026-09-04T07:12:00.000Z") });
  const synthesisInput = buildGeoKnowledgeSynthesisInputV1({ officialName: "Pine Cloud", aliases: ["Pine"], categoryTerms: ["Project software"], market: "US", language: "en-US" }, evidence);
  const sourceRef = synthesisInput.sourceCatalogue.find(source => source.kind === "own_page")!.id;
  const manifest = buildGeoKnowledgeGenerationInputManifest({ kbId: KB_ID, baseDraftVersion: "2", baseDraftHash: "c".repeat(64), profileCopyHash: "d".repeat(64),
    sourceReceiptRefs: [RECEIPT_A, RECEIPT_B], knowledgeSynthesisInput: synthesisInput });
  const result = buildGeoKnowledgeGenerationResultV1({ schemaVersion: "marketing-geo-knowledge-generation-result.v1", generationId: USER_RESULT_ID, kbId: KB_ID,
    manifest, evidence, synthesisInput, narrative: { schemaVersion: "marketing-geo-knowledge-narrative.v1",
      entity: { definitions: { w25: "Pine Cloud is project software.", w55: "Pine Cloud is project software for teams.", w120: "Pine Cloud is project software that supports team workflows." },
        audience: { who: "Teams", notFor: null }, founded: { year: null, team: null, location: null }, disambiguation: null, sourceRefs: [sourceRef] },
      facts: [], qa: [], comparisons: [], scope: { does: [{ id: "scope:workflow", text: "Supports team workflows.", sourceRefs: [sourceRef] }], doesNot: [], needsHuman: [], misconceptions: [] } },
    generatedAt: "2026-09-04T07:13:00.000Z" });
  const generation = { generationId: USER_RESULT_ID, kbId: KB_ID, kind: "knowledge_pack" as const,
    inputHash: geoGenerationInputHash("knowledge_pack", manifest as unknown as Readonly<Record<string, GeoGenerationValue>>),
    state: "succeeded" as const, result, errorReason: null, attempt: ATTEMPT };
  return { generation };
}

describe("browser knowledge generation receipt manifest", () => {
  it("retains the exact canonical source receipt references", async () => {
    const { generation } = await fixture();
    expect(parseGeoKbGenerationWire(generation)).toEqual(generation);
    expect(generation.result.manifest.sourceReceiptRefs).toEqual([RECEIPT_A, RECEIPT_B]);
  });

  it("accepts a server-valid knowledge result whose excerpt limit is measured in Unicode code points", async () => {
    const { generation } = await fixture(`Pine Cloud is project software. ${"😀".repeat(700)}`);
    expect(parseGeoKbGenerationWire(generation)).toEqual(generation);
  });

  it.each(["missing", "duplicate", "unsorted", "bad_hash"] as const)("rejects a %s source receipt manifest", async kind => {
    const { generation } = await fixture(), value = structuredClone(generation);
    if (kind === "missing") Reflect.deleteProperty(value.result.manifest, "sourceReceiptRefs");
    if (kind === "duplicate") Object.assign(value.result.manifest, { sourceReceiptRefs: [RECEIPT_A, RECEIPT_A] });
    if (kind === "unsorted") Object.assign(value.result.manifest, { sourceReceiptRefs: [RECEIPT_B, RECEIPT_A] });
    if (kind === "bad_hash") Object.assign(value.result.manifest, { sourceReceiptRefs: [{ ...RECEIPT_A, contentHash: "not-a-hash" }] });
    expect(parseGeoKbGenerationWire(value)).toBeNull();
  });
});
