import { describe, expect, it } from "vitest";

import { buildGeoKnowledgePackV1 } from "../../lib/geo-tools/kb-knowledge-pack-contract.ts";
import { createGeoPreparedCandidate } from "../../lib/geo-tools/kb-prepared-contract.ts";
import { buildGeoSnapshotContextV2 } from "../../lib/geo-tools/snapshot-context-v2.ts";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
import { buildGeoKnowledgePackV2 } from "../../lib/geo-tools/kb-knowledge-pack-v2-contract.ts";
import { geoItemKey } from "../../lib/geo-tools/kb-item-key.ts";
import { parseGeoKbEditorViewV2, parseGeoKbFrozenKnowledgeWire, parseGeoKbFrozenV2Wire, parseGeoKnowledgePackWire } from "./geo-kb-v2-wire.ts";

const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-09-04T07:11:15.461Z";

function fixture(sourceExcerpt?: string) {
  const payload = completePayloadV2(), questionSet = questionSetV2();
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet,
    sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
  const prepared = createGeoPreparedCandidate({ schemaVersion: "marketing-geo-prepared-candidate.v1", candidateId: V2_CANDIDATE_ID,
    kbId: V2_KB_ID, baseDraftVersion: "1", baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), sourceReceiptRefs: [], generatorVersion: questionSet.methodVersion, payload, questionSet, context });
  const source = { id: "source:home", kind: "own_page" as const, label: "Product page", url: "https://example.com/", competitor: null,
    availability: "available" as const, reason: null, observedAt: AT, bodyHash: "a".repeat(64), excerpts: [sourceExcerpt ?? `${payload.officialName} is ${payload.categoryTerms[0]}.`] };
  const knowledgePack = buildGeoKnowledgePackV1({ schemaVersion: "marketing-geo-knowledge-pack.v1", meta: { generatedAt: AT, lastScanAt: AT,
    market: payload.market.country, language: payload.market.language, counts: { facts: 0, qa: 0, comparisons: 0 } },
    entity: { status: "available", value: { name: payload.officialName, aliases: payload.aliases,
      categories: { primary: payload.categoryTerms[0]!, secondary: payload.categoryTerms.slice(1) },
      definitions: { w25: `${payload.officialName} is ${payload.categoryTerms[0]}.`, w55: `${payload.officialName} is ${payload.categoryTerms[0]}.`, w120: `${payload.officialName} is ${payload.categoryTerms[0]}.` },
      audience: { who: "Teams evaluating analytics software.", notFor: null }, founded: { year: null, team: null, location: null },
      disambiguation: null, links: { home: "https://example.com/", pricing: null, docs: null, about: null, changelog: null, faq: null }, sameAs: [], sourceRefs: [source.id] } },
    facts: { status: "unavailable", reason: "insufficient_evidence" }, qa: { status: "unavailable", reason: "insufficient_evidence" },
    comparisons: { status: "unavailable", reason: "insufficient_evidence" }, scope: { status: "unavailable", reason: "insufficient_evidence" },
    evidence: { status: "unavailable", reason: "insufficient_evidence" }, machine: { status: "unavailable", reason: "not_collected" },
    coverage: { status: "unavailable", reason: "not_collected" }, sourceCatalogue: [source] });
  const frozen = { wireSchemaVersion: "marketing-geo-kb-frozen-wire.v1" as const, kbId: V2_KB_ID, snapshotId: SNAPSHOT_ID, revision: 2,
    frozenAt: AT, contentHash: prepared.baseDraftHash, questionSetHash: context.questionSetHash, questionCount: questionSet.questions.length,
    payload, questionSet, context, knowledgePack };
  const editor = { schemaVersion: "marketing-geo-kb-editor.v2" as const, kbId: V2_KB_ID, origin: "https://example.com", host: "example.com",
    draftVersion: 1, draftHash: prepared.baseDraftHash, profileCopyHash: prepared.profileCopyHash, payload, requiresSave: false,
    profile: { ...context.profile, fullProfile: payload.profileCopy.profile }, frozen, sourceReceipt: null, prepared,
    generations: { roles: null, questions: null } };
  return { frozen, editor };
}

