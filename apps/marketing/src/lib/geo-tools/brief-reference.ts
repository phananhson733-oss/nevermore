// @input -- a parsed GEO Brief plus the authenticated account, never a client trust flag
// @output -- immutable KB/Profile/run evidence and question quality verified before Draft quota/provider work
// @pos -- shared Draft's GEO provenance gate; a public fingerprint is consistency only
import { canonicalize } from "@sf/public-tools/content-brief/canonical";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { readFrozenGeoKb } from "./kb-store.ts";
import { readGeoSnapshotContext } from "./asset-context-store.ts";
import { readVisibilityRunV2 } from "./visibility-store-v2.ts";
import { resolveSharedBriefRunEvidence } from "./brief-shared-deps.ts";
import { sharedGeoBriefBasis, type SharedBriefRunEvidence } from "./brief-shared.ts";
import { assessGeoQuestionQuality, geoQuestionLanguageIssue, geoQuestionProperNames } from "./question-quality.ts";

export interface GeoBriefReferenceDependencies {
  readonly readFrozen: typeof readFrozenGeoKb;
  readonly readContext: typeof readGeoSnapshotContext;
  readonly readRun: typeof readVisibilityRunV2;
  readonly readRunEvidence: typeof resolveSharedBriefRunEvidence;
}
const DEFAULT: GeoBriefReferenceDependencies = { readFrozen: readFrozenGeoKb, readContext: readGeoSnapshotContext, readRun: readVisibilityRunV2, readRunEvidence: resolveSharedBriefRunEvidence };
class GeoReferenceUnavailable extends Error {
  constructor() { super("GEO reference store unavailable"); this.name = "GeoReferenceUnavailable"; }
}
/** Expected refusal only after the exact owned Brief has been verified. */
export class GeoBriefQuestionNeedsReview extends Error {
  constructor() { super("The owned GEO question needs review"); this.name = "GeoBriefQuestionNeedsReview"; }
}
const protectedKeys = ["source", "keyword", "geo_origin", "evidence", "lead_answer", "must_answer", "fact_table", "intent", "format", "verdict", "length", "gap_angle", "internal_links", "do_not_cover", "budget"] as const;

export async function verifyOwnedGeoBrief(input: GeoContentBrief, userId: string, dependencies: GeoBriefReferenceDependencies = DEFAULT): Promise<boolean> {
  const parsed = await parseGeoContentBrief(input);
  if (!parsed.ok) return false;
  const brief = parsed.value;
  const reference = brief.geo_origin.kb_ref;
  const selection = { userId, kbId: reference.kb_id, snapshotId: reference.snapshot_id };
  const frozen = await dependencies.readFrozen(selection);
  if (frozen.kind === "unavailable") throw new GeoReferenceUnavailable();
  if (frozen.kind !== "ok" || frozen.value.kbId !== reference.kb_id || frozen.value.snapshotId !== reference.snapshot_id || frozen.value.revision !== reference.revision || frozen.value.contentHash !== reference.content_hash) return false;
  const context = await dependencies.readContext(selection);
  if (context.kind === "unavailable") throw new GeoReferenceUnavailable();
  if (context.kind !== "ok") return false;
  let runEvidence: SharedBriefRunEvidence | null = null;
  if (brief.geo_origin.kind === "visibility") {
    const runRef = brief.geo_origin.run_ref;
    const questionId = brief.geo_origin.question.id;
    if (!runRef || !questionId) return false;
    const read = await dependencies.readRun({ userId, runId: runRef.id });
    if (read.kind === "unavailable") throw new GeoReferenceUnavailable();
    if (read.kind !== "ok" || read.value.provenance !== "server_owned" || read.value.runId !== runRef.id || read.value.report.manifest.snapshotId !== reference.snapshot_id) return false;
    const gaps = read.value.report.gaps.filter((gap) => gap.questionId === questionId && gap.kind === brief.geo_origin.gap);
    if (gaps.length !== 1) return false;
    // Reclassifies the stored evidence and verifies the exact frozen question;
    // the imported file's gap, counters and sample claims are never trusted.
    const resolved = await dependencies.readRunEvidence({ userId, runId: runRef.id, gapId: gaps[0]!.id, questionId, frozen: frozen.value });
    if (resolved.kind === "unavailable") throw new GeoReferenceUnavailable();
    if (resolved.kind !== "ok") return false;
    runEvidence = resolved.value;
  }
  let expected: GeoContentBrief;
  try {
    expected = sharedGeoBriefBasis({ frozen: frozen.value, context: context.value, questionId: brief.geo_origin.question.id, questionText: brief.geo_origin.question.text, runEvidence, runId: brief.run.run_id, now: brief.run.collected_at });
  } catch { return false; }
  // Model-owned outline words may be edited. Its allowed source set, Q coverage
  // and readiness were already checked by the strict parser above.
  if (brief.run.budget_ms !== expected.run.budget_ms || !protectedKeys.every((key) => canonicalize(brief[key]) === canonicalize(expected[key]))) return false;
  const selected = frozen.value.questionSet.questions.find((question) => question.id === brief.geo_origin.question.id);
  const questionNeedsReview = selected === undefined
    ? geoQuestionLanguageIssue(brief.geo_origin.question.text, frozen.value.payload.market.language, geoQuestionProperNames(frozen.value.payload))
    : !assessGeoQuestionQuality(frozen.value.payload, selected).ok;
  if (questionNeedsReview) throw new GeoBriefQuestionNeedsReview();
  return true;
}
