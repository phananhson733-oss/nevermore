import type { ArtifactType } from "@sf/contracts";

/**
 * Browser-local home for the 409 recovery fence, so it outlives the page that
 * owns it. The fence was `useState` inside `StudioClient` until 2026-07-26,
 * which meant a shell navigation unmounted it: an operator who left Execution
 * and came back got the Generate control live again while the winning run was
 * still going and the artifact projection still could not prove it (stop gate
 * §16.7). Module scope is the same mechanism `_context-navigation-guard.ts`
 * already uses for the Context editor's dirty flag.
 *
 * A full reload clears this, and that is correct: the fence is a client-side
 * suppression of a request the server would refuse, not a record of truth. The
 * truth is `async_runs_one_active_key_idx` and the service guard behind it, and
 * a reload re-derives the state from the canonical projection.
 */
export interface ActiveGenerationRecovery {
  readonly key: string;
  readonly actionId: string;
  readonly artifactType: ArtifactType;
  readonly refreshing: boolean;
}

let fencedProjectId: string | null = null;
let fencedRecoveries: readonly ActiveGenerationRecovery[] = [];

/**
 * Scoped by project on purpose. Switching projects must never inherit another
 * project's fence — that would suppress a control for a run that is not there.
 */
export function readActiveGenerationFence(
  projectId: string,
): readonly ActiveGenerationRecovery[] {
  return fencedProjectId === projectId ? fencedRecoveries : [];
}

export function writeActiveGenerationFence(
  projectId: string,
  recoveries: readonly ActiveGenerationRecovery[],
): void {
  fencedProjectId = projectId;
  fencedRecoveries = recoveries;
}

/** Test-only reset; module state would otherwise leak between cases. */
export function clearActiveGenerationFence(): void {
  fencedProjectId = null;
  fencedRecoveries = [];
}
