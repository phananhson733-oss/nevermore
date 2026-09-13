/**
 * The sample site's five artifacts (jsx:2754-2760). Bodies come from the
 * builders over the payload's own audit, rows, knowledge base and visibility
 * snapshot, so an artifact never disagrees with the module it came from; every
 * body is stamped with its provenance (R5). The fix task names no stack: the
 * sample does not know the repository (R10).
 */
import type { Artifact, ArtifactType, AuditReport, Engine, KeywordRow, KnowledgeBase, ModuleId, Profile, VisSnapshot } from "../types.ts";
import { fixTaskPrompt } from "./builders/audit.ts";
import { llmsTxt } from "./builders/kb.ts";
import { contentBriefPrompt, keywordCsv } from "./builders/keywords.ts";
import { visibilityCsv } from "./builders/visibility.ts";
import type { DemoDeps } from "./demo.ts";
import { findRow } from "./keywords.ts";
import { stampArtifact } from "./provenance.ts";
import { daysAgo } from "./time.ts";

export interface DemoArtifactInput {
  readonly profile: Profile;
  readonly rows: readonly KeywordRow[];
  readonly audit: AuditReport;
  readonly kb: KnowledgeBase;
  readonly lastVis: VisSnapshot;
  /** Brief target when neither the sample query nor any row exists. */
  readonly fallbackTarget: string;
  readonly deps: DemoDeps;
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

const UNKNOWN_STACK = "[未知：先识别仓库框架]";
const KEYWORD_ARTIFACT_ROWS = 40;
const BRIEF_TARGET = "llm seo checklist";

function stamped(spec: ArtifactSpec, deps: DemoDeps): Artifact {
  return {
    id: spec.id,
    at: spec.at,
    module: spec.module,
    type: spec.type,
    engine: spec.engine,
    title: spec.title,
    content: stampArtifact(spec.type, spec.body, deps.provenanceLine(spec.at)),
  };
}

function withFilename(artifact: Artifact, filename: string): Artifact {
  return { ...artifact, filename };
}

function auditArtifact({ profile, audit, deps }: DemoArtifactInput): Artifact {
  const body = fixTaskPrompt({ report: audit, profile, stack: UNKNOWN_STACK });
  return stamped(
    { id: "demo-audit", module: "audit", type: "prompt", engine: "seo", title: "修复任务（给 Code Agent）", body, at: audit.at },
    deps,
  );
}

function keywordsArtifact({ rows, deps }: DemoArtifactInput): Artifact {
  const shown = rows.slice(0, KEYWORD_ARTIFACT_ROWS);
  const title = `关键词矩阵 ${shown.length} 条`;
  const at = daysAgo(deps.now, 1, 14);
  const artifact = stamped({ id: "demo-keywords", module: "keywords", type: "csv", engine: "seo", title, body: keywordCsv(shown), at }, deps);
  return withFilename(artifact, "keyword-matrix.csv");
}

function kbArtifact({ profile, kb, deps }: DemoArtifactInput): Artifact {
  const body = llmsTxt({ profile, entries: kb.entries });
  const artifact = stamped({ id: "demo-kb", module: "kb", type: "md", engine: "geo", title: "llms.txt", body, at: kb.at }, deps);
  return withFilename(artifact, "llms.txt");
}

function visibilityArtifact({ lastVis, deps }: DemoArtifactInput): Artifact {
  const hits = lastVis.results.filter((result) => result.hit).length;
  const title = `可见度矩阵 ${hits}/${lastVis.results.length}`;
  const body = visibilityCsv({ results: lastVis.results, checkedAt: lastVis.at });
  const artifact = stamped({ id: "demo-visibility", module: "visibility", type: "csv", engine: "geo", title, body, at: lastVis.at }, deps);
  return withFilename(artifact, "ai-visibility.csv");
}

function contentArtifact({ profile, rows, fallbackTarget, deps }: DemoArtifactInput): Artifact {
  const target = findRow(rows, BRIEF_TARGET)?.q ?? rows[0]?.q ?? fallbackTarget;
  const body = contentBriefPrompt({ asset: "blog", target, profile, hit: findRow(rows, target), outline: "", extra: "" });
  return stamped(
    { id: "demo-content", module: "content", type: "prompt", engine: "seo", title: `博客文章 brief：${target}`, body, at: daysAgo(deps.now, 4, 10) },
    deps,
  );
}

/** In order: audit fix task, keyword CSV, llms.txt, visibility CSV, blog brief. Prompts carry no filename. */
export function demoArtifacts(input: DemoArtifactInput): readonly Artifact[] {
  return [auditArtifact(input), keywordsArtifact(input), kbArtifact(input), visibilityArtifact(input), contentArtifact(input)];
}
