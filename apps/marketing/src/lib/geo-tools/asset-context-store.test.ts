import { describe, expect, it, vi } from "vitest";
import { readGeoSnapshotContext, readLatestGeoEnrichmentReceipt, persistGeoEnrichmentReceipt, type GeoContextStoreDependencies } from "./asset-context-store.ts";
import { buildGeoSnapshotContext } from "./snapshot-context.ts";
import { CONTEXT_KB_ID, CONTEXT_PROFILE, contextPayload, contextReceipt } from "./snapshot-context.test-fixtures.ts";

const USER = "a1111111-1111-4111-8111-111111111111";
const SNAPSHOT = "11111111-1111-4111-8111-111111111118";
function deps() {
  const { context } = buildGeoSnapshotContext({ kbId: CONTEXT_KB_ID, targetHost: "example.com", payload: contextPayload(), profile: CONTEXT_PROFILE, receipt: contextReceipt() });
  const receipt = contextReceipt();
  const dependencies: GeoContextStoreDependencies = {
    readSnapshot: vi.fn(async () => ({ data: { id: SNAPSHOT, user_id: USER, kb_id: CONTEXT_KB_ID, content_hash: context.payloadHash, question_set_hash: context.questionSetHash, context_hash: context.contentHash }, error: null })),
    readContext: vi.fn(async () => ({ data: { snapshot_id: SNAPSHOT, user_id: USER, kb_id: CONTEXT_KB_ID, content_hash: context.contentHash, context }, error: null })),
    readReceipt: vi.fn(async () => ({ data: { id: receipt.receiptId, user_id: USER, kb_id: CONTEXT_KB_ID, content_hash: receipt.contentHash, report: receipt }, error: null })),
    callRpc: vi.fn(async () => ({ data: [{ outcome: "recorded" }], error: null })),
  };
  return { dependencies, context, receipt };
}
describe("owner-scoped immutable GEO source reads", () => {
  it("canonicalizes accepted UUID spelling before owner-scoped reads", async () => {
    const { dependencies, context } = deps();
    expect(await readGeoSnapshotContext({ userId: USER.toUpperCase(), kbId: CONTEXT_KB_ID, snapshotId: SNAPSHOT }, dependencies)).toEqual({ kind: "ok", value: context });
    expect((await readLatestGeoEnrichmentReceipt({ userId: USER.toUpperCase(), kbId: CONTEXT_KB_ID }, dependencies)).kind).toBe("ok");
  });
  it("returns context only after both row identities and snapshot hashes agree", async () => {
    const { dependencies, context } = deps();
    expect(await readGeoSnapshotContext({ userId: USER, kbId: CONTEXT_KB_ID, snapshotId: SNAPSHOT }, dependencies)).toEqual({ kind: "ok", value: context });
    expect(dependencies.readSnapshot).toHaveBeenCalledWith(USER, CONTEXT_KB_ID, SNAPSHOT);
    expect(dependencies.readContext).toHaveBeenCalledWith(USER, CONTEXT_KB_ID, SNAPSHOT);
  });
  it("treats legacy null context as absent but does not substitute latest Profile", async () => {
    const { dependencies, context } = deps();
    vi.mocked(dependencies.readSnapshot).mockResolvedValue({ data: { id: SNAPSHOT, user_id: USER, kb_id: CONTEXT_KB_ID, content_hash: context.payloadHash, question_set_hash: context.questionSetHash, context_hash: null }, error: null });
    expect(await readGeoSnapshotContext({ userId: USER, kbId: CONTEXT_KB_ID, snapshotId: SNAPSHOT }, dependencies)).toEqual({ kind: "ok", value: null });
    expect(dependencies.readContext).not.toHaveBeenCalled();
  });
  it("does not turn a missing required context or database failure into a legacy null", async () => {
    const { dependencies } = deps();
    vi.mocked(dependencies.readContext).mockResolvedValue({ data: null, error: null });
    expect((await readGeoSnapshotContext({ userId: USER, kbId: CONTEXT_KB_ID, snapshotId: SNAPSHOT }, dependencies)).kind).toBe("unavailable");
    vi.mocked(dependencies.readSnapshot).mockResolvedValue({ data: null, error: { code: "unavailable" } });
    expect((await readGeoSnapshotContext({ userId: USER, kbId: CONTEXT_KB_ID, snapshotId: SNAPSHOT }, dependencies)).kind).toBe("unavailable");
  });
  it("rejects another owner's otherwise valid receipt", async () => {
    const { dependencies, receipt } = deps();
    vi.mocked(dependencies.readReceipt).mockResolvedValue({ data: { id: receipt.receiptId, user_id: "other", kb_id: CONTEXT_KB_ID, content_hash: receipt.contentHash, report: receipt }, error: null });
    expect((await readLatestGeoEnrichmentReceipt({ userId: USER, kbId: CONTEXT_KB_ID }, dependencies)).kind).toBe("unavailable");
  });
  it("detects changed report bytes and never promotes the browser's source labels", async () => {
    const { dependencies, receipt } = deps();
    vi.mocked(dependencies.readReceipt).mockResolvedValue({ data: { id: receipt.receiptId, user_id: USER, kb_id: CONTEXT_KB_ID, content_hash: receipt.contentHash, report: { ...receipt, targetHost: "other.example" } }, error: null });
    expect((await readLatestGeoEnrichmentReceipt({ userId: USER, kbId: CONTEXT_KB_ID }, dependencies)).kind).toBe("unavailable");
  });
  it("persists only a valid server receipt through the dedicated RPC", async () => {
    const { dependencies, receipt } = deps();
    expect(await persistGeoEnrichmentReceipt({ userId: USER, report: receipt }, dependencies)).toEqual({ kind: "ok" });
    expect(dependencies.callRpc).toHaveBeenCalledWith("marketing_geo_record_enrichment", { p_user_id: USER, p_kb_id: CONTEXT_KB_ID, p_receipt_id: receipt.receiptId, p_report: receipt });
    expect(await persistGeoEnrichmentReceipt({ userId: USER, report: { ...receipt, targetHost: "other.example" } }, dependencies)).toEqual({ kind: "unavailable" });
    expect(dependencies.callRpc).toHaveBeenCalledTimes(1);
  });
});
