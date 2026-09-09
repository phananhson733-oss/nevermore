import { describe, expect, it } from "vitest";

import {
  buildGeoKnowledgePackV2,
  type GeoKnowledgePackV2,
} from "./kb-knowledge-pack-v2-contract.ts";
import { geoItemKey } from "./kb-item-key.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import {
  GEO_PREPARED_CANDIDATE_V3_SCHEMA,
  createGeoPreparedCandidateV3,
  geoKnowledgePackV2ItemKeys,
  isGeoPreparedCandidateV3,
  parseGeoPreparedCandidateV3,
} from "./kb-prepared-v3-contract.ts";
import {
  buildGeoSnapshotContextV3,
  type GeoContextEvidenceRefV3,
} from "./snapshot-context-v3.ts";

const KB_ID = "1f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59";
const CANDIDATE_ID = "6f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59";
const OBSERVED_AT = "2026-09-04T03:10:00.000Z";
const GENERATED_AT = "2026-09-04T03:20:00.000Z";
const BODY_HASH = "d".repeat(64);

const FACT_KEY = geoItemKey({
  module: "facts",
  type: "feature",
  subject: "birth chart calculator",
  attribute: "signup requirement",
  qualifiers: [],
});
const FOREIGN_KEY = geoItemKey({
  module: "qa",
  intent: "price",
  canonicalQuestion: "how much does it cost",
});

const source = {
  id: "own-home",
  kind: "own_page",
  label: "Home",
  url: "https://astrologywiki.example/",
  competitor: null,
  availability: "available",
  reason: null,
  observedAt: OBSERVED_AT,
  bodyHash: BODY_HASH,
  excerpts: ["Free birth chart calculator, no signup required."],
  independence: null,
} as const;

const factContent = {
  id: "fact-free-chart",
  type: "feature",
  statement: "Free birth chart calculator, no signup required.",
  label: "Signup required",
  value: "no",
  reason: "",
  subject: "birth chart calculator",
  attribute: "signup requirement",
  qualifiers: [],
  observedAt: OBSERVED_AT,
  nextReviewAt: null,
} as const;

const draftFact = {
  ...factContent,
  itemKey: FACT_KEY,
  origin: "observed_own",
  sourceRefs: ["own-home"],
  evidenceChecks: "cited_and_literals_match",
  alternateObservations: [],
} as const;

const profileRef = {
  websiteId: "2f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
  snapshotId: "3f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
  snapshotRevision: "3",
  profileHash: "b".repeat(64),
  subsetHash: "c".repeat(64),
  subset: {
    productName: "AstrologyWiki",
    oneLinePositioning: "Free birth chart calculator",
    coreFeatures: ["birth chart"],
    country: "US",
    locale: "en-US",
    categories: ["astrology"],
    buyer: "curious readers",
    primaryIcp: "hobbyists",
    triggerPain: "charts are confusing",
    icpPain: "no free calculator",
    qualificationSignals: ["opens pricing"],
    icpInterests: ["astrology"],
    directCompetitors: ["astro.example"],
    fieldProvenance: [
      {
        path: "/productName",
        derivation: "declared",
        observedAt: null,
        evidenceUrl: null,
      },
    ],
  },
} as const;

const role = {
  id: "role-hobbyist",
  label: "Hobbyist reader",
  questionLabel: "hobbyist",
  segment: "consumer",
  painPoints: ["charts are confusing"],
  decisionCriteria: [],
  vocabulary: ["natal chart"],
  alternatives: [],
  review: "accepted",
  source: {
    kind: "profile",
    generationId: null,
    itemId: null,
    evidenceRefs: ["ev-profile-1"],
  },
} as const;

const generationInput = {
  identity: {
    targetUrl: "https://astrologywiki.example/",
    officialName: "AstrologyWiki",
    aliases: ["Astrology Wiki"],
    categoryTerms: ["astrology reference"],
    market: { country: "US", language: "en" },
  },
  profileRef,
  competitors: [
    { domain: "astro.example", brandName: "Astro", confirmed: true },
  ],
  roles: [role],
  evidenceContentHash: "e".repeat(64),
} as const;

const GENERATION_INPUT_HASH = geoV2Digest(generationInput);

