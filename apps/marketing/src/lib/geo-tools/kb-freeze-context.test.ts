import { describe, expect, it, vi } from "vitest";
import { freezeGeoKbWithContext } from "./kb-freeze-context.ts";
import { buildGeoSnapshotContext } from "./snapshot-context.ts";
import { CONTEXT_KB_ID, contextPayload } from "./snapshot-context.test-fixtures.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "11111111-1111-4111-8111-111111111118";
function fixture() {
  const payload = { ...contextPayload(), roles: [] };
  const { context, questionSet } = buildGeoSnapshotContext({ kbId: CONTEXT_KB_ID, targetHost: "example.com", payload, profile: null, receipt: null });
  const readDraft = vi.fn(async () => ({ kind: "ok" as const, value: { payload, draftVersion: 2, contentHash: context.payloadHash, targetHost: "example.com" } }));
  const callRpc = vi.fn(async () => ({ data: [{ outcome: "frozen", snapshot_id: SNAPSHOT, revision: 1, content_hash: context.payloadHash, frozen_at: "2026-08-31T00:00:00.000Z", reused_existing: false }], error: null }));
  return { input: { userId: USER, kbId: CONTEXT_KB_ID, baseVersion: 2, context, questionSet }, deps: { readDraft, callRpc } };
}
describe("source-conditioned freeze admission", () => {
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
