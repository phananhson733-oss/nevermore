import { describe, expect, it } from "vitest";

import {
  MAX_DRAFT_META_CHARS,
  MAX_DRAFT_TITLE_CHARS,
  buildDraftPrompt,
  validateDraft,
} from "./draft.ts";

const INPUT = {
  query: "lamine yamal zodiac sign",
  bucketId: "8-11",
  subject: {
    page: "https://example.com/wiki/lamine-yamal-zodiac-sign",
    title: "Lamine Yamal Zodiac Sign | AstrologyWiki",
    metaDescription: "Learn about Lamine Yamal.",
    ctr: 0.0009,
  },
  comparable: {
    page: "https://example.com/wiki/messi-birth-chart",
    title: "Messi's Birth Chart: Full Natal Reading and What It Means",
    metaDescription:
      "The complete natal chart for Lionel Messi, with each placement explained.",
    ctr: 0.028,
  },
} as const;

describe("buildDraftPrompt", () => {
  it("names both pages and both rates so the model reasons from evidence", () => {
    const prompt = buildDraftPrompt(INPUT);

    expect(prompt).toContain(INPUT.subject.page);
    expect(prompt).toContain(INPUT.comparable.page);
    expect(prompt).toContain(INPUT.comparable.title);
    expect(prompt).toContain(INPUT.query);
  });

  it("tells the model it is copying a wording pattern, not diagnosing", () => {
    // The tool does not know why the CTR is low. A prompt that asks the model
    // to explain would produce a confident cause the evidence cannot support.
    const prompt = buildDraftPrompt(INPUT).toLowerCase();

    expect(prompt).toContain("pattern");
    expect(prompt).toMatch(/do not (explain|claim|diagnose)/);
  });

  it("states the length limits the validator will enforce", () => {
    const prompt = buildDraftPrompt(INPUT);

    expect(prompt).toContain(String(MAX_DRAFT_TITLE_CHARS));
    expect(prompt).toContain(String(MAX_DRAFT_META_CHARS));
  });
});

describe("validateDraft", () => {
  const good = JSON.stringify({
    title: "Lamine Yamal's Birth Chart: Sign, Placements, and Meaning",
    metaDescription:
      "Lamine Yamal's full natal chart, with each placement explained in plain language.",
  });

  it("accepts a well-formed draft", () => {
    const result = validateDraft(good);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toContain("Birth Chart");
  });

  it("rejects a draft that promises an outcome", () => {
    // This is the guard that matters. The engine cannot know whether a
    // rewrite will do anything, so a draft that says it will is the tool
    // making a claim its own limitations section disowns three screens down.
    for (const claim of [
      "This title will increase your CTR by 40%",
      "Guaranteed to rank higher",
      "Boost your clicks with this proven headline",
      "这个标题保证提升排名",
    ]) {
      const result = validateDraft(
        JSON.stringify({ title: claim, metaDescription: "ok" }),
      );
      expect(result.ok, claim).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("promises_outcome");
    }
  });

  it("rejects an over-long title or description", () => {
    const longTitle = validateDraft(
      JSON.stringify({
        title: "x".repeat(MAX_DRAFT_TITLE_CHARS + 1),
        metaDescription: "ok",
      }),
    );
    expect(longTitle.ok).toBe(false);
    if (!longTitle.ok) expect(longTitle.reason).toBe("too_long");

    const longMeta = validateDraft(
      JSON.stringify({
        title: "ok",
        metaDescription: "x".repeat(MAX_DRAFT_META_CHARS + 1),
      }),
    );
    expect(longMeta.ok).toBe(false);
    if (!longMeta.ok) expect(longMeta.reason).toBe("too_long");
  });

  it("rejects empty or whitespace-only fields", () => {
    for (const body of [
      { title: "", metaDescription: "ok" },
      { title: "ok", metaDescription: "   " },
    ]) {
      const result = validateDraft(JSON.stringify(body));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("empty");
    }
  });

  it("rejects anything that is not the expected JSON shape", () => {
    for (const raw of [
      "not json at all",
      "[]",
      "null",
      JSON.stringify({ title: 42, metaDescription: "ok" }),
      JSON.stringify({ title: "ok" }),
    ]) {
      const result = validateDraft(raw);
      expect(result.ok, raw).toBe(false);
      if (!result.ok) expect(result.reason).toBe("unparseable");
    }
  });

  it("tolerates a model that wrapped its JSON in a code fence", () => {
    const result = validateDraft("```json\n" + good + "\n```");

    expect(result.ok).toBe(true);
  });

  it("trims surrounding whitespace rather than rejecting on it", () => {
    const result = validateDraft(
      JSON.stringify({ title: "  Fine Title  ", metaDescription: " Fine. " }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe("Fine Title");
    expect(result.metaDescription).toBe("Fine.");
  });
});
