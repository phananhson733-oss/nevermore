import { describe, expect, it } from "vitest";
import { isPostgresUniqueViolation } from "./db-errors";

describe("isPostgresUniqueViolation", () => {
  it("recognizes top-level and wrapped PostgreSQL unique violations", () => {
    expect(isPostgresUniqueViolation({ code: "23505" })).toBe(true);
    expect(
      isPostgresUniqueViolation({
        cause: { cause: { code: "23505" } },
      }),
    ).toBe(true);
  });

  it("optionally requires the exact PostgreSQL constraint", () => {
    const wrapped = {
      code: "23505",
      cause: {
        code: "23505",
        constraint: "source_connections_one_active_provider_idx",
      },
    };
    expect(
      isPostgresUniqueViolation(
        wrapped,
        "source_connections_one_active_provider_idx",
      ),
    ).toBe(true);
    expect(
      isPostgresUniqueViolation(wrapped, "a_different_unique_constraint"),
    ).toBe(false);
    expect(
      isPostgresUniqueViolation(
        {
          constraint: "source_connections_one_active_provider_idx",
          cause: { code: "23505" },
        },
        "source_connections_one_active_provider_idx",
      ),
    ).toBe(false);
  });

  it("rejects other errors and stops on cyclic cause chains", () => {
    expect(isPostgresUniqueViolation({ code: "23503" })).toBe(false);
    expect(isPostgresUniqueViolation(null)).toBe(false);
    expect(isPostgresUniqueViolation("23505")).toBe(false);

    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isPostgresUniqueViolation(cyclic)).toBe(false);
  });

  it("never reads or stringifies message, stack, or toString", () => {
    const inner = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(inner, {
      code: { value: "23505" },
      message: {
        get: () => {
          throw new Error("message must not be read");
        },
      },
      stack: {
        get: () => {
          throw new Error("stack must not be read");
        },
      },
      toString: {
        get: () => {
          throw new Error("toString must not be read");
        },
      },
    });

    expect(isPostgresUniqueViolation({ cause: inner })).toBe(true);
  });

  it("survives hostile property getters and bounds cause traversal", () => {
    const hostileCode = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(hostileCode, {
      code: {
        get: () => {
          throw new Error("hostile code getter");
        },
      },
      cause: { value: { code: "23505" } },
    });
    expect(() => isPostgresUniqueViolation(hostileCode)).not.toThrow();
    expect(isPostgresUniqueViolation(hostileCode)).toBe(true);

    let causeReads = 0;
    const endlessNode = (): object =>
      new Proxy(Object.create(null) as object, {
        get: (_target, property) => {
          if (property === "code") return undefined;
          if (property === "cause") {
            causeReads += 1;
            return endlessNode();
          }
          throw new Error("unexpected property read");
        },
      });
    const endless = endlessNode();
    expect(isPostgresUniqueViolation(endless)).toBe(false);
    expect(causeReads).toBe(8);

    const hostileCause = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(hostileCause, "cause", {
      get: () => {
        throw new Error("hostile cause getter");
      },
    });
    expect(() => isPostgresUniqueViolation(hostileCause)).not.toThrow();
    expect(isPostgresUniqueViolation(hostileCause)).toBe(false);
  });
});
