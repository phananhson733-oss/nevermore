import { describe, expect, it } from "vitest";
import { buildContentShadowInputManifest } from "./manifest.ts";
import {
  buildResearchPack,
  CONTENT_SHADOW_OUTLINE,
  researchPackToJson,
} from "./research-pack.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import type {
  BriefOutlineProjectionStats,
  ContentShadowFrozenInput,
} from "../types.ts";

const KEYWORD_A = "00000000-0000-4000-8000-00000000000a";
const KEYWORD_B = "00000000-0000-4000-8000-00000000000b";
const GENERATIVE_A = "00000000-0000-4000-8000-00000000001a";
const COMPETITOR_A = "00000000-0000-4000-8000-00000000002a";

const FROZEN: ContentShadowFrozenInput = {
  primaryFindingId: "00000000-0000-4000-8000-000000000001",
  sourceActionId: "00000000-0000-4000-8000-000000000002",
  sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000003",
  contentBriefArtifactId: "00000000-0000-4000-8000-000000000004",
  contentBriefRevision: 3,
  competitorEntityIds: [COMPETITOR_A],
  searchCluster: {
    clusterKey: "growth-analytics",
    keywordEntityIds: [KEYWORD_B, KEYWORD_A],
  },
  generativeQueryEntityIds: [GENERATIVE_A],
  contentBriefOutline: {
    briefSections: ["Objective", "Audience"],
    targetKeywords: ["growth analytics"],
    pageAssignment: "existing_page",
  },
  flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
  promptSetVersion: "mvp.prompts.content-shadow.0.3.0",
  projectionVersion: "content-shadow.0.3.1",
  outputLocale: "en",
};

const STATS: BriefOutlineProjectionStats = {
  briefSectionCount: 2,
  projectedSectionCount: 2,
  clusterKeywordCount: 1,
  projectedKeywordCount: 1,
  unconfirmedMappingCount: 0,
};

const manifest = buildContentShadowInputManifest(FROZEN);

describe("buildResearchPack", () => {
  it("is deterministic: the same manifest yields a byte-identical pack", () => {
    expect(JSON.stringify(buildResearchPack(manifest, STATS))).toBe(
      JSON.stringify(buildResearchPack(manifest, STATS)),
    );
  });

  it("keeps search and generative observation in separate shapes", () => {
    const pack = buildResearchPack(manifest, STATS);

    expect(pack.searchObservation).toEqual({
      clusterKey: "growth-analytics",
      keywordEntityIds: [KEYWORD_A, KEYWORD_B],
    });
    expect(pack.generativeObservation).toEqual({
      generativeQueryEntityIds: [GENERATIVE_A],
    });
  });

  it("never emits a shared volume or any merged demand metric field", () => {
    // Invariant 8 is about STRUCTURE, not prose: a limitation may honestly say
    // "carries no demand volume", but no key may ever hold a merged metric.
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        walk(child);
      }
    };
    walk(buildResearchPack(manifest, STATS));

    for (const key of keys) {
      expect(key).not.toMatch(/volume|impression|click|combined|merged/i);
    }
    // The two observations never share a container.
    expect(keys.has("searchObservation")).toBe(true);
    expect(keys.has("generativeObservation")).toBe(true);
    expect(keys.has("queries")).toBe(false);
  });

  it("freezes the confirmed brief revision instead of recasting it", () => {
    const pack = buildResearchPack(manifest, STATS);

    expect(pack.brief).toEqual({
      artifactId: FROZEN.contentBriefArtifactId,
      revision: 3,
    });
    expect(pack.outline).toEqual([...CONTENT_SHADOW_OUTLINE]);
  });

  it("grades only first-party frozen records and states its gaps", () => {
    const pack = buildResearchPack(manifest, STATS);

    expect(pack.sources.map((source) => source.kind)).toEqual([
      "content_brief",
      "search_query",
      "search_query",
      "generative_query",
      "competitor",
    ]);
    expect(pack.sources.every((source) => source.authorityTier === "A")).toBe(
      true,
    );
    expect(pack.limitations.length).toBeGreaterThan(0);
    expect(pack.limitations.join(" ")).toMatch(/no external source/i);
  });

  /**
   * The pack used to state, unconditionally, that the SEO/GEO judgement "is not
   * implemented yet". The read API returns this list verbatim, so a reviewer
   * looking at a draft the gate had really BLOCKED was told in the same
   * response that the block was a placeholder — which cancels out the one
   * verdict that matters. The remaining limitations have to describe what the
   * implemented gate does not check, not claim it does not exist.
   */
  it("never claims the QA judgement is unimplemented", () => {
    const limitations = buildResearchPack(manifest, STATS).limitations.join(" ");

    expect(limitations).not.toMatch(/not implemented yet/i);
    expect(limitations).not.toMatch(/\bpending\b/i);
    expect(limitations).toMatch(/no plagiarism detection/i);
    expect(limitations).toMatch(/never that it is false/i);
  });

  it("serializes to a plain JSON object for the jsonb column", () => {
    const json = researchPackToJson(buildResearchPack(manifest, STATS));

    expect(Object.getPrototypeOf(json)).toBe(Object.prototype);
    expect(json["adapterVersion"]).toBe(CONTENT_SHADOW_ADAPTER_VERSION);
  });
});

