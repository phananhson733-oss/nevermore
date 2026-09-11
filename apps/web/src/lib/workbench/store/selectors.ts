import type { WorkbenchProjectState } from "../types.ts";

export function seedList(state: WorkbenchProjectState): readonly string[] {
  return state.seeds
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function savedQueries(state: WorkbenchProjectState): readonly string[] {
  return state.saved.map((entry) => entry.q);
}

/** Sidebar badge values (design §4.3). `null` = no badge; zero is never shown. */
export interface WorkbenchCounts {
  readonly audit: string | null;
  readonly visibility: string | null;
  readonly keywords: string | null;
  readonly keywordLibrary: string | null;
  readonly competitors: string | null;
  readonly links: string | null;
  readonly kb: string | null;
  readonly artifacts: string | null;
  readonly dataSources: string | null;
}

function countOrNull(n: number): string | null {
  return n > 0 ? String(n) : null;
}

export function selectCounts(
  state: WorkbenchProjectState,
  keywordRowCount: number | null,
): WorkbenchCounts {
  const hits = state.visResults.filter((r) => r.hit).length;
  const total = state.visResults.length;
  return {
    audit: state.audit ? String(state.audit.score) : null,
    visibility: total > 0 ? `${Math.round((hits / total) * 100)}%` : null,
    keywords: keywordRowCount === null ? null : countOrNull(keywordRowCount),
    keywordLibrary: countOrNull(state.saved.length),
    competitors: state.compData ? countOrNull(state.compData.gap.rows.length) : null,
    links: state.targets ? countOrNull(state.targets.length) : null,
    kb: state.kb ? countOrNull(state.kb.entries.filter((e) => e.statement.trim() === "").length) : null,
    artifacts: countOrNull(state.artifacts.length),
    dataSources: countOrNull(state.gscRows.length),
  };
}
