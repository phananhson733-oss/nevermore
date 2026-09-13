import type { DemoPayload, WorkbenchProjectState } from "../types.ts";

/**
 * The fields "load sample" overwrites and "clear sample" wipes: exactly what
 * `loadDemo` writes, so `clearDemo` can undo it symmetrically. `gscRowsSource`
 * rides along although it is not part of `DemoPayload` (the mock layer never
 * sets it): it belongs to `gscRows`, and clearing the rows while leaving
 * "sample" behind would give any reader that looks at the source with no rows
 * a provenance for data that is gone.
 */
export type DemoFields = DemoPayload & Pick<WorkbenchProjectState, "gscRowsSource">;

/**
 * Those fields and nothing else. Accepts a whole project state (it is a
 * `DemoFields` structurally) and returns a fresh object holding the same
 * references, which is what a confirmation snapshot is: the reducer keeps the
 * reference of every field an action does not write, so "unchanged since the
 * operator confirmed" is a per-field `===`.
 */
export function demoFields(s: DemoFields): DemoFields {
  return {
    conns: s.conns, gscRows: s.gscRows, gscRowsSource: s.gscRowsSource, seeds: s.seeds, built: s.built, saved: s.saved,
    audit: s.audit, auditHistory: s.auditHistory, lastAudit: s.lastAudit,
    visResults: s.visResults, visHistory: s.visHistory, lastVis: s.lastVis,
    compData: s.compData, plans: s.plans, targets: s.targets, kb: s.kb, artifacts: s.artifacts, profileDoc: s.profileDoc,
  };
}

/**
 * Whether two states (or snapshots) hold the same overwritable content, field
 * by field, BY REFERENCE. Anything outside `DemoFields` — `profile`, `notify`,
 * `visPartial`, `demo` — is not compared, so a settings toggle does not void a
 * confirmation. A field that was rewritten with equal content (a `storage`
 * event re-parses everything) does void it: the cheap error is asking again,
 * never overwriting something the operator did not see.
 *
 * The key list is `demoFields`' own literal, so the compared set and the
 * cleared set cannot drift apart.
 */
export function sameDemoFields(a: DemoFields, b: DemoFields): boolean {
  const left = demoFields(a);
  const right = demoFields(b);
  return (Object.keys(left) as (keyof DemoFields)[]).every((key) => left[key] === right[key]);
}
