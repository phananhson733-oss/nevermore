import { describe, expect, it } from "vitest";
import {
  assertObservationSeparation,
  buildContentShadowInputManifest,
  ContentShadowObservationSeparationError,
} from "./manifest.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import type { ContentShadowFrozenInput } from "../types.ts";

const FINDING = "00000000-0000-4000-8000-000000000001";
const ACTION = "00000000-0000-4000-8000-000000000002";
const DIAGNOSTIC = "00000000-0000-4000-8000-000000000003";
const BRIEF = "00000000-0000-4000-8000-000000000004";
const KEYWORD_A = "00000000-0000-4000-8000-00000000000a";
const KEYWORD_B = "00000000-0000-4000-8000-00000000000b";
const GENERATIVE_A = "00000000-0000-4000-8000-00000000001a";
const COMPETITOR_A = "00000000-0000-4000-8000-00000000002a";
const COMPETITOR_B = "00000000-0000-4000-8000-00000000002b";

function frozen(
  overrides: Partial<ContentShadowFrozenInput> = {},
): ContentShadowFrozenInput {
  return {
    primaryFindingId: FINDING,
    sourceActionId: ACTION,
    sourceDiagnosticRunId: DIAGNOSTIC,
    contentBriefArtifactId: BRIEF,
    contentBriefRevision: 2,
    competitorEntityIds: [COMPETITOR_B, COMPETITOR_A],
    searchCluster: {
      clusterKey: "growth-analytics",
      keywordEntityIds: [KEYWORD_B, KEYWORD_A, KEYWORD_B],
    },
    generativeQueryEntityIds: [GENERATIVE_A],
    contentBriefOutline: {
      briefSections: ["Objective", "Audience"],
      targetKeywords: ["growth analytics", "product analytics"],
      pageAssignment: "existing_page",
    },
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    promptSetVersion: "mvp.prompts.content-shadow.0.3.0",
    projectionVersion: "content-shadow.0.3.1",
    outputLocale: "en",
    ...overrides,
  };
}

describe("buildContentShadowInputManifest", () => {
  it("sorts and de-duplicates every identity collection", () => {
    const manifest = buildContentShadowInputManifest(frozen());

    expect(manifest.competitorEntityIds).toEqual([
      COMPETITOR_A,
      COMPETITOR_B,
    ]);
    expect(manifest.searchCluster.keywordEntityIds).toEqual([
      KEYWORD_A,
      KEYWORD_B,
    ]);
    expect(manifest.generativeQueryEntityIds).toEqual([GENERATIVE_A]);
  });

  it("is order-independent so an equivalent request freezes the same tuple", () => {
    const left = buildContentShadowInputManifest(frozen());
    const right = buildContentShadowInputManifest(
      frozen({
        competitorEntityIds: [COMPETITOR_A, COMPETITOR_B],
        searchCluster: {
          clusterKey: "growth-analytics",
          keywordEntityIds: [KEYWORD_A, KEYWORD_B],
        },
      }),
    );

    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });

  it("carries the pinned adapter, prompt and projection versions", () => {
    const manifest = buildContentShadowInputManifest(frozen());

    expect(manifest.flowAdapterVersion).toBe(CONTENT_SHADOW_ADAPTER_VERSION);
    expect(manifest.promptSetVersion).toBe(
      "mvp.prompts.content-shadow.0.3.0",
    );
    expect(manifest.projectionVersion).toBe("content-shadow.0.3.1");
  });

  it("changes the frozen tuple when the pinned adapter advances", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const advanced = buildContentShadowInputManifest(
      frozen({ flowAdapterVersion: "content-shadow-adapter.0.4.0" }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(advanced));
  });

  it("rejects a search identity reused as a generative identity", () => {
    expect(() =>
      buildContentShadowInputManifest(
        frozen({ generativeQueryEntityIds: [KEYWORD_A] }),
      ),
    ).toThrow(ContentShadowObservationSeparationError);
  });
});

describe("assertObservationSeparation", () => {
  it("accepts disjoint search and generative identity sets", () => {
    expect(() =>
      assertObservationSeparation([KEYWORD_A], [GENERATIVE_A]),
    ).not.toThrow();
  });

  it("names every collapsed identity in a stable order", () => {
    expect(() =>
      assertObservationSeparation(
        [KEYWORD_B, KEYWORD_A],
        [KEYWORD_B, KEYWORD_A],
      ),
    ).toThrow(new RegExp(`${KEYWORD_A}, ${KEYWORD_B}`));
  });
});

describe("brief outline is part of the frozen address (Task 4b)", () => {
  it("carries the extracted outline through unchanged, in extraction order", () => {
    const manifest = buildContentShadowInputManifest(frozen());

    // Order is meaningful (document order / normalized-keyword order), so this
    // is the one collection the manifest does NOT sort or de-duplicate.
    expect(manifest.contentBriefOutline).toEqual({
      briefSections: ["Objective", "Audience"],
      targetKeywords: ["growth analytics", "product analytics"],
      pageAssignment: "existing_page",
    });
  });

  it("changes the frozen tuple when a single brief heading is renamed", () => {
    // THIS is the machine proof that a brief edit now reaches the draft: before
    // Task 4b the brief and the draft were siblings and this assertion could
    // not have been written.
    const pinned = buildContentShadowInputManifest(frozen());
    const renamed = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["North Star Metric", "Audience"],
          targetKeywords: ["growth analytics", "product analytics"],
          pageAssignment: "existing_page",
        },
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(renamed));
  });

  it("changes the frozen tuple when a keyword's mapping decision moves", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const remapped = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["Objective", "Audience"],
          targetKeywords: ["growth analytics", "product analytics"],
          pageAssignment: "new_asset",
        },
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(remapped));
  });

  it("changes the frozen tuple when the brief section ORDER changes", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const reordered = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["Audience", "Objective"],
          targetKeywords: ["growth analytics", "product analytics"],
          pageAssignment: "existing_page",
        },
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(reordered));
  });

  it("keeps identity-set order irrelevant even with an outline present", () => {
    const left = buildContentShadowInputManifest(frozen());
    const right = buildContentShadowInputManifest(
      frozen({
        competitorEntityIds: [COMPETITOR_A, COMPETITOR_B],
        searchCluster: {
          clusterKey: "growth-analytics",
          keywordEntityIds: [KEYWORD_A, KEYWORD_B],
        },
      }),
    );

    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });

  it("does not let a caller smuggle an extra key into the frozen outline", () => {
    const manifest = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["Objective"],
          targetKeywords: [],
          pageAssignment: "unassigned",
          smuggled: "payload",
        } as never,
      }),
    );

    expect(Object.keys(manifest.contentBriefOutline).sort()).toEqual([
      "briefSections",
      "pageAssignment",
      "targetKeywords",
    ]);
  });
});