const knowledgeBody = {
  entity: { status: "unavailable", reason: "not_collected" },
  facts: { status: "available", value: [draftFact] },
  qa: { status: "unavailable", reason: "generation_unavailable" },
  comparisons: { status: "unavailable", reason: "not_collected" },
  scope: { status: "unavailable", reason: "generation_unavailable" },
  evidence: { status: "unavailable", reason: "not_collected" },
  machine: { status: "unavailable", reason: "not_collected" },
  coverage: { status: "unavailable", reason: "not_collected" },
  sourceCatalogue: [source],
  collectedAt: OBSERVED_AT,
  generatedAt: GENERATED_AT,
} as const;

function payloadWith(overrides: Record<string, unknown> = {}): GeoKbPayloadV3 {
  return parseGeoKbPayloadV3({
    schemaVersion: "marketing-geo-kb.v3",
    generationInput,
    knowledge: knowledgeBody,
    review: { decisions: [], suppressions: [] },
    runRef: {
      runId: null,
      generationInputHash: GENERATION_INPUT_HASH,
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    },
    ...overrides,
  });
}

const questionSet = {
  schemaVersion: "marketing-geo-question-set.v2",
  registryVersion: "none",
  methodVersion: "geo-kb-questions.v2",
  language: "en",
  country: "US",
  evidenceRefs: ["ev-1"],
  entityCatalog: [
    {
      id: "ent-brand",
      text: "AstrologyWiki",
      kind: "brand",
      roleId: null,
      evidenceRefs: ["ev-1"],
    },
  ],
  questions: [
    {
      id: "q-1",
      text: "What is AstrologyWiki?",
      layer: "branded",
      mode: "demand",
      roleId: null,
      requiredEntities: ["AstrologyWiki"],
      templateId: null,
      calibrated: false,
      provenance: {
        kind: "semantic",
        generatorVersion: "geo-kb-questions.v2",
        evidenceRefs: ["ev-1"],
        entityRefs: ["ent-brand"],
      },
    },
  ],
} as const;

function packWith(itemKey: string = FACT_KEY): GeoKnowledgePackV2 {
  return buildGeoKnowledgePackV2({
    schemaVersion: "marketing-geo-knowledge-pack.v2",
    meta: {
      generatedAt: GENERATED_AT,
      lastScanAt: OBSERVED_AT,
      market: "US",
      language: "en",
      counts: {
        facts: 1,
        qa: 0,
        comparisons: 0,
        accepted: 0,
        acceptedInBulk: 1,
      },
    },
    entity: { status: "unavailable", reason: "not_collected" },
    facts: {
      status: "available",
      value: [
        {
          ...factContent,
          itemKey,
          origin: "observed_own",
          decision: "accepted_in_bulk",
          sourceRefs: ["own-home"],
          priorSourceRefs: [],
          ownerDeclaredAt: null,
          evidenceChecks: "cited_and_literals_match",
        },
      ],
    },
    qa: { status: "unavailable", reason: "generation_unavailable" },
    comparisons: { status: "unavailable", reason: "not_collected" },
    scope: { status: "unavailable", reason: "generation_unavailable" },
    evidence: { status: "unavailable", reason: "not_collected" },
    machine: { status: "unavailable", reason: "not_collected" },
    coverage: { status: "unavailable", reason: "not_collected" },
    sourceCatalogue: [source],
  });
}

const evidenceRefs: readonly GeoContextEvidenceRefV3[] = [
  { sourceId: "4f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59", contentHash: BODY_HASH },
];

const receiptRefs = [
  { receiptId: "7f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59", contentHash: BODY_HASH },
  { receiptId: "8f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59", contentHash: BODY_HASH },
] as const;

type CandidateOverrides = Record<string, unknown>;

/** A body plus the hash it actually has, so a test fails on the rule it targets. */
function candidateWith(
  overrides: CandidateOverrides = {},
): Record<string, unknown> {
  const payload =
    (overrides.payload as GeoKbPayloadV3 | undefined) ?? payloadWith();
  const body = {
    schemaVersion: GEO_PREPARED_CANDIDATE_V3_SCHEMA,
    candidateId: CANDIDATE_ID,
    kbId: KB_ID,
    baseDraftVersion: "4",
    baseDraftHash: geoV2Digest(payload),
    payload,
    questionSet: { status: "available", value: questionSet },
    context: buildGeoSnapshotContextV3({
      kbId: KB_ID,
      payload,
      questionSet,
      evidenceRefs,
    }),
    knowledgePack: packWith(),
    generationInputHash: GENERATION_INPUT_HASH,
    reviewHash: geoV2Digest(payload.review),
    sourceReceiptRefs: receiptRefs,
    ...overrides,
  };
  return { ...body, candidateHash: geoV2Digest(body) };
}

