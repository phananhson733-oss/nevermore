import { Cursor } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { describe, expect, it } from "vitest";
import {
  parseOptionalOutputLocale,
  parseOptionalQueryInteger,
  parseOptionalQueryEnum,
  parseQueryBoolean,
  parseQueryLimit,
  parseQueryValue,
} from "@/lib/http/validate";

function expectQueryValidationError(
  callback: () => unknown,
  pointer: string,
): void {
  let caught: unknown;
  try {
    callback();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ProblemError);
  expect(caught).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  expect((caught as ProblemError).fieldErrors).toEqual([
    expect.objectContaining({ pointer }),
  ]);
}

describe("parseOptionalOutputLocale", () => {
  it("returns null only when outputLocale is absent", () => {
    expect(parseOptionalOutputLocale(new URLSearchParams())).toBeNull();
  });

  it.each(["en", "zh-CN", "fr-CA"])("accepts BCP 47 locale %s", (locale) => {
    expect(
      parseOptionalOutputLocale(new URLSearchParams({ outputLocale: locale })),
    ).toBe(locale);
  });

  it.each(["", "not_a_locale", "en?admin=true"])(
    "rejects malformed outputLocale %j instead of silently using the project default",
    (locale) => {
      let caught: unknown;
      try {
        parseOptionalOutputLocale(
          new URLSearchParams({ outputLocale: locale }),
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProblemError);
      expect(caught).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
      expect((caught as ProblemError).fieldErrors).toEqual([
        {
          pointer: "/outputLocale",
          code: "invalid_string",
          message: "Unsupported output locale.",
        },
      ]);
    },
  );
});

describe("strict query parameter parsing", () => {
  it("applies defaults only when limit and boolean params are absent", () => {
    expect(parseQueryLimit(new URLSearchParams(), 50)).toBe(50);
    expect(parseQueryBoolean(new URLSearchParams(), "active", true)).toBe(true);
  });

  it.each(["0", "101", "1.5", "1e2", " 5", "five", ""])(
    "rejects ambiguous or out-of-range limit %j",
    (limit) => {
      expectQueryValidationError(
        () => parseQueryLimit(new URLSearchParams({ limit }), 50),
        "/limit",
      );
    },
  );

  it("accepts canonical integer and boolean serializations", () => {
    expect(parseQueryLimit(new URLSearchParams({ limit: "100" }), 50)).toBe(100);
    expect(
      parseQueryBoolean(new URLSearchParams({ active: "false" }), "active", true),
    ).toBe(false);
  });

  it.each(["FALSE", "0", "yes", ""])(
    "rejects non-canonical boolean %j",
    (active) => {
      expectQueryValidationError(
        () =>
          parseQueryBoolean(
            new URLSearchParams({ active }),
            "active",
            true,
          ),
        "/active",
      );
    },
  );

  it("rejects duplicate declared query parameters", () => {
    const params = new URLSearchParams("limit=5&limit=10");
    expectQueryValidationError(() => parseQueryLimit(params, 50), "/limit");
  });

  it("validates optional enums without silently dropping invalid values", () => {
    const allowed = ["crawl", "gsc", "ga4", "csv", "dataforseo"] as const;
    expect(
      parseOptionalQueryEnum(
        new URLSearchParams({ provider: "csv" }),
        "provider",
        allowed,
      ),
    ).toBe("csv");
    expect(
      parseOptionalQueryEnum(new URLSearchParams(), "provider", allowed),
    ).toBeNull();
    expectQueryValidationError(
      () =>
        parseOptionalQueryEnum(
          new URLSearchParams({ provider: "unknown-provider-secret" }),
          "provider",
          allowed,
        ),
      "/provider",
    );
  });

  it("does not include an invalid query value in the stable error", () => {
    const marker = "customer-query-secret";
    let caught: unknown;
    try {
      parseOptionalQueryEnum(
        new URLSearchParams({ provider: marker }),
        "provider",
        ["crawl", "gsc"] as const,
      );
    } catch (error) {
      caught = error;
    }
    expect(JSON.stringify(caught)).not.toContain(marker);
  });

  it("supports reusable Zod-backed scalar validation", () => {
    const valid = Buffer.from(
      "2026-07-19T00:00:00.000Z 00000000-0000-4000-8000-000000000001",
    ).toString("base64url");
    expect(
      parseQueryValue(new URLSearchParams({ cursor: valid }), "cursor", Cursor),
    ).toBe(valid);
    expect(parseQueryValue(new URLSearchParams(), "cursor", Cursor)).toBeNull();
    expectQueryValidationError(
      () =>
        parseQueryValue(
          new URLSearchParams({ cursor: "not+a+base64url" }),
          "cursor",
          Cursor,
        ),
      "/cursor",
    );
  });

  it("accepts only canonical, positive, safe integer revision values", () => {
    expect(
      parseOptionalQueryInteger(
        new URLSearchParams({ revision: "27" }),
        "revision",
        { minimum: 1 },
      ),
    ).toBe(27);
    expect(
      parseOptionalQueryInteger(new URLSearchParams(), "revision", {
        minimum: 1,
      }),
    ).toBeNull();

    for (const revision of [
      "0",
      "-1",
      "1.0",
      "01",
      "1e2",
      "9007199254740992",
      "",
    ]) {
      expectQueryValidationError(
        () =>
          parseOptionalQueryInteger(
            new URLSearchParams({ revision }),
            "revision",
            { minimum: 1 },
          ),
        "/revision",
      );
    }
  });
});
