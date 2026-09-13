/**
 * The overview's "what to do next" list (jsx:1104-1110) and its empty test
 * (Q10), as pure functions over the project state. No clock, no copy: a step is
 * an id, an optional `{count}` and the workbench page it links to; the view owns
 * the words (`workbench.overview.next.step.*`).
 *
 * Three departures from the prototype, each on purpose:
 *
 * - Visibility is read from `lastVis`, the last COMPLETED run, not from
 *   `visResults`. `visStart` empties `visResults` and streams partial results
 *   into it (`reducer.ts`), and `visPartial` is persisted, so a project can hold
 *   half a run with no completed one; the same rule the week view follows (Q20),
 *   and the same field `isOverviewEmpty` reads, so the step list and the empty
 *   state cannot disagree about whether visibility has run.
 * - The borderline step goes to the keyword page (Q21); its sentence no longer
 *   promises a top-ten result (Q16, the catalogue carries that rule).
 * - The "keep producing content" fallback appears only when every other step is
 *   absent. That is not a separate guard: a missing audit and a missing
 *   visibility run each always yield a step, so the fallback cannot show while
 *   either has no completed result (next-steps.test.ts pins it).
 *
 * 一旦本文件被更新，务必更新开头注释
 */
import { missedPrompts } from "@/lib/workbench/mock/visibility";
import type { WorkbenchPageId } from "@/lib/workbench/routes";
import type { AuditReport, KeywordRow, VisSnapshot, WorkbenchProjectState } from "@/lib/workbench/types";

/** A step whose sentence takes no argument. */
export interface PlainStep {
  readonly id: "audit" | "visibility" | "matrix" | "content";
  readonly target: WorkbenchPageId;
}

/** A step whose sentence takes `{count}`; the count is never 0 (the step is dropped instead). */
export interface CountedStep {
  readonly id: "fixHigh" | "answerGaps" | "borderline";
  readonly count: number;
  readonly target: WorkbenchPageId;
}

export type NextStep = PlainStep | CountedStep;

export interface NextStepsInput {
  readonly audit: AuditReport | null;
  /** The last completed visibility run; `null` when none has completed. */
  readonly lastVis: VisSnapshot | null;
  /** Gated keyword rows: empty until the matrix is built. */
  readonly rows: readonly KeywordRow[];
}

function auditStep(audit: AuditReport | null): NextStep | null {
  if (audit === null) return { id: "audit", target: "audit" };
  const high = audit.findings.filter((finding) => finding.sev === "high").length;
  return high > 0 ? { id: "fixHigh", count: high, target: "audit" } : null;
}

function visibilityStep(lastVis: VisSnapshot | null): NextStep | null {
  const results = lastVis?.results ?? [];
  if (results.length === 0) return { id: "visibility", target: "visibility" };
  // Distinct prompts with at least one miss: one answer page per prompt, not per platform.
  const gaps = missedPrompts(results).length;
  return gaps > 0 ? { id: "answerGaps", count: gaps, target: "answers" } : null;
}

function keywordStep(rows: readonly KeywordRow[]): NextStep | null {
  if (rows.length === 0) return { id: "matrix", target: "keywords" };
  const borderline = rows.filter((row) => row.gscStatus === "borderline").length;
  return borderline > 0 ? { id: "borderline", count: borderline, target: "keywords" } : null;
}

/** Ordered: audit, visibility, keywords; `content` alone when none of them has anything left. */
export function overviewNextSteps(input: NextStepsInput): readonly NextStep[] {
  const steps = [auditStep(input.audit), visibilityStep(input.lastVis), keywordStep(input.rows)].filter(
    (step): step is NextStep => step !== null,
  );
  return steps.length > 0 ? steps : [{ id: "content", target: "content" }];
}

/**
 * Q10's "nothing has run": no audit, no completed visibility run, no built
 * matrix, no artifact. Imported GSC rows and typed seeds do not count — they
 * are inputs, not results, and the page still has nothing to report on.
 */
export function isOverviewEmpty(
  state: Pick<WorkbenchProjectState, "audit" | "lastVis" | "built" | "artifacts">,
): boolean {
  return state.audit === null && state.lastVis === null && !state.built && state.artifacts.length === 0;
}
