import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  serializeDbProcessFailure,
  type DbProcessBoundary,
} from "./runtime-failure.ts";

const FAILURE_CASES = [
  [
    "migrate",
    '{"event":"db_migrate_failed","code":"DB_MIGRATE_FAILED","type":"internal"}',
    '{"event":"db_migrate_failed","code":"DB_MIGRATE_FAILED","type":"unknown"}',
  ],
  [
    "migrate-check",
    '{"event":"db_migrate_check_failed","code":"DB_MIGRATE_CHECK_FAILED","type":"internal"}',
    '{"event":"db_migrate_check_failed","code":"DB_MIGRATE_CHECK_FAILED","type":"unknown"}',
  ],
  [
    "smoke",
    '{"event":"db_smoke_failed","code":"DB_SMOKE_FAILED","type":"internal"}',
    '{"event":"db_smoke_failed","code":"DB_SMOKE_FAILED","type":"unknown"}',
  ],
] as const satisfies ReadonlyArray<
  readonly [DbProcessBoundary, string, string]
>;

describe("serializeDbProcessFailure", () => {
  it.each(FAILURE_CASES)(
    "%s omits a normal Error message containing customer data",
    (boundary, expectedInternal) => {
      const line = serializeDbProcessFailure(
        boundary,
        new Error("customer-content-secret"),
      );

      expect(line).toBe(expectedInternal);
      expect(line).not.toContain("customer-content-secret");
    },
  );

  it.each(FAILURE_CASES)(
    "%s does not read an Error message getter",
    (boundary, expectedInternal) => {
      let messageReads = 0;
      const error = new Error();
      Object.defineProperty(error, "message", {
        configurable: true,
        get() {
          messageReads += 1;
          throw new Error("message getter must not execute");
        },
      });

      const line = serializeDbProcessFailure(boundary, error);

      expect(messageReads).toBe(0);
      expect(line).toBe(expectedInternal);
    },
  );

  it.each(FAILURE_CASES)(
    "%s does not coerce a hostile non-Error value",
    (boundary, _expectedInternal, expectedUnknown) => {
      let toStringCalls = 0;
      const hostile = {
        message: "customer-content-secret",
        detail: "customer-content-secret",
        internalQuery: "SELECT customer-content-secret",
        input: "customer-content-secret",
        toString() {
          toStringCalls += 1;
          throw new Error("toString must not execute");
        },
      };

      const line = serializeDbProcessFailure(boundary, hostile);

      expect(toStringCalls).toBe(0);
      expect(line).toBe(expectedUnknown);
      expect(line).not.toContain("customer-content-secret");
    },
  );
});

describe("database CLI failure wiring", () => {
  it.each([
    ["migrate.ts", "migrate"],
    ["migrate-check.ts", "migrate-check"],
    ["smoke.ts", "smoke"],
  ] as const)("routes %s through the fixed %s failure boundary", (file, boundary) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");

    expect(source).toContain(
      `console.error(serializeDbProcessFailure("${boundary}", error))`,
    );
    expect(source).not.toMatch(/console\.error\s*\(\s*error\s*\)/u);
    expect(source).not.toMatch(
      /\berror\.(?:message|stack|detail|internalQuery|input)\b/u,
    );
    expect(source).not.toMatch(/\b(?:String|JSON\.stringify)\s*\(\s*error\s*\)/u);
  });

});
