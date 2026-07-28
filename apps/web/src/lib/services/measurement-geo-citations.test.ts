import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GeoCitationAuthorityError,
  GeoCitationAuthorityRepository,
} from "@sf/db";

const { getProjectMeasurementGeoCitations } = await import(
  "./measurement-geo-citations.ts"
);

const IDS = {
  workspace: "d7000000-0000-4000-8000-000000000001",
  project: "d7000000-0000-4000-8000-000000000002",
  window: "d7000000-0000-4000-8000-000000000003",
  site: "d7000000-0000-4000-8000-000000000004",
  page: "d7000000-0000-4000-8000-000000000005",
  source: "d7000000-0000-4000-8000-000000000006",
  snapshot: "d7000000-0000-4000-8000-000000000007",
  observation: "d7000000-0000-4000-8000-000000000008",
  query: "d7000000-0000-4000-8000-000000000009",
  citation: "d7000000-0000-4000-8000-00000000000a",
} as const;

function evidence() {
  return {
    projectId: IDS.project,
    siteId: IDS.site,
    measurementWindowId: IDS.window,
    sitePageId: IDS.page,
    canonicalUrl:
      "https://example.com/customer-onboarding/",
    interpretation: "observational_non_causal" as const,
    phases: {
      baseline: {
        sourceConnectionId: IDS.source,
        snapshotId: IDS.snapshot,
        normalizedObservationId: IDS.observation,
        queries: [
          {
            id: IDS.query,
            query: "best customer onboarding software",
            platform: {
              kind: "known" as const,
              key: "chatgpt" as const,
            },
            model: "gpt-search",
            collector: {
              kind: "browser_probe" as const,
              providerKey: "gengrowth-browser",
              version: "2026-07-28",
            },
            collectedAt: "2026-05-20T12:00:00.000Z",
            marketCode: "US",
            languageTag: "en-US",
            citationState: "cited" as const,
            answerEvidence: {
              excerpt: "RelayOps appears in the compared tools.",
              contentHash: "a".repeat(64),
              selector: "answer:0",
            },
            limitation:
              "Point-in-time answer observation; results may vary.",
            citations: [
              {
                id: IDS.citation,
                citationUrl:
                  "https://example.com/customer-onboarding/",
                citationOrdinal: 1,
                answerEvidenceExcerpt:
                  "RelayOps appears in the compared tools.",
                citedPageExcerpt:
                  "Automate customer onboarding handoffs.",
                citedPageContentHash: "b".repeat(64),
                citedParagraphHash: "c".repeat(64),
                citedParagraphSelector: "main p:nth-of-type(2)",
                citedParagraphIndex: 1,
                evidenceClassification:
                  "direct_observation" as const,
              },
            ],
          },
        ],
      },
      outcome: null,
    },
    limitation:
      "Outcome GEO observation is not available yet.",
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getProjectMeasurementGeoCitations", () => {
  it("reads the selected Measurement Window through strict project scope", async () => {
    const read = vi
      .spyOn(
        GeoCitationAuthorityRepository.prototype,
        "evidenceForMeasurementWindow",
      )
      .mockResolvedValue(evidence());

    await expect(
      getProjectMeasurementGeoCitations(
        { workspaceId: IDS.workspace },
        IDS.project,
        IDS.window,
        {} as never,
      ),
    ).resolves.toEqual(evidence());
    expect(read).toHaveBeenCalledWith(
      {
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      IDS.window,
    );
  });

  it("does not turn missing evidence into a zero-valued GEO result", async () => {
    vi.spyOn(
      GeoCitationAuthorityRepository.prototype,
      "evidenceForMeasurementWindow",
    ).mockResolvedValue(null);

    await expect(
      getProjectMeasurementGeoCitations(
        { workspaceId: IDS.workspace },
        IDS.project,
        IDS.window,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("fails closed when persisted GEO lineage is inconsistent", async () => {
    vi.spyOn(
      GeoCitationAuthorityRepository.prototype,
      "evidenceForMeasurementWindow",
    ).mockRejectedValue(
      new GeoCitationAuthorityError(
        "GEO_EVIDENCE_INTEGRITY_INVALID",
      ),
    );

    await expect(
      getProjectMeasurementGeoCitations(
        { workspaceId: IDS.workspace },
        IDS.project,
        IDS.window,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});
