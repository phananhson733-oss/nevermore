import { buildContentShadowInputManifest } from "../../research/manifest.ts";
import { buildResearchPack } from "../../research/research-pack.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../../version.ts";
import type {
  BriefOutlineProjectionStats,
  ContentShadowBriefOutline,
  QaEvaluationInput,
  ResearchPack,
  ResearchSource,
} from "../../types.ts";

/** The frozen brief outline used by most fixtures. */
export const FIXTURE_OUTLINE: ContentShadowBriefOutline = {
  briefSections: ["What onboarding analytics covers", "Audience"],
  targetKeywords: ["onboarding analytics"],
  pageAssignment: "existing_page",
};

export const FIXTURE_STATS: BriefOutlineProjectionStats = {
  briefSectionCount: 2,
  projectedSectionCount: 2,
  clusterKeywordCount: 1,
  projectedKeywordCount: 1,
  unconfirmedMappingCount: 0,
};

export function fixturePack(
  overrides: {
    readonly outline?: ContentShadowBriefOutline;
    readonly outputLocale?: string;
    readonly stats?: BriefOutlineProjectionStats;
  } = {},
): ResearchPack {
  const outline = overrides.outline ?? FIXTURE_OUTLINE;
  return buildResearchPack(
    buildContentShadowInputManifest({
      primaryFindingId: "00000000-0000-4000-8000-000000000001",
      sourceActionId: "00000000-0000-4000-8000-000000000002",
      sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000003",
      contentBriefArtifactId: "00000000-0000-4000-8000-000000000004",
      contentBriefRevision: 1,
      competitorEntityIds: [],
      searchCluster: {
        clusterKey: "onboarding-analytics",
        keywordEntityIds: ["00000000-0000-4000-8000-00000000000a"],
      },
      generativeQueryEntityIds: [],
      contentBriefOutline: outline,
      flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
      promptSetVersion: "mvp.prompts.content-shadow.0.3.0",
      projectionVersion: "content-shadow.0.3.1",
      outputLocale: overrides.outputLocale ?? "en",
    }),
    overrides.stats ?? FIXTURE_STATS,
  );
}

/**
 * A pack whose sources carry CITABLE identities.
 *
 * Slice 2's deterministic pack cannot produce one of these — every `ref` it
 * emits is an opaque SignalFrame uuid — so this fixture exists to prove the
 * resolution chain actually resolves when a source IS citable, rather than
 * passing only because nothing ever matches.
 */
export function packWithCitableSources(
  refs: readonly string[],
  base: ResearchPack = fixturePack(),
): ResearchPack {
  const sources: ResearchSource[] = refs.map((ref) => ({
    kind: "competitor",
    ref,
    authorityTier: "B",
    limitation: null,
  }));
  return { ...base, sources: [...base.sources, ...sources] };
}

/** A realistic confirmed brief the draft must not simply restate. */
export const FIXTURE_BRIEF = [
  "## What onboarding analytics covers",
  "",
  "Define the activation milestone and say who owns it.",
  "",
  "## Audience",
  "",
  "RevOps leads evaluating onboarding tooling.",
  "",
].join("\n");

export function qaInput(
  draftMarkdown: string,
  pack: ResearchPack = fixturePack(),
  stats: BriefOutlineProjectionStats = FIXTURE_STATS,
  briefMarkdown: string = FIXTURE_BRIEF,
): QaEvaluationInput {
  return { draftMarkdown, briefMarkdown, pack, briefOutlineStats: stats };
}
