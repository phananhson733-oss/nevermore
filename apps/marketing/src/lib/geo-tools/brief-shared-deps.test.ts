import { describe, expect, it, vi } from "vitest";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import { resolveSharedBriefRunEvidence } from "./brief-shared-deps.ts";
import type { VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
import type { OwnedGeoGapResult } from "./owned-gap.ts";
const siteEvidence: VisibilitySiteEvidenceV1 = { schemaVersion: "marketing-geo-site-evidence.v1", collectedAt: "2026-08-31T00:01:00Z", index: { scope: "declared_and_reachable_inventory", status: "partial", targetHost: "acme.test", discoveredCount: 0, inventorySources: [], pages: [], sitemapUrls: [], limits: [] }, references: [], referenceOmittedCount: 0, citability: [], citabilityOmittedCount: 0 };
function setup() {
  const report = visibilityReportFixtureV2();
  const frozen = { ...SHARED_FROZEN, kbId: report.manifest.kbId, snapshotId: report.manifest.snapshotId, questionSetHash: report.manifest.questionSetHash, payload: { ...SHARED_FROZEN.payload, targetUrl: "https://acme.test/" }, questionSet: { ...SHARED_FROZEN.questionSet, questions: report.questions.map(row => row.definition) } };
  const resolveGap = vi.fn(async (): Promise<OwnedGeoGapResult> => ({ kind: "ok", value: { report, siteEvidence, gap: { id: "gap-q1", questionId: "q1", kind: "A", reason: "no_matching_page_in_audited_inventory", evidenceIds: [], pageUrl: null, sourceUrls: [], action: "brief" } } }));
  return { report, frozen, resolveGap, input: { userId: "owner", runId: report.manifest.runId, gapId: "gap-q1", questionId: "q1", frozen } };
}
describe("shared Brief owned-run adapter", () => {
  it("preserves the actual answer excerpt even when the target brand was not mentioned", async () => {
    const { input, resolveGap } = setup();
    const value = await resolveSharedBriefRunEvidence(input, { resolveGap });
    expect(value).toMatchObject({ kind: "ok", value: { samples: [{ excerpt: "Offline observed answer.", status: "answered", search_enabled: true }] } });
    expect(resolveGap).toHaveBeenCalledWith({ userId: input.userId, runId: input.runId, gapId: input.gapId, questionId: input.questionId, snapshotId: input.frozen.snapshotId });
  });
  it.each(["omitted_topics", "site", "question"])("refuses incomplete or mismatched %s evidence", async error => {
    const { input, report, resolveGap } = setup();
    if (error === "omitted_topics") Object.assign(report.questions[0]!.samples[0]!, { subtopicsOmitted: 1 });
    if (error === "site") input.frozen.payload.targetUrl = "https://other.example";
    if (error === "question") input.frozen.questionSet.questions = [{ ...input.frozen.questionSet.questions[0]!, text: "another frozen question" }];
    expect((await resolveSharedBriefRunEvidence(input, { resolveGap })).kind).toBe("unavailable");
  });
});
