import { describe, expect, it } from "vitest";

import {
  GEO_GENERATION_INPUT_BYTES,
  geoGenerationInputHash,
  type GeoGenerationValue,
} from "./kb-generation.ts";
import {
  buildGeoKnowledgeGenerationResultV1,
  GEO_KNOWLEDGE_GENERATION_RESULT_MAX_BYTES,
  GEO_KNOWLEDGE_GENERATION_RESULT_SCHEMA,
  geoKnowledgeGenerationResultHash,
  parseGeoKnowledgeGenerationResultV1,
} from "./kb-knowledge-generation-contract.ts";
import {
  buildGeoKnowledgeEvidenceV1,
  type GeoKnowledgeEvidenceV1,
} from "./kb-knowledge-evidence.ts";
import {
  buildGeoKnowledgeSynthesisInputV1,
  geoKnowledgeSynthesisInputDigest,
  type GeoKnowledgeSynthesisInputV1,
} from "./kb-knowledge-synthesis-contract.ts";
import {
  buildGeoKnowledgeGenerationInputManifest,
  geoKnowledgeGenerationInputHash,
} from "./kb-prepared-contract.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";

const KB_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const OBSERVED_AT = "2026-09-04T07:11:15.461Z";
const GENERATED_AT = "2026-09-04T07:12:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function evidence(targetUrl = "https://product.example/") {
  const target = new URL(targetUrl);
  const base = target.toString();
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1",
    collectedAt: OBSERVED_AT,
    targetUrl: base,
    confirmedCompetitors: [],
    availability: "partial",
    limitation: "llms.txt was not published.",
    pages: [],
    machine: {
      jsonLd: { status: "absent", types: [], sourceRefs: ["source:own"] },
      llms: { status: "absent", sourceRefs: ["source:llms"] },
      robots: { status: "present", sourceRefs: ["source:robots"] },
      sitemap: {
        status: "present",
        sourceRefs: ["source:sitemap"],
        urlCount: 0,
        knowledgePagesListed: false,
        locations: [],
        truncated: false,
      },
      hreflang: { status: "absent", locales: [], sourceRefs: ["source:own"] },
    },
    sourceCatalogue: [
      {
        id: "source:own",
        kind: "own_page",
        label: "Product page",
        url: base,
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: OBSERVED_AT,
        bodyHash: HASH_A,
        excerpts: [
          "Pine Cloud is project software for teams of 2. It requires human approval.",
        ],
      },
      {
        id: "source:robots",
        kind: "robots",
        label: "robots.txt",
        url: new URL("/robots.txt", target).toString(),
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: OBSERVED_AT,
        bodyHash: HASH_A,
        excerpts: ["User-agent: *"],
      },
      {
        id: "source:sitemap",
        kind: "sitemap",
        label: "sitemap.xml",
        url: new URL("/sitemap.xml", target).toString(),
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: OBSERVED_AT,
        bodyHash: HASH_A,
        excerpts: [base],
      },
      {
        id: "source:llms",
        kind: "llms",
        label: "llms.txt",
        url: new URL("/llms.txt", target).toString(),
        competitor: null,
        availability: "unavailable",
        reason: "not_found",
        observedAt: null,
        bodyHash: null,
        excerpts: [],
      },
    ],
  });
}

function synthesis(rawEvidence: GeoKnowledgeEvidenceV1 = evidence()) {
  return buildGeoKnowledgeSynthesisInputV1(
    {
      officialName: "Pine Cloud",
      aliases: ["Pine"],
      categoryTerms: ["Project software"],
      market: "US",
      language: "en-US",
    },
    rawEvidence,
  );
}

function narrative() {
  return {
    schemaVersion: "marketing-geo-knowledge-narrative.v1" as const,
    entity: {
      definitions: {
        w25: "Pine Cloud is project software for teams of 2.",
        w55: "Pine Cloud is project software for teams of 2 with human approval.",
        w120:
          "Pine Cloud is project software for teams of 2. Each workflow requires human approval.",
      },
      audience: { who: "Teams of 2", notFor: null },
      founded: { year: null, team: null, location: null },
      disambiguation: null,
      sourceRefs: ["source:own"],
    },
    facts: [
      {
        id: "fact:teams",
        type: "feature" as const,
        statement: "Pine Cloud supports teams of 2.",
        sourceRefs: ["source:own"],
      },
    ],
    qa: [
      {
        id: "qa:teams",
        intent: "applicability" as const,
        question: "Does Pine Cloud support teams of 2?",
        variants: [],
        directAnswer: "Yes. Pine Cloud supports teams of 2.",
        expansion: null,
        sourceRefs: ["source:own"],
      },
    ],
    comparisons: [],
    scope: {
      does: [
        {
          id: "scope:does",
          text: "Supports teams of 2.",
          sourceRefs: ["source:own"],
        },
      ],
      doesNot: [],
      needsHuman: [
        {
          id: "scope:human",
          text: "Requires human approval.",
          sourceRefs: ["source:own"],
        },
      ],
      misconceptions: [],
    },
  };
}

