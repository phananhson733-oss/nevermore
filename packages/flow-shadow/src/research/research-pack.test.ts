import { describe, expect, it } from "vitest";
import { buildContentShadowInputManifest } from "./manifest.ts";
import {
  buildResearchPack,
  CONTENT_SHADOW_OUTLINE,
  researchPackToJson,
} from "./research-pack.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import type { ContentShadowFrozenInput } from "../types.ts";

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
  flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
  promptSetVersion: "mvp.prompts.0.2.0",
  projectionVersion: "content-shadow.0.3.0",
  outputLocale: "en",
};

const manifest = buildContentShadowInputManifest(FROZEN);

describe("buildResearchPack", () => {
  it("is deterministic: the same manifest yields a byte-identical pack", () => {
    expect(JSON.stringify(buildResearchPack(manifest))).toBe(
      JSON.stringify(buildResearchPack(manifest)),
    );
  });

  it("keeps search and generative observation in separate shapes", () => {
    const pack = buildResearchPack(manifest);

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
    walk(buildResearchPack(manifest));

    for (const key of keys) {
      expect(key).not.toMatch(/volume|impression|click|combined|merged/i);
    }
    // The two observations never share a container.
    expect(keys.has("searchObservation")).toBe(true);
    expect(keys.has("generativeObservation")).toBe(true);
    expect(keys.has("queries")).toBe(false);
  });

  it("freezes the confirmed brief revision instead of recasting it", () => {
    const pack = buildResearchPack(manifest);

    expect(pack.brief).toEqual({
      artifactId: FROZEN.contentBriefArtifactId,
      revision: 3,
    });
    expect(pack.outline).toEqual([...CONTENT_SHADOW_OUTLINE]);
  });

  it("grades only first-party frozen records and states its gaps", () => {
    const pack = buildResearchPack(manifest);

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

  it("serializes to a plain JSON object for the jsonb column", () => {
    const json = researchPackToJson(buildResearchPack(manifest));

    expect(Object.getPrototypeOf(json)).toBe(Object.prototype);
    expect(json["adapterVersion"]).toBe(CONTENT_SHADOW_ADAPTER_VERSION);
  });
});