describe("a complete v3 candidate", () => {
  it("parses, and reports the schema it is", () => {
    const candidate = parseGeoPreparedCandidateV3(candidateWith());
    expect(candidate.schemaVersion).toBe(GEO_PREPARED_CANDIDATE_V3_SCHEMA);
    expect(isGeoPreparedCandidateV3(candidate)).toBe(true);
    expect(candidate.questionSet.status).toBe("available");
    expect(candidate.knowledgePack).not.toBeNull();
    expect(geoKnowledgePackV2ItemKeys(candidate.knowledgePack!)).toEqual([
      FACT_KEY,
    ]);
  });

  it("is what createGeoPreparedCandidateV3 produces", () => {
    const { candidateHash: _ignored, ...body } = candidateWith();
    const created = createGeoPreparedCandidateV3(body as never);
    expect(created.candidateHash).toBe(geoV2Digest(body));
  });

  it("accepts identities whose UUID version nibble is not 1 to 5", () => {
    // Ids in this product are UUIDv8; `z.uuid()` or a `[1-5]` nibble would
    // reject every one of them.
    expect(
      parseGeoPreparedCandidateV3(
        candidateWith({ candidateId: "6f08f279-2b1e-0c4d-9a3f-0e1d2c3b4a59" }),
      ).candidateId,
    ).toBe("6f08f279-2b1e-0c4d-9a3f-0e1d2c3b4a59");
  });
});

describe("publishing with one half missing", () => {
  it("publishes knowledge without a question set", () => {
    const payload = payloadWith();
    const candidate = parseGeoPreparedCandidateV3(
      candidateWith({
        questionSet: {
          status: "unavailable",
          reason: "roles_missing",
          failedGenerationId: null,
        },
        context: buildGeoSnapshotContextV3({
          kbId: KB_ID,
          payload,
          questionSet: null,
          evidenceRefs,
        }),
      }),
    );
    expect(candidate.questionSet).toEqual({
      status: "unavailable",
      reason: "roles_missing",
      failedGenerationId: null,
    });
  });

  it("publishes a question set without a knowledge pack", () => {
    expect(
      parseGeoPreparedCandidateV3(candidateWith({ knowledgePack: null }))
        .knowledgePack,
    ).toBeNull();
  });

  it("refuses to publish a version with neither", () => {
    const payload = payloadWith();
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({
          knowledgePack: null,
          questionSet: {
            status: "unavailable",
            reason: "generation_unavailable",
            failedGenerationId: "9f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
          },
          context: buildGeoSnapshotContextV3({
            kbId: KB_ID,
            payload,
            questionSet: null,
            evidenceRefs,
          }),
        }),
      ),
    ).toThrow(/needs a question set or a knowledge pack/u);
  });

  it("requires the knowledge pack key to be present rather than absent", () => {
    const { knowledgePack: _dropped, ...rest } = candidateWith();
    const { candidateHash: _ignored, ...body } = rest;
    expect(() =>
      parseGeoPreparedCandidateV3({
        ...body,
        candidateHash: geoV2Digest(body),
      }),
    ).toThrow(/present or explicitly null/u);
  });
});

describe("the context is bound to what it describes", () => {
  it("rejects a context built from a different payload", () => {
    const other = payloadWith({
      knowledge: {
        ...knowledgeBody,
        facts: {
          status: "available",
          value: [{ ...draftFact, label: "Signup" }],
        },
      },
    });
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({
          context: buildGeoSnapshotContextV3({
            kbId: KB_ID,
            payload: other,
            questionSet,
            evidenceRefs,
          }),
        }),
      ),
    ).toThrow(/scope mismatch/u);
  });

  it("rejects a context belonging to a different knowledge base", () => {
    const payload = payloadWith();
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({
          context: buildGeoSnapshotContextV3({
            kbId: "5f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
            payload,
            questionSet,
            evidenceRefs,
          }),
        }),
      ),
    ).toThrow(/scope mismatch/u);
  });

  it("rejects a context whose roles or counts were edited after it was built", () => {
    const candidate = candidateWith();
    const context = candidate.context as Record<string, unknown>;
    const { contentHash: _ignored, ...rest } = context;
    const contextBody: Record<string, unknown> = {
      ...rest,
      sourceSummary: {
        own: "2",
        competitor: "0",
        thirdParty: "0",
        gsc: "0",
        profile: "0",
        model: "0",
      },
    };
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({
          context: { ...contextBody, contentHash: geoV2Digest(contextBody) },
        }),
      ),
    ).toThrow(/Prepared context differs/u);
  });

  it("rejects the sentinel hash when a question set is actually present", () => {
    const payload = payloadWith();
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({
          context: buildGeoSnapshotContextV3({
            kbId: KB_ID,
            payload,
            questionSet: null,
            evidenceRefs,
          }),
        }),
      ),
    ).toThrow(/question set hash mismatch/u);
  });

  it("rejects a real question-set hash when the question set is unavailable", () => {
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({
          questionSet: {
            status: "unavailable",
            reason: "not_attempted",
            failedGenerationId: null,
          },
        }),
      ),
    ).toThrow(/question set hash mismatch/u);
  });

  it("rejects a payload hash that is not the payload's", () => {
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({ baseDraftHash: "f".repeat(64) }),
      ),
    ).toThrow(/payload hash mismatch/u);
  });
});

