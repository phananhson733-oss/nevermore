import { describe, it, expect } from "vitest";
import { handleGeoKbSaveDraft, handleGeoKbFreeze } from "../src/lib/geo-tools/kb-handler.ts";
import { createGeoProfileCopy } from "../src/lib/geo-tools/kb-profile-copy.ts";
import { buildGeoProfileSuggestions, applyGeoProfileSuggestions } from "../src/lib/geo-tools/kb-profile-suggestions.ts";
import { createVisibilityProfileUpdateFixture, PROFILE_UPDATE_FROZEN } from "./ai-visibility-profile-update-fixture.ts";

const request = (path: string, body: unknown) => new Request(`http://127.0.0.1/api/tools/geo-knowledge-base/${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
describe("source-update browser fixture", () => {
  it("uses real draft/freeze guards and keeps frozen v1 immutable through explicit v2 adoption", async () => {
    const state = createVisibilityProfileUpdateFixture(), fixture = state.fixture;
    const copied = { ...fixture.view().payload, profileCopy: createGeoProfileCopy(state.reference, state.sourceProfile) };
    const payload = applyGeoProfileSuggestions(copied, buildGeoProfileSuggestions(state.sourceProfile, copied), { fields: ["officialName", "categoryTerms"], competitorIndices: null });
    const saved = await handleGeoKbSaveDraft(request("draft", { kbId: fixture.frozen.kbId, baseVersion: 1, payload, expectedProfileReference: state.reference }), fixture.kbDependencies);
    expect(saved.status).toBe(200);
    expect(state.savedPayloads).toHaveLength(1);
    expect(fixture.providerCalls).toBe(0);
    const view = fixture.view();
    const frozen = await handleGeoKbFreeze(request("freeze", { kbId: view.kbId, baseVersion: view.draftVersion, contextHash: view.context!.contentHash }), fixture.kbDependencies);
    expect(frozen.status).toBe(200);
    expect(fixture.frozen.snapshotId).toBe(PROFILE_UPDATE_FROZEN);
    expect(fixture.frozen.payload.profileCopy!.snapshotRevision).toBe("2");
    expect(fixture.frozen.questionSet.questions.some(question => question.text.includes("business intelligence"))).toBe(true);
    expect(JSON.stringify(state.oldFrozen)).toBe(state.oldBytes);
    expect(fixture.providerCalls).toBe(0);
    const report = await fixture.run(["chatgpt"], 3);
    expect(report.manifest.snapshotRevision).toBe(2);
    expect(report.manifest.questionSetHash).toBe(fixture.frozen.questionSetHash);
    expect(JSON.stringify(state.oldFrozen)).toBe(state.oldBytes);
  });
});