describe("buildResearchPack brief outline projection (Task 4b)", () => {
  it("projects the brief outline beside — never merged into — the fixed scaffold", () => {
    const pack = buildResearchPack(manifest, STATS);

    // O-6: the scaffold is the document structure, the brief outline is the
    // coverage checklist. Two fields, never asserted against each other.
    expect(pack.outline).toEqual([...CONTENT_SHADOW_OUTLINE]);
    expect(pack.briefOutline).toEqual({
      briefSections: ["Objective", "Audience"],
      targetKeywords: ["growth analytics"],
      pageAssignment: "existing_page",
    });
  });

  it("no longer describes the brief as consumed as-is", () => {
    const pack = buildResearchPack(manifest, STATS);
    const briefSource = pack.sources.find(
      (source) => source.kind === "content_brief",
    );

    expect(briefSource?.limitation).toMatch(/coverage checklist/i);
    expect(briefSource?.limitation).not.toMatch(/as-is/i);
  });

  it("states an extraction failure loudly instead of degrading in silence", () => {
    const broken = buildContentShadowInputManifest({
      ...FROZEN,
      contentBriefOutline: {
        briefSections: [],
        targetKeywords: [],
        pageAssignment: "unassigned",
      },
    });

    const limitations = buildResearchPack(broken, {
      briefSectionCount: 0,
      projectedSectionCount: 0,
      clusterKeywordCount: 0,
      projectedKeywordCount: 0,
      unconfirmedMappingCount: 0,
    }).limitations;

    expect(limitations.join(" ")).toMatch(
      /outline extraction FAILED[\s\S]*NOT guided by the brief/,
    );
  });

  it("discloses projection truncation and unconfirmed mapping review states", () => {
    const limitations = buildResearchPack(manifest, {
      briefSectionCount: 2,
      projectedSectionCount: 2,
      clusterKeywordCount: 120,
      projectedKeywordCount: 50,
      unconfirmedMappingCount: 7,
    }).limitations;

    expect(limitations.join(" ")).toContain(
      "The frozen search cluster holds 120 keywords; only the first 50",
    );
    expect(limitations.join(" ")).toContain(
      "7 of 120 frozen cluster keywords carry an unconfirmed page-mapping review state",
    );
  });

  /**
   * A PARTIAL extraction failure is still a failure of the brief -> draft
   * causal chain for the topics it dropped. Decision O-4 only spelled out total
   * failure, but its principle ("an honest shortfall beats a silent pass")
   * covers this: the drop has to be visible, even though it is not `failed`.
   */
  it("discloses brief sections the outline cap dropped", () => {
    const limitations = buildResearchPack(manifest, {
      briefSectionCount: 19,
      projectedSectionCount: 12,
      clusterKeywordCount: 1,
      projectedKeywordCount: 1,
      unconfirmedMappingCount: 0,
    }).limitations;

    expect(limitations.join(" ")).toContain(
      "The pinned content brief carried 19 distinct section headings; only the first 12 (in document order) reached the draft prompt, so 7 committed topic(s) did not guide this draft.",
    );
  });

  it("says nothing about truncation or review state when neither applies", () => {
    const limitations = buildResearchPack(manifest, STATS).limitations;

    expect(limitations.join(" ")).not.toContain("only the first");
    expect(limitations.join(" ")).not.toContain("unconfirmed page-mapping");
    expect(limitations.join(" ")).not.toContain("distinct section headings");
  });
});
