import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), frozen: vi.fn(), history: vi.fn() }));
vi.mock("./kb-store.ts", () => ({ listGeoKnowledgeBases: mocks.list, readFrozenGeoKb: mocks.frozen }));
vi.mock("./kb-history.ts", () => ({ listFrozenGeoKbVersions: mocks.history }));
import { DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES } from "./visibility-handler-deps.ts";
describe("frozen choice read integrity", () => {
  it.each(["missing", "unavailable", "invalid"])("does not disguise a declared frozen snapshot's %s read as an empty account", async (kind) => {
    mocks.list.mockResolvedValue({ kind: "ok", value: [{ kbId: "kb-1", host: "acme.test", frozen: { snapshotId: "snapshot-1", revision: 1 } }] });
    mocks.frozen.mockResolvedValue({ kind });
    mocks.history.mockResolvedValue({ kind });
    expect((await DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES.listFrozen("owner")).kind).toBe("unavailable");
  });
  it("exposes separate exact snapshot choices for historical versions of the same owned KB", async () => {
    const snapshot = { kbId: "kb-1", snapshotId: "snapshot-1", revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", questionSet: { language: "en", country: "US", questions: [{ mode: "retrieval" }] } };
    mocks.history.mockResolvedValue({ kind: "ok", value: [{ host: "acme.test", snapshot }, { host: "acme.test", snapshot: { ...snapshot, snapshotId: "snapshot-2", revision: 2 } }] });
    const read = await DEFAULT_VISIBILITY_HANDLER_DEPENDENCIES.listFrozen("owner");
    expect(read).toMatchObject({ kind: "ok", value: [{ kbId: "kb-1", snapshotId: "snapshot-1", revision: 1 }, { kbId: "kb-1", snapshotId: "snapshot-2", revision: 2 }] });
    expect(mocks.history).toHaveBeenCalledWith({ userId: "owner" });
  });
});
