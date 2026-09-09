// @input -- offline completions and closed inputs for the image-plan seam
// @output -- proof of the closed output shape, the honest receipts and the region-tag fix
// @pos -- unit tests for content-draft-v2-images; no network, no real provider
import { IMAGE_ALT_MAX_CHARS, IMAGE_PROMPT_MAX_CHARS, IMAGE_PROMPTS_TIMEOUT_MS } from "@sf/public-tools/content-brief/constants";
import { describe, expect, it, vi } from "vitest";
import { buildDraftV2ImagePromptsSystemPrompt, buildDraftV2ImagePromptsUserPrompt, parseModelImagePromptsShape, runDraftV2ImagePrompts, type DraftV2ImagePromptsInput } from "./content-draft-v2-images.ts";
import { KeywordLlmError, type KeywordLlmConfig, type KeywordLlmRequest } from "./keyword-llm-client.ts";
import { SITE_CONTENT_CLOSE, SITE_CONTENT_OPEN } from "./keyword-prompts.ts";

const NOW = Date.parse("2026-08-31T03:00:00.000Z");
const CONFIG: KeywordLlmConfig = { apiKey: "offline-test", model: "offline-model", url: "https://offline.invalid", authScheme: "bearer", temperature: null };
const input: DraftV2ImagePromptsInput = {
  primary: "birth chart", language: "en", tone: "explanatory",
  outline: [{ id: "O1", h2: "Birth Chart Basics", h3: [] }, { id: "O2", h2: "Creating a Birth Chart", h3: ["Information to Enter"] }],
  sections: [
    { id: "O1", h2: "Birth Chart Basics", excerpt: "A birth chart is a map based on your date, time and place of birth." },
    { id: "O2", h2: "Creating a Birth Chart", excerpt: "Enter the birth month, date and year; the time; and the place." },
  ],
  deadlineAt: NOW + 60_000,
};
const good = { hero: { prompt: "Wide editorial illustration of a night sky over a quiet desk, soft lamplight, no text.", alt: "A desk under a starry sky." }, sections: [
  { section_id: "O1", prompt: "Flat vector of a circular star map on paper, muted palette, no text.", alt: "A round star map on paper." },
  { section_id: "O2", prompt: "Flat vector of a blank form and a pencil, warm light, no text.", alt: "A form and a pencil." },
] };
const ids = ["O1", "O2"];

describe("image plan output shape", () => {
  it("accepts exactly the listed sections in order and normalises whitespace", () => {
    const parsed = parseModelImagePromptsShape(JSON.stringify({ ...good, hero: { ...good.hero, prompt: "  Wide   editorial\n illustration  " } }), ids);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.hero.prompt).toBe("Wide editorial illustration");
  });
  it.each([
    ["an extra root key", { ...good, notes: "x" }, ""],
    ["a missing hero key", { ...good, hero: { prompt: "p" } }, "hero"],
    ["sections out of order", { ...good, sections: [...good.sections].reverse() }, "sections[0]"],
    ["a missing section", { ...good, sections: good.sections.slice(0, 1) }, "sections"],
    ["an invented section", { ...good, sections: [...good.sections, { section_id: "O3", prompt: "p", alt: "a" }] }, "sections"],
    ["an overlong prompt", { ...good, hero: { ...good.hero, prompt: "x".repeat(IMAGE_PROMPT_MAX_CHARS + 1) } }, "hero"],
    ["an overlong alt", { ...good, hero: { ...good.hero, alt: "x".repeat(IMAGE_ALT_MAX_CHARS + 1) } }, "hero"],
    ["an empty prompt", { ...good, hero: { ...good.hero, prompt: "   " } }, "hero"],
    ["a non-string alt", { ...good, hero: { ...good.hero, alt: 3 } }, "hero"],
  ])("refuses %s", (_label, body, path) => {
    const parsed = parseModelImagePromptsShape(JSON.stringify(body), ids);
    expect(parsed).toEqual({ ok: false, path });
  });
  it("refuses non-JSON", () => {
    expect(parseModelImagePromptsShape("hero: none", ids)).toEqual({ ok: false, path: "" });
  });
});

