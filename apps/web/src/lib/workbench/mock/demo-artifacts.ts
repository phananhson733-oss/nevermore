/**
 * The sample site's five artifacts (jsx:2754-2760). Bodies come from the
 * builders over the payload's own audit, rows, knowledge base and visibility
 * snapshot, so an artifact never disagrees with the module it came from; every
 * body is stamped with its provenance (R5). The fix task names no stack: the
 * sample does not know the repository (R10). The list is newest first, the
 * order `addArtifact` keeps.
 */
import type { Artifact, ArtifactType, AuditReport, Engine, KeywordRow, KnowledgeBase, ModuleId, Profile, VisSnapshot } from "../types.ts";
import { fixTaskPrompt } from "./builders/audit.ts";
import { llmsTxt } from "./builders/kb.ts";
import { contentBriefPrompt, keywordCsv } from "./builders/keywords.ts";
import { visibilityCsv } from "./builders/visibility.ts";
import { DEMO_SEEDS } from "./demo-constants.ts";
import { buildRows, findRow } from "./keywords.ts";
import { UNKNOWN_STACK } from "./profile.ts";
import { stampArtifact } from "./provenance.ts";
import { normQ } from "./text.ts";

export interface DemoArtifactInput {
  readonly profile: Profile;
  readonly seedQueries: readonly string[];
  readonly rows: readonly KeywordRow[];
  readonly audit: AuditReport;
  readonly kb: KnowledgeBase;
  readonly lastVis: VisSnapshot;
  readonly keywordsAt: string;
  readonly briefAt: string;
  readonly provenanceLine: (at: string) => string;
}

interface ArtifactSpec {
  readonly id: string;
  readonly module: ModuleId;
  readonly type: ArtifactType;
  readonly engine: Engine;
  readonly title: string;
  readonly body: string;
  readonly at: string;
}

const KEYWORD_ARTIFACT_ROWS = 40;
/** The sample brief's preferred query, when the seeds make it. */
const BRIEF_TARGET = "llm seo checklist";

function stamped(spec: ArtifactSpec, provenanceLine: (at: string) => string): Artifact {
  return {
    id: spec.id,
    at: spec.at,
    module: spec.module,
    type: spec.type,
    engine: spec.engine,
    title: spec.title,
    content: stampArtifact(spec.type, spec.body, provenanceLine(spec.at)),
  };
}

function withFilename(artifact: Artifact, filename: string): Artifact {
  return { ...artifact, filename };
}

function auditArtifact({ profile, audit, provenanceLine }: DemoArtifactInput): Artifact {
  const body = fixTaskPrompt({ report: audit, profile, stack: UNKNOWN_STACK });
  return stamped(
    { id: "demo-audit", module: "audit", type: "prompt", engine: "seo", title: "修复任务（给 Code Agent）", body, at: audit.at },
    provenanceLine,
  );
}

function keywordsArtifact({ rows, keywordsAt, provenanceLine }: DemoArtifactInput): Artifact {
  const shown = rows.slice(0, KEYWORD_ARTIFACT_ROWS);
  const spec: ArtifactSpec = {
    id: "demo-keywords",
    module: "keywords",
    type: "csv",
    engine: "seo",
    title: `关键词矩阵 ${shown.length} 条`,
    body: keywordCsv(shown),
    at: keywordsAt,
  };
  return withFilename(stamped(spec, provenanceLine), "keyword-matrix.csv");
}

function kbArtifact({ profile, kb, provenanceLine }: DemoArtifactInput): Artifact {
  const body = llmsTxt({ profile, entries: kb.entries });
  const artifact = stamped({ id: "demo-kb", module: "kb", type: "md", engine: "geo", title: "llms.txt", body, at: kb.at }, provenanceLine);
  return withFilename(artifact, "llms.txt");
}

function visibilityArtifact({ lastVis, provenanceLine }: DemoArtifactInput): Artifact {
  const hits = lastVis.results.filter((result) => result.hit).length;
  const spec: ArtifactSpec = {
    id: "demo-visibility",
    module: "visibility",
    type: "csv",
    engine: "geo",
    title: `可见度矩阵 ${hits}/${lastVis.results.length}`,
    body: visibilityCsv({ results: lastVis.results, checkedAt: lastVis.at }),
    at: lastVis.at,
  };
  return withFilename(stamped(spec, provenanceLine), "ai-visibility.csv");
}

/**
 * `normQ` keys of the queries the seeds make on their own. Checked against a
 * seed-only build: in the real rows a GSC row with the same query wins the
 * dedupe and carries `seed: ""`, which would hide every seed query GSC lists.
 */
function seedMadeKeys(profile: Profile, seedQueries: readonly string[]): ReadonlySet<string> {
  const seeds = new Set(seedQueries.map((seed) => seed.trim()).filter((seed) => seed !== ""));
  const made = buildRows(seedQueries, profile, []).filter((row) => seeds.has(row.seed));
  return new Set(made.map((row) => normQ(row.q)));
}

/** The sample query when the seeds make it, else the first matrix row the seeds make, else the first demo seed. */
function briefTarget({ profile, seedQueries, rows }: DemoArtifactInput): string {
  const keys = seedMadeKeys(profile, seedQueries);
  const fromSeeds = rows.filter((row) => keys.has(normQ(row.q)));
  const preferred = fromSeeds.find((row) => normQ(row.q) === BRIEF_TARGET) ?? fromSeeds[0];
  return preferred?.q ?? DEMO_SEEDS[0];
}

function contentArtifact(input: DemoArtifactInput): Artifact {
  const target = briefTarget(input);
  const body = contentBriefPrompt({ asset: "blog", target, profile: input.profile, hit: findRow(input.rows, target), outline: "", extra: "" });
  return stamped(
    { id: "demo-content", module: "content", type: "prompt", engine: "seo", title: `博客文章 brief：${target}`, body, at: input.briefAt },
    input.provenanceLine,
  );
}

/** Later stamps first; `toSorted` is stable, so equal stamps keep build order. Stamps share one fixed-width format. */
function newestFirst(a: Artifact, b: Artifact): number {
  if (a.at === b.at) return 0;
  return a.at < b.at ? 1 : -1;
}

/** Audit fix task, keyword CSV, llms.txt, visibility CSV and blog brief, newest first. Prompts carry no filename. */
export function demoArtifacts(input: DemoArtifactInput): readonly Artifact[] {
  const built = [auditArtifact(input), keywordsArtifact(input), kbArtifact(input), visibilityArtifact(input), contentArtifact(input)];
  return built.toSorted(newestFirst);
}
