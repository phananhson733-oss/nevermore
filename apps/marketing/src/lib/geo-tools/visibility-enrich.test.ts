import { describe, expect, it } from "vitest";
import { enrichVisibilityReportV2 } from "./visibility-enrich.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { parseVisibilityReportV2 } from "./visibility-export.ts";
import { encodeVisibilityWire } from "./visibility-wire.ts";
import type { GeoSiteEvidenceDependencies } from "./site-index.ts";
function report() { const base = visibilityReportFixtureV2(); return visibilityReportFixtureV2({ samplesPerQuestion: 3, questions: [{ ...base.questions[0]!.definition, text: "How do teams automate invoice reminders?", requiredEntities: ["invoice reminders"] }], samples: Array.from({ length: 3 }, (_, i) => ({ ...base.questions[0]!.samples[0]!, sampleIndex: i + 1, slotId: `chatgpt:q1:${i + 1}`, providerTaskId: `task-${i}` })) }); }
function deps(large = false): GeoSiteEvidenceDependencies {
  const urls = Array.from({ length: large ? 24 : 1 }, (_, i) => i === 0 ? "https://acme.test/" : `https://acme.test/page-${i}`);
  return { now: () => new Date("2026-08-31T00:02:00.000Z"), renderPage: async () => { throw new Error("no scripts, no relevant page"); }, fetchResource: async (url) => {
    const xml = url.endsWith(".xml"), robots = url.endsWith("robots.txt");
    const body = robots ? "User-agent: *\nAllow: /" : xml ? `<urlset>${urls.map((item) => `<url><loc>${item}</loc></url>`).join("")}</urlset>` : `<html><title>Company home</title><body>${large ? Array.from({ length: 20 }, () => `<h2>${"章".repeat(160)}</h2>`).join("") : "Company home"}</body></html>`;
    return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200, redirectChain: [], contentType: robots ? "text/plain" : xml ? "application/xml" : "text/html", xRobotsTag: null, body, bytes: new TextEncoder().encode(body).byteLength, bodyComplete: true };
  } };
}
describe("actual Visibility→site evidence→gap pipeline", () => {
  it("attaches a real complete scoped inventory and A action before durable storage", async () => {
    const input = report(), enriched = await enrichVisibilityReportV2(input, deps());
    expect(enriched.siteEvidence?.index.status).toBe("complete");
    expect(enriched.gaps[0]).toMatchObject({ kind: "A", action: "brief", evidenceIds: ["site-index"] });
    expect(enriched.manifest.finishedAt).toBe("2026-08-31T00:02:00.000Z");
    expect(parseVisibilityReportV2(enriched)).not.toBeNull();
  });
  it("downgrades omitted site evidence instead of inventing absence or losing sample metrics", async () => {
    const input = report(), enriched = await enrichVisibilityReportV2(input, deps(true));
    expect(enriched.limits).toContain("siteEvidenceBudget");
    expect(enriched.siteEvidence?.index.status).toBe("partial");
    expect(enriched.gaps.every((gap) => gap.kind === "unattributed")).toBe(true);
    expect(enriched.metrics).toEqual(input.metrics);
    expect(enriched.manifest.calls).toBe(3);
    expect(new TextEncoder().encode(JSON.stringify(encodeVisibilityWire(enriched))).byteLength).toBeLessThan(4 * 1024 * 1024);
    expect(parseVisibilityReportV2(enriched)).not.toBeNull();
  });
});