describe("customer knowledge frozen wire", () => {
  it("uses an additive discriminator and keeps the previous strict frozen parser unchanged", () => {
    const { frozen } = fixture();
    const { wireSchemaVersion: _wire, knowledgePack: _pack, ...frozenV2 } = frozen;
    expect(parseGeoKbFrozenKnowledgeWire(frozen)).toEqual(frozen);
    expect(parseGeoKbFrozenV2Wire(frozen)).toBeNull();
    expect(parseGeoKbFrozenV2Wire(frozenV2)).toEqual(frozenV2);
  });

  it("keeps a strict null companion for historical v1 prepared candidates", () => {
    const { frozen } = fixture();
    expect(parseGeoKbFrozenKnowledgeWire({ ...frozen, knowledgePack: null })?.knowledgePack).toBeNull();
  });

  it("rejects a malformed pack, a payload identity mismatch, and unknown wire fields", () => {
    const { frozen } = fixture();
    expect(parseGeoKbFrozenKnowledgeWire({ ...frozen, knowledgePack: { ...frozen.knowledgePack, contentHash: "not-a-hash" } })).toBeNull();
    const entity = frozen.knowledgePack.entity;
    if (entity.status === "unavailable") throw new Error("fixture requires entity");
    expect(parseGeoKbFrozenKnowledgeWire({ ...frozen, knowledgePack: { ...frozen.knowledgePack, entity: { ...entity, value: { ...entity.value, name: "Other product" } } } })).toBeNull();
    expect(parseGeoKbFrozenKnowledgeWire({ ...frozen, userId: "must-not-cross-wire" })).toBeNull();
  });

  it("retains the pack through the complete editor DTO", () => {
    const { editor } = fixture();
    expect(parseGeoKbEditorViewV2(editor)?.frozen).toEqual(editor.frozen);
  });

  it("accepts server-valid astral text through both frozen and complete-editor wire boundaries", () => {
    const excerpt = `Acme is analytics software. ${"😀".repeat(700)}`;
    const { frozen, editor } = fixture(excerpt);
    expect(parseGeoKbFrozenKnowledgeWire(frozen)).toEqual(frozen);
    expect(parseGeoKbEditorViewV2(editor)?.frozen).toEqual(editor.frozen);
  });

  it.each(["bad\u0001control", "bad\ud800surrogate"])("rejects unsafe customer text %j", (excerpt) => {
    const { frozen } = fixture();
    const value = structuredClone(frozen);
    value.knowledgePack.sourceCatalogue[0]!.excerpts = [excerpt];
    expect(parseGeoKbFrozenKnowledgeWire(value)).toBeNull();
  });
});

/**
 * A published pack v2, built through the server contract so the browser schema
 * is checked against what actually gets stored rather than against a second
 * hand-written copy of it.
 */
function packV2() {
  const source = { id: "own:pricing", kind: "own_page" as const, label: "Pricing", url: "https://example.com/pricing", competitor: null,
    availability: "available" as const, reason: null, observedAt: AT, bodyHash: "a".repeat(64),
    excerpts: ["The Pro plan costs 9 per month."], independence: null };
  const unavailable = { status: "unavailable" as const, reason: "insufficient_evidence" as const };
  return buildGeoKnowledgePackV2({
    schemaVersion: "marketing-geo-knowledge-pack.v2",
    meta: { generatedAt: AT, lastScanAt: AT, market: "US", language: "en", counts: { facts: 1, qa: 0, comparisons: 0, accepted: 1, acceptedInBulk: 0 } },
    entity: unavailable,
    facts: { status: "available", value: [{
      id: "fact:pro", type: "price", statement: "The Pro plan costs 9 per month.",
      label: "Pro plan monthly price", value: "9", reason: "", subject: "Pro plan", attribute: "monthly price",
      qualifiers: ["usd", "monthly"], observedAt: AT, nextReviewAt: null,
      itemKey: geoItemKey({ module: "facts", type: "price", subject: "Pro plan", attribute: "monthly price", qualifiers: ["usd", "monthly"] }),
      origin: "observed_own", decision: "accepted", sourceRefs: [source.id], priorSourceRefs: [],
      ownerDeclaredAt: null, evidenceChecks: "cited_and_literals_match",
    }] },
    qa: unavailable, comparisons: unavailable, scope: unavailable, evidence: unavailable,
    machine: { status: "unavailable", reason: "not_collected" }, coverage: { status: "unavailable", reason: "not_collected" },
    sourceCatalogue: [source],
  });
}

describe("customer knowledge pack v2 on the browser boundary", () => {
  it("renders a published pack v2, including the fields that say who decided what", () => {
    const pack = packV2();

    const parsed = parseGeoKnowledgePackWire(pack);

    expect(parsed).toEqual(pack);
    if (parsed === null || parsed.schemaVersion !== "marketing-geo-knowledge-pack.v2") throw new Error("Expected a pack v2");
    if (parsed.facts.status !== "available") throw new Error("Expected published facts");
    expect(parsed.facts.value[0]).toMatchObject({ origin: "observed_own", decision: "accepted", label: "Pro plan monthly price", value: "9" });
    expect(parsed.meta.counts).toMatchObject({ accepted: 1, acceptedInBulk: 0 });
  });

  it("keeps rendering a v1 pack and refuses a pack that lies about its own version", () => {
    const { frozen } = fixture();
    expect(parseGeoKnowledgePackWire(frozen.knowledgePack)).toEqual(frozen.knowledgePack);
    // The same bytes under the v1 discriminator must not be accepted: the two
    // packs differ by exactly the provenance the reader is shown.
    expect(parseGeoKnowledgePackWire({ ...packV2(), schemaVersion: "marketing-geo-knowledge-pack.v1" })).toBeNull();
  });

  it("treats a stored pack it cannot render as an inconsistency, never as an absent pack", () => {
    const { frozen } = fixture();
    const damaged = { ...frozen.knowledgePack, sourceCatalogue: [] };

    expect(parseGeoKbFrozenKnowledgeWire({ ...frozen, knowledgePack: damaged })).toBeNull();
  });
});
