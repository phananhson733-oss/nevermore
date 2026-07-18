import { describe, expect, it } from "vitest";

import type { Executor } from "../repositories/base.ts";
import { TelemetryRepository } from "../repositories/telemetry.ts";

/**
 * AC-040: telemetry `properties` must never carry raw secrets. The repository
 * deep-redacts properties before insert, so this is a pure unit test — a capture
 * fake stands in for the executor and records the row that would be inserted.
 */

// Obviously-fake credential values (secrets:scan must never flag these).
const FAKE = "Bearer FAKE-not-a-real-token";
const FAKE_NESTED = "FAKE-nested-not-a-real-token";

function captureExecutor(): {
  exec: Executor;
  rows: ReadonlyArray<Record<string, unknown>>;
} {
  const rows: Array<Record<string, unknown>> = [];
  const exec = {
    insert: () => ({
      values: (row: Record<string, unknown>): Promise<void> => {
        rows.push(row);
        return Promise.resolve();
      },
    }),
  } as unknown as Executor;
  return { exec, rows };
}

describe("TelemetryRepository.emit redaction", () => {
  it("redacts secret-named properties before insert", async () => {
    const { exec, rows } = captureExecutor();
    const repo = new TelemetryRepository(exec);

    await repo.emit({
      workspaceId: "ws-1",
      projectId: "pr-1",
      eventName: "export_ready",
      actorId: "op-1",
      properties: {
        kind: "service_bundle",
        authorization: FAKE,
        nested: { api_key: FAKE_NESTED },
      },
    });

    expect(rows).toHaveLength(1);
    const inserted = rows[0] as { properties: Record<string, unknown> };
    expect(inserted.properties).toEqual({
      kind: "service_bundle",
      authorization: "[redacted]",
      nested: { api_key: "[redacted]" },
    });

    const serialized = JSON.stringify(inserted);
    expect(serialized).not.toContain(FAKE);
    expect(serialized).not.toContain(FAKE_NESTED);
  });

  it("passes legitimate allowlisted properties through unchanged", async () => {
    const { exec, rows } = captureExecutor();
    const repo = new TelemetryRepository(exec);

    const properties = {
      kind: "service_bundle",
      itemCounts: { findings: 3, actions: 2 },
      sizeBucket: "under_1mb",
    };
    await repo.emit({
      workspaceId: "ws-1",
      projectId: "pr-1",
      eventName: "export_ready",
      actorId: "op-1",
      properties,
    });

    const inserted = rows[0] as { properties: Record<string, unknown> };
    expect(inserted.properties).toEqual(properties);
  });
});