function manifest(
  knowledgeSynthesisInput: GeoKnowledgeSynthesisInputV1 = synthesis(),
) {
  return buildGeoKnowledgeGenerationInputManifest({
    kbId: KB_ID,
    baseDraftVersion: "2",
    baseDraftHash: HASH_A,
    profileCopyHash: HASH_B,
    sourceReceiptRefs: [{
      receiptId: "44444444-4444-4444-8444-444444444444",
      contentHash: "c".repeat(64),
    }],
    knowledgeSynthesisInput,
  });
}

function body() {
  const knowledgeSynthesisInput = synthesis();
  return {
    schemaVersion: GEO_KNOWLEDGE_GENERATION_RESULT_SCHEMA,
    generationId: GENERATION_ID,
    kbId: KB_ID,
    manifest: manifest(knowledgeSynthesisInput),
    evidence: evidence(),
    synthesisInput: knowledgeSynthesisInput,
    narrative: narrative(),
    generatedAt: GENERATED_AT,
  };
}

function rehash(value: any) {
  const { contentHash: _contentHash, ...resultBody } = value;
  return {
    ...resultBody,
    contentHash: geoKnowledgeGenerationResultHash(resultBody),
  };
}

function withEvidenceHash(
  value: GeoKnowledgeSynthesisInputV1,
  evidenceContentHash: string,
) {
  const { contentHash: _contentHash, ...inputBody } = value;
  const changed = { ...inputBody, evidenceContentHash };
  return {
    ...changed,
    contentHash: geoKnowledgeSynthesisInputDigest(changed),
  };
}

function evidenceWithAcceptedFact() {
  const original = evidence();
  const { contentHash: _contentHash, ...evidenceBody } = original;
  return buildGeoKnowledgeEvidenceV1({
    ...evidenceBody,
    sourceCatalogue: [
      ...evidenceBody.sourceCatalogue,
      {
        id: "source:accepted",
        kind: "accepted_fact",
        label: "Accepted fact",
        url: null,
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: null,
        bodyHash: null,
        excerpts: ["Pine Cloud requires human approval."],
      },
    ],
  });
}

