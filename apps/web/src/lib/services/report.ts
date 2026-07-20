import {
  ActionsRepository,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  type DbTx,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getProject } from "./projects";
import type { ProjectDto } from "./mappers";
import { loadEvidenceByFinding } from "./diagnostic-load";
import {
  toActionDto,
  toCoverageDto,
  toFindingDto,
  type ActionDto,
  type CoverageDto,
  type FindingDto,
} from "./diagnostic-mappers";
import { toArtifactDto, type ArtifactDto } from "./artifact-mappers";

/**
 * Client report projection (spec §10.4). A server-side read model — NOT a table.
 * It reads only canonical objects (AC-036): confirmed + active findings with key
 * evidence, non-dismissed actions (the 30/60/90 plan), and READY artifacts (draft
 * artifacts are excluded from the client view). It never recomputes priority.
 */

const EN_METHODOLOGY =
  "Findings are derived from deterministic rules over first-party and public evidence; " +
  "no result, ranking, or revenue outcome is promised.";
const ZH_CN_METHODOLOGY =
  "发现由确定性规则基于第一方和公开证据得出；不承诺任何结果、排名或收入表现。";

const REPORT_PAGE_SIZE = 100;
const REPORT_MAX_PAGES_PER_RESOURCE = 100;
const REPORT_MAX_ITEMS_PER_RESOURCE =
  REPORT_PAGE_SIZE * REPORT_MAX_PAGES_PER_RESOURCE;
const REPORT_MAX_BYTES_PER_RESOURCE = 16 * 1024 * 1024;
const REPORT_MAX_EVIDENCE_LINKS = 50_000;
const REPORT_MAX_EVIDENCE_ROWS = 50_000;

type ReportResource = "findings" | "actions" | "artifacts";

function reportBudgetExceeded(resource: ReportResource): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    `Report ${resource} projection exceeded its safety budget.`,
  );
}

/** Incrementally measures the exact JSON-array contribution of final DTOs. */
class ReportResourceBudget {
  readonly #encoder = new TextEncoder();
  #items = 0;
  #bytes = 2; // JSON array brackets.

  constructor(private readonly resource: ReportResource) {}

