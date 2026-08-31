// @input -- actual site collector and T2 rules over offline public documents
// @output -- a training-only ClaudeBot block never becomes a counted B gap
// @pos -- T2 purpose classification through the dependent persisted evidence guard
import { expect, it } from "vitest";
import type { PublicResourceResult } from "@sf/sources/public-http";
import { collectVisibilitySiteEvidence } from "./site-index.ts";
import { measureCitabilityRender } from "./citability-render.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { classifyVisibilityGaps } from "./gap-classify.ts";
import { parseVisibilitySiteEvidence } from "./site-index-validate.ts";

it("retains fourteen validated checks but does not classify a training-only block as B", async () => {
  const seed = visibilityReportFixtureV2();
  const report = visibilityReportFixtureV2({
    questions: [{ ...seed.questions[0]!.definition, text: "How can teams automate invoice reminders?", requiredEntities: ["invoice reminders"] }], samplesPerQuestion: 3,
    samples: Array.from({ length: 3 }, (_, index) => ({ ...seed.questions[0]!.samples[0]!, sampleIndex: index + 1, slotId: `chatgpt:q1:${index + 1}`, providerTaskId: `offline-${index}`, citedDomains: [], citedUrls: [] })),
  });
  const html = `<html><head><title>Invoice reminder guide</title><link rel="canonical" href="https://acme.test/"></head><body><p>Acme is the best way for teams of 5 users to automate invoice reminders, according to <a href="https://source.test/guide">the guide</a>.</p><table><tr><td>Reminder</td><td>Workflow</td></tr></table><p>${"A readable explanation of the invoice reminder workflow. ".repeat(12)}</p></body></html>`;
  const pages: Record<string, { body: string; type: string }> = {
    "https://acme.test/robots.txt": { body: "User-agent: ClaudeBot\nDisallow: /\n", type: "text/plain" },
    "https://acme.test/sitemap.xml": { body: "<urlset><url><loc>https://acme.test/</loc></url></urlset>", type: "application/xml" },
    "https://acme.test/": { body: html, type: "text/html" },
  };
  const now = () => new Date("2026-08-31T00:02:00.000Z");
  const evidence = await collectVisibilitySiteEvidence(report, { now, fetchResource: async (url): Promise<PublicResourceResult> => {
    const page = pages[url];
    if (!page) return { kind: "error", code: "network" };
    return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200, redirectChain: [], body: page.body, bodyComplete: true, bytes: new TextEncoder().encode(page.body).byteLength, contentType: page.type, xRobotsTag: null };
  }, renderPage: async (request) => measureCitabilityRender(request, request.rawHtml, { now }) });
  expect(evidence.citability[0]?.checks).toHaveLength(14);
  expect(parseVisibilitySiteEvidence(evidence, report)).not.toBeNull();
  expect(evidence.citability[0]?.checks.filter((row) => row.state === "fail").map((row) => row.ruleId)).toEqual(["robots.claudebot"]);
  expect(classifyVisibilityGaps(report, evidence)[0]).toMatchObject({ kind: "unattributed", reason: "no_actionable_gap", action: "none" });
  const tampered = { ...evidence, citability: evidence.citability.map((check) => ({ ...check, checks: check.checks.map((row) => row.ruleId === "robots.claudebot" ? { ...row, weight: "counted" as const } : row) })) };
  expect(parseVisibilitySiteEvidence(tampered, report)).toBeNull();
});
