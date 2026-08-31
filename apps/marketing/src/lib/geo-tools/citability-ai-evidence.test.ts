import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCitabilityAiContext } from "./citability-ai-evidence.ts";
import { extractCitabilityText } from "./citability-text.ts";

const input = {
  finalUrl: "https://example.com/guide",
  targetQuestion: "When is a Saturn return?",
  rawHtml: "<main><p>A Saturn return is often discussed near age 29.</p></main>",
  capturedAt: "2026-08-31T12:00:00.000Z",
  checks: [{ ruleId: "leadAnswer", state: "pass" as const, kind: "heuristic" as const }],
};

describe("server-owned citability AI evidence", () => {
  it("hashes exact raw bytes and preserves full metadata with complete small-page coverage", () => {
    const context = createCitabilityAiContext(input);
    expect(context.rawSha256).toBe(createHash("sha256").update(input.rawHtml).digest("hex"));
    expect(context).toMatchObject({
      schemaVersion: "citability-ai-context.v1", finalUrl: input.finalUrl,
      question: input.targetQuestion, capturedAt: input.capturedAt, coverage: "full",
      excerpts: [{ id: "E1", text: extractCitabilityText(input.rawHtml) }], checks: input.checks,
    });
    expect(context.totalBodyChars).toBe(context.includedBodyChars);
    expect(context.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(createCitabilityAiContext(input)).toEqual(context);
  });

  it("retains opening plus relevant later chunks and explicitly reports excerpt coverage", () => {
    const html = `<main>${"Unrelated introduction. ".repeat(200)}Saturn return age 29. ${"Other words. ".repeat(500)}</main>`;
    const context = createCitabilityAiContext({ ...input, rawHtml: html });
    expect(context.coverage).toBe("excerpt");
    expect(context.excerpts).toHaveLength(8);
    expect(context.excerpts[0].text).toMatch(/^Unrelated introduction/);
    expect(context.excerpts.some((item) => item.text.includes("Saturn return"))).toBe(true);
    expect(context.excerpts.every((item) => item.text.length <= 360)).toBe(true);
    expect(context.includedBodyChars).toBe(context.excerpts.reduce((sum, item) => sum + item.text.length, 0));
    expect(context.includedBodyChars).toBeLessThan(context.totalBodyChars);
    expect(context.excerpts.map((item) => item.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"]);
  });

  it("excludes script, navigation and footer content; rejects empty readable evidence", () => {
    const context = createCitabilityAiContext({ ...input, rawHtml: "<script>SECRET</script><nav>MENU</nav><main>Body.</main><footer>FOOTER</footer>" });
    expect(context.excerpts[0].text).toBe("Body.");
    expect(() => createCitabilityAiContext({ ...input, rawHtml: "<script>empty shell</script>" })).toThrow("empty_evidence");
  });

  it("changes fingerprint when source or question changes, never silently shortens metadata", () => {
    const before = createCitabilityAiContext(input);
    expect(createCitabilityAiContext({ ...input, rawHtml: input.rawHtml + " " }).inputFingerprint).not.toBe(before.inputFingerprint);
    expect(createCitabilityAiContext({ ...input, targetQuestion: "Is it exact?" }).inputFingerprint).not.toBe(before.inputFingerprint);
    const longUrl = `https://example.com/${"x".repeat(2500)}`;
    expect(createCitabilityAiContext({ ...input, finalUrl: longUrl }).finalUrl).toBe(longUrl);
  });

  it.each(["javascript:alert(1)", "https://user:password@example.com/", "not a URL"])("rejects unsafe metadata URL %s", (finalUrl) => {
    expect(() => createCitabilityAiContext({ ...input, finalUrl })).toThrow("invalid_context");
  });
});
