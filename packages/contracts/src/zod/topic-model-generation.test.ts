import { describe, expect, it } from "vitest";
import {
  TOPIC_MODEL_GENERATION_INPUT_SCHEMA_VERSION,
  TopicModelGenerationInputManifest,
  parseTopicModelGenerationInputManifest,
} from "./topic-model-generation.ts";

const manifest = {
  schemaVersion: TOPIC_MODEL_GENERATION_INPUT_SCHEMA_VERSION,
  analysisRefreshRunId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  market: "US",
  language: "en",
  groups: [
    {
      groupKey: "group-a",
      representativeKeywords: ["revenue automation"],
      keywordCount: 2,
      aggregateSearchVolume: 100,
      providerIntentDistribution: {
        informational: 0,
        navigational: 0,
        commercial: 1,
        transactional: 0,
      },
      urls: ["https://example.test/revenue"],
    },
    {
      groupKey: "group-b",
      representativeKeywords: ["pipeline reporting"],
      keywordCount: 1,
      aggregateSearchVolume: null,
      providerIntentDistribution: {
        informational: 0,
        navigational: 0,
        commercial: 0,
        transactional: 0,
      },
      urls: [],
    },
  ],
  productProfile: {
    productName: "Acme",
    oneLiner: null,
    category: "Software",
    valueProposition: "Connect revenue workflows",
    coreFeatures: ["Workflow automation"],
  },
  icp: {
    targetCompanyOrAudience: "B2B revenue teams",
    buyerRoles: ["VP Revenue"],
    userRoles: ["Revenue operations"],
    useCases: ["Automate handoffs"],
    pains: ["Fragmented workflows"],
    outcomes: ["Faster handoffs"],
  },
  keywords: [
    {
      keywordId: "10000000-0000-4000-8000-000000000003",
      expectedGovernanceRevision: 0,
      groupKey: "group-a",
      providerSearchIntent: {
        value: "commercial",
        snapshotId: "10000000-0000-4000-8000-000000000004",
        observationId: "10000000-0000-4000-8000-000000000005",
        observedAt: "2026-08-09T00:00:00.000Z",
      },
    },
    {
      keywordId: "10000000-0000-4000-8000-000000000006",
      expectedGovernanceRevision: 2,
      groupKey: "group-a",
      providerSearchIntent: {
        value: null,
        snapshotId: "10000000-0000-4000-8000-000000000004",
        observationId: "10000000-0000-4000-8000-000000000007",
        observedAt: "2026-08-09T00:00:00.000Z",
      },
    },
    {
      keywordId: "10000000-0000-4000-8000-000000000008",
      expectedGovernanceRevision: 0,
      groupKey: "group-b",
      providerSearchIntent: null,
    },
  ],
} as const;

describe("TopicModelGenerationInputManifest", () => {
  it("accepts the exact bounded shape and preserves explicit provider null lineage", () => {
    const parsed = TopicModelGenerationInputManifest.parse(manifest);
    expect(parsed).toEqual(manifest);
    expect(parsed.keywords[1]?.providerSearchIntent).toEqual(
      manifest.keywords[1]?.providerSearchIntent,
    );
    expect(parsed.keywords[2]?.providerSearchIntent).toBeNull();
    expect(parseTopicModelGenerationInputManifest(manifest)).toEqual(manifest);
  });

  it("rejects missing/extra authority fields and nested extras", () => {
    expect(
      TopicModelGenerationInputManifest.safeParse({
        ...manifest,
        actorId: "10000000-0000-4000-8000-000000000009",
      }).success,
    ).toBe(false);
    expect(
      TopicModelGenerationInputManifest.safeParse({
        ...manifest,
        keywords: [
          manifest.keywords[0],
          manifest.keywords[1],
          {
            keywordId: manifest.keywords[2].keywordId,
            expectedGovernanceRevision: 0,
            groupKey: "group-b",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      TopicModelGenerationInputManifest.safeParse({
        ...manifest,
        keywords: [
          {
            ...manifest.keywords[0],
            providerSearchIntent: {
              ...manifest.keywords[0].providerSearchIntent,
              rawProviderPayload: {},
            },
          },
          ...manifest.keywords.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects group/reference/count/distribution drift and duplicate occurrence lineage", () => {
    expect(
      TopicModelGenerationInputManifest.safeParse({
        ...manifest,
        groups: [
          { ...manifest.groups[0], keywordCount: 1 },
          manifest.groups[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      TopicModelGenerationInputManifest.safeParse({
        ...manifest,
        groups: [
          {
            ...manifest.groups[0],
            providerIntentDistribution: {
              ...manifest.groups[0].providerIntentDistribution,
              commercial: 0,
            },
          },
          manifest.groups[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      TopicModelGenerationInputManifest.safeParse({
        ...manifest,
        groups: [
          {
            ...manifest.groups[0],
            representativeKeywords: [
              "revenue automation",
              "revenue operations",
              "pipeline automation",
            ],
          },
          manifest.groups[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      TopicModelGenerationInputManifest.safeParse({
        ...manifest,
        keywords: [
          manifest.keywords[0],
          {
            ...manifest.keywords[1],
            providerSearchIntent: {
              ...manifest.keywords[1].providerSearchIntent,
              observationId:
                manifest.keywords[0].providerSearchIntent.observationId,
            },
          },
          manifest.keywords[2],
        ],
      }).success,
    ).toBe(false);
  });
});
