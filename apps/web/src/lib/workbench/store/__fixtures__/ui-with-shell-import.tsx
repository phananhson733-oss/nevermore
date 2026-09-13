/**
 * Control fixture for `store/ui-shell-import-gate.test.ts` (Q35). Nothing in the
 * app imports it; the test reads it as if it sat under `components/workbench/ui/`.
 *
 * It makes the two edges the `ui/` gate exists to catch: a static import of a
 * shell module through the `@/` alias, and a dynamic one through a relative
 * path. It lives here rather than in `ui/`, where the gate would read it as
 * real code.
 *
 * Lives under `lib/workbench`, outside the Tailwind `@source` roots, and is a
 * `.tsx`, outside the coverage universe (`apps/** /*.ts`).
 */
import { WORKBENCH_NAV } from "@/components/workbench/shell/workbench-nav.ts";

export const loadPalette = () =>
  import("../../../../components/workbench/shell/CommandPalette.tsx");

export function UiWithShellImport() {
  return <p>{[WORKBENCH_NAV.length, typeof loadPalette].join(" ")}</p>;
}
