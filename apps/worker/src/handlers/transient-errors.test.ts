import { describe, expect, it } from "vitest";
import {
  BlobObjectAlreadyExistsError,
  SupabaseStorageError,
} from "@sf/sources";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "./transient-errors.ts";

describe("transient infrastructure classification", () => {
  it("recognizes retry-safe database, runtime, nested, and storage failures", () => {
    expect(
      isTransientInfrastructureError(
        Object.assign(new Error("serialization"), { code: "40001" }),
      ),
    ).toBe(true);
    expect(
      isTransientInfrastructureError(
        Object.assign(new Error("connection"), { code: "08006" }),
      ),
    ).toBe(true);
    expect(
      isTransientInfrastructureError(
        new Error("outer", {
          cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }),
        }),
      ),
    ).toBe(true);
    expect(
      isTransientInfrastructureError(
        new SupabaseStorageError("put", "export/project/run/id", {
          status: 429,
        }),
      ),
    ).toBe(true);
    expect(
      isTransientInfrastructureError(
        new BlobObjectAlreadyExistsError("export/project/run/id"),
      ),
    ).toBe(true);
  });

  it("does not retry permanent or cyclic unknown failures", () => {
    expect(
      isTransientInfrastructureError(
        new SupabaseStorageError("put", "export/project/run/id", {
          status: 400,
        }),
      ),
    ).toBe(false);
    const cyclic = new Error("unknown") as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    expect(isTransientInfrastructureError(cyclic)).toBe(false);
    expect(isTransientInfrastructureError("opaque")).toBe(false);
  });

  it("returns stable storage and database log codes", () => {
    expect(
      transientFailureCode(
        new SupabaseStorageError("put", "export/project/run/id"),
      ),
    ).toBe("STORAGE_NETWORK");
    expect(
      transientFailureCode(
        new SupabaseStorageError("put", "export/project/run/id", {
          status: 408,
        }),
      ),
    ).toBe("STORAGE_TIMEOUT");
    expect(
      transientFailureCode(
        new SupabaseStorageError("put", "export/project/run/id", {
          status: 503,
        }),
      ),
    ).toBe("STORAGE_UNAVAILABLE");
    expect(
      transientFailureCode(
        new BlobObjectAlreadyExistsError("export/project/run/id"),
      ),
    ).toBe("STORAGE_COLLISION");
    expect(
      transientFailureCode(
        Object.assign(new Error("deadlock"), { code: "40p01" }),
      ),
    ).toBe("40P01");
    expect(transientFailureCode(new Error("unknown"))).toBe(
      "INFRASTRUCTURE_UNAVAILABLE",
    );
  });
});
