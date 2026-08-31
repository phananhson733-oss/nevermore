import { describe, expect, it } from "vitest";
import { parseConfirmedBriefV2 } from "./v2-brief.ts";
import { confirmedDraftV2Fixture, draftResultV2Fixture } from "./v2-draft-fixtures.ts";
import { parseDraftResultV2 } from "./v2-draft.ts";

describe("real confirmed Draft v2 fixtures", () => {
  it.each([{ action: "create" as const }, { action: "update" as const }, { action: "undecidable" as const }, { paaOnly: true, language: "zh-CN", reverse: true }])("validates full confirmed input %#", async (options) => {
    const confirmed = await confirmedDraftV2Fixture(options);
    expect(await parseConfirmedBriefV2(confirmed)).toEqual({ ok: true, value: confirmed });
  });

  it.each([{ action: "create" as const }, { action: "update" as const }, { paaOnly: true, language: "zh-CN", reverse: true }])("builds an exact Draft for confirmed fixture %#", async (options) => {
    const confirmed = await confirmedDraftV2Fixture(options);
    const draft = await draftResultV2Fixture(confirmed);
    expect(await parseDraftResultV2(draft, confirmed)).toEqual({ ok: true, value: draft });
  });
});
