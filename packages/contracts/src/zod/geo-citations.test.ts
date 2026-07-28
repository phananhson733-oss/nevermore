import { describe, expect, it } from "vitest";
import {
  GeoCitationCollectionBatch,
  GeoCitationEvidenceResponse,
} from "./geo-citations.ts";

const ids = {
  project: "a1000000-0000-4000-8000-000000000001",
  site: "a1000000-0000-4000-8000-000000000002",
  page: "a1000000-0000-4000-8000-000000000003",
  source: "a1000000-0000-4000-8000-000000000004",
  run: "a1000000-0000-4000-8000-000000000005",
  snapshot: "a1000000-0000-4000-8000-000000000006",
  observation: "a1000000-0000-4000-8000-000000000007",
  query: "a1000000-0000-4000-8000-000000000008",
  citation: "a1000000-0000-4000-8000-000000000009",
  measurement: "a1000000-0000-4000-8000-000000000010",
};

const hash = "a".repeat(64);
const canonicalUrl =
  "https://relayops.example/customer-onboarding/";

function citedQuery() {
  return {
    sitePageId: ids.page,
    canonicalUrl,
    query: "What is the best customer onboarding software?",
    platform: {
      kind: "known" as const,
      key: "chatgpt" as const,
    },
    model: "gpt-5-search",
    collector: {
      kind: "vendor_api" as const,
      providerKey: "internal-ai-visibility",
      version: "2026-07-28",
    },
    collectedAt: "2026-07-01T12:00:00.000Z",
    citationState: "cited" as const,
    answerEvidence: {
      excerpt:
        "RelayOps is listed as an onboarding workflow option.",
      contentHash: hash,
      selector: "answer:citation[1]",
    },
    limitation:
      "Point-in-time answer observation; output may vary by model and account.",
    citations: [
      {
        citationUrl: canonicalUrl,
        citationOrdinal: 1,
        answerEvidenceExcerpt:
          "RelayOps is listed as an onboarding workflow option.",
        citedPageExcerpt:
          "Automate customer onboarding without losing the human touch.",
        citedPageContentHash: hash,
        citedParagraphHash: "b".repeat(64),
        citedParagraphSelector: "main > section:nth-of-type(2) > p:nth-of-type(1)",
        citedParagraphIndex: 3,
        evidenceClassification: "direct_observation" as const,
      },
    ],
  };
}

function batch() {
  return {
    projectId: ids.project,
    siteId: ids.site,
    sourceConnectionId: ids.source,
    collectionRunId: ids.run,
    capturedAt: "2026-07-02T00:00:00.000Z",
    coveredWindow: {
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-02T00:00:00.000Z",
    },
    marketCode: "US",
    languageTag: "en-US",
    limitation:
      "Point-in-time AI answer observations are non-causal and may vary.",
    queries: [citedQuery()],
  };
}

describe("GEO citation authority contracts", () => {
  it("accepts a bounded, source-scoped direct citation observation", () => {
    expect(GeoCitationCollectionBatch.parse(batch())).toEqual(batch());
  });

  it("requires an audited provider key when a platform is not in the known enum", () => {
    const value = batch();
    value.queries[0]!.platform = {
      kind: "other",
      providerKey: "",
    } as never;

    expect(GeoCitationCollectionBatch.safeParse(value).success).toBe(false);
    expect(
      GeoCitationCollectionBatch.safeParse({
        ...batch(),
        queries: [
          {
            ...citedQuery(),
            platform: {
              kind: "other",
              providerKey: "you-com",
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("does not accept an unbounded answer, an uncited result with citations, or causal explanation fields", () => {
    const oversized = batch();
    oversized.queries[0]!.answerEvidence.excerpt = "x".repeat(1_001);
    expect(
      GeoCitationCollectionBatch.safeParse(oversized).success,
    ).toBe(false);

    const uncitedWithCitation = batch();
    uncitedWithCitation.queries[0]!.citationState =
      "unseen" as never;
    expect(
      GeoCitationCollectionBatch.safeParse(uncitedWithCitation).success,
    ).toBe(false);

    expect(
      GeoCitationCollectionBatch.safeParse({
        ...batch(),
        queries: [
          {
            ...citedQuery(),
            whyItWasCited:
              "This page caused the model to cite the brand.",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("does not attribute another same-site page citation to the selected canonical URL", () => {
    const wrongPage = batch();
    wrongPage.queries[0]!.citations[0]!.citationUrl =
      "https://relayops.example/pricing/";

    expect(
      GeoCitationCollectionBatch.safeParse(wrongPage).success,
    ).toBe(false);
  });

  it("allows unavailable probes only with null evidence, no citations, and an explicit limitation", () => {
    expect(
      GeoCitationCollectionBatch.safeParse({
        ...batch(),
        queries: [
          {
            ...citedQuery(),
            citationState: "unavailable",
            answerEvidence: null,
            citations: [],
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      GeoCitationCollectionBatch.safeParse({
        ...batch(),
        queries: [
          {
            ...citedQuery(),
            citationState: "unavailable",
            answerEvidence: null,
            citations: [],
            limitation: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("returns reverse-look-up evidence without causal attribution", () => {
    const response = {
      projectId: ids.project,
      siteId: ids.site,
      measurementWindowId: ids.measurement,
      sitePageId: ids.page,
      canonicalUrl,
      interpretation: "observational_non_causal" as const,
      phases: {
        baseline: {
          sourceConnectionId: ids.source,
          snapshotId: ids.snapshot,
          normalizedObservationId: ids.observation,
          queries: [
            {
              id: ids.query,
              query: citedQuery().query,
              platform: citedQuery().platform,
              model: citedQuery().model,
              collector: citedQuery().collector,
              collectedAt: citedQuery().collectedAt,
              marketCode: "US",
              languageTag: "en-US",
              citationState: "cited" as const,
              answerEvidence: citedQuery().answerEvidence,
              limitation: citedQuery().limitation,
              citations: [
                {
                  id: ids.citation,
                  ...citedQuery().citations[0]!,
                },
              ],
            },
          ],
        },
        outcome: null,
      },
      limitation:
        "Only baseline evidence is available; no before/after conclusion is supported.",
    };

    expect(GeoCitationEvidenceResponse.parse(response)).toEqual(
      response,
    );
    expect(
      GeoCitationEvidenceResponse.safeParse({
        ...response,
        causalConclusion: "The content update caused the citation.",
      }).success,
    ).toBe(false);
  });
});
