// @input -- authenticated subject and a run/snapshot/question/gap selector only
// @output -- server-owned A/D evidence or refusal; imported reports are never accepted
// @pos -- trusted Visibility→Brief bridge before any model or quota work
import { readVisibilityRunV2 } from "./visibility-store-v2.ts";
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
import type { VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
import type { GeoGap } from "./gap-contract.ts";
import { classifyVisibilityGaps } from "./gap-classify.ts";
export interface OwnedGeoGapSelector { readonly userId: string; readonly runId: string; readonly gapId: string; readonly questionId: string; readonly snapshotId: string }
export type OwnedGeoGapResult = { readonly kind: "ok"; readonly value: { readonly report: VisibilityReportV2; readonly gap: GeoGap & { readonly kind: "A" | "D" }; readonly siteEvidence: VisibilitySiteEvidenceV1 } } | { readonly kind: "missing" | "unavailable" | "not_eligible" };
export async function resolveOwnedVisibilityGap(input: OwnedGeoGapSelector, dependencies: { readonly readRun: typeof readVisibilityRunV2 } = { readRun: readVisibilityRunV2 }): Promise<OwnedGeoGapResult> {
  const read = await dependencies.readRun({ userId: input.userId, runId: input.runId });
  if (read.kind !== "ok") return { kind: read.kind === "unavailable" ? "unavailable" : "missing" };
  const { report } = read.value;
  if (read.value.provenance !== "server_owned" || report.manifest.runId !== input.runId || report.manifest.snapshotId !== input.snapshotId || !report.questions.some((q) => q.questionId === input.questionId)) return { kind: "missing" };
  if (report.siteEvidence === null) return { kind: "not_eligible" };
  const stored = report.gaps.find((gap) => gap.id === input.gapId && gap.questionId === input.questionId);
  const gap = classifyVisibilityGaps(report, report.siteEvidence).find((gap) => gap.id === input.gapId && gap.questionId === input.questionId);
  if (stored === undefined || gap === undefined) return { kind: "missing" };
  const keys = ["id", "questionId", "kind", "reason", "pageUrl", "action"] as const;
  if (!keys.every((key) => stored[key] === gap[key]) || JSON.stringify(stored.evidenceIds) !== JSON.stringify(gap.evidenceIds) || JSON.stringify(stored.sourceUrls) !== JSON.stringify(gap.sourceUrls)) return { kind: "unavailable" };
  if (gap.kind !== "A" && gap.kind !== "D") return { kind: "not_eligible" };
  return { kind: "ok", value: { report, gap: gap as GeoGap & { readonly kind: "A" | "D" }, siteEvidence: report.siteEvidence } };
}