describe("image plan prompts", () => {
  it("fences the article as data and truncates long excerpts", () => {
    const system = buildDraftV2ImagePromptsSystemPrompt();
    expect(system).toContain("TRUST BOUNDARY");
    expect(system).toContain("Never put words, letters, numbers, labels, charts, logos, brand marks, watermarks or user-interface screenshots in the image");
    expect(system).toContain("Write every prompt in English, whatever the article language");
    const long = { ...input, sections: [{ ...input.sections[0]!, excerpt: "word ".repeat(200) }] };
    const user = JSON.parse(buildDraftV2ImagePromptsUserPrompt(long)) as { article: string; article_end: string; sections: { excerpt: string }[]; language: { code: string; name: string } };
    expect(user.article).toBe(SITE_CONTENT_OPEN);
    expect(user.article_end).toBe(SITE_CONTENT_CLOSE);
    expect(Array.from(user.sections[0]!.excerpt).length).toBeLessThanOrEqual(321);
    expect(user.sections[0]!.excerpt.endsWith("…")).toBe(true);
    expect(user.language).toEqual({ code: "en", name: "English" });
  });
  it("carries a region tag as its canonical locale with the base-language name", () => {
    const user = JSON.parse(buildDraftV2ImagePromptsUserPrompt({ ...input, language: "zh-Hant-TW" })) as { language: { code: string; name: string } };
    expect(user.language).toEqual({ code: "zh-Hant-TW", name: "Chinese" });
  });
});

describe("image plan seam", () => {
  const client = (content: string) => ({ complete: vi.fn(async (_request: KeywordLlmRequest) => ({ content, modelId: "offline-image", usage: { requestCount: 1, retryCount: 0, inputTokens: 60, outputTokens: 40 } })) });

  it("returns an available plan with a complete read", async () => {
    const offline = client(JSON.stringify(good));
    const plan = await runDraftV2ImagePrompts(input, { config: CONFIG, now: () => NOW, client: offline });
    expect(plan).toMatchObject({ status: "available", hero: good.hero, read: { status: "complete", calls: 1, model_id: "offline-image", temperature_requested: 0, input_tokens: 60, output_tokens: 40 } });
    expect(offline.complete.mock.calls[0]![0]).toMatchObject({ temperature: 0, timeoutMs: IMAGE_PROMPTS_TIMEOUT_MS });
  });
  it("makes no call with nothing to illustrate", async () => {
    const offline = client(JSON.stringify(good));
    const plan = await runDraftV2ImagePrompts({ ...input, sections: [] }, { config: CONFIG, now: () => NOW, client: offline });
    expect(plan).toMatchObject({ status: "unavailable", reason: "insufficient_evidence", read: { calls: 0, attempted: 0 } });
    expect(offline.complete).not.toHaveBeenCalled();
  });
  it("makes no call when unconfigured or out of budget", async () => {
    const offline = client(JSON.stringify(good));
    expect(await runDraftV2ImagePrompts(input, { config: null, client: offline })).toMatchObject({ status: "unavailable", reason: "not_configured" });
    expect(await runDraftV2ImagePrompts({ ...input, deadlineAt: NOW }, { config: CONFIG, now: () => NOW, client: offline })).toMatchObject({ status: "unavailable", reason: "timeout", read: { calls: 0 } });
    expect(offline.complete).not.toHaveBeenCalled();
  });
  it("reports a billed but unanswered call as attempted", async () => {
    const failing = { complete: vi.fn(async () => { throw new KeywordLlmError("timeout", "slow", { requestCount: 1, retryCount: 0, inputTokens: 55, outputTokens: null }); }) };
    const plan = await runDraftV2ImagePrompts(input, { config: CONFIG, now: () => NOW, client: failing });
    expect(plan).toMatchObject({ status: "unavailable", reason: "timeout", read: { status: "unavailable", attempted: 1, calls: 1, input_tokens: 55 } });
  });
  it("keeps the receipt and the model id when the reply fails the shape", async () => {
    const plan = await runDraftV2ImagePrompts(input, { config: CONFIG, now: () => NOW, client: client(JSON.stringify({ ...good, sections: [] })) });
    expect(plan).toMatchObject({ status: "unavailable", reason: "validation_failed", read: { status: "unavailable", attempted: 1, calls: 1, model_id: "offline-image", output_tokens: 40 } });
  });
  it("refuses a language no draft seam supports", async () => {
    const offline = client(JSON.stringify(good));
    expect(await runDraftV2ImagePrompts({ ...input, language: "tlh" }, { config: CONFIG, now: () => NOW, client: offline })).toMatchObject({ status: "unavailable", reason: "unsupported_language" });
    expect(offline.complete).not.toHaveBeenCalled();
  });
});