describe("generation and review identity", () => {
  it("rejects a candidate hash that does not match the reused generations", () => {
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({ generationInputHash: "a".repeat(64) }),
      ),
    ).toThrow(/generation input hash mismatch/u);
  });

  it("rejects a draft whose runRef points at a different locked input", () => {
    // The candidate's own hash is correct here; the draft disagrees with it,
    // which is exactly the "the Profile was confirmed again" case.
    const payload = payloadWith({
      runRef: {
        runId: null,
        generationInputHash: "0".repeat(64),
        rolesGenerationId: null,
        knowledgeGenerationId: null,
        questionsGenerationId: null,
      },
    });
    expect(() =>
      parseGeoPreparedCandidateV3(candidateWith({ payload })),
    ).toThrow(/generation input hash mismatch/u);
  });

  it("rejects a review hash that is not the review's", () => {
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({ reviewHash: "b".repeat(64) }),
      ),
    ).toThrow(/review hash mismatch/u);
  });

  it("rejects a candidate whose own hash was not recomputed", () => {
    expect(() =>
      parseGeoPreparedCandidateV3({
        ...candidateWith(),
        candidateHash: "c".repeat(64),
      }),
    ).toThrow(/Prepared candidate hash mismatch/u);
  });
});

describe("the published pack cannot invent items", () => {
  it("rejects an item key the reviewed draft never had", () => {
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({ knowledgePack: packWith(FOREIGN_KEY) }),
      ),
    ).toThrow(/not in the reviewed draft/u);
  });

  it("rejects an item the owner excluded", () => {
    const payload = payloadWith({
      review: {
        decisions: [
          {
            itemKey: FACT_KEY,
            decision: "excluded",
            override: null,
            baseContentHash: BODY_HASH,
            decidedAt: GENERATED_AT,
            baseDraftVersion: "3",
          },
        ],
        suppressions: [],
      },
    });
    expect(() =>
      parseGeoPreparedCandidateV3(candidateWith({ payload })),
    ).toThrow(/excluded by the owner/u);
  });

  it("rejects a pack generated for another market", () => {
    const foreignInput = {
      ...generationInput,
      identity: {
        ...generationInput.identity,
        market: { country: "GB", language: "en" },
      },
    };
    const foreignHash = geoV2Digest(foreignInput);
    const payload = payloadWith({
      generationInput: foreignInput,
      runRef: {
        runId: null,
        generationInputHash: foreignHash,
        rolesGenerationId: null,
        knowledgeGenerationId: null,
        questionsGenerationId: null,
      },
    });
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({ payload, generationInputHash: foreignHash }),
      ),
    ).toThrow(/knowledge pack scope mismatch/u);
  });
});

describe("source receipt references", () => {
  it("rejects an unsorted or duplicated receipt list", () => {
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({ sourceReceiptRefs: [...receiptRefs].reverse() }),
      ),
    ).toThrow(/sorted by receipt id/u);
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({ sourceReceiptRefs: [receiptRefs[0], receiptRefs[0]] }),
      ),
    ).toThrow(/Duplicate source receipt reference/u);
    expect(() =>
      parseGeoPreparedCandidateV3(
        candidateWith({
          sourceReceiptRefs: [
            {
              receiptId: "7F08F279-2B1E-8C4D-9A3F-0E1D2C3B4A59",
              contentHash: BODY_HASH,
            },
          ],
        }),
      ),
    ).toThrow(/must be canonical/u);
  });
});
