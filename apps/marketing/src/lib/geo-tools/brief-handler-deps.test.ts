import { expect, it } from "vitest";
import { listFrozenVersions } from "./brief-handler-deps.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";

it("keeps all immutable snapshots of one KB in the Brief selector", async () => {
  const result = await listFrozenVersions("owner", async () => ({ kind: "ok", value: [1, 2].map(revision => ({ host: "fixture.example", snapshot: { ...SHARED_FROZEN, snapshotId: `snapshot-${revision}`, revision } })) }));
  expect(result.kind).toBe("ok");
  if (result.kind === "ok") expect(result.value.map(item => item.snapshotId)).toEqual(["snapshot-1", "snapshot-2"]);
});
it("does not hide a failed frozen history read behind an empty no-frozen state", async () => {
  expect((await listFrozenVersions("owner", async () => ({ kind: "unavailable", reason: "failed" }))).kind).toBe("unavailable");
});
