import { describe, expect, it } from "vitest";
import {
  runtimeFailureMetadata,
  serializeWorkerBootFailure,
} from "./runtime-failure.ts";

describe("runtimeFailureMetadata", () => {
  it("classifies Error instances without copying attacker-controlled fields", () => {
    const failure = runtimeFailureMetadata(
      "UNAVAILABLE",
      new Error("customer-content-secret"),
    );

    expect(failure).toEqual({ code: "UNAVAILABLE", type: "internal" });
    expect(JSON.stringify(failure)).not.toContain("customer-content-secret");
  });

  it("classifies opaque thrown values without coercing them to strings", () => {
    const failure = runtimeFailureMetadata("UNAVAILABLE", {
      message: "customer-content-secret",
      toString: () => "customer-content-secret",
    });

    expect(failure).toEqual({ code: "UNAVAILABLE", type: "unknown" });
    expect(JSON.stringify(failure)).not.toContain("customer-content-secret");
  });
});

describe("serializeWorkerBootFailure", () => {
  it("does not read an Error message getter while formatting the boot log", () => {
    let messageReads = 0;
    const error = new Error();
    Object.defineProperty(error, "message", {
      configurable: true,
      get() {
        messageReads += 1;
        throw new Error("message getter must not execute");
      },
    });

    const line = serializeWorkerBootFailure(error);

    expect(messageReads).toBe(0);
    expect(line).toBe(
      '{"event":"worker_boot_failed","code":"WORKER_BOOT_FAILED","type":"internal"}',
    );
  });

  it("omits a normal Error message containing customer data", () => {
    const line = serializeWorkerBootFailure(
      new Error("customer-content-secret"),
    );

    expect(line).toBe(
      '{"event":"worker_boot_failed","code":"WORKER_BOOT_FAILED","type":"internal"}',
    );
    expect(line).not.toContain("customer-content-secret");
  });

  it("does not coerce a hostile non-Error value while formatting the boot log", () => {
    let toStringCalls = 0;
    const hostile = {
      message: "customer-content-secret",
      toString() {
        toStringCalls += 1;
        throw new Error("toString must not execute");
      },
    };

    const line = serializeWorkerBootFailure(hostile);

    expect(toStringCalls).toBe(0);
    expect(line).toBe(
      '{"event":"worker_boot_failed","code":"WORKER_BOOT_FAILED","type":"unknown"}',
    );
    expect(line).not.toContain("customer-content-secret");
  });
});