describe("durable GEO knowledge generation result", () => {
  it("round-trips a strict, independently verifiable result", () => {
    const result = buildGeoKnowledgeGenerationResultV1(body());
    expect(result).toEqual({
      ...body(),
      contentHash: geoKnowledgeGenerationResultHash(body()),
    });
    expect(parseGeoKnowledgeGenerationResultV1(
      JSON.parse(JSON.stringify(result)),
    )).toEqual(result);
    expect(geoV2JsonbBytes(result)).toBeLessThanOrEqual(
      GEO_KNOWLEDGE_GENERATION_RESULT_MAX_BYTES,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /apiKey|authorization|providerResponse|rawResponse/iu,
    );
  });

  it("uses the exact same durable input hash domain as prepared-candidate Task 5", () => {
    const input = manifest();
    const durable = JSON.parse(canonicalGeoV2Text(input)) as Readonly<
      Record<string, GeoGenerationValue>
    >;
    expect(geoV2JsonbBytes(durable)).toBeLessThanOrEqual(
      GEO_GENERATION_INPUT_BYTES,
    );
    expect(geoGenerationInputHash("knowledge_pack", durable)).toBe(
      geoKnowledgeGenerationInputHash(input),
    );
  });

  it("requires the manifest and synthesis input to be byte-exact", () => {
    const result: any = buildGeoKnowledgeGenerationResultV1(body());
    const current = result.manifest.knowledgeSynthesisInput;
    const { contentHash: _contentHash, ...inputBody } = current;
    const changedBody = { ...inputBody, market: "CA" };
    result.manifest.knowledgeSynthesisInput = {
      ...changedBody,
      contentHash: geoKnowledgeSynthesisInputDigest(changedBody),
    };
    expect(() => parseGeoKnowledgeGenerationResultV1(rehash(result))).toThrow(
      /manifest|synthesis/i,
    );
  });

  it("makes the exact sorted source receipt refs part of the durable result identity", () => {
    const result = buildGeoKnowledgeGenerationResultV1(body());
    expect(result.manifest.sourceReceiptRefs).toEqual([{
      receiptId: "44444444-4444-4444-8444-444444444444",
      contentHash: "c".repeat(64),
    }]);

    const changed: any = structuredClone(result);
    changed.manifest.sourceReceiptRefs = [{
      receiptId: "55555555-5555-4555-8555-555555555555",
      contentHash: "d".repeat(64),
    }];
    const rebound = parseGeoKnowledgeGenerationResultV1(rehash(changed));
    expect(rebound.manifest.sourceReceiptRefs).toEqual(changed.manifest.sourceReceiptRefs);
    expect(rebound.contentHash).not.toBe(result.contentHash);
  });

  it("binds the evidence hash and target to the exact synthesis input", () => {
    const differentTarget = evidence("https://other.example/");
    const targetResult: any = buildGeoKnowledgeGenerationResultV1(body());
    targetResult.evidence = differentTarget;
    targetResult.synthesisInput = withEvidenceHash(
      targetResult.synthesisInput,
      differentTarget.contentHash,
    );
    targetResult.manifest.knowledgeSynthesisInput = targetResult.synthesisInput;
    expect(() => parseGeoKnowledgeGenerationResultV1(
      rehash(targetResult),
    )).toThrow(/target|evidence/i);

    const wrongHash: any = buildGeoKnowledgeGenerationResultV1(body());
    wrongHash.synthesisInput = withEvidenceHash(
      wrongHash.synthesisInput,
      "c".repeat(64),
    );
    wrongHash.manifest.knowledgeSynthesisInput = wrongHash.synthesisInput;
    expect(() => parseGeoKnowledgeGenerationResultV1(
      rehash(wrongHash),
    )).toThrow(/evidence|hash/i);
  });

  it("binds the exact usable evidence source projection", () => {
    const changedEvidence = evidenceWithAcceptedFact();
    const result: any = buildGeoKnowledgeGenerationResultV1(body());
    result.evidence = changedEvidence;
    result.synthesisInput = withEvidenceHash(
      result.synthesisInput,
      changedEvidence.contentHash,
    );
    result.manifest.knowledgeSynthesisInput = result.synthesisInput;
    expect(() => parseGeoKnowledgeGenerationResultV1(rehash(result))).toThrow(
      /source|evidence/i,
    );
  });

  it("revalidates the narrative against its exact synthesis evidence", () => {
    const result: any = buildGeoKnowledgeGenerationResultV1(body());
    result.narrative.facts[0].statement =
      "Pine Cloud supports teams of 99.";
    expect(() => parseGeoKnowledgeGenerationResultV1(rehash(result))).toThrow(
      /numeric|narrative|schema/i,
    );
  });

  it("requires canonical chronology and matching generation/kb scope", () => {
    for (const mutate of [
      (value: any) => { value.generatedAt = "2026-09-04T07:10:00.000Z"; },
      (value: any) => { value.generatedAt = "2026-09-04 07:12:00Z"; },
      (value: any) => { value.kbId = GENERATION_ID; },
      (value: any) => { value.generationId = "not-a-uuid"; },
    ]) {
      const result: any = buildGeoKnowledgeGenerationResultV1(body());
      mutate(result);
      expect(() => parseGeoKnowledgeGenerationResultV1(rehash(result))).toThrow();
    }
  });

  it("rejects altered hashes, unknown fields, and raw provider material", () => {
    const valid = buildGeoKnowledgeGenerationResultV1(body());
    expect(() => parseGeoKnowledgeGenerationResultV1({
      ...valid,
      contentHash: HASH_A,
    })).toThrow(/hash/i);
    for (const extra of [
      { apiKey: "secret" },
      { providerResponse: { body: "raw" } },
      { payload: { mutable: true } },
    ]) {
      expect(() => parseGeoKnowledgeGenerationResultV1(
        rehash({ ...valid, ...extra }),
      )).toThrow();
    }
  });
});
