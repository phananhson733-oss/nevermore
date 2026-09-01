import { describe, expect, it, vi } from "vitest";
import { freezeGeoKbWithContext } from "./kb-freeze-context.ts";
import { buildGeoSnapshotContext } from "./snapshot-context.ts";
import { CONTEXT_KB_ID, CONTEXT_PROFILE, contextPayload, contextReceipt } from "./snapshot-context.test-fixtures.ts";
import { createHash } from "node:crypto";
import { canonicalProfileJson, emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";
import type { GeoKbPayload } from "./kb-contract.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "11111111-1111-4111-8111-111111111118";
function fixture() {
  const payload: GeoKbPayload = { ...contextPayload(), roles: [] };
  const { context, questionSet } = buildGeoSnapshotContext({ kbId: CONTEXT_KB_ID, targetHost: "example.com", payload, profile: null, receipt: null });
  const readDraft = vi.fn(async () => ({ kind: "ok" as const, value: { payload, draftVersion: 2, contentHash: context.payloadHash, targetHost: "example.com" } }));
  const callRpc = vi.fn(async () => ({ data: [{ outcome: "frozen", snapshot_id: SNAPSHOT, revision: 1, content_hash: context.payloadHash, frozen_at: "2026-08-31T00:00:00.000Z", reused_existing: false }], error: null }));
  return { input: { userId: USER, kbId: CONTEXT_KB_ID, baseVersion: 2, context, questionSet }, deps: { readDraft, callRpc } };
}
describe("source-conditioned freeze admission", () => {
  it("refuses a validly hashed context for different Profile content than the saved complete copy", async () => {
    const { input, deps } = fixture();
    const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", coreFeatures: ["Reporting"], country: "US", locale: "en" };
    const copy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: USER, snapshotId: SNAPSHOT, snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") }, profile);
    const payload = { ...contextPayload(), profileCopy: copy };
    const generated = buildGeoSnapshotContext({ kbId: CONTEXT_KB_ID, targetHost: "example.com", payload, profile: { ...inheritedProfileFromCopy(copy), productName: "Other source" }, receipt: null });
    deps.readDraft.mockResolvedValue({ kind: "ok", value: { payload, draftVersion: 2, contentHash: generated.context.payloadHash, targetHost: "example.com" } });
    expect(await freezeGeoKbWithContext({ ...input, ...generated }, deps)).toMatchObject({ kind: "invalid", code: "context_stale" });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });
  it("freezes actual supported English role questions while ignoring an unused Chinese manual role", async () => {
    const payload = { ...contextPayload(), roles: [...contextPayload().roles, { id: "unused-manual", label: "中文手工角色", segment: "本地资料", painPoints: ["未用于提问的痛点"], decisionCriteria: [], vocabulary: [] }] };
    const generated = buildGeoSnapshotContext({ kbId: CONTEXT_KB_ID, targetHost: "example.com", payload, profile: CONTEXT_PROFILE, receipt: contextReceipt() });
    expect(generated.context.roles).toEqual(expect.arrayContaining([expect.objectContaining({ roleId: "analytics", source: "gsc" }), expect.objectContaining({ roleId: "unused-manual", source: "kb" })]));
    expect(generated.questionSet.questions.some(question => question.roleId === "analytics")).toBe(true);
    expect(generated.questionSet.questions.some(question => question.roleId === "unused-manual")).toBe(false);
    const deps = {
      readDraft: vi.fn(async () => ({ kind: "ok" as const, value: { payload, draftVersion: 2, contentHash: generated.context.payloadHash, targetHost: "example.com" } })),
      callRpc: vi.fn(async () => ({ data: [{ outcome: "frozen", snapshot_id: SNAPSHOT, revision: 1, content_hash: generated.context.payloadHash, frozen_at: "2026-08-31T00:00:00.000Z", reused_existing: false }], error: null })),
    };
    expect((await freezeGeoKbWithContext({ userId: USER, kbId: CONTEXT_KB_ID, baseVersion: 2, ...generated }, deps)).kind).toBe("ok");
    expect(deps.callRpc).toHaveBeenCalledOnce();
  });
  it("can freeze without inventing a role, while skipped layers stay absent", async () => {
    const { input, deps } = fixture();
    expect((await freezeGeoKbWithContext(input, deps)).kind).toBe("ok");
    expect(deps.callRpc).toHaveBeenCalledWith("marketing_geo_freeze_kb_with_context", expect.objectContaining({ p_context: input.context, p_question_set: input.questionSet }));
    expect(input.questionSet.questions.every((q) => q.layer !== "problem" && q.layer !== "evaluation")).toBe(true);
  });
  it("rejects stale draft versions before RPC", async () => {
    const { input, deps } = fixture();
    expect((await freezeGeoKbWithContext({ ...input, baseVersion: 1 }, deps)).kind).toBe("conflict");
    expect(deps.callRpc).not.toHaveBeenCalled();
  });
  it("does not freeze questions or context from another payload", async () => {
    const { input, deps } = fixture();
    expect((await freezeGeoKbWithContext({ ...input, questionSet: { ...input.questionSet, questions: [] } }, deps)).kind).toBe("invalid");
    expect((await freezeGeoKbWithContext({ ...input, context: { ...input.context, targetHost: "other.example" } }, deps)).kind).toBe("unavailable");
    expect(deps.callRpc).not.toHaveBeenCalled();
  });
  it("refuses a successful RPC response that names other payload bytes", async () => {
    const { input, deps } = fixture();
    deps.callRpc.mockResolvedValue({ data: [{ outcome: "frozen", snapshot_id: SNAPSHOT, revision: 1, content_hash: "b".repeat(64), frozen_at: "2026-08-31T00:00:00.000Z", reused_existing: false }], error: null });
    expect((await freezeGeoKbWithContext(input, deps)).kind).toBe("unavailable");
  });
});
