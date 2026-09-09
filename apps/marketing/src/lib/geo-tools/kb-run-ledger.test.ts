import { describe, expect, it } from "vitest";
import {
  parseGeoRunOperationRecord,
  parseGeoRunOperationRecords,
  parseGeoRunRecord,
} from "./kb-run-ledger.ts";

const V8 = "3f2b1a04-77c5-8d31-9e60-0a1b2c3d4e5f";

function operation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "marketing-geo-kb-run-operation.v1",
    key: "fetch:own:https://acme.test/",
    kind: "fetch",
    state: "not_started",
    resultRef: null,
    reason: null,
    probeCount: "0",
    startedAt: null,
    finishedAt: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "marketing-geo-kb-run.v1",
    runId: V8,
    userId: V8,
    kbId: V8,
    idempotencyKey: "run-key-000001",
    state: "running",
    generationInputHash: "a".repeat(64),
    leaseExpiresAt: "2026-09-07T12:06:00.000Z",
    createdAt: "2026-09-07T11:59:00.000Z",
    ...overrides,
  };
}

describe("reading a run record", () => {
  it("accepts the UUIDv8 identifiers this product actually mints", () => {
    // A validator that pins the RFC 4122 version nibble rejects every id here.
    expect(parseGeoRunRecord(run()).runId).toBe(V8);
  });

  it("refuses an unknown schema version rather than reading what it recognises", () => {
    expect(() => parseGeoRunRecord(run({ schemaVersion: "marketing-geo-kb-run.v2" }))).toThrow();
  });
});

describe("reading an operation record", () => {
  it("carries the count as a string, because this wire has no JSON numbers", () => {
    expect(parseGeoRunOperationRecord(operation({ probeCount: "3" })).probeCount).toBe(3);
    expect(() => parseGeoRunOperationRecord(operation({ probeCount: 3 }))).toThrow();
  });

  it("refuses a succeeded operation with nowhere to read its result", () => {
    expect(() =>
      parseGeoRunOperationRecord(
        operation({ state: "succeeded", startedAt: "2026-09-07T11:00:00.000Z", finishedAt: "2026-09-07T11:00:01.000Z" }),
      ),
    ).toThrow();
  });

  it("refuses a result reference on an operation that did not succeed", () => {
    expect(() => parseGeoRunOperationRecord(operation({ resultRef: "generation:1" }))).toThrow();
  });

  it("refuses an unknown outcome that names some other reason", () => {
    expect(() =>
      parseGeoRunOperationRecord(
        operation({
          state: "outcome_unknown",
          reason: "timeout",
          startedAt: "2026-09-07T11:00:00.000Z",
          finishedAt: "2026-09-07T11:00:01.000Z",
        }),
      ),
    ).toThrow();
  });

  it("refuses a lease on anything but a claim", () => {
    expect(() =>
      parseGeoRunOperationRecord(operation({ state: "dispatched", startedAt: "2026-09-07T11:00:00.000Z", leaseExpiresAt: "2026-09-07T12:02:00.000Z" })),
    ).toThrow();
    expect(() => parseGeoRunOperationRecord(operation({ state: "claimed" }))).toThrow();
  });

  it("refuses a key whose prefix is not its kind", () => {
    // The kind lives inside the key; a row where they disagree has an identity
    // that does not describe its work.
    expect(() => parseGeoRunOperationRecord(operation({ kind: "model" }))).toThrow();
  });

  it("refuses two rows claiming the same operation key", () => {
    expect(() => parseGeoRunOperationRecords([operation(), operation()])).toThrow();
  });
});
