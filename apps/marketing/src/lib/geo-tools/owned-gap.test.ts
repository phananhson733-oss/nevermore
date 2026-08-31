import { describe, expect, it, vi } from "vitest";
import { resolveOwnedVisibilityGap } from "./owned-gap.ts";
import { classifyVisibilityGaps } from "./gap-classify.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import type { VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
const userId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const base = visibilityReportFixtureV2();
  const report = visibilityReportFixtureV2({ questions: [{ ...base.questions[0]!.definition, requiredEntities: ["invoice reminders"] }], samplesPerQuestion: 3, samples: Array.from({ length: 3 }, (_, i) => ({ ...base.questions[0]!.samples[0]!, sampleIndex: i + 1, slotId: `chatgpt:q1:${i + 1}`, providerTaskId: `task-${i}` })) });
  const siteEvidence: VisibilitySiteEvidenceV1 = { schemaVersion: "marketing-geo-site-evidence.v1", collectedAt: "2026-08-31T00:02:00.000Z", index: { status: "complete", scope: "declared_and_reachable_inventory", targetHost: "acme.test", discoveredCount: 1, sitemapUrls: ["https://acme.test/sitemap.xml"], inventorySources: [{ url: "https://acme.test/sitemap.xml", fetchedAt: "2026-08-31T00:02:00.000Z", httpStatus: 200, bodyComplete: true, contentSha256: "b".repeat(64) }], limits: [], pages: [{ id: "page-1", url: "https://acme.test/", finalUrl: "https://acme.test/", fetchedAt: "2026-08-31T00:02:00.000Z", state: "read", reason: null, httpStatus: 200, contentSha256: "a".repeat(64), contentMethod: "raw_html", bodyComplete: true, title: "Acme", headings: [], pageType: "other", pageTypeBasis: "title_headings", ownPresence: true, ownPresenceBasis: "brand_text", ownPresenceExcerpt: "Acme", matches: [] }] }, references: [], referenceOmittedCount: 0, citability: [], citabilityOmittedCount: 0 };
  return { ...report, siteEvidence, gaps: classifyVisibilityGaps(report, siteEvidence) };
}
describe("owned GAP→Brief resolver", () => {
  it("resolves A from the same owned run/snapshot/question, not from client counts", async () => {
    const report = fixture();
    const readRun = vi.fn(async () => ({ kind: "ok" as const, value: { runId: report.manifest.runId, report, createdAt: report.manifest.finishedAt, provenance: "server_owned" as const } }));
    const input = { userId, runId: report.manifest.runId, snapshotId: report.manifest.snapshotId, questionId: "q1", gapId: "gap-q1" };
    expect(await resolveOwnedVisibilityGap(input, { readRun })).toMatchObject({ kind: "ok", value: { gap: { kind: "A", action: "brief" }, report } });
    expect(readRun).toHaveBeenCalledWith({ userId, runId: report.manifest.runId });
    expect((await resolveOwnedVisibilityGap({ ...input, snapshotId: "11111111-1111-4111-8111-111111111119" }, { readRun })).kind).toBe("missing");
  });
  it("refuses forged classifications and non-Brief gaps", async () => {
    const report = fixture();
    const input = { userId, runId: report.manifest.runId, snapshotId: report.manifest.snapshotId, questionId: "q1", gapId: "gap-q1" };
    const forged = { ...report, gaps: [{ ...report.gaps[0]!, kind: "D" as const }] };
    const readRun = async () => ({ kind: "ok" as const, value: { runId: report.manifest.runId, report: forged, createdAt: report.manifest.finishedAt, provenance: "server_owned" as const } });
    expect((await resolveOwnedVisibilityGap(input, { readRun })).kind).toBe("unavailable");
    const noEvidence = { ...report, siteEvidence: null, gaps: [] };
    expect((await resolveOwnedVisibilityGap(input, { readRun: async () => ({ kind: "ok", value: { runId: report.manifest.runId, report: noEvidence, createdAt: report.manifest.finishedAt, provenance: "server_owned" } }) })).kind).toBe("not_eligible");
  });
});
