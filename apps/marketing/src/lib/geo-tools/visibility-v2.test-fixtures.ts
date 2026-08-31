// @input -- explicit test-only identity/observation overrides
// @output -- a report built through the actual V2 measurement pipeline
// @pos -- deterministic fixture shared by UI, store and local SQL tests; no network
import { createVisibilityReportV2, type VisibilityReportInputV2 } from "./visibility-v2.ts";
export function visibilityReportFixtureV2(overrides: Partial<VisibilityReportInputV2> = {}) {
  return createVisibilityReportV2({ runId: "11111111-1111-4111-8111-111111111112", kbId: "11111111-1111-4111-8111-111111111113", snapshotId: "11111111-1111-4111-8111-111111111114", snapshotRevision: 1, questionSetHash: "a".repeat(64), startedAt: "2026-08-31T00:00:00.000Z", finishedAt: "2026-08-31T00:01:00.000Z", engines: ["chatgpt"], samplesPerQuestion: 1,
    context: { officialName: "Acme", aliases: [], competitors: [], targetHost: "acme.test", marketCode: "US", language: "en" },
    questions: [{ id: "q1", text: "Best tools?", layer: "discovery", mode: "retrieval", calibrated: false, roleId: null, requiredEntities: [], templateId: null }],
    samples: [{ engine: "chatgpt", questionId: "q1", sampleIndex: 1, slotId: "chatgpt:q1:1", status: "ok", mentioned: false, cited: false, citedUrls: [], citedDomains: [], competitorsMentioned: [], excerpt: null, answerExcerpt: "Offline observed answer.", answerExcerptTruncated: false, subtopics: [], subtopicsOmitted: 0, competitorPositions: [], citedDomainsOmitted: 0, citedUrlsOmitted: 0, excerptOmitted: false, listPosition: null, modelRequested: "gpt-5-2025-08-07", modelObserved: "gpt-5", providerTaskId: "offline-task", webSearchPerformed: true, observedAt: "2026-08-31T00:00:30.000Z", costUsd: 0.01 }], ...overrides,
  });
}
