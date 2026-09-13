import type { DemoPayload, WorkbenchProjectState } from "../types.ts";
import { sameContent } from "./same-content.ts";

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
 * reference of every field an action does not write, so a field nobody touched
 * since the operator confirmed is still `===` to its snapshot. A field that
 * was rebuilt with the same content is not, which is why `sameDemoFields` does
 * not stop at `===`.
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
 * by field. Anything outside `DemoFields` — `profile`, `notify`, `visPartial`,
 * `demo` — is not compared, so a settings toggle does not void a confirmation.
 *
 * A field is the same when it is the same reference, the cheap path and the
 * common one (the reducer keeps every reference an action does not write), or
 * else when both sides encode to the same JSON (`sameContent`, codex S6r3 #2). Reference
 * alone was too strict: another tab that changed only `notify` persists the
 * whole state, the `storage` event re-parses it, and every field here comes
 * back as a new reference with the same content, so the confirmation was
 * refused and the same box opened again with nothing to say why. The store
 * persists through JSON, so equal under JSON is all the store itself can tell
 * apart: the same content is the same authorisation. The encoding keeps key
 * order, so the same content written with its keys in another order compares
 * unequal; that only asks the operator again, the safe direction.
 *
 * The key list is `demoFields`' own literal, so the compared set and the
 * cleared set cannot drift apart.
 */
export function sameDemoFields(a: DemoFields, b: DemoFields): boolean {
  const left = demoFields(a);
  const right = demoFields(b);
  return (Object.keys(left) as (keyof DemoFields)[]).every((key) => sameContent(left[key], right[key]));
}
