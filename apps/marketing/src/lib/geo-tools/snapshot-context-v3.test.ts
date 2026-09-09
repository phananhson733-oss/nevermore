import { describe, expect, it } from "vitest";

import { geoItemKey } from "./kb-item-key.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import { geoV3DecisionStates } from "./kb-v3-review.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import {
  GEO_ABSENT_QUESTION_SET_HASH,
  GEO_SNAPSHOT_CONTEXT_SCHEMA_V3,
  buildGeoSnapshotContextV3,
  geoV3SourceSummary,
  isGeoSnapshotContextV3,
  parseGeoSnapshotContextV3,
  type GeoContextEvidenceRefV3,
} from "./snapshot-context-v3.ts";

const KB_ID = "1f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59";
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
const QA_KEY = geoItemKey({
  module: "qa",
  intent: "definition",
  canonicalQuestion: "what is astrologywiki",
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

const fact = {
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
  itemKey: FACT_KEY,
  origin: "observed_own",
  sourceRefs: ["own-home"],
  evidenceChecks: "cited_and_literals_match",
  alternateObservations: [],
} as const;

const synthesizedQa = {
  id: "qa-what-is",
  intent: "definition",
  question: "What is AstrologyWiki?",
  canonicalQuestion: "what is astrologywiki",
  variants: [],
  directAnswer: "A free astrology reference site.",
  expansion: null,
  itemKey: QA_KEY,
  origin: "synthesized",
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

/** Accepted, with pain points but no decision criteria: eligible for `problem` only. */
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

function payloadWith(overrides: Record<string, unknown> = {}): GeoKbPayloadV3 {
  return parseGeoKbPayloadV3({
    schemaVersion: "marketing-geo-kb.v3",
    generationInput,
    knowledge: {
      entity: { status: "unavailable", reason: "not_collected" },
      facts: { status: "available", value: [fact] },
      qa: { status: "unavailable", reason: "generation_unavailable" },
      comparisons: { status: "unavailable", reason: "not_collected" },
      scope: { status: "unavailable", reason: "generation_unavailable" },
      evidence: { status: "unavailable", reason: "not_collected" },
      machine: { status: "unavailable", reason: "not_collected" },
      coverage: { status: "unavailable", reason: "not_collected" },
      sourceCatalogue: [source],
      collectedAt: OBSERVED_AT,
      generatedAt: GENERATED_AT,
    },
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

const evidenceRefs: readonly GeoContextEvidenceRefV3[] = [
  { sourceId: "4f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59", contentHash: BODY_HASH },
];

function build(
  overrides: Partial<Parameters<typeof buildGeoSnapshotContextV3>[0]> = {},
) {
  return buildGeoSnapshotContextV3({
    kbId: KB_ID,
    payload: payloadWith(),
    questionSet: null,
    evidenceRefs,
    ...overrides,
  });
}

describe("building a v3 snapshot context", () => {
  it("carries hashes, lineage and counts, and no facts at all", () => {
    const context = build();
    expect(context.schemaVersion).toBe(GEO_SNAPSHOT_CONTEXT_SCHEMA_V3);
    expect(isGeoSnapshotContextV3(context)).toBe(true);
    expect(Object.keys(context).sort()).toEqual(
      [
        "contentHash",
        "evidenceRefs",
        "kbId",
        "payloadHash",
        "profileRef",
        "questionSetHash",
        "roles",
        "schemaVersion",
        "skippedLayers",
        "sourceSummary",
        "targetHost",
      ].sort(),
    );
    // The two things v2 could not represent honestly, and therefore no longer
    // exist here: projected facts and a per-fact evidence catalogue.
    expect(context).not.toHaveProperty("facts");
    expect(context).not.toHaveProperty("evidenceCatalog");
    expect(context.targetHost).toBe("astrologywiki.example");
    expect(context.payloadHash).toBe(geoV2Digest(payloadWith()));
    expect(context.profileRef).toEqual(profileRef);
  });

  it("projects role lineage and derives the layers no role can support", () => {
    const context = build();
    expect(context.roles).toEqual([
      {
        roleId: "role-hobbyist",
        review: "accepted",
        source: role.source,
        eligibleLayers: ["problem"],
      },
    ]);
    expect(context.skippedLayers).toEqual(["evaluation"]);
  });

  it("cannot be given an unreviewed role at all", () => {
    // The context filters unaccepted roles out of every layer, but a v3 draft
    // can no longer carry one: the generation input is locked after the roles
    // step, so an unaccepted role there would mean the lock did not happen.
    const pending = { ...role, review: "pending" } as const;
    expect(() => payloadWith({ generationInput: { ...generationInput, roles: [pending] } }))
      .toThrow(/accepted roles only/iu);
  });

  it("is a pure function of its input", () => {
    expect(canonicalGeoV2Text(build())).toBe(canonicalGeoV2Text(build()));
  });

  it("re-parses everything it builds", () => {
    const context = build();
    expect(parseGeoSnapshotContextV3(context)).toEqual(context);
    expect(parseGeoSnapshotContextV3(build({ questionSet }))).toBeTruthy();
  });

  it("refuses a target that is not a public host", () => {
    const payload = payloadWith({
      generationInput: {
        ...generationInput,
        identity: {
          ...generationInput.identity,
          targetUrl: "https://localhost/",
        },
      },
    });
    expect(() => build({ payload })).toThrow(/site mismatch/u);
  });

  it("sorts and rejects evidence references deterministically", () => {
    const unsorted: readonly GeoContextEvidenceRefV3[] = [
      {
        sourceId: "9f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
        contentHash: BODY_HASH,
      },
      {
        sourceId: "4f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
        contentHash: BODY_HASH,
      },
    ];
    expect(
      build({ evidenceRefs: unsorted }).evidenceRefs.map((ref) => ref.sourceId),
    ).toEqual([
      "4f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
      "9f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
    ]);
    expect(() => build({ evidenceRefs: [unsorted[1]!, unsorted[1]!] })).toThrow(
      /Duplicate evidence reference/u,
    );
    expect(() =>
      build({
        evidenceRefs: [
          {
            sourceId: "4F08F279-2B1E-8C4D-9A3F-0E1D2C3B4A59",
            contentHash: BODY_HASH,
          },
        ],
      }),
    ).toThrow(/canonical/u);
    const tooMany = Array.from({ length: 33 }, (_, index) => ({
      sourceId: `${String(index).padStart(8, "0")}-2b1e-8c4d-9a3f-0e1d2c3b4a59`,
      contentHash: BODY_HASH,
    }));
    expect(() => build({ evidenceRefs: tooMany })).toThrow();
  });
});

describe("the absent question set sentinel", () => {
  it("is the digest of the canonical text null, and no real set can produce it", () => {
    // Pinned as a literal on purpose: a value re-derived by the same expression
    // the implementation uses would agree with any change to that expression.
    expect(GEO_ABSENT_QUESTION_SET_HASH).toBe(
      "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
    );
    expect(build({ questionSet: null }).questionSetHash).toBe(
      GEO_ABSENT_QUESTION_SET_HASH,
    );
  });

  it("is replaced by the real digest when a question set exists", () => {
    const context = build({ questionSet });
    expect(context.questionSetHash).toBe(geoV2Digest(questionSet));
    expect(context.questionSetHash).not.toBe(GEO_ABSENT_QUESTION_SET_HASH);
  });
});

describe("per-origin source counts", () => {
  it("counts reviewable items by where they came from, as decimal strings", () => {
    const knowledge = {
      entity: { status: "unavailable", reason: "not_collected" },
      facts: { status: "available", value: [fact] },
      qa: { status: "available", value: [synthesizedQa] },
      comparisons: { status: "unavailable", reason: "not_collected" },
      scope: { status: "unavailable", reason: "generation_unavailable" },
      evidence: { status: "unavailable", reason: "not_collected" },
      machine: { status: "unavailable", reason: "not_collected" },
      coverage: { status: "unavailable", reason: "not_collected" },
      sourceCatalogue: [source],
      collectedAt: OBSERVED_AT,
      generatedAt: GENERATED_AT,
    };
    const context = build({ payload: payloadWith({ knowledge }) });
    expect(context.sourceSummary).toEqual({
      own: "1",
      competitor: "0",
      thirdParty: "0",
      gsc: "0",
      profile: "0",
      model: "1",
    });
  });

  it("counts the draft, not the publication: a review never subtracts", () => {
    // Pinned because the field's meaning is frozen into a hash-covered record.
    // Excluding an item removes it from the published pack and leaves this
    // summary alone, and that is the documented reading -- see the note on
    // `sourceSummarySchema`. Making the count review-aware is not a change of
    // arithmetic: a corrected item publishes as `declared_owner`, which has no
    // bucket here, so it needs a schema change and a
    // GEO_SNAPSHOT_CONTEXT_SCHEMA_V3 bump to go with it.
    const knowledge = {
      entity: { status: "unavailable", reason: "not_collected" },
      facts: { status: "available", value: [fact] },
      qa: { status: "available", value: [synthesizedQa] },
      comparisons: { status: "unavailable", reason: "not_collected" },
      scope: { status: "unavailable", reason: "generation_unavailable" },
      evidence: { status: "unavailable", reason: "not_collected" },
      machine: { status: "unavailable", reason: "not_collected" },
      coverage: { status: "unavailable", reason: "not_collected" },
      sourceCatalogue: [source],
      collectedAt: OBSERVED_AT,
      generatedAt: GENERATED_AT,
    };
    const unreviewed = payloadWith({ knowledge });
    const hashes = geoV3ItemContentHashes(unreviewed.knowledge);
    const reviewed = payloadWith({
      knowledge,
      review: {
        decisions: [
          {
            itemKey: FACT_KEY,
            decision: "excluded",
            override: null,
            baseContentHash: hashes.get(FACT_KEY)!,
            decidedAt: GENERATED_AT,
            baseDraftVersion: "1",
          },
        ],
        suppressions: [{ itemKey: QA_KEY, suppressedAt: GENERATED_AT }],
      },
    });

    // Both items really are out of the publication, so the equality below is
    // not the equality of a review that did nothing.
    const states = geoV3DecisionStates(reviewed.review, [FACT_KEY, QA_KEY]);
    expect(states.get(FACT_KEY)?.decision).toBe("excluded");
    expect(states.get(QA_KEY)?.decision).toBe("excluded");

    expect(geoV3SourceSummary(unreviewed.knowledge)).toEqual({
      own: "1",
      competitor: "0",
      thirdParty: "0",
      gsc: "0",
      profile: "0",
      model: "1",
    });
    expect(geoV3SourceSummary(reviewed.knowledge)).toEqual(
      geoV3SourceSummary(unreviewed.knowledge),
    );
    expect(build({ payload: reviewed }).sourceSummary).toEqual(
      build({ payload: unreviewed }).sourceSummary,
    );
  });

  it("reports zeroes, not absence, when there is no knowledge body", () => {
    expect(geoV3SourceSummary(null)).toEqual({
      own: "0",
      competitor: "0",
      thirdParty: "0",
      gsc: "0",
      profile: "0",
      model: "0",
    });
    expect(
      build({ payload: payloadWith({ knowledge: null }) }).sourceSummary.own,
    ).toBe("0");
  });
});

describe("parsing a v3 snapshot context", () => {
  it("rejects a JSON number anywhere in the context", () => {
    const context = build();
    expect(() =>
      parseGeoSnapshotContextV3({
        ...context,
        sourceSummary: { ...context.sourceSummary, own: 1 },
      }),
    ).toThrow(/must not contain numbers/u);
  });

  it("rejects content that no longer matches its own hash", () => {
    const context = build();
    expect(() =>
      parseGeoSnapshotContextV3({
        ...context,
        kbId: "5f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
      }),
    ).toThrow(/Context hash mismatch/u);
  });

  it("rejects a layer granted by a role nobody accepted", () => {
    const context = build();
    const roles = [{ ...context.roles[0]!, review: "pending" as const }];
    const body = { ...context, roles, skippedLayers: [] };
    const { contentHash: _ignored, ...rest } = body;
    expect(() =>
      parseGeoSnapshotContextV3({ ...rest, contentHash: geoV2Digest(rest) }),
    ).toThrow(/Invalid role policy\/lineage/u);
  });

  it("rejects a skipped-layer list that disagrees with the roles", () => {
    const context = build();
    const { contentHash: _ignored, ...rest } = {
      ...context,
      skippedLayers: ["problem", "evaluation"] as const,
    };
    expect(() =>
      parseGeoSnapshotContextV3({ ...rest, contentHash: geoV2Digest(rest) }),
    ).toThrow(/Invalid skipped-layer policy/u);
  });

  it("rejects a target host that is not its own canonical form", () => {
    const context = build();
    const { contentHash: _ignored, ...rest } = {
      ...context,
      targetHost: "www.astrologywiki.example",
    };
    expect(() =>
      parseGeoSnapshotContextV3({ ...rest, contentHash: geoV2Digest(rest) }),
    ).toThrow(/site mismatch/u);
  });

  it("rejects evidence references that arrive out of order or duplicated", () => {
    const context = build({
      evidenceRefs: [
        {
          sourceId: "4f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
          contentHash: BODY_HASH,
        },
        {
          sourceId: "9f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
          contentHash: BODY_HASH,
        },
      ],
    });
    const reversed = {
      ...context,
      evidenceRefs: [...context.evidenceRefs].reverse(),
    };
    const { contentHash: _ignored, ...rest } = reversed;
    expect(() =>
      parseGeoSnapshotContextV3({ ...rest, contentHash: geoV2Digest(rest) }),
    ).toThrow(/sorted by source id/u);
    const duplicated = {
      ...context,
      evidenceRefs: [context.evidenceRefs[0]!, context.evidenceRefs[0]!],
    };
    const { contentHash: _also, ...duplicatedRest } = duplicated;
    expect(() =>
      parseGeoSnapshotContextV3({
        ...duplicatedRest,
        contentHash: geoV2Digest(duplicatedRest),
      }),
    ).toThrow(/Duplicate evidence reference/u);
  });

  it("rejects unknown keys, including the v2 fields v3 removed", () => {
    const context = build();
    expect(() =>
      parseGeoSnapshotContextV3({ ...context, facts: [] }),
    ).toThrow();
    expect(() =>
      parseGeoSnapshotContextV3({ ...context, candidateId: KB_ID }),
    ).toThrow();
  });

  it("accepts identities whose UUID version nibble is not 1 to 5", () => {
    // Entity ids in this product are UUIDv8; a version-pinning validator would
    // reject every one of them.
    expect(build({ kbId: "1f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59" }).kbId).toBe(
      "1f08f279-2b1e-8c4d-9a3f-0e1d2c3b4a59",
    );
    expect(build({ kbId: "1f08f279-2b1e-0c4d-9a3f-0e1d2c3b4a59" }).kbId).toBe(
      "1f08f279-2b1e-0c4d-9a3f-0e1d2c3b4a59",
    );
  });
});
