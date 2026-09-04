import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { PROFILE_REFRESH_REASONS } from "../account-websites/refresh-error.ts";

// next-intl renders a missing key as its own path instead of throwing, so an
// enum value without a message ships as "tools.geoKnowledgeBase.editor.deliveries.x".
const HOLDS = ["conflict", "copyStale", "running"] as const;
const DELIVERIES = ["not_attempted", "response_received", "outcome_unknown"] as const;
const GENERATION_STATES = ["claimed", "dispatched", "succeeded", "failed", "uncertain", "unknown", "not_found"] as const;

describe.each([["en", en], ["zh", zh]] as const)("every enum the GEO editor renders has a message in %s", (_locale, messages) => {
  const geo = messages.tools.geoKnowledgeBase;
  it("names every refresh reason", () => { for (const reason of PROFILE_REFRESH_REASONS) expect(messages.account.websites.editor.refreshErrors[reason]).toEqual(expect.any(String)); });
  it("names every autosave hold, delivery and generation state", () => {
    for (const hold of HOLDS) expect(geo.editor.autosaveHeld[hold]).toEqual(expect.any(String));
    for (const delivery of DELIVERIES) expect(geo.editor.deliveries[delivery]).toEqual(expect.any(String));
    for (const state of GENERATION_STATES) expect(geo.editor.generationStates[state]).toEqual(expect.any(String));
  });
});
