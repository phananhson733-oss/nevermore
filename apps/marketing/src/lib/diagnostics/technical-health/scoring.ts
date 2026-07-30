// @input  -- DiagnosticFinding[] (severity + moduleId per finding-schemas.ts)
// @output -- computeOverallScore(findings): number; computeModuleScore(findings, moduleId): number | null; gradeFromScore(score): Grade
// @pos    -- D1 Phase 1e chunk 5 scoring SoT. Pure deduction model per design spec §1; P0 cap per §2. Zero AI imports (forward-guarded by contract test).
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { ModuleId, Severity } from "./finding-schemas";

/**
 * Minimal input interface for scoring functions. Any type that carries
 * `severity` and `moduleId` (including `DiagnosticFinding`) satisfies this.
 * Using a narrow interface avoids the double-cast in runner.ts and keeps
 * scoring independent of the full finding shape.
 */
export interface ScoringInput {
  readonly severity: Severity;
  readonly moduleId: ModuleId;
}

const VALID_SEVERITIES = new Set<Severity>(["P0", "P1", "P2", "P3"]);

function isValidSeverity(s: unknown): s is Severity {
  return typeof s === "string" && VALID_SEVERITIES.has(s as Severity);
}

/**
 * Deduction weights per severity level. Chosen so a single P0 raw stays
 * within the cap zone before the cap is applied (design spec §1 rationale).
 * Mirrors health-score.ts ratio but steeper for P0 to avoid "cap is the only
 * place P0 matters" code smell.
 */
const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  P0: 25,
  P1: 10,
  P2: 4,
  P3: 1,
} as const;

/**
 * Grade thresholds per PRD §9.
 * Boundaries are inclusive on the lower end of each band.
 * DB CHECK constraint enforces A/B/C/D/F enum.
 */
const GRADE_THRESHOLDS = [
  { min: 90, grade: "A" },
  { min: 75, grade: "B" },
  { min: 60, grade: "C" },
  { min: 40, grade: "D" },
] as const;

export type Grade = "A" | "B" | "C" | "D" | "F";

/**
 * Apply P0 + P1 caps to the raw deduction score per PRD §8.4 / §22 AC1.
 *
 * Rules (evaluated in order):
 *  - Any P0 present → cap at 40
 *  - ≥2 P1, no P0 → cap at 70
 *  - 1 P1, no P0 → cap at 85
 *  - else → uncapped
 *
 * Cap never raises the score — `Math.min(raw, cap)` when raw is already
 * below cap leaves it unchanged (design spec §1 note on row 5 worked example).
 */
function applyP0Cap(raw: number, findings: readonly ScoringInput[]): number {
  if (findings.some((f) => f.severity === "P0")) {
    return Math.min(raw, 40);
  }
  const p1Count = findings.filter((f) => f.severity === "P1").length;
  if (p1Count >= 2) return Math.min(raw, 70);
  if (p1Count === 1) return Math.min(raw, 85);
  return raw;
}

/**
 * Compute overall technical-health score from a flat list of findings.
 *
 * Returns `100` for an empty finding list — this represents "all rules ran
 * and nothing failed". The runner overrides this to `null` when the rule
 * registry itself is empty, so callers see the distinction between "perfect"
 * and "not yet diagnosed".
 *
 * Result is a `Math.round`-ed integer in `[0, 100]`.
 */
export function computeOverallScore(findings: readonly ScoringInput[]): number {
  for (const f of findings) {
    if (!isValidSeverity(f.severity)) {
      throw new Error(`computeOverallScore: invalid severity "${String(f.severity)}"`);
    }
  }
  const sum = findings.reduce(
    (acc, f) => acc + SEVERITY_DEDUCTIONS[f.severity],
    0,
  );
  const raw = Math.max(0, 100 - sum);
  return Math.round(applyP0Cap(raw, findings));
}

/**
 * Compute module-scoped score for the subset of findings that belong to
 * `moduleId`. Returns `null` when no finding in the list belongs to the
 * module — "module not yet diagnosed" vs. "module diagnosed, perfect score".
 *
 * Uses identical deduction + cap logic as `computeOverallScore`, scoped to
 * the module subset. PRD §8.5 per-module contextual caps (e.g., A2 ≤30 when
 * GSC index coverage <30%) are deferred to Phase 4.
 */
export function computeModuleScore(
  findings: readonly ScoringInput[],
  moduleId: ModuleId,
): number | null {
  const moduleFindings = findings.filter((f) => f.moduleId === moduleId);
  if (moduleFindings.length === 0) return null;
  return computeOverallScore(moduleFindings);
}

/**
 * Map a numeric score to the A-F grade per PRD §9.
 *
 * Bands:
 *   90-100 → A (Excellent)
 *   75-89  → B (Good)
 *   60-74  → C (Needs Work)
 *   40-59  → D (At Risk)
 *   0-39   → F (Critical)
 *
 * Boundaries are inclusive on the lower end (i.e. 90 → A, 75 → B).
 */
export function gradeFromScore(score: number): Grade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "F";
}
