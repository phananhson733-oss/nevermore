import {
  CoverageState,
  FrontstageLensId,
  type CoverageState as CoverageStateDto,
  type FrontstageLensId as FrontstageLensIdDto,
} from "@sf/contracts";

/**
 * Whole-project opportunity mix for the Overview right card, reduced from the
 * three frontstage lenses of the latest Growth Audit run.
 *
 * SCOPE DISCIPLINE. This reduction is PROJECT-wide. The stat cells rendered
 * beside it count only the URL portfolio page that is currently loaded. The two
 * must stay separate objects so a page-scoped number can never be presented as
 * a project-wide one; `scope` is the marker that keeps them distinguishable.
 *
 * HONESTY. A lens whose coverage is `no_data` reports missing coverage, never a
 * measured zero (see the `CoverageState` contract), so its count is `null` and
 * the UI must render an explicit dash. The project total is `null` unless every
 * lens of the taxonomy contributed a known count, because a partial sum
 * presented as a project total is a false number.
 */

/** Marks a value as whole-project scoped, never portfolio-page scoped. */
export const PROJECT_OPPORTUNITY_MIX_SCOPE = "project" as const;

/**
 * The subset of the Growth Audit projection this reduction reads, declared
 * structurally rather than as the DTO. A first paint must not assume a payload
 * survived contract validation, so every field stays `unknown` and is guarded.
 * `GrowthAuditResponse` is assignable to this type.
 */
export interface ProjectOpportunityMixLensInput {
  readonly lensId?: unknown;
  readonly coverageState?: unknown;
  readonly findingCount?: unknown;
}

export interface ProjectOpportunityMixInput {
  readonly lenses?: readonly ProjectOpportunityMixLensInput[] | null;
}

export interface ProjectOpportunityMixLens {
  readonly lensId: FrontstageLensIdDto;
  readonly coverageState: CoverageStateDto;
  /** `null` whenever the count is not an observed measurement. Never `0`. */
  readonly findingCount: number | null;
}

export interface ProjectOpportunityMix {
  readonly scope: typeof PROJECT_OPPORTUNITY_MIX_SCOPE;
  /** Ordered by the canonical lens taxonomy; may be shorter when rows are unusable. */
  readonly lenses: readonly ProjectOpportunityMixLens[];
  /** Sum across every lens; `null` when any lens count is unknown. */
  readonly total: number | null;
}

/** Why no mix can be shown. Drives the empty-state copy, never a zero. */
export type ProjectOpportunityMixNoDataReason = "no_audit_run" | "no_lens_coverage";

/**
 * A terminal state for the card: `data` or `no_data`. Transport failures are not
 * modelled here — a server read throws to the error boundary and a client read
 * surfaces its own `problem` state.
 */
export type ProjectOpportunityMixResult =
  | { readonly state: "data"; readonly mix: ProjectOpportunityMix }
  | {
      readonly state: "no_data";
      readonly reason: ProjectOpportunityMixNoDataReason;
    };

function isFrontstageLensId(value: unknown): value is FrontstageLensIdDto {
  return FrontstageLensId.safeParse(value).success;
}

function isCoverageState(value: unknown): value is CoverageStateDto {
  return CoverageState.safeParse(value).success;
}

/** `no_data` is missing coverage, so it can never be reported as a count. */
function toFindingCount(
  coverageState: CoverageStateDto,
  raw: unknown,
): number | null {
  if (coverageState === "no_data") return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return null;
  return raw;
}

function toMixLens(
  row: ProjectOpportunityMixLensInput | null | undefined,
): ProjectOpportunityMixLens | null {
  const lensId = row?.lensId;
  const coverageState = row?.coverageState;
  if (!isFrontstageLensId(lensId) || !isCoverageState(coverageState)) {
    return null;
  }
  return {
    lensId,
    coverageState,
    findingCount: toFindingCount(coverageState, row?.findingCount),
  };
}

function sumFindingCounts(
  lenses: readonly ProjectOpportunityMixLens[],
): number | null {
  let total = 0;
  for (const lens of lenses) {
    if (lens.findingCount === null) return null;
    total += lens.findingCount;
  }
  return total;
}

/**
 * Reduce a Growth Audit projection to the whole-project opportunity mix.
 * Returns `null` — never a zero-filled mix — when there is no lens row this
 * reduction can honestly stand behind.
 */
export function selectProjectOpportunityMix(
  audit: ProjectOpportunityMixInput | null | undefined,
): ProjectOpportunityMix | null {
  const rows = audit?.lenses;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const byLensId = new Map<FrontstageLensIdDto, ProjectOpportunityMixLens>();
  for (const row of rows) {
    const lens = toMixLens(row);
    if (lens && !byLensId.has(lens.lensId)) byLensId.set(lens.lensId, lens);
  }

  const lenses = FrontstageLensId.options
    .map((lensId) => byLensId.get(lensId))
    .filter((lens): lens is ProjectOpportunityMixLens => lens !== undefined);
  if (lenses.length === 0) return null;

  const complete = lenses.length === FrontstageLensId.options.length;
  return {
    scope: PROJECT_OPPORTUNITY_MIX_SCOPE,
    lenses,
    total: complete ? sumFindingCounts(lenses) : null,
  };
}

/**
 * Map an audit payload — or its absence — onto the card's terminal state.
 * `null`/`undefined` means no Growth Audit has ever been run for the project.
 */
export function toProjectOpportunityMixResult(
  audit: ProjectOpportunityMixInput | null | undefined,
): ProjectOpportunityMixResult {
  if (audit === null || audit === undefined) {
    return { state: "no_data", reason: "no_audit_run" };
  }
  const mix = selectProjectOpportunityMix(audit);
  if (mix === null) return { state: "no_data", reason: "no_lens_coverage" };
  return { state: "data", mix };
}