  consume(value: unknown): void {
    const serialized = JSON.stringify(value);
    this.#bytes +=
      (this.#items === 0 ? 0 : 1) + this.#encoder.encode(serialized).byteLength;
    this.#items += 1;
    if (
      this.#items > REPORT_MAX_ITEMS_PER_RESOURCE ||
      this.#bytes > REPORT_MAX_BYTES_PER_RESOURCE
    ) {
      reportBudgetExceeded(this.resource);
    }
  }
}

/**
 * Methodology is frozen delivery copy, not UI chrome. Only the reviewed en and
 * zh-CN variants are represented as localized. Every other valid BCP-47 request
 * receives an explicitly labelled English fallback so the API never implies
 * that untranslated English was authored in the requested language.
 */
function methodologyForOutputLocale(locale: string): string {
  const normalized = locale.toLowerCase();
  if (normalized === "en") return EN_METHODOLOGY;
  if (normalized === "zh-cn") return ZH_CN_METHODOLOGY;
  return (
    `A localized methodology is not available for ${locale}; ` +
    `the following text is the frozen English fallback. ${EN_METHODOLOGY}`
  );
}

async function loadAllPages<Row>(
  resource: ReportResource,
  load: (
    cursor: string | null,
  ) => Promise<{ rows: Row[]; nextCursor: string | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  const seenCursors = new Set<string>();
  const scanBudget = new ReportResourceBudget(resource);
  let cursor: string | null = null;
  let pagesRead = 0;

  while (true) {
    const page = await load(cursor);
    pagesRead += 1;
    for (const row of page.rows) {
      scanBudget.consume(row);
      rows.push(row);
    }
    if (page.nextCursor === null) return rows;
    if (
      page.nextCursor === cursor ||
      seenCursors.has(page.nextCursor) ||
      pagesRead >= REPORT_MAX_PAGES_PER_RESOURCE
    ) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        `Report ${resource} pagination did not complete safely.`,
      );
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export interface ReportDto {
  project: ProjectDto;
  outputLocale: string;
  generatedAt: string;
  coverage: CoverageDto;
  findings: FindingDto[];
  actions: ActionDto[];
  artifacts: ArtifactDto[];
  methodology: string;
  limitations: string[];
}

function emptyCoverage(): CoverageDto {
  return {
    overall: "unavailable",
    domains: {
      technical_seo: "unavailable",
      search_performance: "unavailable",
      content_intent: "unavailable",
      conversion_journey: "unavailable",
      geo_ai: "unavailable",
    },
    limitations: ["No diagnostic run has completed for this project yet."],
  };
}

interface ReportSnapshot {
  readonly project: ProjectDto;
  readonly coverage: CoverageDto;
  readonly findings: FindingDto[];
  readonly actions: ActionDto[];
  readonly artifacts: ArtifactDto[];
}

async function loadReportSnapshot(
  tx: DbTx,
  scope: WorkspaceScope,
  projectScope: { readonly workspaceId: string; readonly projectId: string },
): Promise<ReportSnapshot> {
  const project = await getProject(scope, projectScope.projectId, tx);
  const latest = await new DiagnosticRunsRepository(tx).findLatest(projectScope);
  const coverage = latest ? toCoverageDto(latest.coverage) : emptyCoverage();

  // Confirmed + active findings (client-readable), with key evidence.
  const findingsRepo = new FindingsRepository(tx);
  const findingRows = await loadAllPages("findings", (cursor) =>
    findingsRepo.list(projectScope, {
      limit: REPORT_PAGE_SIZE,
      cursor,
      activeOnly: true,
    }),
  );
  const confirmed = findingRows.filter((f) => f.review_state === "confirmed");
  const evidenceByFinding = await loadEvidenceByFinding(
    tx,
    projectScope,
    confirmed.map((f) => f.id),
    {
      maxLinks: REPORT_MAX_EVIDENCE_LINKS,
      maxEvidenceRows: REPORT_MAX_EVIDENCE_ROWS,
      maxEvidenceBytes: REPORT_MAX_BYTES_PER_RESOURCE,
      onExceeded: () => reportBudgetExceeded("findings"),
    },
  );
  const findingBudget = new ReportResourceBudget("findings");
  const findings: FindingDto[] = [];
  for (const finding of confirmed) {
    const dto = toFindingDto(
      finding,
      evidenceByFinding.get(finding.id) ?? [],
    );
    findingBudget.consume(dto);
    findings.push(dto);
  }

  // Non-dismissed actions (the 30/60/90 plan).
  const actionsRepo = new ActionsRepository(tx);
  const actionRows = await loadAllPages("actions", (cursor) =>
    actionsRepo.list(projectScope, { limit: REPORT_PAGE_SIZE, cursor }),
  );
  const actionBudget = new ReportResourceBudget("actions");
  const actions: ActionDto[] = [];
  for (const action of actionRows) {
    if (action.status === "dismissed") continue;
    const dto = toActionDto(action);
    actionBudget.consume(dto);
    actions.push(dto);
  }

  // READY artifacts only (draft artifacts stay out of the client view).
  const artifactsRepo = new ExecutionArtifactsRepository(tx);
  const artifactRows = await loadAllPages("artifacts", (cursor) =>
    artifactsRepo.listByProject(projectScope, {
      limit: REPORT_PAGE_SIZE,
      cursor,
    }),
  );
  const readyArtifacts = artifactRows.filter((a) => a.status === "ready");
  const artifactBudget = new ReportResourceBudget("artifacts");
  const artifacts: ArtifactDto[] = [];
  for (const artifact of readyArtifacts) {
    const current = artifact.current_revision > 0
      ? await artifactsRepo.findRevision(
          projectScope,
          artifact.id,
          artifact.current_revision,
        )
      : null;
    const dto = toArtifactDto(artifact, current, null);
    artifactBudget.consume(dto);
    artifacts.push(dto);
  }

  return { project, coverage, findings, actions, artifacts };
}

export async function getProjectReport(
  scope: WorkspaceScope,
  projectId: string,
  outputLocale: string | null,
  generatedAt: string,
): Promise<ReportDto> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  const snapshot = await db.transaction(
    (tx) => loadReportSnapshot(tx, scope, projectScope),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const locale = outputLocale ?? snapshot.project.defaultDeliveryLocale;

  return {
    project: snapshot.project,
    outputLocale: locale,
    generatedAt,
    coverage: snapshot.coverage,
    findings: snapshot.findings,
    actions: snapshot.actions,
    artifacts: snapshot.artifacts,
    methodology: methodologyForOutputLocale(locale),
    limitations: snapshot.coverage.limitations,
  };
}
